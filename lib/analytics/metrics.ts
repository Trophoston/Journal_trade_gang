/** Deterministic trading statistics. The AI never computes numbers; it reads these. */

export interface StatTrade {
  net: number;
  r?: number;
  openedAt: Date;
  closedAt?: Date;
  tradingDay: string;
  durationSec?: number;
  commission: number;
  swap: number;
  fee: number;
  riskMoney?: number;
}

export type Outcome = "win" | "loss" | "be";

/** Break-even when the result is within ±0.05R (or exactly zero without a stop). */
export function outcome(t: Pick<StatTrade, "net" | "r">): Outcome {
  if (t.r !== undefined && t.r !== null) {
    if (Math.abs(t.r) < 0.05) return "be";
    return t.r > 0 ? "win" : "loss";
  }
  if (Math.abs(t.net) < 1e-9) return "be";
  return t.net > 0 ? "win" : "loss";
}

export interface Summary {
  count: number;
  wins: number;
  losses: number;
  be: number;
  winRate: number | null;
  net: number;
  grossWin: number;
  grossLoss: number;
  avgWin: number | null;
  avgLoss: number | null;
  payoff: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  avgR: number | null;
  totalR: number;
  rCount: number;
  largestWin: number;
  largestLoss: number;
  fees: number;
  avgHoldSec: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function summarize(trades: StatTrade[]): Summary {
  let wins = 0, losses = 0, be = 0, grossWin = 0, grossLoss = 0, net = 0, totalR = 0, rCount = 0;
  let largestWin = 0, largestLoss = 0, fees = 0, hold = 0, holdN = 0;
  for (const t of trades) {
    const o = outcome(t);
    net += t.net;
    fees += t.commission + t.swap + t.fee;
    if (o === "win") {
      wins++;
      grossWin += t.net;
    } else if (o === "loss") {
      losses++;
      grossLoss += -t.net;
    } else be++;
    largestWin = Math.max(largestWin, t.net);
    largestLoss = Math.min(largestLoss, t.net);
    if (t.r !== undefined && t.r !== null) {
      totalR += t.r;
      rCount++;
    }
    if (t.durationSec) {
      hold += t.durationSec;
      holdN++;
    }
  }
  const decided = wins + losses;
  const avgWin = wins ? grossWin / wins : null;
  const avgLoss = losses ? grossLoss / losses : null;
  return {
    count: trades.length,
    wins,
    losses,
    be,
    winRate: decided ? wins / decided : null,
    net: r2(net),
    grossWin: r2(grossWin),
    grossLoss: r2(grossLoss),
    avgWin: avgWin === null ? null : r2(avgWin),
    avgLoss: avgLoss === null ? null : r2(avgLoss),
    payoff: avgWin !== null && avgLoss ? avgWin / avgLoss : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    expectancy: trades.length ? r2(net / trades.length) : null,
    avgR: rCount ? totalR / rCount : null,
    totalR: r2(totalR),
    rCount,
    largestWin: r2(largestWin),
    largestLoss: r2(largestLoss),
    fees: r2(fees),
    avgHoldSec: holdN ? hold / holdN : null,
  };
}

/** Wilson score interval for a win rate (z = 1.645 → 90%). */
export function wilson(k: number, n: number, z = 1.645): [number, number] {
  if (!n) return [0, 1];
  const p = k / n;
  const den = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - margin) / den), Math.min(1, (centre + margin) / den)];
}

export interface DayStat {
  day: string;
  net: number;
  count: number;
  wins: number;
  losses: number;
  r: number;
  rCount: number;
}

export function dailyStats<T extends StatTrade>(trades: T[]): DayStat[] {
  const map = new Map<string, DayStat>();
  for (const t of trades) {
    const d = map.get(t.tradingDay) ?? { day: t.tradingDay, net: 0, count: 0, wins: 0, losses: 0, r: 0, rCount: 0 };
    d.net += t.net;
    d.count++;
    const o = outcome(t);
    if (o === "win") d.wins++;
    if (o === "loss") d.losses++;
    if (t.r !== undefined && t.r !== null) {
      d.r += t.r;
      d.rCount++;
    }
    map.set(t.tradingDay, d);
  }
  return [...map.values()].map((d) => ({ ...d, net: r2(d.net), r: r2(d.r) })).sort((a, b) => a.day.localeCompare(b.day));
}

export interface Streaks {
  currentTrades: { kind: "win" | "loss" | "none"; n: number };
  maxWinTrades: number;
  maxLossTrades: number;
  currentDays: { kind: "win" | "loss" | "none"; n: number };
  maxWinDays: number;
  maxLossDays: number;
}

function runStreaks(seq: ("win" | "loss" | "be")[]) {
  let cur: "win" | "loss" | "none" = "none", n = 0, maxW = 0, maxL = 0;
  for (const o of seq) {
    if (o === "be") continue;
    if (o === cur) n++;
    else {
      cur = o;
      n = 1;
    }
    if (o === "win") maxW = Math.max(maxW, n);
    else maxL = Math.max(maxL, n);
  }
  return { current: { kind: cur, n }, maxW, maxL };
}

export function streaks<T extends StatTrade>(trades: T[]): Streaks {
  const sorted = [...trades].sort((a, b) => (a.closedAt?.getTime() ?? 0) - (b.closedAt?.getTime() ?? 0));
  const t = runStreaks(sorted.map(outcome));
  const d = runStreaks(dailyStats(sorted).map((x) => (x.net > 0 ? "win" : x.net < 0 ? "loss" : "be")));
  return {
    currentTrades: t.current,
    maxWinTrades: t.maxW,
    maxLossTrades: t.maxL,
    currentDays: d.current,
    maxWinDays: d.maxW,
    maxLossDays: d.maxL,
  };
}

export interface BreakdownRow {
  key: string;
  label: string;
  n: number;
  wins: number;
  losses: number;
  winRate: number | null;
  wilsonLow: number;
  wilsonHigh: number;
  net: number;
  avgR: number | null;
  expectancy: number;
  profitFactor: number | null;
}

/** Group trades by a key (a trade may belong to several keys, e.g. confluence tags). */
export function breakdown<T extends StatTrade>(
  trades: T[],
  keyFn: (t: T) => string | string[] | null | undefined,
  labelFn: (key: string) => string = (k) => k,
): BreakdownRow[] {
  const groups = new Map<string, T[]>();
  for (const t of trades) {
    const k = keyFn(t);
    const keys = Array.isArray(k) ? k : k === null || k === undefined || k === "" ? [] : [k];
    for (const key of keys) {
      const g = groups.get(key);
      if (g) g.push(t);
      else groups.set(key, [t]);
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const s = summarize(g);
      const [lo, hi] = wilson(s.wins, s.wins + s.losses);
      return {
        key,
        label: labelFn(key),
        n: s.count,
        wins: s.wins,
        losses: s.losses,
        winRate: s.winRate,
        wilsonLow: lo,
        wilsonHigh: hi,
        net: s.net,
        avgR: s.avgR,
        expectancy: s.expectancy ?? 0,
        profitFactor: s.profitFactor,
      };
    })
    .sort((a, b) => b.n - a.n);
}

/** Rank rows with enough samples: strongest and weakest by avg R (or expectancy when R is missing). */
export function strongWeak(rows: BreakdownRow[], minN = 8, take = 3) {
  const score = (r: BreakdownRow) => r.avgR ?? r.expectancy;
  const eligible = rows.filter((r) => r.n >= minN).sort((a, b) => score(b) - score(a));
  const strong = eligible.filter((r) => score(r) > 0).slice(0, take);
  const weak = eligible
    .filter((r) => score(r) < 0)
    .reverse()
    .slice(0, take);
  return { strong, weak, insufficient: rows.filter((r) => r.n < minN).length };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
}
