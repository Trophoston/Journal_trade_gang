import { createHash } from "node:crypto";
import type { Part } from "@google/genai";
import { GridFSBucket } from "mongodb";
import { breakdown, outcome, summarize, strongWeak, type BreakdownRow, type Summary } from "../analytics/metrics";
import { guardrails } from "../analytics/guardrails";
import { db } from "../db/client";
import { cols } from "../db/collections";
import type { AccountDoc, TradeDoc } from "../domain/types";
import { fmtDateTime, fmtTime } from "../format";
import { ensureEvidence, newsAround } from "../market/service";
import { newsCurrencies } from "../mt5/symbols";
import { activeAccount, closedTrades } from "../queries/core";
import { getSettings, type SettingsDoc } from "../settings";
import { SESSION_LABEL, sessionSpans, type SessionId } from "../time/sessions";
import { addDays, NY_TZ, tradingDayBounds, tradingDayOf, weekStartOf, zonedParts } from "../time/zone";
import type { AiReport } from "./types";

export interface BuiltContext {
  json: Record<string, unknown>;
  images: Part[];
  hash: string;
}

const r2 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

function hashOf(x: unknown) {
  return createHash("sha1").update(JSON.stringify(x)).digest("hex").slice(0, 16);
}

export function tradeRow(t: TradeDoc, tz: string) {
  return {
    id: t._id,
    day: t.tradingDay,
    symbol: t.symbol,
    side: t.side,
    session: SESSION_LABEL[t.session],
    opened: fmtDateTime(t.openedAt, tz),
    minutes: t.durationSec ? Math.round(t.durationSec / 60) : null,
    r: r2(t.r),
    net: r2(t.net),
    outcome: outcome(t),
    closeReason: t.closeReason ?? null,
    setup: t.journal?.setup ?? null,
    confluences: t.journal?.confluences ?? [],
    emotions: t.journal?.emotions ?? [],
    mistakes: t.journal?.mistakes ?? [],
    followedPlan: t.journal?.followedPlan ?? null,
  };
}

function summaryJson(s: Summary) {
  return {
    trades: s.count,
    wins: s.wins,
    losses: s.losses,
    breakeven: s.be,
    winRate: s.winRate === null ? null : r2(s.winRate * 100),
    net: s.net,
    avgR: r2(s.avgR),
    profitFactor: s.profitFactor === null || !Number.isFinite(s.profitFactor) ? null : r2(s.profitFactor),
    expectancy: s.expectancy,
    largestWin: s.largestWin,
    largestLoss: s.largestLoss,
  };
}

/** Numbered statistic rows (S1…) the model can cite. */
class Stats {
  rows: Record<string, unknown>[] = [];
  add(group: string, r: BreakdownRow) {
    const id = `S${this.rows.length + 1}`;
    this.rows.push({ id, group, key: r.label, n: r.n, winRate: r.winRate === null ? null : r2(r.winRate * 100), avgR: r2(r.avgR), net: r2(r.net) });
    return id;
  }
  addAll(group: string, rows: BreakdownRow[], max = 8) {
    rows.slice(0, max).forEach((r) => this.add(group, r));
  }
}

function rulesJson(s: SettingsDoc, account: AccountDoc | null) {
  return { ...s.rules, ...(account?.rules ?? {}), personal: s.customRules, playbook: s.playbook };
}

async function screenshotParts(t: TradeDoc, enabled: boolean): Promise<Part[]> {
  if (!enabled || !t.journal?.screenshots?.length) return [];
  const bucket = new GridFSBucket(await db(), { bucketName: "screenshots" });
  const parts: Part[] = [];
  for (const s of t.journal.screenshots.slice(0, 3)) {
    try {
      const { ObjectId } = await import("mongodb");
      const file = await bucket.find({ _id: new ObjectId(s.id) }).next();
      if (!file || file.length > 6_000_000) continue;
      const chunks: Buffer[] = [];
      for await (const chunk of bucket.openDownloadStream(file._id)) chunks.push(chunk as Buffer);
      parts.push({ inlineData: { mimeType: (file.metadata?.contentType as string) ?? "image/png", data: Buffer.concat(chunks).toString("base64") } });
    } catch {
      // a missing screenshot should not block the analysis
    }
  }
  return parts;
}

// ───────────────────────── Trade ─────────────────────────

export async function tradeContext(tradeId: string): Promise<BuiltContext & { trade: TradeDoc; account: AccountDoc | null }> {
  const c = await cols();
  const raw = await c.trades.findOne({ _id: tradeId });
  if (!raw) throw new Error("Trade not found");
  const trade = await ensureEvidence(raw);
  const [settings, account] = await Promise.all([getSettings(), c.accounts.findOne({ _id: trade.accountId })]);
  const tz = settings.timezone;
  const history = (await closedTrades(trade.accountId)).filter((t) => t._id !== trade._id && t.closedAt! < trade.closedAt!);
  const stats = new Stats();
  const same = (label: string, xs: TradeDoc[]) => {
    const s = summarize(xs);
    stats.rows.push({ id: `S${stats.rows.length + 1}`, group: "history", key: label, n: s.count, winRate: s.winRate === null ? null : r2(s.winRate * 100), avgR: r2(s.avgR), net: s.net });
  };
  if (trade.journal?.setup) same(`setup ${trade.journal.setup}`, history.filter((t) => t.journal?.setup === trade.journal.setup));
  same(`session ${SESSION_LABEL[trade.session]}`, history.filter((t) => t.session === trade.session));
  same(`symbol ${trade.symbol}`, history.filter((t) => t.symbol === trade.symbol));
  same(`${trade.symbol} ${trade.side}s`, history.filter((t) => t.symbol === trade.symbol && t.side === trade.side));

  const dayTrades = history.filter((t) => t.tradingDay === trade.tradingDay);
  const news = await newsAround(trade.symbol, new Date(trade.openedAt.getTime() - 2 * 3_600_000), new Date((trade.closedAt ?? trade.openedAt).getTime() + 2 * 3_600_000), trade.source);

  const json = {
    minSample: settings.minSample,
    timezone: tz,
    currency: account?.currency ?? "USD",
    trade: {
      ...tradeRow(trade, tz),
      openedNY: fmtDateTime(trade.openedAt, NY_TZ),
      closed: trade.closedAt ? fmtDateTime(trade.closedAt, tz) : null,
      volume: trade.volume,
      entry: trade.entryPrice,
      exit: trade.exitPrice ?? null,
      stopLoss: trade.sl0 ?? null,
      takeProfit: trade.tp0 ?? null,
      finalStop: trade.slFinal ?? null,
      stopMoves: (trade.slHistory ?? []).map((h) => ({ at: fmtTime(h.time, tz), sl: h.sl, tp: h.tp })),
      riskMoney: trade.riskMoney ?? null,
      pips: trade.pips ?? null,
      maeR: trade.mae?.r ?? null,
      mfeR: trade.mfe?.r ?? null,
      rating: trade.journal?.rating ?? null,
      notes: trade.journal?.notes ?? "",
      screenshots: trade.journal?.screenshots?.length ?? 0,
    },
    evidence: (trade.evidence?.items ?? []).map((e) => ({ id: e.id, kind: e.kind, polarity: e.polarity, title: e.title, detail: e.detail, tf: e.tf ?? null })),
    candleCoverage: trade.evidence?.coverage ?? [],
    news: news.map((n, i) => ({ id: `N${i + 1}`, time: fmtDateTime(n.time, tz), currency: n.currency, name: n.name, importance: n.importance, actual: n.actual, forecast: n.forecast, previous: n.previous })),
    dayBefore: {
      tradesEarlierToday: dayTrades.length,
      netEarlierToday: r2(dayTrades.reduce((s, t) => s + t.net, 0)),
      lastResult: dayTrades.length ? outcome(dayTrades[dayTrades.length - 1]) : null,
    },
    stats: stats.rows,
    rules: rulesJson(settings, account),
  };
  const images = await screenshotParts(trade, settings.ai.sendScreenshots);
  return { json, images, hash: hashOf({ json, images: images.length }), trade, account };
}

// ───────────────────────── Day ─────────────────────────

export async function dayContext(accountId: string, day: string): Promise<BuiltContext & { trades: TradeDoc[] }> {
  const c = await cols();
  const [settings, account] = await Promise.all([getSettings(), c.accounts.findOne({ _id: accountId })]);
  const tz = settings.timezone;
  const all = await closedTrades(accountId, { to: day });
  const trades = all.filter((t) => t.tradingDay === day);
  const recent = all.filter((t) => t.tradingDay < day && t.tradingDay >= addDays(day, -30));
  const journal = await c.days.findOne({ _id: `${accountId}:${day}` });
  const rules = rulesJson(settings, account);
  const breaks: string[] = [];
  if (rules.maxTradesPerDay && trades.length > rules.maxTradesPerDay) breaks.push(`Took ${trades.length} trades (max ${rules.maxTradesPerDay})`);
  if (rules.requireStopLoss) for (const t of trades.filter((x) => !x.sl0)) breaks.push(`No stop loss on ${t._id}`);
  const json = {
    minSample: settings.minSample,
    day,
    currency: account?.currency ?? "USD",
    summary: summaryJson(summarize(trades)),
    last30DaysPerDay: (() => {
      const s = summarize(recent);
      const days = new Set(recent.map((t) => t.tradingDay)).size || 1;
      return { tradingDays: days, avgTradesPerDay: r2(s.count / days), avgNetPerDay: r2(s.net / days), winRate: s.winRate === null ? null : r2(s.winRate * 100) };
    })(),
    trades: trades.map((t) => ({ ...tradeRow(t, tz), evidence: (t.evidence?.items ?? []).map((e) => `${e.polarity}: ${e.title}`), notes: t.journal?.notes ?? "" })),
    journal: journal ? { plan: journal.plan ?? "", bias: journal.bias ?? null, reflection: journal.reflection ?? "", mood: journal.mood ?? null } : null,
    detectedRuleBreaks: breaks,
    rules,
  };
  return { json, images: [], hash: hashOf(json), trades };
}

// ───────────────────────── Week ─────────────────────────

export async function weekContext(accountId: string, monday: string): Promise<BuiltContext & { trades: TradeDoc[] }> {
  const c = await cols();
  const [settings, account] = await Promise.all([getSettings(), c.accounts.findOne({ _id: accountId })]);
  const tz = settings.timezone;
  const end = addDays(monday, 6);
  const trades = await closedTrades(accountId, { from: monday, to: end });
  const prev = await closedTrades(accountId, { from: addDays(monday, -7), to: addDays(monday, -1) });
  const history = await closedTrades(accountId, { from: addDays(monday, -90), to: end });
  const stats = new Stats();
  const localHour = (t: TradeDoc) => String(zonedParts(t.openedAt, tz).h).padStart(2, "0") + ":00";
  stats.addAll("this week by session", breakdown(trades, (t) => t.session, (k) => SESSION_LABEL[k as SessionId]));
  stats.addAll("this week by weekday", breakdown(trades, (t) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][zonedParts(t.openedAt, NY_TZ).wd]));
  stats.addAll("this week by setup", breakdown(trades, (t) => t.journal?.setup));
  stats.addAll("this week by mistake", breakdown(trades, (t) => t.journal?.mistakes));
  stats.addAll("90 days by session", breakdown(history, (t) => t.session, (k) => SESSION_LABEL[k as SessionId]));
  stats.addAll("90 days by local hour", breakdown(history, localHour), 12);
  stats.addAll("90 days by setup", breakdown(history, (t) => t.journal?.setup));
  stats.addAll("90 days by confluence", breakdown(history, (t) => t.journal?.confluences));
  const lastWeekly = await c.aiReports.find({ kind: "weekly", accountId, scopeKey: { $lt: `weekly:${accountId}:${monday}` } }).sort({ scopeKey: -1, version: -1 }).limit(1).next();
  const days = await c.days.find({ accountId, day: { $gte: monday, $lte: end } }).toArray();
  const json = {
    minSample: settings.minSample,
    week: `${monday} to ${end}`,
    currency: account?.currency ?? "USD",
    summary: summaryJson(summarize(trades)),
    previousWeek: summaryJson(summarize(prev)),
    trades: trades.map((t) => tradeRow(t, tz)),
    stats: stats.rows,
    mistakesCost: breakdown(trades, (t) => t.journal?.mistakes).map((r) => ({ mistake: r.label, n: r.n, net: r.net })),
    lastWeekRules: (lastWeekly?.content as { nextWeekRules?: string[] } | undefined)?.nextWeekRules ?? [],
    journal: days.map((d) => ({ day: d.day, plan: d.plan ?? "", reflection: d.reflection ?? "", mood: d.mood ?? null })),
    rules: rulesJson(settings, account),
  };
  return { json, images: [], hash: hashOf(json), trades };
}

// ───────────────────────── Brief / pre-trade ─────────────────────────

async function edgeWindows(accountId: string, minN: number) {
  const history = await closedTrades(accountId, { from: addDays(tradingDayOf(new Date()), -120) });
  const sessions = breakdown(history, (t) => t.session, (k) => SESSION_LABEL[k as SessionId]);
  return { history, sessions, ranked: strongWeak(sessions, minN) };
}

export async function briefContext(accountId: string, day: string): Promise<BuiltContext> {
  const c = await cols();
  const [settings, account] = await Promise.all([getSettings(), c.accounts.findOne({ _id: accountId })]);
  const tz = settings.timezone;
  const { history, sessions } = await edgeWindows(accountId, settings.minSample);
  const today = history.filter((t) => t.tradingDay === day);
  const symbols = [...new Set(history.slice(-50).map((t) => t.symbol))];
  const currencies = [...new Set(symbols.flatMap(newsCurrencies))];
  const { start, end } = tradingDayBounds(day);
  const events = await c.events
    .find({ time: { $gte: new Date(Math.max(Date.now(), start.getTime())), $lte: end }, currency: { $in: currencies.length ? currencies : ["USD"] }, importance: { $in: ["medium", "high"] }, source: account?.source ?? "mt5" })
    .sort({ time: 1 })
    .limit(12)
    .toArray();
  const lastDaily = await c.aiReports.find({ kind: "daily", accountId }).sort({ createdAt: -1 }).limit(1).next();
  const lastWeekly = await c.aiReports.find({ kind: "weekly", accountId }).sort({ createdAt: -1 }).limit(1).next();
  const rules = rulesJson(settings, account);
  const stats = new Stats();
  stats.addAll("120 days by session", sessions);
  const json = {
    minSample: settings.minSample,
    day,
    now: fmtDateTime(new Date(), tz),
    sessionsToday: sessionSpans(day).map((s) => ({ session: s.label, local: `${fmtTime(s.start, tz)}–${fmtTime(s.end, tz)}`, killzone: s.kzStart ? `${fmtTime(s.kzStart, tz)}–${fmtTime(s.kzEnd!, tz)}` : null })),
    stats: stats.rows,
    todaySoFar: today.map((t) => tradeRow(t, tz)),
    guardrails: guardrails({ today, history, rules, startBalance: account?.balance ?? 0, minN: settings.minSample }),
    news: events.map((n, i) => ({ id: `N${i + 1}`, local: fmtTime(n.time, tz), currency: n.currency, name: n.name, importance: n.importance, forecast: n.forecast })),
    lastLesson: (lastDaily?.content as { keyLesson?: string; tomorrowFocus?: string[] } | undefined) ?? null,
    weekRules: (lastWeekly?.content as { nextWeekRules?: string[] } | undefined)?.nextWeekRules ?? [],
    rules,
  };
  return { json, images: [], hash: hashOf({ ...json, now: day }) };
}

export interface PreTradeInput {
  symbol: string;
  side: "long" | "short";
  setup?: string;
  confluences?: string[];
  stopPips?: number;
  note?: string;
}

export async function preTradeContext(accountId: string, input: PreTradeInput): Promise<BuiltContext> {
  const c = await cols();
  const [settings, account] = await Promise.all([getSettings(), c.accounts.findOne({ _id: accountId })]);
  const tz = settings.timezone;
  const day = tradingDayOf(new Date());
  const { history } = await edgeWindows(accountId, settings.minSample);
  const { sessionOf } = await import("../time/sessions");
  const session = sessionOf(new Date());
  const stats = new Stats();
  const add = (label: string, xs: TradeDoc[]) => {
    const s = summarize(xs);
    stats.rows.push({ id: `S${stats.rows.length + 1}`, group: "history", key: label, n: s.count, winRate: s.winRate === null ? null : r2(s.winRate * 100), avgR: r2(s.avgR), net: s.net });
  };
  add(`${input.symbol} ${input.side}s`, history.filter((t) => t.symbol === input.symbol && t.side === input.side));
  add(`session ${SESSION_LABEL[session]}`, history.filter((t) => t.session === session));
  if (input.setup) {
    add(`setup ${input.setup}`, history.filter((t) => t.journal?.setup === input.setup));
    add(`setup ${input.setup} in ${SESSION_LABEL[session]}`, history.filter((t) => t.journal?.setup === input.setup && t.session === session));
  }
  for (const conf of input.confluences ?? []) add(`with ${conf}`, history.filter((t) => t.journal?.confluences?.includes(conf)));
  const today = history.filter((t) => t.tradingDay === day);
  const news = await c.events
    .find({ time: { $gte: new Date(Date.now() - 30 * 60_000), $lte: new Date(Date.now() + 3 * 3_600_000) }, currency: { $in: newsCurrencies(input.symbol) }, importance: { $in: ["medium", "high"] }, source: account?.source ?? "mt5" })
    .sort({ time: 1 })
    .toArray();
  const rules = rulesJson(settings, account);
  const json = {
    minSample: settings.minSample,
    now: fmtDateTime(new Date(), tz),
    plannedTrade: { ...input, session: SESSION_LABEL[session] },
    stats: stats.rows,
    todaySoFar: today.map((t) => tradeRow(t, tz)),
    guardrails: guardrails({ today, history, rules, startBalance: account?.balance ?? 0, minN: settings.minSample }),
    news: news.map((n, i) => ({ id: `N${i + 1}`, local: fmtTime(n.time, tz), currency: n.currency, name: n.name, importance: n.importance })),
    rules,
  };
  return { json, images: [], hash: hashOf(json) };
}

/** Context for the side chat: the report plus a compact view of what it is about. */
export async function chatContext(scopeKey: string, report: AiReport | null): Promise<Record<string, unknown>> {
  const [kind, ...rest] = scopeKey.split(":");
  const settings = await getSettings();
  let about: Record<string, unknown> = {};
  try {
    if (kind === "trade") about = (await tradeContext(rest.join(":"))).json;
    else if (kind === "daily") about = (await dayContext(rest[0], rest[1])).json;
    else if (kind === "weekly") about = (await weekContext(rest[0], rest[1])).json;
    else if (kind === "brief") about = (await briefContext(rest[0], rest[1])).json;
    else {
      const acc = await activeAccount();
      if (acc) about = { ...(await briefContext(acc._id, tradingDayOf(new Date()))).json, note: "General journal chat" };
    }
  } catch {
    about = {};
  }
  return { scope: scopeKey, timezone: settings.timezone, report: report ? { kind: report.kind, title: report.title, content: report.content } : null, context: about };
}

export const weekOf = (day: string) => weekStartOf(day);
