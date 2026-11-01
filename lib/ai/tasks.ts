import type { Part } from "@google/genai";
import { cols } from "../db/collections";
import { fmtDay } from "../format";
import { getSettings } from "../settings";
import { weekLabel } from "../time/zone";
import { briefContext, dayContext, preTradeContext, tradeContext, weekContext, type BuiltContext, type PreTradeInput } from "./context";
import { mockBrief, mockDaily, mockPreTrade, mockTrade, mockWeekly } from "./mock";
import { PROMPT_VERSION, SYSTEM, languageRule } from "./prompts";
import { generateJson, groundedSearch, type Thinking } from "./provider";
import { briefSchema, dailyReviewSchema, preTradeSchema, tradeAnalysisSchema, weeklyReviewSchema } from "./schemas";
import type { AiReport, ReportKind, Source } from "./types";

export const STEPS: Record<ReportKind, string[]> = {
  trade: ["Reading the trade and executions", "Scanning candles for sweeps and FVGs", "Checking the economic calendar", "Comparing with your history", "Gemini is writing the analysis"],
  daily: ["Collecting today's trades", "Checking rules and journal notes", "Gemini is writing the daily review"],
  weekly: ["Collecting the week", "Ranking sessions, hours and setups", "Checking last week's rules", "Gemini is writing the weekly review"],
  brief: ["Loading your edge by session", "Checking today's calendar", "Gemini is writing today's brief"],
  pretrade: ["Matching your history", "Checking news and limits", "Gemini is grading the setup"],
};

type Progress = (step: number) => Promise<void>;

function partsOf(ctx: BuiltContext, extra?: string): Part[] {
  return [{ text: `${extra ? `${extra}\n\n` : ""}Context JSON:\n${JSON.stringify(ctx.json)}` }, ...ctx.images];
}

async function saveReport(r: Omit<AiReport, "_id" | "version" | "createdAt">): Promise<AiReport> {
  const c = await cols();
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await c.aiReports.find({ kind: r.kind, scopeKey: r.scopeKey }).sort({ version: -1 }).limit(1).next();
    const version = (latest?.version ?? 0) + 1;
    const doc: AiReport = { ...r, _id: `${r.scopeKey}#${version}`, version, createdAt: new Date() };
    try {
      await c.aiReports.insertOne(doc);
      return doc;
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  throw new Error("บันทึกรายงานไม่ได้");
}

interface RunInput {
  kind: ReportKind;
  scopeKey: string;
  accountId: string;
  payload: Record<string, string>;
  auto: boolean;
}

/** Build context → call Gemini → store a new report version. */
export async function runReport(job: RunInput, progress: Progress): Promise<AiReport> {
  const settings = await getSettings();
  const lang = settings.ai.language;
  const system = `${SYSTEM[job.kind]}\n\n${languageRule(lang)}`;
  const fast = settings.ai.fastModel;
  const deep = settings.ai.deepModel;
  const fallbackModels = [fast, settings.ai.liteModel];

  const run = async <T,>(ctx: BuiltContext, schema: import("zod").ZodType<T>, mock: () => T, model: string, thinking: Thinking, extra?: string) => {
    return generateJson({ kind: job.kind, model, fallbackModels, system, parts: partsOf(ctx, extra), schema, thinking, mock });
  };

  if (job.kind === "trade") {
    await progress(0);
    const tradeId = job.payload.tradeId;
    await progress(1);
    const ctx = await tradeContext(tradeId);
    await progress(2);
    let sources: Source[] = [];
    let extra = "";
    const unexplained = ctx.trade.evidence?.items.some((e) => e.kind === "volatility") && !ctx.trade.evidence?.items.some((e) => e.kind === "news");
    if (settings.ai.useSearch && unexplained && ctx.trade.closedAt) {
      try {
        const s = await groundedSearch(settings.ai.searchModel, `What market-moving headlines affected ${ctx.trade.symbol} between ${ctx.trade.openedAt.toISOString()} and ${ctx.trade.closedAt.toISOString()}? Answer in 3 short bullet points with times in UTC. If nothing notable, say so.`);
        sources = s.sources;
        if (s.text) extra = `Web headlines found by Google Search for this window (cite as "web"):\n${s.text}`;
      } catch {
        // search is optional context
      }
    }
    await progress(3);
    await progress(4);
    const res = await run(ctx, tradeAnalysisSchema, () => mockTrade(ctx.json, lang), fast, "low", extra);
    const t = ctx.trade;
    return saveReport({
      kind: "trade",
      scopeKey: job.scopeKey,
      accountId: t.accountId,
      title: `${t.symbol} ${t.side === "long" ? "Buy" : "Sell"} · ${fmtDay(t.tradingDay)}`,
      model: res.model,
      promptVersion: PROMPT_VERSION,
      inputHash: ctx.hash,
      lang,
      content: res.data,
      sources,
      usage: res.usage,
      auto: job.auto,
    });
  }

  if (job.kind === "daily") {
    await progress(0);
    const ctx = await dayContext(job.accountId, job.payload.day);
    await progress(1);
    await progress(2);
    const res = await run(ctx, dailyReviewSchema, () => mockDaily(ctx.json, lang), fast, "medium");
    return saveReport({
      kind: "daily",
      scopeKey: job.scopeKey,
      accountId: job.accountId,
      title: `รีวิวรายวัน · ${fmtDay(job.payload.day)}`,
      model: res.model,
      promptVersion: PROMPT_VERSION,
      inputHash: ctx.hash,
      lang,
      content: res.data,
      sources: [],
      usage: res.usage,
      auto: job.auto,
    });
  }

  if (job.kind === "weekly") {
    await progress(0);
    const ctx = await weekContext(job.accountId, job.payload.monday);
    await progress(1);
    await progress(2);
    await progress(3);
    const res = await run(ctx, weeklyReviewSchema, () => mockWeekly(ctx.json, lang), deep, "high");
    return saveReport({
      kind: "weekly",
      scopeKey: job.scopeKey,
      accountId: job.accountId,
      title: `รีวิวรายสัปดาห์ · ${weekLabel(job.payload.monday)}`,
      model: res.model,
      promptVersion: PROMPT_VERSION,
      inputHash: ctx.hash,
      lang,
      content: res.data,
      sources: [],
      usage: res.usage,
      auto: job.auto,
    });
  }

  if (job.kind === "brief") {
    await progress(0);
    const ctx = await briefContext(job.accountId, job.payload.day);
    await progress(1);
    await progress(2);
    const res = await run(ctx, briefSchema, () => mockBrief(ctx.json, lang), fast, "low");
    return saveReport({
      kind: "brief",
      scopeKey: job.scopeKey,
      accountId: job.accountId,
      title: `Brief เทรดถัดไป · ${fmtDay(job.payload.day)}`,
      model: res.model,
      promptVersion: PROMPT_VERSION,
      inputHash: ctx.hash,
      lang,
      content: res.data,
      sources: [],
      usage: res.usage,
      auto: job.auto,
    });
  }

  await progress(0);
  const input = JSON.parse(job.payload.input) as PreTradeInput;
  const ctx = await preTradeContext(job.accountId, input);
  await progress(1);
  await progress(2);
  const res = await run(ctx, preTradeSchema, () => mockPreTrade(ctx.json, lang), fast, "low");
  return saveReport({
    kind: "pretrade",
    scopeKey: job.scopeKey,
    accountId: job.accountId,
    title: `Pre-trade · ${input.symbol} ${input.side}${input.setup ? ` · ${input.setup}` : ""}`,
    model: res.model,
    promptVersion: PROMPT_VERSION,
    inputHash: ctx.hash,
    lang,
    content: res.data,
    sources: [],
    usage: res.usage,
    auto: false,
  });
}
