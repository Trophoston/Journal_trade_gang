import type { ObjectId } from "mongodb";
import { cols } from "../db/collections";
import type { AccountDoc, Timeframe, TradeDoc } from "../domain/types";
import { tradingDayBounds, addDays } from "../time/zone";
import { utcToServer } from "./servertime";

/** Data the app asks the EA for. The EA picks tasks up from heartbeat responses. */
export interface EaTask {
  _id?: ObjectId;
  key: string;
  accountId: string;
  kind: "CANDLES" | "CALENDAR" | "HISTORY";
  rawSymbol?: string;
  symbol?: string;
  tf?: Timeframe;
  from: Date;
  to: Date;
  currencies?: string[];
  status: "pending" | "sent" | "done";
  sentAt?: Date;
  doneAt?: Date;
  createdAt: Date;
}

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const TF_MS: Record<Timeframe, number> = { M1: MIN, M5: 5 * MIN, M15: 15 * MIN, H1: H, H4: 4 * H, D1: D };
export const CAL_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "CNY"];

/** Candle windows needed to explain one trade (incl. bars after the exit for the stop-hunt check). */
export function candleWindows(t: Pick<TradeDoc, "openedAt" | "closedAt">): { tf: Timeframe; from: Date; to: Date }[] {
  const open = t.openedAt.getTime();
  const close = (t.closedAt ?? t.openedAt).getTime();
  const out: { tf: Timeframe; from: Date; to: Date }[] = [];
  if (close - open < 2 * D) out.push({ tf: "M1", from: new Date(open - 30 * MIN), to: new Date(close + 30 * MIN) });
  out.push({ tf: "M5", from: new Date(open - 26 * H), to: new Date(close + 6 * H) });
  out.push({ tf: "M15", from: new Date(open - 4 * D), to: new Date(close + 2 * H) });
  out.push({ tf: "H1", from: new Date(open - 14 * D), to: new Date(open) });
  return out;
}

const hourKey = (d: Date) => Math.floor(d.getTime() / H);

/** Queue candle + calendar tasks for closed trades, skipping ranges we already hold. */
export async function planTradeTasks(account: AccountDoc, trades: TradeDoc[]) {
  if (account.source !== "mt5") return 0;
  const c = await cols();
  let created = 0;
  const now = Date.now();
  for (const t of trades) {
    if (t.status !== "closed") continue;
    for (const w of candleWindows(t)) {
      const to = new Date(Math.min(w.to.getTime(), now));
      const expected = ((to.getTime() - w.from.getTime()) / TF_MS[w.tf]) * (5 / 7);
      const have = await c.candles.countDocuments({ symbol: t.symbol, tf: w.tf, t: { $gte: w.from, $lte: to } });
      if (have >= expected * 0.7) continue;
      const key = `${account._id}:${t.rawSymbol}:${w.tf}:${hourKey(w.from)}:${hourKey(to)}`;
      const r = await c.eaTasks.updateOne(
        { key },
        { $setOnInsert: { key, accountId: account._id, kind: "CANDLES", rawSymbol: t.rawSymbol, symbol: t.symbol, tf: w.tf, from: w.from, to, status: "pending", createdAt: new Date() } },
        { upsert: true },
      );
      created += r.upsertedCount;
    }
    const day = t.tradingDay;
    const key = `${account._id}:cal:${day}`;
    const r = await c.eaTasks.updateOne(
      { key },
      {
        $setOnInsert: {
          key,
          accountId: account._id,
          kind: "CALENDAR",
          from: tradingDayBounds(addDays(day, -1)).start,
          to: tradingDayBounds(addDays(day, 1)).end,
          currencies: CAL_CURRENCIES,
          status: "pending",
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
    created += r.upsertedCount;
  }
  return created;
}

/** Keep the coming week's economic calendar fresh (refreshed hourly). */
export async function planUpcomingCalendar(account: AccountDoc) {
  const c = await cols();
  const now = Date.now();
  const key = `${account._id}:cal-upcoming:${Math.floor(now / H)}`;
  await c.eaTasks.updateOne(
    { key },
    {
      $setOnInsert: {
        key,
        accountId: account._id,
        kind: "CALENDAR",
        from: new Date(now - D),
        to: new Date(now + 7 * D),
        currencies: CAL_CURRENCIES,
        status: "pending",
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}

/** Pick up to `max` tasks for the EA and render them as `T|id|…` lines in server time. */
export async function takeTaskLines(account: AccountDoc, max = 3): Promise<string[]> {
  const c = await cols();
  const stale = new Date(Date.now() - 2 * MIN);
  const tasks = await c.eaTasks
    .find({ accountId: account._id, $or: [{ status: "pending" }, { status: "sent", sentAt: { $lt: stale } }] })
    .sort({ kind: 1, createdAt: 1 })
    .limit(max)
    .toArray();
  if (!tasks.length) return [];
  await c.eaTasks.updateMany({ _id: { $in: tasks.map((t) => t._id!) } }, { $set: { status: "sent", sentAt: new Date() } });
  const cfg = account.serverTime;
  return tasks.map((t) => {
    const from = utcToServer(t.from, cfg);
    const to = utcToServer(t.to, cfg);
    if (t.kind === "CANDLES") return `T|${t._id}|CANDLES|${t.rawSymbol}|${t.tf}|${from}|${to}`;
    if (t.kind === "CALENDAR") return `T|${t._id}|CALENDAR|${from}|${to}|${(t.currencies ?? CAL_CURRENCIES).join(",")}`;
    return `T|${t._id}|HISTORY|${from}`;
  });
}
