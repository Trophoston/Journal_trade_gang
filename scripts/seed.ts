/**
 * Demo data: ~3 months of XAUUSD / EURUSD / NAS100 trades on a synthetic price path,
 * pushed through the same ingest code the MT5 EA uses. Candles, news, journal tags
 * and a few mock AI reports are generated so every screen has something to show.
 *
 *   pnpm db:up && pnpm seed
 */
process.env.AI_MOCK_DELAY = "0";

import type { AnyBulkWriteOperation } from "mongodb";
import { runReport } from "../lib/ai/tasks";
import type { ReportKind } from "../lib/ai/types";
import { mongo } from "../lib/db/client";
import { cols, ensureIndexes } from "../lib/db/collections";
import type { CandleDoc, EconEventDoc, Timeframe, TradeDoc } from "../lib/domain/types";
import { refreshEvidence } from "../lib/market/service";
import { accountIdFor, handleDeals, handleHello } from "../lib/mt5/ingest";
import type { DealPayload } from "../lib/mt5/protocol";
import { getSettings, updateSettings } from "../lib/settings";
import { addDays, dayKey, NY_TZ, tradingDayOf, weekdayOf, weekStartOf, zonedParts, zonedTime } from "../lib/time/zone";

// ───────────────────────── deterministic randomness

let seed = 20261101;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a: number, b: number) => a + rand() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const chance = (p: number) => rand() < p;
function gauss() {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
function pick<T>(items: readonly T[], weights?: number[]): T {
  if (!weights) return items[Math.floor(rand() * items.length)];
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rand() * total;
  for (let i = 0; i < items.length; i++) if ((x -= weights[i]) <= 0) return items[i];
  return items[items.length - 1];
}
function some<T>(items: readonly T[], n: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

// ───────────────────────── market model

const LOGIN = 80012345;
const SERVER = "TradeGang-Demo";
const MIN = 60_000;
const HOUR = 60 * MIN;

interface Instrument {
  raw: string;
  symbol: string;
  start: number;
  sigma: number; // per-minute move at session multiplier 1
  digits: number;
  tickSize: number;
  tickValue: number;
  contract: number;
  commissionPerLot: number; // per side
  currencies: string[];
}

const INSTRUMENTS: Instrument[] = [
  { raw: "XAUUSDm", symbol: "XAUUSD", start: 3948, sigma: 0.85, digits: 2, tickSize: 0.01, tickValue: 1, contract: 100, commissionPerLot: 3.5, currencies: ["USD"] },
  { raw: "EURUSDm", symbol: "EURUSD", start: 1.1612, sigma: 0.000095, digits: 5, tickSize: 0.00001, tickValue: 1, contract: 100000, commissionPerLot: 3.5, currencies: ["EUR", "USD"] },
  { raw: "USTECm", symbol: "NAS100", start: 25140, sigma: 5.2, digits: 2, tickSize: 0.01, tickValue: 0.01, contract: 1, commissionPerLot: 0, currencies: ["USD"] },
];

const hourCache = new Map<number, { wd: number; h: number; min: number; day: string }>();
function ny(ms: number) {
  const key = Math.floor(ms / (15 * MIN));
  let v = hourCache.get(key);
  if (!v) {
    const p = zonedParts(key * 15 * MIN, NY_TZ);
    v = { wd: p.wd, h: p.h, min: p.min, day: dayKey(p.y, p.m, p.d) };
    hourCache.set(key, v);
  }
  return { ...v, min: v.min + Math.floor((ms % (15 * MIN)) / MIN) };
}

function marketOpen(ms: number) {
  const { wd, h } = ny(ms);
  if (wd === 6) return false;
  if (wd === 5 && h >= 17) return false;
  if (wd === 0 && h < 17) return false;
  return true;
}

function sessionMult(ms: number) {
  const { h, min } = ny(ms);
  const hm = h + min / 60;
  if (hm >= 16 && hm < 18) return 0.3;
  if (hm >= 18 || hm < 1) return hm >= 20 ? 0.5 : 0.42;
  if (hm < 7) return hm >= 2 && hm < 5 ? 1.35 : 0.95;
  if (hm < 11.5) return hm < 10 ? 1.55 : 1.1;
  return hm >= 13.5 ? 0.9 : 0.75;
}

interface Path {
  t0: number;
  o: Float64Array;
  h: Float64Array;
  l: Float64Array;
  c: Float64Array;
  open: Uint8Array;
}

function buildPath(inst: Instrument, t0: number, minutes: number, spikes: Map<number, number>): Path {
  const o = new Float64Array(minutes);
  const h = new Float64Array(minutes);
  const l = new Float64Array(minutes);
  const c = new Float64Array(minutes);
  const open = new Uint8Array(minutes);
  let price = inst.start;
  let drift = 0;
  for (let i = 0; i < minutes; i++) {
    const t = t0 + i * MIN;
    if (!marketOpen(t)) {
      o[i] = h[i] = l[i] = c[i] = price;
      continue;
    }
    open[i] = 1;
    if (i % 60 === 0) drift = drift * 0.6 + gauss() * 0.11 * inst.sigma;
    const mult = sessionMult(t) * (spikes.get(Math.floor(t / MIN)) ?? 1);
    const s = inst.sigma * mult;
    const ret = drift * mult + gauss() * s + (inst.start - price) * 0.00002;
    const op = price;
    const cl = op + ret;
    o[i] = op;
    c[i] = cl;
    h[i] = Math.max(op, cl) + Math.abs(gauss()) * 0.4 * s;
    l[i] = Math.min(op, cl) - Math.abs(gauss()) * 0.4 * s;
    price = cl;
  }
  return { t0, o, h, l, c, open };
}

const round = (x: number, digits: number) => Number(x.toFixed(digits));

function aggregate(inst: Instrument, path: Path, tf: Timeframe, size: number): Omit<CandleDoc, "_id">[] {
  const out: Omit<CandleDoc, "_id">[] = [];
  const n = path.c.length;
  for (let i = 0; i < n; i += size) {
    let hi = -Infinity;
    let lo = Infinity;
    let first = -1;
    let last = -1;
    for (let j = i; j < Math.min(n, i + size); j++) {
      if (!path.open[j]) continue;
      if (first < 0) first = j;
      last = j;
      hi = Math.max(hi, path.h[j]);
      lo = Math.min(lo, path.l[j]);
    }
    if (first < 0) continue;
    out.push({
      symbol: `demo:${inst.symbol}`,
      tf,
      t: new Date(path.t0 + i * MIN),
      o: round(path.o[first], inst.digits),
      h: round(hi, inst.digits),
      l: round(lo, inst.digits),
      c: round(path.c[last], inst.digits),
      v: int(80, 900) * size,
    });
  }
  return out;
}

// ───────────────────────── calendar

interface NewsSeed {
  time: Date;
  currency: string;
  name: string;
  importance: "high" | "medium" | "low";
  forecast: number | null;
  previous: number | null;
}

function nthWeekday(y: number, m: number, wd: number, n: number) {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const day = dayKey(y, m, d);
    if (Number(day.slice(5, 7)) !== m) break;
    if (weekdayOf(day) === wd && ++count === n) return day;
  }
  return dayKey(y, m, 28);
}

function newsCalendar(fromDay: string, toDay: string): NewsSeed[] {
  const out: NewsSeed[] = [];
  const at = (day: string, h: number, min: number) => zonedTime(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)), h, min, NY_TZ);
  const add = (day: string, h: number, min: number, currency: string, name: string, importance: NewsSeed["importance"], f: number | null, p: number | null) => {
    if (day >= fromDay && day <= toDay) out.push({ time: at(day, h, min), currency, name, importance, forecast: f, previous: p });
  };
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    if (wd === 4) add(d, 8, 30, "USD", "Initial Jobless Claims", "medium", 221, 218);
    if (wd === 3) add(d, 10, 30, "USD", "EIA Crude Oil Inventories", "low", -1.2, 0.8);
  }
  for (const [y, m] of [
    [2026, 7],
    [2026, 8],
    [2026, 9],
    [2026, 10],
    [2026, 11],
  ]) {
    add(nthWeekday(y, m, 5, 1), 8, 30, "USD", "Nonfarm Payrolls", "high", 135, 122);
    add(nthWeekday(y, m, 5, 1), 8, 30, "USD", "Unemployment Rate", "high", 4.3, 4.3);
    add(nthWeekday(y, m, 1, 1), 10, 0, "USD", "ISM Manufacturing PMI", "high", 49.6, 49.1);
    add(nthWeekday(y, m, 3, 1), 10, 0, "USD", "ISM Services PMI", "medium", 51.8, 52.0);
    add(nthWeekday(y, m, 2, 1), 10, 0, "USD", "JOLTS Job Openings", "medium", 7.2, 7.4);
    add(nthWeekday(y, m, 3, 1), 8, 15, "USD", "ADP Employment Change", "medium", 95, 110);
    add(nthWeekday(y, m, 3, 2), 8, 30, "USD", "CPI m/m", "high", 0.3, 0.2);
    add(nthWeekday(y, m, 3, 2), 8, 30, "USD", "Core CPI m/m", "high", 0.3, 0.3);
    add(nthWeekday(y, m, 4, 2), 8, 30, "USD", "PPI m/m", "medium", 0.2, 0.1);
    add(nthWeekday(y, m, 4, 3), 8, 30, "USD", "Retail Sales m/m", "high", 0.4, 0.6);
    add(nthWeekday(y, m, 2, 1), 5, 0, "EUR", "CPI Flash Estimate y/y", "high", 2.1, 2.0);
    add(nthWeekday(y, m, 2, 3), 5, 0, "EUR", "ZEW Economic Sentiment", "medium", 38.5, 41.2);
  }
  add("2026-09-16", 14, 0, "USD", "FOMC Statement & Rate Decision", "high", 3.75, 4.0);
  add("2026-09-16", 14, 30, "USD", "FOMC Press Conference", "high", null, null);
  add("2026-10-28", 14, 0, "USD", "FOMC Statement & Rate Decision", "high", 3.5, 3.75);
  add("2026-10-28", 14, 30, "USD", "FOMC Press Conference", "high", null, null);
  add("2026-09-10", 8, 15, "EUR", "ECB Main Refinancing Rate", "high", 2.0, 2.0);
  add("2026-10-29", 8, 15, "EUR", "ECB Main Refinancing Rate", "high", 2.0, 2.0);
  add("2026-08-21", 10, 0, "USD", "Fed Chair Speech (Jackson Hole)", "high", null, null);
  return out.sort((a, b) => a.time.getTime() - b.time.getTime());
}

// ───────────────────────── trades

const SETUPS = [
  { name: "Liquidity sweep + FVG", edge: 0.1, confluences: ["Liquidity sweep", "FVG", "BOS / MSS", "Killzone", "HTF bias"] },
  { name: "Order block retest", edge: 0.02, confluences: ["Order block", "HTF bias", "OTE", "Killzone"] },
  { name: "Breakout retest", edge: -0.02, confluences: ["BOS / MSS", "Breaker", "HTF bias"] },
  { name: "Trend continuation", edge: 0.04, confluences: ["HTF bias", "FVG", "OTE"] },
  { name: "Range fade", edge: -0.12, confluences: ["Liquidity sweep", "SMT divergence"] },
];

const SESSION_WINDOWS: Record<string, [number, number, number]> = {
  // [start NY hour, end NY hour, base win probability]
  asia: [19, 24, 0.3],
  london: [2, 5.5, 0.54],
  ny_am: [7.25, 10.5, 0.5],
  ny_pm: [12, 15.5, 0.36],
};

interface Plan {
  inst: Instrument;
  openIdx: number;
  session: string;
  setup: (typeof SETUPS)[number];
  revenge: boolean;
}

interface Sim {
  side: "long" | "short";
  entry: number;
  sl: number;
  tp: number;
  exitIdx: number;
  exit: number;
  reason: string;
  partial?: { idx: number; price: number };
  movedToBe?: number;
  mistakes: string[];
  win: boolean;
}

function simulate(path: Path, inst: Instrument, openIdx: number, side: "long" | "short", slDist: number, rr: number) {
  const dir = side === "long" ? 1 : -1;
  const entry = path.c[openIdx];
  const sl = entry - dir * slDist;
  const tp = entry + dir * slDist * rr;
  let mfe = 0;
  let firstR = -1;
  const limit = Math.min(path.c.length - 1, openIdx + 10 * 60);
  for (let i = openIdx + 1; i <= limit; i++) {
    if (!path.open[i]) continue;
    const adverse = dir === 1 ? path.l[i] <= sl : path.h[i] >= sl;
    const favorable = dir === 1 ? path.h[i] >= tp : path.l[i] <= tp;
    const fav = dir === 1 ? path.h[i] - entry : entry - path.l[i];
    mfe = Math.max(mfe, fav);
    if (firstR < 0 && fav >= slDist) firstR = i;
    if (adverse) return { hit: "sl" as const, idx: i, entry, sl, tp, mfe, firstR };
    if (favorable) return { hit: "tp" as const, idx: i, entry, sl, tp, mfe, firstR };
  }
  return { hit: "time" as const, idx: limit, entry, sl, tp, mfe, firstR };
}

function decide(path: Path, plan: Plan, wantWin: boolean): Sim | null {
  const inst = plan.inst;
  const atr = inst.sigma * sessionMult(path.t0 + plan.openIdx * MIN) * between(9, 16);
  const sides: ("long" | "short")[] = chance(0.5) ? ["long", "short"] : ["short", "long"];
  let sims: ({ side: "long" | "short" } & ReturnType<typeof simulate>)[] = [];
  let chosen: (typeof sims)[number] | undefined;
  // smaller targets until the wanted outcome exists on this path
  for (const rr of [pick([2, 2.5, 3]), 2, 1.6, 1.3]) {
    sims = sides.map((side) => ({ side, ...simulate(path, inst, plan.openIdx, side, atr, rr) }));
    chosen = wantWin ? sims.find((s) => s.hit === "tp") : sims.find((s) => s.hit === "sl");
    if (chosen) break;
  }
  chosen ??= [...sims].sort((a, b) => (wantWin ? -1 : 1) * ((a.side === "long" ? 1 : -1) * (path.c[a.idx] - a.entry) - (b.side === "long" ? 1 : -1) * (path.c[b.idx] - b.entry)))[0];
  const dir = chosen.side === "long" ? 1 : -1;
  const mistakes: string[] = [];
  let exitIdx = chosen.idx;
  let exit = chosen.hit === "sl" ? chosen.sl : chosen.hit === "tp" ? chosen.tp : path.c[chosen.idx];
  let reason = chosen.hit === "sl" ? "DEAL_REASON_SL" : chosen.hit === "tp" ? "DEAL_REASON_TP" : "DEAL_REASON_CLIENT";
  let partial: Sim["partial"];
  let movedToBe: number | undefined;

  if (chosen.hit === "sl" && chosen.firstR > 0 && chance(0.55)) {
    // was +1R, trader moved the stop to entry, got stopped at break-even
    movedToBe = chosen.firstR;
    for (let i = chosen.firstR + 1; i <= chosen.idx; i++) {
      if (dir === 1 ? path.l[i] <= chosen.entry : path.h[i] >= chosen.entry) {
        exitIdx = i;
        break;
      }
    }
    exit = chosen.entry + dir * inst.tickSize * int(0, 20);
    reason = "DEAL_REASON_SL";
    mistakes.push("Moved stop");
  } else if (chosen.hit === "tp" && chosen.firstR > 0 && chance(0.18)) {
    partial = { idx: chosen.firstR, price: chosen.entry + dir * atr };
  } else if (chosen.hit === "tp" && chance(0.12)) {
    // cut the winner early by hand
    const mid = Math.floor((plan.openIdx + chosen.idx) / 2);
    exitIdx = Math.max(plan.openIdx + 3, mid);
    exit = path.c[exitIdx];
    reason = "DEAL_REASON_CLIENT";
    mistakes.push("Cut winner early");
  }
  if (exitIdx <= plan.openIdx) return null;
  const pnl = (exit - chosen.entry) * dir;
  return { side: chosen.side, entry: chosen.entry, sl: chosen.sl, tp: chosen.tp, exitIdx, exit, reason, partial, movedToBe, mistakes, win: pnl > 0 };
}

// ───────────────────────── main

async function main() {
  const started = Date.now();
  await ensureIndexes();
  const c = await cols();
  const accountId = accountIdFor(LOGIN, SERVER);

  console.log("• clearing previous demo data");
  await Promise.all([
    c.accounts.deleteOne({ _id: accountId }),
    c.deals.deleteMany({ accountId }),
    c.trades.deleteMany({ accountId }),
    c.cashflows.deleteMany({ accountId }),
    c.symbols.deleteMany({ accountId }),
    c.equity.deleteMany({ "meta.accountId": accountId }),
    c.days.deleteMany({ accountId }),
    c.aiReports.deleteMany({ accountId }),
    c.aiJobs.deleteMany({ accountId }),
    c.aiThreads.deleteMany({ accountId }),
    c.candles.deleteMany({ symbol: /^demo:/ }),
    c.events.deleteMany({ source: "demo" }),
  ]);

  const now = Date.now();
  const today = tradingDayOf(now);
  let firstDay = addDays(today, -91);
  while (weekdayOf(firstDay) !== 1) firstDay = addDays(firstDay, 1);
  const t0 = zonedTime(Number(firstDay.slice(0, 4)), Number(firstDay.slice(5, 7)), Number(firstDay.slice(8, 10)), 0, 0, NY_TZ).getTime() - 7 * HOUR; // Sunday 17:00 NY
  const end = Math.min(now, zonedTime(Number(today.slice(0, 4)), Number(today.slice(5, 7)), Number(today.slice(8, 10)), 17, 0, NY_TZ).getTime());
  const minutes = Math.floor((end - t0) / MIN);

  console.log("• economic calendar");
  const news = newsCalendar(addDays(firstDay, -1), addDays(today, 8));
  const spikes: Record<string, Map<number, number>> = { USD: new Map(), EUR: new Map() };
  for (const n of news) {
    if (n.importance === "low" || n.time.getTime() > now) continue;
    const m0 = Math.floor(n.time.getTime() / MIN);
    const strength = n.importance === "high" ? 5.5 : 2.4;
    for (let k = 0; k < 18; k++) spikes[n.currency]?.set(m0 + k, Math.max(spikes[n.currency]?.get(m0 + k) ?? 1, k < 3 ? strength : 1 + (strength - 1) * 0.25));
  }
  await c.events.insertMany(
    news.map(
      (n, i): EconEventDoc => ({
        _id: `demo:${i}`,
        eventId: 900000 + i,
        time: n.time,
        currency: n.currency,
        country: n.currency === "USD" ? "US" : "EU",
        name: n.name,
        importance: n.importance,
        actual: n.time.getTime() < now && n.forecast !== null ? round(n.forecast + gauss() * Math.max(0.1, Math.abs(n.forecast) * 0.08), 2) : null,
        forecast: n.forecast,
        previous: n.previous,
        source: "demo",
      }),
    ),
  );

  console.log("• price paths and candles");
  const paths = new Map<string, Path>();
  for (const inst of INSTRUMENTS) {
    const merged = new Map<number, number>();
    for (const cur of inst.currencies) for (const [k, v] of spikes[cur] ?? []) merged.set(k, Math.max(merged.get(k) ?? 1, v));
    const path = buildPath(inst, t0, minutes, merged);
    paths.set(inst.symbol, path);
    for (const [tf, size] of [
      ["M5", 5],
      ["M15", 15],
      ["H1", 60],
    ] as const) {
      const bars = aggregate(inst, path, tf, size);
      for (let i = 0; i < bars.length; i += 5000) await c.candles.insertMany(bars.slice(i, i + 5000) as CandleDoc[], { ordered: false });
    }
  }

  console.log("• trades");
  const deals: DealPayload[] = [];
  let ticket = 51_000_000;
  const toServer = (ms: number) => Math.floor(ms / 1000);
  const balanceDeal = (ms: number, amount: number, comment: string) => {
    deals.push({ ticket: ticket++, order: 0, position: 0, time: toServer(ms), timeMsc: ms, type: "DEAL_TYPE_BALANCE", entry: "DEAL_ENTRY_IN", reason: "", symbol: "", volume: 0, price: 0, profit: amount, swap: 0, commission: 0, fee: 0, sl: 0, tp: 0, magic: 0, comment });
  };
  balanceDeal(t0 + 30 * MIN, 10_000, "Deposit");

  let balance = 10_000;
  let lastLossAt = 0;
  const journal = new Map<number, { setup: string; confluences: string[]; emotions: string[]; mistakes: string[]; rating: number; followedPlan: boolean; notes?: string }>();
  const m1Windows: [number, number, string][] = [];
  const dayList: string[] = [];
  for (let d = firstDay; d <= today; d = addDays(d, 1)) if (weekdayOf(d) >= 1 && weekdayOf(d) <= 5) dayList.push(d);

  let tradeCount = 0;
  for (const [di, day] of dayList.entries()) {
    if (di === 38) {
      balanceDeal(zonedTime(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)), 0, 30, NY_TZ).getTime(), 2_000, "Deposit");
      balance += 2000;
    }
    if (di === 58) {
      balanceDeal(zonedTime(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)), 0, 30, NY_TZ).getTime(), -1_500, "Withdrawal");
      balance -= 1500;
    }
    const n = pick([0, 1, 2, 3, 4, 5], [9, 30, 33, 18, 7, 3]);
    const plans: Plan[] = [];
    for (let k = 0; k < n; k++) {
      const session = pick(["london", "ny_am", "asia", "ny_pm"], [36, 34, 14, 16]);
      const [h0, h1] = SESSION_WINDOWS[session];
      const hour = between(h0, h1);
      const base = session === "asia" ? addDays(day, -1) : day;
      const hh = Math.floor(hour % 24);
      const mm = Math.floor((hour % 1) * 60);
      const ms = zonedTime(Number(base.slice(0, 4)), Number(base.slice(5, 7)), Number(base.slice(8, 10)), hh, mm, NY_TZ).getTime();
      const idx = Math.floor((ms - t0) / MIN);
      if (idx < 30 || idx >= minutes - 60 || ms > now - 2 * HOUR) continue;
      const inst = pick(INSTRUMENTS, [55, 25, 20]);
      if (!paths.get(inst.symbol)!.open[idx]) continue;
      plans.push({ inst, openIdx: idx, session, setup: pick(SETUPS, [34, 22, 16, 18, 10]), revenge: false });
    }
    plans.sort((a, b) => a.openIdx - b.openIdx);
    let lossesToday = 0;
    for (const plan of plans) {
      const openMs = t0 + plan.openIdx * MIN;
      plan.revenge = lastLossAt > 0 && openMs - lastLossAt < 60 * MIN;
      const path = paths.get(plan.inst.symbol)!;
      let p = SESSION_WINDOWS[plan.session][2] + plan.setup.edge;
      if (plan.inst.symbol === "NAS100") p -= 0.08;
      if (plan.revenge) p -= 0.18;
      if (lossesToday >= 2) p -= 0.1;
      const sim = decide(path, plan, chance(Math.max(0.08, Math.min(0.85, p))));
      if (!sim) continue;
      const inst = plan.inst;
      const dir = sim.side === "long" ? 1 : -1;
      const slDist = Math.abs(sim.entry - sim.sl);
      const oversized = chance(plan.revenge ? 0.35 : 0.05);
      const riskPct = oversized ? between(1.8, 2.6) : between(0.8, 1.1);
      const valuePerUnit = inst.tickValue / inst.tickSize;
      const volume = Math.max(0.01, Number(((balance * riskPct) / 100 / (slDist * valuePerUnit)).toFixed(2)));
      const pos = ticket;
      const entry = round(sim.entry, inst.digits);
      const sl = round(sim.sl, inst.digits);
      const tp = round(sim.tp, inst.digits);
      const commission = -inst.commissionPerLot * volume;
      const deal = (ms: number, type: "buy" | "sell", entryKind: string, vol: number, price: number, profit: number, reason: string, comm: number, swap = 0) =>
        deals.push({
          ticket: ticket++,
          order: ticket + 7_000_000,
          position: pos,
          time: toServer(ms),
          timeMsc: ms,
          type: type === "buy" ? "DEAL_TYPE_BUY" : "DEAL_TYPE_SELL",
          entry: entryKind,
          reason,
          symbol: inst.raw,
          volume: vol,
          price,
          profit: Number(profit.toFixed(2)),
          swap: Number(swap.toFixed(2)),
          commission: Number(comm.toFixed(2)),
          fee: 0,
          sl,
          tp,
          magic: 0,
          comment: reason === "DEAL_REASON_SL" ? `[sl ${sl}]` : reason === "DEAL_REASON_TP" ? `[tp ${tp}]` : "",
        });
      deal(openMs + int(0, 50) * 1000, sim.side === "long" ? "buy" : "sell", "DEAL_ENTRY_IN", volume, entry, 0, "DEAL_REASON_CLIENT", commission);
      let remaining = volume;
      let realized = 0;
      const closeType = sim.side === "long" ? "sell" : "buy";
      if (sim.partial && volume >= 0.02) {
        const half = Number((volume / 2).toFixed(2));
        const price = round(sim.partial.price, inst.digits);
        const profit = (price - entry) * dir * half * valuePerUnit;
        realized += profit;
        deal(t0 + sim.partial.idx * MIN + int(5, 55) * 1000, closeType, "DEAL_ENTRY_OUT", half, price, profit, "DEAL_REASON_CLIENT", -inst.commissionPerLot * half);
        remaining = Number((volume - half).toFixed(2));
      }
      const closeMs = t0 + sim.exitIdx * MIN + int(5, 55) * 1000;
      const exit = round(sim.exit, inst.digits);
      const nights = Math.max(0, tradingDayOf(closeMs) > tradingDayOf(openMs) ? 1 : 0);
      const swap = nights ? -volume * (inst.symbol === "XAUUSD" ? 4.2 : 1.1) : 0;
      const profit = (exit - entry) * dir * remaining * valuePerUnit;
      realized += profit;
      deal(closeMs, closeType, "DEAL_ENTRY_OUT", remaining, exit, profit, sim.reason, -inst.commissionPerLot * remaining, swap);
      const net = realized + commission * 2 + swap;
      balance += net;
      tradeCount++;

      const loss = net < 0;
      if (loss) {
        lastLossAt = closeMs;
        lossesToday++;
      }
      const mistakes = [...sim.mistakes];
      if (oversized) mistakes.push("Oversized");
      if (plan.revenge) mistakes.push(pick(["Chased price", "Overtraded", "Early entry"]));
      if (lossesToday > 2 && loss) mistakes.push("Overtraded");
      if (!plan.revenge && loss && chance(0.25)) mistakes.push(pick(["Early entry", "Late entry", "Traded news"]));
      const emotions = plan.revenge ? some(["Revenge", "FOMO", "Fear"], int(1, 2)) : chance(0.75) ? [pick(["Calm", "Confident"])] : some(["FOMO", "Bored", "Tired", "Greedy"], 1);
      const confluences = some(plan.setup.confluences, int(2, Math.min(4, plan.setup.confluences.length)));
      if (plan.session === "london" || plan.session === "ny_am") confluences.push("Killzone");
      journal.set(pos, {
        setup: plan.setup.name,
        confluences: [...new Set(confluences)],
        emotions,
        mistakes: [...new Set(mistakes)],
        rating: Math.max(1, Math.min(5, (loss ? 3 : 4) - Math.min(2, mistakes.length) + int(-1, 1))),
        followedPlan: mistakes.length === 0,
        notes: chance(0.18)
          ? pick([
              "รอ sweep ของ Asia low แล้วค่อยเข้า ตามแผน",
              "เข้าเร็วไป ยังไม่มี MSS ชัด",
              "ข่าวออกระหว่างถือ ราคาสวิงแรง",
              "Clean displacement after the sweep, took the FVG.",
              "Should have waited for the M5 close.",
            ])
          : undefined,
      });
      m1Windows.push([openMs - 45 * MIN, closeMs + 45 * MIN, inst.symbol]);
    }
  }

  console.log(`• ${tradeCount} trades → ingest (${deals.length} deals)`);
  const gmt = Math.floor(now / 1000);
  await handleHello(
    { login: LOGIN, server: SERVER, v: 1, ea: "demo-seed", company: "Trade Gang Demo", name: "Demo Trader", currency: "USD", leverage: 500, marginMode: "ACCOUNT_MARGIN_MODE_RETAIL_HEDGING", tradeMode: "ACCOUNT_TRADE_MODE_DEMO", balance, equity: balance, serverTime: gmt, gmtTime: gmt },
    "demo",
  );
  const symbols = INSTRUMENTS.map((i) => ({ name: i.raw, digits: i.digits, point: i.tickSize, tickSize: i.tickSize, tickValue: i.tickValue, contractSize: i.contract, currencyProfit: "USD" }));
  for (let i = 0; i < deals.length; i += 400) await handleDeals({ login: LOGIN, server: SERVER, deals: deals.slice(i, i + 400), symbols: i === 0 ? symbols : [] });

  console.log("• M1 candles around trades");
  const m1Ops: AnyBulkWriteOperation<CandleDoc>[] = [];
  const seen = new Set<string>();
  for (const [from, to, symbol] of m1Windows) {
    const path = paths.get(symbol)!;
    const inst = INSTRUMENTS.find((x) => x.symbol === symbol)!;
    for (let i = Math.max(0, Math.floor((from - t0) / MIN)); i <= Math.min(minutes - 1, Math.floor((to - t0) / MIN)); i++) {
      const key = `${symbol}:${i}`;
      if (!path.open[i] || seen.has(key)) continue;
      seen.add(key);
      m1Ops.push({
        insertOne: { document: { symbol: `demo:${symbol}`, tf: "M1", t: new Date(t0 + i * MIN), o: round(path.o[i], inst.digits), h: round(path.h[i], inst.digits), l: round(path.l[i], inst.digits), c: round(path.c[i], inst.digits), v: int(20, 300) } as CandleDoc },
      });
    }
  }
  for (let i = 0; i < m1Ops.length; i += 5000) await c.candles.bulkWrite(m1Ops.slice(i, i + 5000), { ordered: false });

  console.log("• journal tags, evidence, equity");
  const trades = await c.trades.find({ accountId }).sort({ closedAt: 1 }).toArray();
  const untagged = new Set(trades.slice(-6).map((t) => t._id));
  const jOps: AnyBulkWriteOperation<TradeDoc>[] = [];
  for (const t of trades) {
    const j = journal.get(t.positionId);
    if (!j || untagged.has(t._id)) continue;
    jOps.push({
      updateOne: {
        filter: { _id: t._id },
        update: { $set: { "journal.setup": j.setup, "journal.confluences": j.confluences, "journal.emotions": j.emotions, "journal.mistakes": j.mistakes, "journal.rating": j.rating, "journal.followedPlan": j.followedPlan, ...(j.notes ? { "journal.notes": j.notes } : {}), "journal.reviewedAt": t.closedAt } },
      },
    });
  }
  if (jOps.length) await c.trades.bulkWrite(jOps);
  for (const t of await c.trades.find({ accountId, status: "closed" }).toArray()) await refreshEvidence(t);

  const flows = await c.cashflows.find({ accountId }).toArray();
  const events = [...trades.filter((t) => t.closedAt).map((t) => ({ t: t.closedAt!, d: t.net })), ...flows.map((f) => ({ t: f.time, d: f.amount }))].sort((a, b) => a.t.getTime() - b.t.getTime());
  let bal = 0;
  const snaps = events.map((e) => {
    bal += e.d;
    return { t: e.t, meta: { accountId }, balance: Number(bal.toFixed(2)), equity: Number(bal.toFixed(2)) };
  });
  if (snaps.length) await c.equity.insertMany(snaps);
  await c.accounts.updateOne({ _id: accountId }, { $set: { balance: Number(bal.toFixed(2)), equity: Number(bal.toFixed(2)), floating: 0, positions: [], lastSeenAt: new Date(now - 26 * HOUR) } });

  const recentDays = [...new Set(trades.map((t) => t.tradingDay))].slice(-12);
  const plans = ["รอ sweep ของ Asia high/low ก่อน London", "เทรดเฉพาะ XAUUSD ช่วง NY AM", "Bias bullish ตาม H4, หา long ใน discount", "ไม่เทรดก่อน CPI 30 นาที"];
  for (const day of recentDays) {
    await c.days.updateOne(
      { _id: `${accountId}:${day}` },
      { $set: { accountId, day, plan: pick(plans), bias: pick(["bullish", "bearish", "neutral"] as const), reflection: chance(0.6) ? pick(["ทำตามแผนได้ดี", "เทรดเยอะเกินไปหลังแพ้", "Patient today, waited for the killzone."]) : undefined, mood: int(2, 5), updatedAt: new Date() } },
      { upsert: true },
    );
  }

  await updateSettings({ activeAccountId: accountId });

  console.log("• mock AI reports");
  const settings = await getSettings();
  const run = async (kind: ReportKind, scopeKey: string, payload: Record<string, string>) => {
    try {
      await runReport({ kind, scopeKey, accountId, payload, auto: true }, async () => {});
    } catch (err) {
      console.warn(`  ! ${kind} ${scopeKey}: ${(err as Error).message}`);
    }
  };
  const closed = trades.filter((t) => t.status === "closed" && !untagged.has(t._id));
  for (const t of closed.slice(-24)) await run("trade", `trade:${t._id}`, { tradeId: t._id });
  for (const day of recentDays.slice(-8, -1)) await run("daily", `daily:${accountId}:${day}`, { day });
  const mondays = [...new Set(recentDays.map(weekStartOf))];
  for (const monday of [...new Set([...mondays, weekStartOf(addDays(today, -7)), weekStartOf(addDays(today, -14)), weekStartOf(addDays(today, -21))])].sort().slice(-4)) {
    if (monday < weekStartOf(today) || weekdayOf(today) === 6 || weekdayOf(today) === 0) await run("weekly", `weekly:${accountId}:${monday}`, { monday });
  }
  await run("brief", `brief:${accountId}:${today}`, { day: today });

  const total = await c.trades.countDocuments({ accountId });
  console.log(`✓ demo ready: ${total} trades, balance ${bal.toFixed(2)} USD, language ${settings.ai.language}, ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (await mongo()).close();
  });
