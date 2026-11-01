import "server-only";
import { outcome } from "../analytics/metrics";
import { cols } from "../db/collections";
import type { Bar, Timeframe, TradeDoc } from "../domain/types";
import { fmtDateTime } from "../format";
import { barKey, ensureEvidence, loadBars, newsAround } from "../market/service";
import { SESSION_LABEL } from "../time/sessions";
import { getCtx, getTrades, latestReport, serialize } from "./journal";

export interface TradeQuery {
  symbol?: string;
  setup?: string;
  session?: string;
  side?: string;
  outcome?: string;
  review?: string;
  from?: string;
  to?: string;
}

const isReviewed = (t: TradeDoc) => Boolean(t.journal?.setup) && (t.journal?.emotions?.length ?? 0) > 0;

export type TradeRow = NonNullable<Awaited<ReturnType<typeof tradeList>>>["rows"][number];

/** The trades table: every closed trade of the focused account, filtered, newest first. */
export async function tradeList(q: TradeQuery) {
  const ctx = await getCtx();
  if (!ctx.account) return null;
  const all = await getTrades();
  const c = await cols();
  const reports = new Set(
    (await c.aiReports.find({ kind: "trade", accountId: ctx.account._id }, { projection: { scopeKey: 1 } }).toArray()).map((r) => r.scopeKey),
  );
  const rows = all
    .filter(
      (t) =>
        (!q.symbol || t.symbol === q.symbol) &&
        (!q.setup || (q.setup === "__none" ? !t.journal?.setup : t.journal?.setup === q.setup)) &&
        (!q.session || t.session === q.session) &&
        (!q.side || t.side === q.side) &&
        (!q.outcome || outcome(t) === q.outcome) &&
        (!q.review || !isReviewed(t)) &&
        (!q.from || t.tradingDay >= q.from) &&
        (!q.to || t.tradingDay <= q.to),
    )
    .reverse()
    .map((t) => ({
      id: t._id,
      symbol: t.symbol,
      side: t.side,
      day: t.tradingDay,
      openedAt: t.openedAt.getTime(),
      closedAt: t.closedAt!.getTime(),
      volume: t.volume,
      entry: t.entryPrice,
      exit: t.exitPrice ?? null,
      net: t.net,
      r: t.r ?? null,
      pips: t.pips ?? null,
      durationSec: t.durationSec ?? null,
      session: t.session,
      sessionLabel: SESSION_LABEL[t.session],
      setup: t.journal?.setup ?? null,
      emotions: t.journal?.emotions ?? [],
      mistakes: t.journal?.mistakes ?? [],
      closeReason: t.closeReason ?? null,
      outcome: outcome(t),
      reviewed: isReviewed(t),
      analyzed: reports.has(`trade:${t._id}`),
    }));
  return {
    ctx: { currency: ctx.currency, tz: ctx.tz },
    rows,
    total: all.length,
    symbols: [...new Set(all.map((t) => t.symbol))].sort(),
    setups: ctx.settings.tags.setups,
  };
}

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

/** Chart windows per timeframe: enough context before entry and after exit to see sweeps and stop hunts. */
function chartWindows(t: TradeDoc): Record<Timeframe, { from: Date; to: Date } | null> {
  const open = t.openedAt.getTime();
  const close = (t.closedAt ?? t.openedAt).getTime();
  return {
    M1: close - open < 2 * D ? { from: new Date(open - 3 * H), to: new Date(close + 90 * MIN) } : null,
    M5: { from: new Date(open - 26 * H), to: new Date(close + 6 * H) },
    M15: { from: new Date(open - 4 * D), to: new Date(close + 12 * H) },
    H1: { from: new Date(open - 14 * D), to: new Date(close + 2 * D) },
    H4: null,
    D1: null,
  };
}

/** Everything the trade detail needs, in display currency. */
export async function tradeDetail(id: string) {
  const ctx = await getCtx();
  const c = await cols();
  const raw = await c.trades.findOne({ _id: id });
  if (!raw || raw.status !== "closed") return null;
  const trade = await ensureEvidence(raw);
  const k = ctx.account?._id === trade.accountId ? ctx.scale : trade.source === "mt5" && (await c.accounts.findOne({ _id: trade.accountId }))?.isCent ? 0.01 : 1;
  const key = barKey(trade);
  const w = chartWindows(trade);
  const tfs = (["M1", "M5", "M15", "H1"] as const).filter((tf) => w[tf]);
  const [barsList, news, { report, versions }, siblings] = await Promise.all([
    Promise.all(tfs.map((tf) => loadBars(key, tf, w[tf]!.from, w[tf]!.to))),
    newsAround(trade.symbol, new Date(trade.openedAt.getTime() - 2 * H), new Date(trade.closedAt!.getTime() + 2 * H), trade.source),
    latestReport(`trade:${trade._id}`),
    c.trades
      .find({ accountId: trade.accountId, status: "closed", hidden: { $ne: true } }, { projection: { _id: 1, closedAt: 1 } })
      .sort({ closedAt: 1 })
      .toArray(),
  ]);
  const bars: Partial<Record<Timeframe, Bar[]>> = {};
  tfs.forEach((tf, i) => {
    if (barsList[i].length) bars[tf] = barsList[i];
  });
  const idx = siblings.findIndex((s) => s._id === trade._id);
  const evidence = trade.evidence?.items ?? [];
  const cites: Record<string, { title: string; detail?: string }> = {};
  for (const e of evidence) cites[e.id] = { title: e.title, detail: e.detail };
  news.forEach((n, i) => (cites[`N${i + 1}`] = { title: `${n.currency} ${n.name}`, detail: fmtDateTime(n.time, ctx.tz) }));

  return {
    ctx: { currency: ctx.currency, tz: ctx.tz },
    trade: {
      id: trade._id,
      symbol: trade.symbol,
      rawSymbol: trade.rawSymbol,
      side: trade.side,
      day: trade.tradingDay,
      volume: trade.volume,
      openedAt: trade.openedAt.getTime(),
      closedAt: trade.closedAt!.getTime(),
      entry: trade.entryPrice,
      exit: trade.exitPrice ?? null,
      sl0: trade.sl0 ?? null,
      tp0: trade.tp0 ?? null,
      slFinal: trade.slFinal ?? null,
      tpFinal: trade.tpFinal ?? null,
      slHistory: trade.slHistory.map((h) => ({ t: h.time.getTime(), sl: h.sl, tp: h.tp })),
      closeReason: trade.closeReason ?? null,
      net: trade.net * k,
      gross: trade.gross * k,
      fees: (trade.commission + trade.swap + trade.fee) * k,
      riskMoney: trade.riskMoney != null ? trade.riskMoney * k : null,
      r: trade.r ?? null,
      pips: trade.pips ?? null,
      durationSec: trade.durationSec ?? null,
      session: SESSION_LABEL[trade.session],
      outcome: outcome(trade),
      mae: trade.mae ?? null,
      mfe: trade.mfe ?? null,
      source: trade.source,
      executions: trade.executions.map((e) => ({ ticket: e.ticket, t: e.time.getTime(), side: e.side, entry: e.entry, volume: e.volume, price: e.price, profit: e.profit * k, fees: (e.commission + e.swap + e.fee) * k, reason: e.reason })),
      journal: serialize({
        setup: trade.journal?.setup ?? null,
        confluences: trade.journal?.confluences ?? [],
        emotions: trade.journal?.emotions ?? [],
        mistakes: trade.journal?.mistakes ?? [],
        rating: trade.journal?.rating ?? null,
        followedPlan: trade.journal?.followedPlan ?? null,
        notes: trade.journal?.notes ?? "",
        screenshots: trade.journal?.screenshots ?? [],
      }),
    },
    bars,
    evidence: evidence.map((e) => ({ ...e })),
    coverage: trade.evidence?.coverage ?? [],
    news: news.map((n, i) => ({ id: `N${i + 1}`, t: n.time.getTime(), currency: n.currency, name: n.name, importance: n.importance, actual: n.actual, forecast: n.forecast, previous: n.previous })),
    report,
    versions,
    cites,
    tags: ctx.settings.tags,
    prev: idx > 0 ? siblings[idx - 1]._id : null,
    next: idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1]._id : null,
  };
}

export type TradeDetail = NonNullable<Awaited<ReturnType<typeof tradeDetail>>>;
