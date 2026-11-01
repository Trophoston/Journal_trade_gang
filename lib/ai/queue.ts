import { cols } from "../db/collections";
import type { TradeDoc } from "../domain/types";
import { publish } from "../live/bus";
import { getSettings } from "../settings";
import { AiConfigError, aiConfigured, RateLimitError } from "./provider";
import { runReport, STEPS } from "./tasks";
import type { AiJob, ReportKind } from "./types";

/**
 * Persisted, single-worker AI queue.
 * - An automatic job never runs for a scope that already has a report (run once).
 * - A manual job (`force`) always runs and stores the next report version.
 * - Rate limits push the job back instead of failing it.
 */

export interface EnqueueInput {
  kind: ReportKind;
  scopeKey: string;
  accountId: string;
  payload: Record<string, string>;
  auto: boolean;
  runAfter?: Date;
}

export type EnqueueResult = { status: "queued" | "exists" | "running"; jobId?: string; reportId?: string };

export async function enqueue(input: EnqueueInput): Promise<EnqueueResult> {
  const c = await cols();
  const active = await c.aiJobs.findOne({ kind: input.kind, scopeKey: input.scopeKey, active: true });
  if (active) {
    // a manual request pulls a delayed automatic job forward
    if (!input.auto && active.status === "queued") {
      await c.aiJobs.updateOne({ _id: active._id }, { $set: { runAfter: new Date(), auto: false, force: true, updatedAt: new Date() } });
      wake();
    }
    return { status: active.status === "running" ? "running" : "queued", jobId: String(active._id) };
  }
  if (input.auto) {
    const report = await c.aiReports.findOne({ kind: input.kind, scopeKey: input.scopeKey }, { projection: { _id: 1 } });
    if (report) return { status: "exists", reportId: report._id };
  }
  const now = new Date();
  const job: AiJob = {
    kind: input.kind,
    scopeKey: input.scopeKey,
    accountId: input.accountId,
    payload: input.payload,
    status: "queued",
    active: true,
    auto: input.auto,
    force: !input.auto,
    runAfter: input.runAfter ?? now,
    attempts: 0,
    steps: STEPS[input.kind],
    createdAt: now,
    updatedAt: now,
  };
  try {
    const res = await c.aiJobs.insertOne(job);
    wake();
    return { status: "queued", jobId: String(res.insertedId) };
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    const again = await c.aiJobs.findOne({ kind: input.kind, scopeKey: input.scopeKey, active: true });
    return { status: again?.status === "running" ? "running" : "queued", jobId: again ? String(again._id) : undefined };
  }
}

/** Auto-analysis for a freshly closed live trade, after the configured delay (gives time to tag it). */
export async function scheduleTradeAnalysis(trade: Pick<TradeDoc, "_id" | "accountId" | "closedAt">) {
  const settings = await getSettings();
  if (!settings.ai.autoTrade) return;
  const base = Math.max(Date.now(), trade.closedAt?.getTime() ?? 0);
  const runAfter = new Date(Math.max(Date.now(), base + settings.ai.analyzeDelayMin * 60_000));
  await enqueue({ kind: "trade", scopeKey: `trade:${trade._id}`, accountId: trade.accountId, payload: { tradeId: trade._id }, auto: true, runAfter });
}

/** Tagging a trade means the context is ready: run its queued analysis now. */
export async function expediteTrade(tradeId: string) {
  const c = await cols();
  const res = await c.aiJobs.updateOne({ kind: "trade", scopeKey: `trade:${tradeId}`, active: true, status: "queued" }, { $set: { runAfter: new Date() } });
  if (res.modifiedCount) wake();
}

export async function activeJobs(accountId?: string) {
  const c = await cols();
  return c.aiJobs.find({ active: true, ...(accountId ? { accountId } : {}) }).sort({ runAfter: 1 }).toArray();
}

// ---------------------------------------------------------------- runner

const g = globalThis as unknown as { __tgRunner?: { started: boolean; busy: boolean; timer?: NodeJS.Timeout } };
const state = (g.__tgRunner ??= { started: false, busy: false });

function wake() {
  if (!state.started) return;
  setImmediate(() => void tick());
}

export async function startRunner() {
  if (state.started) return;
  state.started = true;
  const c = await cols();
  // a job left "running" means the server stopped mid-call
  await c.aiJobs.updateMany({ active: true, status: "running" }, { $set: { status: "queued", updatedAt: new Date() } });
  state.timer = setInterval(() => void tick(), 5_000);
  state.timer.unref?.();
  void tick();
}

async function tick() {
  if (state.busy || !aiConfigured()) return;
  state.busy = true;
  try {
    for (;;) {
      const c = await cols();
      const job = await c.aiJobs.findOneAndUpdate(
        { active: true, status: "queued", runAfter: { $lte: new Date() } },
        { $set: { status: "running", step: 0, updatedAt: new Date() }, $inc: { attempts: 1 } },
        { sort: { force: -1, runAfter: 1 }, returnDocument: "after" },
      );
      if (!job) break;
      await runJob(job);
    }
  } catch (err) {
    console.error("[ai] queue tick failed", err);
  } finally {
    state.busy = false;
  }
}

async function runJob(job: AiJob) {
  const c = await cols();
  const id = String(job._id);
  const progress = async (step: number) => {
    await c.aiJobs.updateOne({ _id: job._id }, { $set: { step, updatedAt: new Date() } });
    publish({ type: "ai.progress", jobId: id, scopeKey: job.scopeKey, kind: job.kind, step, steps: job.steps });
  };
  try {
    if (job.auto && !job.force) {
      const existing = await c.aiReports.findOne({ kind: job.kind, scopeKey: job.scopeKey }, { projection: { _id: 1 } });
      if (existing) {
        await c.aiJobs.updateOne({ _id: job._id }, { $set: { status: "done", active: false, reportId: existing._id, updatedAt: new Date() } });
        return;
      }
    }
    const report = await runReport(job, progress);
    await c.aiJobs.updateOne({ _id: job._id }, { $set: { status: "done", active: false, reportId: report._id, updatedAt: new Date() }, $unset: { error: "" } });
    publish({ type: "ai.done", jobId: id, scopeKey: job.scopeKey, kind: job.kind, reportId: report._id, title: report.title });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof RateLimitError) {
      const runAfter = new Date(Date.now() + err.retryAfterMs);
      await c.aiJobs.updateOne(
        { _id: job._id },
        { $set: { status: "queued", runAfter, error: `${message} จะลองใหม่เวลา ${runAfter.toISOString()}`, updatedAt: new Date() }, $inc: { attempts: -1 } },
      );
      publish({ type: "ai.failed", jobId: id, scopeKey: job.scopeKey, kind: job.kind, error: `${message} ระบบจะลองใหม่อัตโนมัติ` });
      return;
    }
    const permanent = err instanceof AiConfigError || job.attempts >= 3;
    if (permanent) {
      await c.aiJobs.updateOne({ _id: job._id }, { $set: { status: "failed", active: false, error: message, updatedAt: new Date() } });
    } else {
      const runAfter = new Date(Date.now() + 2 ** job.attempts * 60_000);
      await c.aiJobs.updateOne({ _id: job._id }, { $set: { status: "queued", runAfter, error: message, updatedAt: new Date() } });
    }
    console.error(`[ai] ${job.kind} ${job.scopeKey} failed:`, message);
    publish({ type: "ai.failed", jobId: id, scopeKey: job.scopeKey, kind: job.kind, error: message });
  }
}
