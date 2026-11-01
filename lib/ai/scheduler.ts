import { cols } from "../db/collections";
import { getSettings } from "../settings";
import { addDays, tradingDayOf, weekdayOf, weekStartOf } from "../time/zone";
import { enqueue, scheduleTradeAnalysis } from "./queue";

/**
 * Creates the automatic jobs: missed trade analyses, the daily review after each
 * trading day closes (17:00 NY + 10 min), the weekly review after the Friday close
 * and one brief per trading day. Each scope runs once; the queue skips scopes
 * that already have a report.
 */
export async function catchUp(now = new Date()) {
  const settings = await getSettings();
  const c = await cols();
  const accounts = await c.accounts.find({ source: "mt5" }).toArray();
  const current = tradingDayOf(new Date(now.getTime() - 10 * 60_000));

  for (const account of accounts) {
    if (settings.ai.autoTrade && account.firstConnectedAt) {
      const since = new Date(account.firstConnectedAt.getTime() - 3_600_000);
      const trades = await c.trades
        .find({ accountId: account._id, status: "closed", hidden: { $ne: true }, closedAt: { $gte: since } }, { projection: { _id: 1, accountId: 1, closedAt: 1 } })
        .sort({ closedAt: -1 })
        .limit(40)
        .toArray();
      const done = new Set(
        (await c.aiReports.find({ kind: "trade", scopeKey: { $in: trades.map((t) => `trade:${t._id}`) } }, { projection: { scopeKey: 1 } }).toArray()).map((r) => r.scopeKey),
      );
      for (const t of trades) if (!done.has(`trade:${t._id}`)) await scheduleTradeAnalysis(t);
    }

    if (settings.ai.autoDaily) {
      const from = addDays(current, -7);
      const days: string[] = await c.trades.distinct("tradingDay", { accountId: account._id, status: "closed", hidden: { $ne: true }, tradingDay: { $gte: from, $lt: current } });
      for (const day of days) await enqueue({ kind: "daily", scopeKey: `daily:${account._id}:${day}`, accountId: account._id, payload: { day }, auto: true });
    }

    if (settings.ai.autoWeekly) {
      const wd = weekdayOf(current);
      const thisMonday = weekStartOf(current);
      const weekDone = wd === 6 || wd === 0;
      const mondays = [1, 2, 3, 4].map((i) => addDays(thisMonday, -7 * i));
      if (weekDone) mondays.unshift(thisMonday);
      for (const monday of mondays) {
        const n = await c.trades.countDocuments({ accountId: account._id, status: "closed", hidden: { $ne: true }, tradingDay: { $gte: monday, $lte: addDays(monday, 4) } });
        if (n) await enqueue({ kind: "weekly", scopeKey: `weekly:${account._id}:${monday}`, accountId: account._id, payload: { monday }, auto: true });
      }
    }

    if (settings.ai.autoBrief) {
      const today = tradingDayOf(now);
      const wd = weekdayOf(today);
      const recent = await c.trades.countDocuments({ accountId: account._id, closedAt: { $gte: new Date(now.getTime() - 30 * 86_400_000) } });
      if (wd >= 1 && wd <= 5 && recent) await enqueue({ kind: "brief", scopeKey: `brief:${account._id}:${today}`, accountId: account._id, payload: { day: today }, auto: true });
    }
  }
}

const g = globalThis as unknown as { __tgScheduler?: NodeJS.Timeout };

export function startScheduler() {
  if (g.__tgScheduler) return;
  const run = () => catchUp().catch((err) => console.error("[ai] scheduler failed", err));
  g.__tgScheduler = setInterval(run, 5 * 60_000);
  g.__tgScheduler.unref?.();
  void run();
}
