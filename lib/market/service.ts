import { cols } from "../db/collections";
import type { Bar, Timeframe, TradeDoc } from "../domain/types";
import { newsCurrencies } from "../mt5/symbols";
import { candleWindows } from "../mt5/tasks";
import { computeEvidence } from "./evidence";

/** Demo candles live under their own key so they never mix with (or block fetching) real MT5 candles. */
export const barKey = (t: { symbol: string; source?: "mt5" | "demo" }) => (t.source === "demo" ? `demo:${t.symbol}` : t.symbol);

export async function loadBars(symbol: string, tf: Timeframe, from: Date, to: Date): Promise<Bar[]> {
  const c = await cols();
  const docs = await c.candles
    .find({ symbol, tf, t: { $gte: from, $lte: to } }, { projection: { _id: 0, t: 1, o: 1, h: 1, l: 1, c: 1 } })
    .sort({ t: 1 })
    .toArray();
  return docs.map((d) => ({ t: d.t.getTime(), o: d.o, h: d.h, l: d.l, c: d.c }));
}

export async function newsAround(symbol: string, from: Date, to: Date, source: "mt5" | "demo" = "mt5") {
  const c = await cols();
  return c.events
    .find({ time: { $gte: from, $lte: to }, currency: { $in: newsCurrencies(symbol) }, importance: { $in: ["medium", "high"] }, source })
    .sort({ time: 1 })
    .toArray();
}

/** Bump when the detectors change so stored evidence is recomputed on next use. */
export const EVIDENCE_VERSION = 3;

/** Compute (and store) market evidence + MAE/MFE for a closed trade from stored candles. */
export async function refreshEvidence(trade: TradeDoc): Promise<TradeDoc> {
  if (trade.status !== "closed" || !trade.closedAt) return trade;
  const w = Object.fromEntries(candleWindows(trade).map((x) => [x.tf, x]));
  const key = barKey(trade);
  const [m1, m5, m15, h1, news] = await Promise.all([
    w.M1 ? loadBars(key, "M1", w.M1.from, w.M1.to) : Promise.resolve([]),
    loadBars(key, "M5", w.M5.from, w.M5.to),
    loadBars(key, "M15", w.M15.from, w.M15.to),
    loadBars(key, "H1", w.H1.from, w.H1.to),
    newsAround(trade.symbol, new Date(trade.openedAt.getTime() - 2 * 3_600_000), new Date(trade.closedAt.getTime() + 2 * 3_600_000), trade.source),
  ]);
  const res = computeEvidence({ ...trade, m1, m5, m15, h1, news });
  const evidence = { computedAt: new Date(), items: res.items, coverage: res.coverage, v: EVIDENCE_VERSION };
  const c = await cols();
  await c.trades.updateOne({ _id: trade._id }, { $set: { evidence, mae: res.mae, mfe: res.mfe } });
  return { ...trade, evidence, mae: res.mae, mfe: res.mfe };
}

/** Evidence, computed on first use. */
export async function ensureEvidence(trade: TradeDoc): Promise<TradeDoc> {
  return trade.evidence?.v === EVIDENCE_VERSION ? trade : refreshEvidence(trade);
}
