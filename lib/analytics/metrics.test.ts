import { describe, expect, it } from "vitest";
import { buildCurve } from "./curve";
import { edgeRadar } from "./edge";
import { guardrails } from "./guardrails";
import { breakdown, dailyStats, outcome, strongWeak, streaks, summarize, wilson } from "./metrics";

const T = (net: number, r: number | undefined, day: string, h = 13) => ({
  net,
  r,
  openedAt: new Date(`${day}T${String(h).padStart(2, "0")}:00:00Z`),
  closedAt: new Date(`${day}T${String(h).padStart(2, "0")}:30:00Z`),
  tradingDay: day,
  durationSec: 1800,
  commission: -1,
  swap: 0,
  fee: 0,
});

describe("summary metrics", () => {
  const trades = [T(100, 1, "2026-10-26"), T(-50, -0.5, "2026-10-26", 14), T(200, 2, "2026-10-27"), T(-100, -1, "2026-10-28"), T(1, 0.01, "2026-10-28", 15)];
  it("counts outcomes with break-even excluded from win rate", () => {
    const s = summarize(trades);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(2);
    expect(s.be).toBe(1);
    expect(s.winRate).toBe(0.5);
    expect(s.net).toBe(151);
    expect(s.profitFactor).toBeCloseTo(300 / 150);
    expect(s.payoff).toBeCloseTo(150 / 75);
    expect(s.avgR).toBeCloseTo(1.51 / 5);
    expect(s.fees).toBe(-5);
    expect(outcome({ net: 0.3, r: 0.02 })).toBe("be");
  });
  it("tracks streaks by trade and by day", () => {
    const s = streaks(trades);
    expect(s.maxWinTrades).toBe(1);
    expect(s.currentTrades).toEqual({ kind: "loss", n: 1 });
    expect(dailyStats(trades).map((d) => d.net)).toEqual([50, 200, -99]);
    expect(s.maxWinDays).toBe(2);
  });
  it("ranks only groups with enough samples", () => {
    const many = Array.from({ length: 10 }, (_, i) => T(i % 3 ? 50 : -40, i % 3 ? 1 : -0.8, "2026-10-26", 8));
    const rows = breakdown([...many, ...trades], (t) => (t.openedAt.getUTCHours() === 8 ? "london" : "ny"));
    const sw = strongWeak(rows, 8);
    expect(sw.strong.map((r) => r.key)).toEqual(["london"]);
    expect(sw.insufficient).toBe(1);
    const [lo, hi] = wilson(7, 10);
    expect(lo).toBeGreaterThan(0.4);
    expect(hi).toBeLessThan(0.9);
  });
});

describe("balance curve", () => {
  it("removes deposits from the return and drawdown", () => {
    const c = buildCurve([
      { time: new Date("2026-10-01T00:00:00Z"), kind: "flow", amount: 1000 },
      { time: new Date("2026-10-02T00:00:00Z"), kind: "trade", amount: 100 },
      { time: new Date("2026-10-03T00:00:00Z"), kind: "trade", amount: -110 },
      { time: new Date("2026-10-04T00:00:00Z"), kind: "flow", amount: 1000 },
      { time: new Date("2026-10-05T00:00:00Z"), kind: "trade", amount: 199 },
    ]);
    expect(c.balance).toBe(2189);
    expect(c.highestBalance).toBe(2189);
    expect(c.netDeposits).toBe(2000);
    expect(c.maxDrawdownPct).toBeCloseTo(10, 5);
    expect(c.gainPct).toBeCloseTo((1.1 * 0.9 * (1 + 199 / 1990) - 1) * 100, 5);
    expect(c.absGainPct).toBeCloseTo(9.45, 2);
  });
});

describe("edge radar and guardrails", () => {
  it("scores axes only with enough data", () => {
    const trades = Array.from({ length: 10 }, (_, i) => ({ r: i % 2 ? 1 : -1, riskMoney: 100, mae: { r: 0.3 }, mfe: { r: 1.5 }, journal: { followedPlan: true, mistakes: [] } }));
    const s = summarize(trades.map((t, i) => ({ ...T(t.r * 100, t.r, `2026-10-2${i}`) })));
    const { axes, score } = edgeRadar(trades, s, dailyStats(trades.map((t, i) => T(t.r * 100, t.r, `2026-10-2${i}`))), 4);
    expect(axes.find((a) => a.key === "entry")?.score).toBe(70);
    expect(axes.find((a) => a.key === "discipline")?.score).toBe(100);
    expect(score).not.toBeNull();
  });
  it("warns after losses and at the daily loss limit", () => {
    const today = [T(-100, -1, "2026-10-30", 8), T(-120, -1, "2026-10-30", 9)];
    const g = guardrails({ today, history: [], rules: { dailyLossLimitPct: 2 }, startBalance: 10000 });
    expect(g[0].level).toBe("stop");
    expect(g.some((x) => x.title === "แพ้ติดกัน 2 ครั้ง")).toBe(true);
  });
});
