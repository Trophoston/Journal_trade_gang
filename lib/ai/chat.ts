import { randomUUID } from "node:crypto";
import { Type, type Content, type FunctionDeclaration } from "@google/genai";
import { breakdown, outcome, summarize } from "../analytics/metrics";
import { cols } from "../db/collections";
import type { TradeDoc } from "../domain/types";
import { fmtDateTime } from "../format";
import { ensureEvidence } from "../market/service";
import { activeAccount, closedTrades } from "../queries/core";
import { getSettings } from "../settings";
import { SESSION_LABEL, type SessionId } from "../time/sessions";
import { NY_TZ, zonedParts } from "../time/zone";
import { chatContext, tradeRow } from "./context";
import { SYSTEM, languageRule } from "./prompts";
import { chatStream, type ChatEvent } from "./provider";
import type { AiThread, ThreadMessage } from "./types";

export type ChatOut =
  | { type: "thread"; id: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "done" }
  | { type: "error"; message: string };

const GROUPS = ["session", "weekday", "hour", "symbol", "setup", "side", "mistake", "emotion", "confluence"] as const;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TOOLS: FunctionDeclaration[] = [
  {
    name: "getStats",
    description: "Win rate, average R, net and sample size for the trader's closed trades, optionally grouped. Use it before claiming anything about strong or weak times, setups or symbols.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        groupBy: { type: Type.STRING, enum: [...GROUPS], description: "Optional grouping" },
        from: { type: Type.STRING, description: "First trading day, YYYY-MM-DD" },
        to: { type: Type.STRING, description: "Last trading day, YYYY-MM-DD" },
        symbol: { type: Type.STRING },
        setup: { type: Type.STRING },
      },
    },
  },
  {
    name: "listTrades",
    description: "List closed trades (newest first) with day, symbol, side, session, R, net, setup and tags.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        from: { type: Type.STRING },
        to: { type: Type.STRING },
        symbol: { type: Type.STRING },
        setup: { type: Type.STRING },
        outcome: { type: Type.STRING, enum: ["win", "loss", "be"] },
        limit: { type: Type.INTEGER, description: "Max rows, default 20" },
      },
    },
  },
  {
    name: "getTrade",
    description: "Full facts for one trade plus the chart evidence items (sweeps, FVGs, news, MAE/MFE).",
    parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING } }, required: ["id"] },
  },
  {
    name: "getNews",
    description: "Economic calendar events between two UTC timestamps.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        from: { type: Type.STRING, description: "ISO timestamp" },
        to: { type: Type.STRING, description: "ISO timestamp" },
        currency: { type: Type.STRING },
        highOnly: { type: Type.BOOLEAN },
      },
      required: ["from", "to"],
    },
  },
];

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

async function runTool(name: string, args: Args): Promise<{ result: unknown; summary: string }> {
  const settings = await getSettings();
  const account = await activeAccount();
  if (!account) return { result: { error: "No account yet" }, summary: "no account" };
  const tz = settings.timezone;

  if (name === "getStats" || name === "listTrades") {
    let trades = await closedTrades(account._id, { from: str(args.from), to: str(args.to), symbol: str(args.symbol), setup: str(args.setup) });
    if (name === "listTrades") {
      if (args.outcome) trades = trades.filter((t) => outcome(t) === args.outcome);
      const limit = Math.min(Number(args.limit) || 20, 50);
      const rows = trades.slice(-limit).reverse().map((t) => tradeRow(t, tz));
      return { result: rows, summary: `${rows.length} trades` };
    }
    const group = str(args.groupBy) as (typeof GROUPS)[number] | undefined;
    const s = summarize(trades);
    const overall = { n: s.count, winRate: s.winRate === null ? null : Math.round(s.winRate * 1000) / 10, avgR: s.avgR, net: s.net, profitFactor: s.profitFactor };
    if (!group) return { result: overall, summary: `${s.count} trades overall` };
    const key: Record<(typeof GROUPS)[number], (t: TradeDoc) => string | string[] | null | undefined> = {
      session: (t) => SESSION_LABEL[t.session as SessionId],
      weekday: (t) => WEEKDAY[new Date(t.tradingDay).getUTCDay()],
      hour: (t) => `${String(zonedParts(t.openedAt, tz).h).padStart(2, "0")}:00 local / ${String(zonedParts(t.openedAt, NY_TZ).h).padStart(2, "0")}:00 NY`,
      symbol: (t) => t.symbol,
      setup: (t) => t.journal?.setup,
      side: (t) => t.side,
      mistake: (t) => t.journal?.mistakes,
      emotion: (t) => t.journal?.emotions,
      confluence: (t) => t.journal?.confluences,
    };
    const rows = breakdown(trades, key[group]).map((r) => ({ key: r.label, n: r.n, winRate: r.winRate === null ? null : Math.round(r.winRate * 1000) / 10, avgR: r.avgR === null ? null : Math.round(r.avgR * 100) / 100, net: Math.round(r.net * 100) / 100 }));
    return { result: { overall, rows, minSampleForConclusions: settings.minSample }, summary: `stats by ${group}` };
  }

  if (name === "getTrade") {
    const c = await cols();
    const t = await c.trades.findOne({ _id: String(args.id), accountId: account._id });
    if (!t) return { result: { error: "Trade not found" }, summary: "trade not found" };
    const full = await ensureEvidence(t);
    return {
      result: { ...tradeRow(full, tz), entry: full.entryPrice, exit: full.exitPrice, sl: full.sl0, tp: full.tp0, mae: full.mae, mfe: full.mfe, notes: full.journal?.notes, evidence: full.evidence?.items ?? [] },
      summary: `${full.symbol} ${full.side} ${full.tradingDay}`,
    };
  }

  if (name === "getNews") {
    const c = await cols();
    const from = new Date(String(args.from));
    const to = new Date(String(args.to));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { result: { error: "Invalid dates" }, summary: "invalid dates" };
    const q: Record<string, unknown> = { time: { $gte: from, $lte: to }, source: account.source };
    if (str(args.currency)) q.currency = str(args.currency);
    q.importance = args.highOnly ? "high" : { $in: ["medium", "high"] };
    const events = await c.events.find(q).sort({ time: 1 }).limit(40).toArray();
    return {
      result: events.map((e) => ({ time: fmtDateTime(e.time, tz), currency: e.currency, event: e.name, importance: e.importance, actual: e.actual, forecast: e.forecast, previous: e.previous })),
      summary: `${events.length} events`,
    };
  }
  return { result: { error: `Unknown tool ${name}` }, summary: "unknown tool" };
}

async function* mockReply(question: string, ctx: Record<string, unknown>, lang: "th" | "en"): AsyncGenerator<ChatEvent> {
  const report = ctx.report as { title?: string } | null;
  const text =
    lang === "th"
      ? `**(โหมด mock — ยังไม่ได้ต่อ Gemini)**\n\nคุณถามว่า: _${question}_\n\nจาก${report?.title ? ` “${report.title}”` : "ข้อมูลในบันทึก"} สิ่งที่ควรดูต่อคือ:\n\n- เทียบผลของ setup นี้ในแต่ละ session (ใช้ **n ≥ 8** ก่อนสรุป)\n- ดูว่า stop อยู่เลย liquidity sweep wick หรือไม่\n- ถ้าเทรดหลังแพ้ภายใน 60 นาที ผลมักแย่ลง\n\nใส่ \`GEMINI_API_KEY\` ใน \`.env.local\` แล้วตั้ง \`AI_PROVIDER=gemini\` เพื่อคุยกับ Gemini จริง`
      : `**(Mock mode — Gemini is not connected)**\n\nYou asked: _${question}_\n\nBased on ${report?.title ? `“${report.title}”` : "your journal"}, look at:\n\n- This setup's results per session (wait for **n ≥ 8** before concluding)\n- Whether the stop sat beyond the liquidity-sweep wick\n- Trades taken within 60 minutes after a loss tend to do worse\n\nAdd \`GEMINI_API_KEY\` to \`.env.local\` and set \`AI_PROVIDER=gemini\` to chat with Gemini.`;
  for (const chunk of text.match(/.{1,18}/gs) ?? []) {
    await new Promise((r) => setTimeout(r, 25));
    yield { type: "text", delta: chunk };
  }
}

export interface ChatTurnInput {
  threadId?: string;
  scopeKey: string;
  reportId?: string;
  message: string;
}

/** One user turn: streams text and tool notices, runs up to 4 tool rounds, saves the thread. */
export async function* chatTurn(input: ChatTurnInput): AsyncGenerator<ChatOut> {
  const c = await cols();
  const settings = await getSettings();
  const account = await activeAccount();
  const now = new Date();
  let thread: AiThread | null = input.threadId ? await c.aiThreads.findOne({ _id: input.threadId }) : null;
  if (!thread) {
    thread = {
      _id: randomUUID(),
      scopeKey: input.scopeKey,
      reportId: input.reportId,
      accountId: account?._id ?? "",
      title: input.message.slice(0, 80),
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    await c.aiThreads.insertOne(thread);
  }
  yield { type: "thread", id: thread._id };

  const report = thread.reportId ? await c.aiReports.findOne({ _id: thread.reportId }) : null;
  const ctx = await chatContext(thread.scopeKey, report);
  const system = `${SYSTEM.chat}\n\n${languageRule(settings.ai.language)}\n\nToday is ${now.toISOString().slice(0, 10)}. Context JSON:\n${JSON.stringify(ctx)}`;

  const userMsg: ThreadMessage = { role: "user", text: input.message, at: now };
  await c.aiThreads.updateOne({ _id: thread._id }, { $push: { messages: userMsg }, $set: { updatedAt: now } });

  const contents: Content[] = [...thread.messages, userMsg].map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
  let answer = "";
  const tools: NonNullable<ThreadMessage["tools"]> = [];
  try {
    for (let round = 0; round < 5; round++) {
      let calls: { name: string; args: Record<string, unknown> }[] = [];
      let modelContent: Content | undefined;
      const stream = chatStream(
        { model: settings.ai.fastModel, system, contents, tools: round < 4 ? TOOLS : [] },
        () => mockReply(input.message, ctx, settings.ai.language),
      );
      for await (const ev of stream) {
        if (ev.type === "text") {
          answer += ev.delta;
          yield ev;
        } else {
          calls = ev.calls;
          modelContent = ev.content;
        }
      }
      if (!calls.length || !modelContent) break;
      contents.push(modelContent);
      const responses = [];
      for (const call of calls) {
        const { result, summary } = await runTool(call.name, call.args);
        tools.push({ name: call.name, args: call.args, summary });
        yield { type: "tool", name: call.name, summary };
        responses.push({ functionResponse: { name: call.name, response: { result } } });
      }
      contents.push({ role: "user", parts: responses });
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
  if (answer) {
    const modelMsg: ThreadMessage = { role: "model", text: answer, ...(tools.length ? { tools } : {}), at: new Date() };
    await c.aiThreads.updateOne({ _id: thread._id }, { $push: { messages: modelMsg }, $set: { updatedAt: new Date() } });
  }
  yield { type: "done" };
}
