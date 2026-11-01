import "server-only";
import { breakdown, dailyStats, outcome, strongWeak, summarize, type BreakdownRow } from "../analytics/metrics";
import type { TradeDoc } from "../domain/types";
import { SESSION_IDS, SESSION_LABEL } from "../time/sessions";
import { addDays, NY_TZ, zonedParts } from "../time/zone";
import { getCtx, getCurve, getTrades } from "./journal";

export type Range = "30d" | "90d" | "ytd" | "all";
export const RANGES: Range[] = ["30d", "90d", "ytd", "all"];

const WD = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];
const wdIndex = (jsDay: number) => (jsDay + 6) % 7;

export interface HeatCell {
  wd: number; // 0 = Monday
  h: number;
  n: number;
  net: number;
  avgR: number | null;
  winRate: number | null;
}

function heat(trades: TradeDoc[], tz: string): HeatCell[] {
  const cells = new Map<string, TradeDoc[]>();
  for (const t of trades) {
    const p = zonedParts(t.openedAt, tz);
    const k = `${wdIndex(p.wd)}:${p.h}`;
    const g = cells.get(k);
    if (g) g.push(t);
    else cells.set(k, [t]);
  }
  return [...cells.entries()].map(([k, g]) => {
    const [wd, h] = k.split(":").map(Number);
    const s = summarize(g);
    return { wd, h, n: s.count, net: s.net, avgR: s.avgR, winRate: s.winRate };
  });
}

const HOLD = [
  { key: "a", label: "ไม่ถึง 15 นาที", max: 15 * 60 },
  { key: "b", label: "15 นาที – 1 ชม.", max: 3600 },
  { key: "c", label: "1 – 4 ชม.", max: 4 * 3600 },
  { key: "d", label: "4 ชม. – 1 วัน", max: 86_400 },
  { key: "e", label: "เกิน 1 วัน", max: Infinity },
];

const order = (rows: BreakdownRow[], keys: string[]) => keys.map((k) => rows.find((r) => r.key === k)).filter((r): r is BreakdownRow => Boolean(r));

/** Every breakdown on the Insights page, for one date range. Numbers only; no AI. */
export async function insights(range: Range) {
  const ctx = await getCtx();
  if (!ctx.account) return null;
  const [all, curve] = await Promise.all([getTrades(), getCurve()]);
  const from = range === "30d" ? addDays(ctx.today, -30) : range === "90d" ? addDays(ctx.today, -90) : range === "ytd" ? `${ctx.today.slice(0, 4)}-01-01` : "";
  const trades = from ? all.filter((t) => t.tradingDay >= from) : all;
  const minN = ctx.settings.minSample;

  // Trade number within its day, and whether it came soon after a loss.
  const byDay = new Map<string, TradeDoc[]>();
  for (const t of [...trades].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())) {
    const g = byDay.get(t.tradingDay);
    if (g) g.push(t);
    else byDay.set(t.tradingDay, [t]);
  }
  const nth = new Map<string, number>();
  const afterLoss = new Map<string, boolean>();
  for (const g of byDay.values()) {
    g.forEach((t, i) => {
      nth.set(t._id, i + 1);
      const lastLoss = g
        .slice(0, i)
        .filter((p) => outcome(p) === "loss" && p.closedAt && p.closedAt <= t.openedAt)
        .at(-1);
      afterLoss.set(t._id, Boolean(lastLoss && t.openedAt.getTime() - lastLoss.closedAt!.getTime() <= 60 * 60_000));
    });
  }

  const sessions = order(
    breakdown(trades, (t) => t.session, (k) => SESSION_LABEL[k as keyof typeof SESSION_LABEL] ?? k),
    [...SESSION_IDS],
  );
  const weekdays = order(
    breakdown(trades, (t) => String(wdIndex(zonedParts(t.openedAt, ctx.tz).wd)), (k) => WD[Number(k)]),
    ["0", "1", "2", "3", "4", "5", "6"],
  );
  const hours = breakdown(trades, (t) => String(zonedParts(t.openedAt, ctx.tz).h).padStart(2, "0"), (k) => `${k}:00`).sort((a, b) => a.key.localeCompare(b.key));
  const symbols = breakdown(trades, (t) => t.symbol);
  const setups = breakdown(trades, (t) => t.journal?.setup ?? "ยังไม่ติด tag");
  const confluences = breakdown(trades, (t) => t.journal?.confluences ?? []);
  const emotions = breakdown(trades, (t) => t.journal?.emotions ?? []);
  const mistakes = breakdown(trades, (t) => (t.journal?.mistakes?.length ? t.journal.mistakes : "ไม่ได้ติด tag ข้อผิดพลาด"));
  const sides = breakdown(trades, (t) => t.side, (k) => (k === "long" ? "Buy" : "Sell"));
  const tradeNo = order(
    breakdown(trades, (t) => String(Math.min(4, nth.get(t._id) ?? 1)), (k) => (k === "4" ? "เทรดที่ 4 ขึ้นไป" : `เทรดที่ ${k} ของวัน`)),
    ["1", "2", "3", "4"],
  );
  const tilt = breakdown(trades, (t) => (afterLoss.get(t._id) ? "after" : "other"), (k) => (k === "after" ? "ภายใน 60 นาทีหลังแพ้" : "เทรดอื่น ๆ"));
  const hold = order(
    breakdown(trades, (t) => (t.durationSec === undefined ? null : HOLD.find((b) => t.durationSec! < b.max)!.key), (k) => HOLD.find((b) => b.key === k)!.label),
    HOLD.map((b) => b.key),
  );
  const news = breakdown(trades, (t) => (t.evidence ? ((t.evidence.items ?? []).some((e) => e.kind === "news") ? "near" : "clear") : null), (k) => (k === "near" ? "มีข่าวแรงภายใน ±30 นาที" : "ไม่มีข่าวใกล้ ๆ"));
  const stopBe = breakdown(
    trades,
    (t) => ((t.slHistory ?? []).slice(1).some((h) => Math.abs(h.sl - t.entryPrice) <= Math.abs((t.sl0 ?? t.entryPrice) - t.entryPrice) * 0.1) ? "be" : "kept"),
    (k) => (k === "be" ? "เลื่อน SL ไป break-even" : "ปล่อย SL ไว้ที่เดิม"),
  );

  // Mistake cost: what each tagged mistake lost, against the account's average trade.
  const cost = breakdown(trades, (t) => t.journal?.mistakes ?? [])
    .map((r) => ({ key: r.key, label: r.label, n: r.n, net: r.net, avgR: r.avgR }))
    .sort((a, b) => a.net - b.net);

  // R distribution in 0.5R bins, clamped to −3R…+5R.
  const bins = new Map<number, number>();
  for (const t of trades) {
    if (t.r === undefined || t.r === null) continue;
    const b = Math.max(-3, Math.min(5, Math.floor(t.r * 2) / 2));
    bins.set(b, (bins.get(b) ?? 0) + 1);
  }
  const hist: { from: number; n: number }[] = [];
  for (let b = -3; b <= 5; b += 0.5) hist.push({ from: b, n: bins.get(b) ?? 0 });

  // Drawdown (cash-flow adjusted) over the range.
  const fromMs = from ? new Date(`${from}T00:00:00Z`).getTime() : -Infinity;
  let peak = 0;
  const dd = curve.points.map((p) => {
    peak = Math.max(peak, p.index);
    return { t: p.t, dd: peak > 0 ? (p.index / peak - 1) * 100 : 0 };
  });
  const ddRange = dd.filter((p) => p.t >= fromMs);

  const candidates = [
    ...sessions.map((r) => ({ ...r, group: "Session" })),
    ...weekdays.map((r) => ({ ...r, group: "วัน" })),
    ...hours.map((r) => ({ ...r, group: "ชั่วโมง" })),
    ...symbols.map((r) => ({ ...r, group: "Symbol" })),
    ...setups.filter((r) => r.key !== "ยังไม่ติด tag").map((r) => ({ ...r, group: "Setup" })),
  ];
  const sw = strongWeak(candidates, minN, 4);

  return {
    ctx: { currency: ctx.currency, tz: ctx.tz, minN, range },
    summary: summarize(trades),
    days: dailyStats(trades).length,
    heat: { local: heat(trades, ctx.tz), ny: heat(trades, NY_TZ) },
    sessions,
    weekdays,
    hours,
    symbols,
    sides,
    setups,
    confluences,
    emotions,
    mistakes,
    tradeNo,
    tilt,
    hold,
    news,
    stopBe,
    cost,
    hist,
    drawdown: { points: ddRange, max: Math.min(0, ...ddRange.map((p) => p.dd)), current: ddRange.at(-1)?.dd ?? 0 },
    strong: sw.strong as (BreakdownRow & { group: string })[],
    weak: sw.weak as (BreakdownRow & { group: string })[],
    insufficient: sw.insufficient,
  };
}

export type Insights = NonNullable<Awaited<ReturnType<typeof insights>>>;
