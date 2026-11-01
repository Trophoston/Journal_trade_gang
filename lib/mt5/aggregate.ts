import type { CloseReason, DealDoc, Execution, Side, SlChange, SymbolSpec, TradeDoc } from "../domain/types";
import { sessionOf } from "../time/sessions";
import { tradingDayOf } from "../time/zone";

const EPS = 1e-8;

export type TradeCore = Omit<TradeDoc, "journal" | "createdAt" | "updatedAt" | "evidence" | "mae" | "mfe" | "hidden" | "source">;

interface Segment {
  side: Side;
  ins: Execution[];
  outs: Execution[];
  closed: boolean;
  firstIn?: DealDoc;
  lastOut?: DealDoc;
}

const REASON: Record<string, CloseReason> = {
  DEAL_REASON_SL: "sl",
  DEAL_REASON_TP: "tp",
  DEAL_REASON_CLIENT: "manual",
  DEAL_REASON_MOBILE: "mobile",
  DEAL_REASON_WEB: "web",
  DEAL_REASON_EXPERT: "expert",
  DEAL_REASON_SO: "so",
};

function exec(d: DealDoc, part = 1, carriesPnl = true): Execution {
  return {
    ticket: d.ticket,
    time: d.time,
    side: d.kind === "buy" ? "long" : "short",
    entry: d.entry,
    volume: d.volume * part,
    price: d.price,
    profit: carriesPnl ? d.profit : 0,
    commission: d.commission * part,
    swap: carriesPnl ? d.swap : 0,
    fee: d.fee * part,
    reason: d.reason,
  };
}

/**
 * Walk one position's deals and split them into flat-to-flat trades.
 * Hedging accounts produce one segment per position; netting accounts can
 * produce several (and INOUT reversals split a deal between two trades).
 */
export function segmentDeals(deals: DealDoc[]): Segment[] {
  const sorted = deals
    .filter((d) => d.kind === "buy" || d.kind === "sell")
    .sort((a, b) => a.timeMsc - b.timeMsc || a.ticket - b.ticket);
  const out: Segment[] = [];
  let cur: Segment | null = null;
  let net = 0; // signed volume, + long

  const close = () => {
    if (cur) {
      cur.closed = true;
      out.push(cur);
    }
    cur = null;
    net = 0;
  };

  for (const d of sorted) {
    const dir = d.kind === "buy" ? 1 : -1;
    if (d.entry === "in") {
      if (!cur) cur = { side: dir > 0 ? "long" : "short", ins: [], outs: [], closed: false, firstIn: d };
      cur.ins.push(exec(d));
      net += dir * d.volume;
    } else if (d.entry === "inout") {
      const closing = Math.abs(net);
      const share = d.volume > EPS ? closing / d.volume : 0;
      if (cur && closing > EPS) {
        cur.outs.push(exec(d, share));
        cur.lastOut = d;
        close();
      }
      const opening = d.volume - closing;
      if (opening > EPS) {
        cur = { side: dir > 0 ? "long" : "short", ins: [exec(d, 1 - share, false)], outs: [], closed: false, firstIn: d };
        net = dir * opening;
      }
    } else {
      // A close with no known open: the position began before the synced history.
      if (!cur) cur = { side: dir > 0 ? "short" : "long", ins: [], outs: [], closed: false };
      cur.outs.push(exec(d));
      cur.lastOut = d;
      net += dir * d.volume;
      if (Math.abs(net) < EPS) close();
    }
  }
  // Orphan closes (no known open) are complete trades; anything else still open stays open.
  if (cur) {
    const seg: Segment = cur;
    if (seg.ins.length === 0) seg.closed = true;
    out.push(seg);
  }
  return out;
}

const vwap = (xs: Execution[]) => {
  const v = xs.reduce((s, x) => s + x.volume, 0);
  return v > EPS ? xs.reduce((s, x) => s + x.price * x.volume, 0) / v : xs[0]?.price ?? 0;
};
const sum = (xs: Execution[], k: "profit" | "commission" | "swap" | "fee") => xs.reduce((s, x) => s + x[k], 0);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export interface BuildOptions {
  accountId: string;
  positionId: number;
  symbol: string;
  rawSymbol: string;
  spec?: Pick<SymbolSpec, "tickSize" | "tickValue" | "pipSize">;
  slHistory?: SlChange[];
}

/** Turn a segment into the computed part of a trade. */
export function buildTrade(seg: Segment, index: number, o: BuildOptions): TradeCore {
  const all = [...seg.ins, ...seg.outs];
  const entryPrice = vwap(seg.ins.length ? seg.ins : seg.outs);
  const exitPrice = seg.outs.length ? vwap(seg.outs) : undefined;
  const volume = seg.ins.length ? seg.ins.reduce((s, x) => s + x.volume, 0) : seg.outs.reduce((s, x) => s + x.volume, 0);
  const openedAt = (seg.ins[0] ?? seg.outs[0]).time;
  const closedAt = seg.closed ? seg.outs[seg.outs.length - 1]?.time : undefined;
  const gross = sum(all, "profit");
  const commission = sum(all, "commission");
  const swap = sum(all, "swap");
  const fee = sum(all, "fee");
  const net = gross + commission + swap + fee;
  const dir = seg.side === "long" ? 1 : -1;

  const history = (o.slHistory ?? []).filter((h) => h.time >= openedAt && (!closedAt || h.time <= closedAt));
  const sl0 = (seg.firstIn?.sl || 0) > 0 ? seg.firstIn!.sl : history.find((h) => h.sl > 0)?.sl;
  const tp0 = (seg.firstIn?.tp || 0) > 0 ? seg.firstIn!.tp : history.find((h) => h.tp > 0)?.tp;
  const slFinal = (seg.lastOut?.sl || 0) > 0 ? seg.lastOut!.sl : [...history].reverse().find((h) => h.sl > 0)?.sl;
  const tpFinal = (seg.lastOut?.tp || 0) > 0 ? seg.lastOut!.tp : [...history].reverse().find((h) => h.tp > 0)?.tp;

  let riskMoney: number | undefined;
  if (sl0 && o.spec && o.spec.tickSize > 0 && o.spec.tickValue > 0) {
    const dist = (entryPrice - sl0) * dir;
    if (dist > 0) riskMoney = round((dist / o.spec.tickSize) * o.spec.tickValue * volume);
  }
  const points = exitPrice !== undefined ? (exitPrice - entryPrice) * dir : undefined;

  return {
    _id: `${o.accountId}_${o.positionId}${index ? `-${index}` : ""}`,
    accountId: o.accountId,
    positionId: o.positionId,
    segment: index,
    symbol: o.symbol,
    rawSymbol: o.rawSymbol,
    side: seg.side,
    status: seg.closed ? "closed" : "open",
    volume: round(volume, 4),
    openedAt,
    closedAt,
    tradingDay: tradingDayOf(closedAt ?? openedAt),
    entryPrice,
    exitPrice,
    sl0,
    tp0,
    slFinal,
    tpFinal,
    slHistory: history,
    closeReason: seg.closed ? (REASON[seg.lastOut?.reason ?? ""] ?? "other") : undefined,
    gross: round(gross),
    commission: round(commission),
    swap: round(swap),
    fee: round(fee),
    net: round(net),
    riskMoney,
    r: riskMoney ? round(net / riskMoney, 2) : undefined,
    points,
    pips: points !== undefined && o.spec?.pipSize ? round(points / o.spec.pipSize, 1) : undefined,
    durationSec: closedAt ? Math.round((closedAt.getTime() - openedAt.getTime()) / 1000) : undefined,
    session: sessionOf(openedAt),
    executions: all.sort((a, b) => a.time.getTime() - b.time.getTime()),
  };
}

export function tradesFromDeals(deals: DealDoc[], o: Omit<BuildOptions, "positionId" | "symbol" | "rawSymbol">): TradeCore[] {
  if (!deals.length) return [];
  const first = deals[0];
  return segmentDeals(deals).map((seg, i) =>
    buildTrade(seg, i, { ...o, positionId: first.positionId, symbol: first.symbol, rawSymbol: first.rawSymbol }),
  );
}
