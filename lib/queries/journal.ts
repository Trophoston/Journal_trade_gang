import "server-only";
import { cache } from "react";
import { buildCurve, type CurveResult } from "../analytics/curve";
import { edgeRadar } from "../analytics/edge";
import { guardrails } from "../analytics/guardrails";
import { inPeriod, resolvePeriod, type Period } from "../analytics/period";
import { breakdown, dailyStats, outcome, streaks, summarize, type Summary } from "../analytics/metrics";
import type { AiReport } from "../ai/types";
import { cols } from "../db/collections";
import type { AccountDoc, CashflowDoc, TradeDoc } from "../domain/types";
import { getSettings, type SettingsDoc } from "../settings";
import { SESSION_LABEL, sessionSpans, type SessionId } from "../time/sessions";
import { fmtMonth } from "../format";
import { addDays, monthKey, tradingDayBounds, tradingDayOf, weekdayOf, weekStartOf } from "../time/zone";
import { activeAccount, closedTrades, displayCurrency, moneyScale } from "./core";

export interface Ctx {
  settings: SettingsDoc;
  account: AccountDoc | null;
  scale: number;
  currency: string;
  tz: string;
  today: string;
}

/** Per-request context: settings, the focused account and display units. */
export const getCtx = cache(async (): Promise<Ctx> => {
  const [settings, account] = await Promise.all([getSettings(), activeAccount()]);
  return { settings, account, scale: moneyScale(account), currency: displayCurrency(account), tz: settings.timezone, today: tradingDayOf(new Date()) };
});

function scaleTrade(t: TradeDoc, k: number): TradeDoc {
  if (k === 1) return t;
  return { ...t, net: t.net * k, gross: t.gross * k, commission: t.commission * k, swap: t.swap * k, fee: t.fee * k, riskMoney: t.riskMoney != null ? t.riskMoney * k : undefined };
}

/** All closed trades of the focused account, in display currency. */
export const getTrades = cache(async (): Promise<TradeDoc[]> => {
  const { account, scale } = await getCtx();
  if (!account) return [];
  return (await closedTrades(account._id)).map((t) => scaleTrade(t, scale));
});

export const getFlows = cache(async (): Promise<CashflowDoc[]> => {
  const { account, scale } = await getCtx();
  if (!account) return [];
  const c = await cols();
  return (await c.cashflows.find({ accountId: account._id }).sort({ time: 1 }).toArray()).map((f) => ({ ...f, amount: f.amount * scale }));
});

export const getCurve = cache(async () => {
  const [trades, flows] = await Promise.all([getTrades(), getFlows()]);
  return buildCurve([...trades.map((t) => ({ time: t.closedAt!, kind: "trade" as const, amount: t.net })), ...flows.map((f) => ({ time: f.time, kind: "flow" as const, amount: f.amount }))]);
});

export function serialize<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

export async function latestReport(scopeKey: string) {
  const c = await cols();
  const [report, versions] = await Promise.all([c.aiReports.find({ scopeKey }).sort({ version: -1 }).limit(1).next(), c.aiReports.countDocuments({ scopeKey })]);
  return { report: report ? (serialize(report) as unknown as Omit<AiReport, "createdAt"> & { createdAt: string }) : null, versions };
}

export function summaryOf(trades: TradeDoc[]): Summary {
  return summarize(trades);
}

const isReviewed = (t: TradeDoc) => Boolean(t.journal?.setup) && (t.journal?.emotions?.length ?? 0) > 0;

// ───────────────────────── Dashboard

/** Balance curve inside a period, starting from the balance carried in from before it. */
function periodCurve(period: Period, trades: TradeDoc[], flows: CashflowDoc[]): CurveResult {
  const events = [
    ...trades.map((t) => ({ day: t.tradingDay, e: { time: t.closedAt!, kind: "trade" as const, amount: t.net } })),
    ...flows.map((f) => ({ day: tradingDayOf(f.time), e: { time: f.time, kind: "flow" as const, amount: f.amount } })),
  ];
  const start = events.filter((x) => period.from && x.day < period.from).reduce((s, x) => s + x.e.amount, 0);
  const curve = buildCurve(
    events.filter((x) => inPeriod(period, x.day)).map((x) => x.e),
    start,
  );
  // Anchor the line at the period's opening balance.
  if (period.from) curve.points.unshift({ t: tradingDayBounds(period.from).start.getTime(), balance: Math.round(start * 100) / 100, index: 1 });
  return curve;
}

export async function dashboard(sp: { p?: string; at?: string; from?: string; to?: string } = {}) {
  const ctx = await getCtx();
  const { account, settings, today } = ctx;
  if (!account) return null;
  const [trades, fullCurve, flows] = await Promise.all([getTrades(), getCurve(), getFlows()]);
  const c = await cols();
  const period = resolvePeriod(sp, today);
  // Stats follow the chosen period; live status, guardrails and the brief always use everything.
  const pTrades = period.kind === "all" ? trades : trades.filter((t) => inPeriod(period, t.tradingDay));
  const summary = summarize(pTrades);
  const days = dailyStats(pTrades);
  const curve = period.kind === "all" ? fullCurve : periodCurve(period, trades, flows);
  // The month card: the period's last month when one is chosen; early in a month with no trades yet, the last month that has some.
  const thisMonth = monthKey(today);
  const month =
    period.kind !== "all" ? monthKey(pTrades.at(-1)?.tradingDay ?? (period.to && period.to < today ? period.to : today)) : trades.some((t) => monthKey(t.tradingDay) === thisMonth) || !trades.length ? thisMonth : monthKey(trades[trades.length - 1].tradingDay);
  const monthTrades = trades.filter((t) => monthKey(t.tradingDay) === month);
  // On a weekend, plan for the next trading day.
  const wd = weekdayOf(today);
  const planDay = wd === 6 ? addDays(today, 2) : wd === 0 ? addDays(today, 1) : today;
  const todayTrades = trades.filter((t) => t.tradingDay === today);
  const rules = { ...settings.rules, ...account.rules };
  const startBalance = (account.balance * ctx.scale || curve.balance) - todayTrades.reduce((s, t) => s + t.net, 0);
  const guards = guardrails({ today: todayTrades, history: trades, rules, startBalance, minN: settings.minSample });

  const sessions = breakdown(trades.slice(-300), (t) => t.session).filter((r) => r.key !== "off");
  const spans = sessionSpans(planDay);
  const now = Date.now();
  const news = await c.events
    .find({ time: { $gte: new Date(now - 3 * 3_600_000), $lte: new Date(now + 30 * 3_600_000) }, importance: { $in: ["high", "medium"] }, currency: { $in: ["USD", "EUR", "GBP", "JPY"] }, source: account.source })
    .sort({ time: 1 })
    .limit(12)
    .toArray();
  const brief = await c.aiReports.find({ kind: "brief", accountId: account._id }).sort({ createdAt: -1 }).limit(1).next();

  const review = trades
    .filter((t) => !isReviewed(t))
    .slice(-6)
    .reverse();

  const reports = await c.aiReports.find({ kind: "trade", scopeKey: { $in: review.map((t) => `trade:${t._id}`) } }, { projection: { scopeKey: 1 } }).toArray();
  const analyzed = new Set(reports.map((r) => r.scopeKey));

  return {
    ctx: { currency: ctx.currency, tz: ctx.tz, today, minSample: settings.minSample },
    period,
    firstDay: trades[0]?.tradingDay ?? today,
    account: {
      id: account._id,
      name: account.name,
      source: account.source,
      balance: account.balance * ctx.scale,
      equity: account.equity * ctx.scale,
      floating: account.floating * ctx.scale,
      margin: account.margin * ctx.scale,
      lastSeenAt: account.lastSeenAt?.getTime() ?? 0,
      positions: account.positions.map((p) => ({ ...p, profit: p.profit * ctx.scale, openedAt: p.openedAt.getTime() })),
      dailyLossLimitPct: rules.dailyLossLimitPct ?? 0,
      maxTradesPerDay: rules.maxTradesPerDay ?? 0,
    },
    curve: { points: curve.points.map((p) => ({ t: p.t, v: Math.round(p.balance * 100) / 100 })), gainPct: curve.gainPct, maxDrawdownPct: curve.maxDrawdownPct, currentDrawdownPct: curve.currentDrawdownPct, highest: curve.highestBalance, netDeposits: curve.netDeposits, tradingPnl: curve.tradingPnl, returns: curve.periodReturns },
    summary,
    month: { key: month, label: month === thisMonth ? "เดือนนี้" : fmtMonth(month), summary: summarize(monthTrades), days: days.filter((d) => monthKey(d.day) === month) },
    planDay,
    today: { trades: todayTrades.length, net: todayTrades.reduce((s, t) => s + t.net, 0), startBalance },
    streaks: streaks(pTrades),
    edge: edgeRadar(pTrades, summary, days, curve.maxDrawdownPct),
    guards,
    sparkDays: days.slice(-30).map((d) => ({ day: d.day, net: d.net, n: d.count })),
    sessions: spans.map((sp) => {
      const row = sessions.find((r) => r.key === sp.id);
      return { id: sp.id as SessionId, label: SESSION_LABEL[sp.id as SessionId], start: sp.start.getTime(), end: sp.end.getTime(), kzStart: sp.kzStart?.getTime(), kzEnd: sp.kzEnd?.getTime(), n: row?.n ?? 0, avgR: row?.avgR ?? null, winRate: row?.winRate ?? null };
    }),
    news: news.map((n) => ({ id: n._id, t: n.time.getTime(), currency: n.currency, name: n.name, importance: n.importance, actual: n.actual, forecast: n.forecast })),
    brief: brief ? serialize(brief) : null,
    review: review.map((t) => ({ id: t._id, symbol: t.symbol, side: t.side, day: t.tradingDay, closedAt: t.closedAt!.getTime(), net: t.net, r: t.r ?? null, analyzed: analyzed.has(`trade:${t._id}`) })),
    totals: { trades: trades.length, fees: summary.fees },
  };
}

// ───────────────────────── Calendar

export async function calendarMonth(month: string) {
  const ctx = await getCtx();
  if (!ctx.account) return null;
  const trades = await getTrades();
  const c = await cols();
  const inMonth = trades.filter((t) => monthKey(t.tradingDay) === month);
  const days = dailyStats(inMonth);
  const first = `${month}-01`;
  const gridStart = weekStartOf(first);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const gridEnd = addDays(weekStartOf(last), 6);
  const [notes, reviews] = await Promise.all([
    c.days.find({ accountId: ctx.account._id, day: { $gte: gridStart, $lte: gridEnd } }, { projection: { day: 1, plan: 1, reflection: 1 } }).toArray(),
    c.aiReports.find({ accountId: ctx.account._id, kind: { $in: ["daily", "weekly"] }, scopeKey: { $regex: `^(daily|weekly):${ctx.account._id}:${month.slice(0, 4)}` } }, { projection: { scopeKey: 1 } }).toArray(),
  ]);
  const noted = new Set(notes.filter((n) => n.plan || n.reflection).map((n) => n.day));
  const reviewed = new Set(reviews.map((r) => r.scopeKey.split(":").at(-1)!));
  const weeks: { monday: string; days: { day: string; inMonth: boolean; stat: (typeof days)[number] | null; note: boolean; review: boolean }[]; net: number; count: number; r: number; review: boolean }[] = [];
  for (let wk = gridStart; wk <= gridEnd; wk = addDays(wk, 7)) {
    const row = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(wk, i);
      return { day, inMonth: monthKey(day) === month, stat: days.find((d) => d.day === day) ?? null, note: noted.has(day), review: reviewed.has(day) };
    });
    const stats = row.filter((d) => d.inMonth && d.stat).map((d) => d.stat!);
    weeks.push({ monday: wk, days: row, net: stats.reduce((s, d) => s + d.net, 0), count: stats.reduce((s, d) => s + d.count, 0), r: stats.reduce((s, d) => s + d.r, 0), review: reviewed.has(wk) });
  }
  const s = summarize(inMonth);
  const curve = await getCurve();
  const balanceBefore = (t: number) => curve.points.filter((p) => p.t < t).at(-1)?.balance ?? curve.points[0]?.balance ?? 0;
  const pct: Record<string, number> = {};
  for (const d of days) {
    const b = balanceBefore(tradingDayBounds(d.day).start.getTime());
    if (b > 0) pct[d.day] = (d.net / b) * 100;
  }
  const startBalance = balanceBefore(tradingDayBounds(first).start.getTime());
  return {
    ctx: { currency: ctx.currency, tz: ctx.tz, today: ctx.today },
    month,
    weeks,
    pct,
    summary: s,
    startBalance,
    monthPct: startBalance > 0 ? (s.net / startBalance) * 100 : null,
    greenDays: days.filter((d) => d.net > 0).length,
    redDays: days.filter((d) => d.net < 0).length,
  };
}

export async function dayDetail(day: string) {
  const ctx = await getCtx();
  if (!ctx.account) return null;
  const trades = (await getTrades()).filter((t) => t.tradingDay === day);
  const c = await cols();
  const journal = await c.days.findOne({ _id: `${ctx.account._id}:${day}` });
  const scopeKey = `daily:${ctx.account._id}:${day}`;
  const { report, versions } = await latestReport(scopeKey);
  const reportIds = new Set((await c.aiReports.find({ kind: "trade", scopeKey: { $in: trades.map((t) => `trade:${t._id}`) } }, { projection: { scopeKey: 1 } }).toArray()).map((r) => r.scopeKey));
  return {
    day,
    scopeKey,
    report,
    versions,
    summary: summarize(trades),
    journal: { plan: journal?.plan ?? "", reflection: journal?.reflection ?? "", bias: journal?.bias ?? null, mood: journal?.mood ?? null },
    trades: trades.map((t) => ({
      id: t._id,
      symbol: t.symbol,
      side: t.side,
      openedAt: t.openedAt.getTime(),
      closedAt: t.closedAt!.getTime(),
      net: t.net,
      r: t.r ?? null,
      session: SESSION_LABEL[t.session],
      setup: t.journal?.setup ?? null,
      outcome: outcome(t),
      analyzed: reportIds.has(`trade:${t._id}`),
    })),
  };
}
