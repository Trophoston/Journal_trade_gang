"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { cols } from "../db/collections";
import { activeAccount } from "../queries/core";
import { enqueue } from "../ai/queue";
import { runReport } from "../ai/tasks";
import type { AiReport, AiThread, ReportKind } from "../ai/types";

const kinds = ["trade", "daily", "weekly", "brief"] as const;

function scopeFor(kind: ReportKind, accountId: string, payload: Record<string, string>) {
  if (kind === "trade") return `trade:${payload.tradeId}`;
  if (kind === "daily") return `daily:${accountId}:${payload.day}`;
  if (kind === "weekly") return `weekly:${accountId}:${payload.monday}`;
  return `brief:${accountId}:${payload.day}`;
}

/** Manual run (or re-run): always produces a new report version. */
export async function runAi(kind: (typeof kinds)[number], payload: Record<string, string>) {
  z.enum(kinds).parse(kind);
  const account = await activeAccount();
  if (!account) return { ok: false as const, error: "ยังไม่มีบัญชี" };
  const scopeKey = scopeFor(kind, account._id, payload);
  const res = await enqueue({ kind, scopeKey, accountId: account._id, payload, auto: false });
  return { ok: true as const, scopeKey, ...res };
}

/** "Analyze selected" in the trades table: one queued job per trade without a report. */
export async function analyzeTrades(tradeIds: string[]) {
  const ids = z.array(z.string()).max(200).parse(tradeIds);
  const account = await activeAccount();
  if (!account) return { queued: 0, skipped: 0, keys: [] as string[] };
  const c = await cols();
  const done = new Set((await c.aiReports.find({ kind: "trade", scopeKey: { $in: ids.map((id) => `trade:${id}`) } }, { projection: { scopeKey: 1 } }).toArray()).map((r) => r.scopeKey));
  const keys: string[] = [];
  for (const id of ids) {
    if (done.has(`trade:${id}`)) continue;
    const r = await enqueue({ kind: "trade", scopeKey: `trade:${id}`, accountId: account._id, payload: { tradeId: id }, auto: false });
    if (r.status === "queued") keys.push(`trade:${id}`);
  }
  return { queued: keys.length, skipped: ids.length - keys.length, keys };
}

const preTradeInput = z.object({
  symbol: z.string().min(1).max(20),
  side: z.enum(["long", "short"]),
  setup: z.string().max(80).optional(),
  confluences: z.array(z.string().max(60)).max(12).optional(),
  riskPct: z.number().min(0).max(20).optional(),
  notes: z.string().max(1000).optional(),
});

/** Pre-trade check runs right away (not queued) and is saved to Coach history. */
export async function preTradeCheck(input: z.infer<typeof preTradeInput>): Promise<{ ok: true; report: AiReport } | { ok: false; error: string }> {
  const parsed = preTradeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "ตรวจสอบข้อมูลในฟอร์มอีกครั้ง" };
  const account = await activeAccount();
  if (!account) return { ok: false, error: "ยังไม่มีบัญชี" };
  try {
    const report = await runReport(
      { kind: "pretrade", scopeKey: `pretrade:${account._id}:${Date.now()}`, accountId: account._id, payload: { input: JSON.stringify(parsed.data) }, auto: false },
      async () => {},
    );
    refresh();
    return { ok: true, report: JSON.parse(JSON.stringify(report)) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "AI request failed" };
  }
}

export async function getThread(threadId: string): Promise<AiThread | null> {
  const c = await cols();
  const t = await c.aiThreads.findOne({ _id: z.string().parse(threadId) });
  return t ? JSON.parse(JSON.stringify(t)) : null;
}

export async function listThreads(scopeKey: string) {
  const c = await cols();
  const threads = await c.aiThreads.find({ scopeKey: z.string().parse(scopeKey) }, { projection: { messages: 0 } }).sort({ updatedAt: -1 }).limit(20).toArray();
  return threads.map((t) => ({ id: t._id, title: t.title, updatedAt: t.updatedAt.toISOString() }));
}

export async function reportVersions(scopeKey: string) {
  const c = await cols();
  const reports = await c.aiReports.find({ scopeKey: z.string().parse(scopeKey) }).sort({ version: -1 }).toArray();
  return JSON.parse(JSON.stringify(reports)) as AiReport[];
}
