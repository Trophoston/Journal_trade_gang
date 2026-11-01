"use server";

import { z } from "zod";
import { cols } from "../db/collections";
import { activeAccount, displayCurrency, moneyScale } from "../queries/core";
import { SESSION_LABEL } from "../time/sessions";

/** ⌘K trade search: symbol, setup, day or note text. */
export async function searchTrades(q: string) {
  const query = z.string().max(80).parse(q).trim();
  const account = await activeAccount();
  if (!account) return [];
  const c = await cols();
  const filter: Record<string, unknown> = { accountId: account._id, status: "closed", hidden: { $ne: true } };
  if (query) {
    const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ symbol: rx }, { "journal.setup": rx }, { tradingDay: rx }, { "journal.notes": rx }, { side: rx }];
  }
  const trades = await c.trades.find(filter, { projection: { symbol: 1, side: 1, tradingDay: 1, net: 1, r: 1, journal: { setup: 1 } } }).sort({ closedAt: -1 }).limit(12).toArray();
  return trades.map((t) => ({ id: t._id, symbol: t.symbol, side: t.side, day: t.tradingDay, net: t.net, r: t.r ?? null, setup: t.journal?.setup ?? null }));
}

/** Short facts for trade ids the AI cites in its text: shown on hover, so only what fits a card. */
export async function peekTrades(ids: string[]) {
  const list = z.array(z.string().max(80)).max(60).parse(ids);
  if (!list.length) return [];
  const c = await cols();
  const trades = await c.trades
    .find({ _id: { $in: list } }, { projection: { accountId: 1, symbol: 1, side: 1, tradingDay: 1, openedAt: 1, closedAt: 1, durationSec: 1, net: 1, r: 1, volume: 1, session: 1, closeReason: 1, journal: { setup: 1 } } })
    .toArray();
  const accounts = new Map((await c.accounts.find({ _id: { $in: [...new Set(trades.map((t) => t.accountId))] } }).toArray()).map((a) => [a._id, a]));
  return trades.map((t) => {
    const a = accounts.get(t.accountId);
    return {
      id: t._id,
      symbol: t.symbol,
      side: t.side,
      day: t.tradingDay,
      openedAt: t.openedAt?.getTime() ?? null,
      durationSec: t.durationSec ?? null,
      net: t.net * moneyScale(a),
      currency: displayCurrency(a),
      r: t.r ?? null,
      volume: t.volume,
      session: t.session ? SESSION_LABEL[t.session] : null,
      closeReason: t.closeReason ?? null,
      setup: t.journal?.setup ?? null,
    };
  });
}
export type TradePeek = Awaited<ReturnType<typeof peekTrades>>[number];
