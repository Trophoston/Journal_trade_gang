import { describe, expect, it } from "vitest";
import type { Bar } from "../domain/types";
import { computeEvidence } from "./evidence";
import { findFvgs, swings } from "./indicators";

const t0 = Date.parse("2026-10-29T10:00:00Z");
const step = 5 * 60_000;

function scenario(): Bar[] {
  const bars: Bar[] = Array.from({ length: 140 }, (_, i) => ({ t: t0 + i * step, o: 100, h: 100.3, l: 99.7, c: 100 }));
  const set = (i: number, o: number, h: number, l: number, c: number) => (bars[i] = { t: bars[i].t, o, h, l, c });
  set(50, 100, 100.2, 99.0, 99.8); // swing low = liquidity
  set(84, 100, 100.6, 99.9, 100.2); // swing high before the sweep
  set(90, 99.8, 99.9, 98.8, 99.6); // sweep of 99.0, closes back above
  set(95, 100.2, 100.9, 100.2, 100.8); // closes above 100.6 → structure shift
  set(96, 100.6, 100.9, 100.5, 100.8);
  set(97, 100.8, 101.5, 100.8, 101.4);
  set(98, 101.4, 101.6, 101.2, 101.5); // bull FVG 100.9–101.2
  set(99, 101.3, 101.4, 101.0, 101.1);
  set(100, 101.0, 101.2, 100.8, 100.9); // entry bar
  set(101, 100.9, 100.9, 98.6, 98.9); // stop hit
  set(110, 101, 104.2, 100.9, 104); // target after the stop
  return bars;
}

describe("detectors", () => {
  it("finds gaps and swings", () => {
    const bars = scenario();
    expect(findFvgs(bars).some((g) => g.dir === "bull" && g.bottom === 100.9 && g.top === 101.2)).toBe(true);
    expect(swings(bars, 3).some((s) => s.kind === "low" && s.price === 99.0)).toBe(true);
  });

  it("explains a long that swept liquidity, entered an FVG, then got stop-hunted", () => {
    const m5 = scenario();
    const res = computeEvidence({
      side: "long",
      entryPrice: 101.0,
      exitPrice: 98.7,
      sl0: 98.7,
      tp0: 104,
      r: -1,
      openedAt: new Date(m5[100].t),
      closedAt: new Date(m5[101].t),
      closeReason: "sl",
      m5,
      news: [{ time: new Date(m5[100].t - 10 * 60_000), currency: "USD", name: "CPI m/m", importance: "high" }],
    });
    const kinds = res.items.map((i) => `${i.kind}:${i.polarity}`);
    expect(kinds).toContain("sweep:supports");
    expect(kinds).toContain("structure:supports");
    expect(kinds).toContain("fvg:supports");
    expect(kinds).toContain("fvg:against");
    expect(kinds).toContain("stop_hunt:against");
    expect(kinds).toContain("news:against");
    expect(res.mae?.r).toBeCloseTo(1.04, 2);
    expect(res.items[0].id).toBe("E1");
  });

  it("never reports less excursion than the fills themselves", () => {
    const m5 = scenario();
    // Candles stay in 99.7–100.3, but the long was filled at 100 and closed at take-profit 102.
    const res = computeEvidence({
      side: "long",
      entryPrice: 100,
      exitPrice: 102,
      sl0: 99,
      tp0: 102,
      r: 2,
      openedAt: new Date(m5[10].t),
      closedAt: new Date(m5[12].t),
      closeReason: "tp",
      m5,
      news: [],
    });
    expect(res.mfe?.r).toBe(2);
    expect(res.mae?.r).toBeCloseTo(0.3, 2);
  });

  it("handles a trade stored with no R (no stop at entry) or no exit price", () => {
    const m5 = scenario();
    const base = { side: "long" as const, entryPrice: 100, sl0: 99, openedAt: new Date(m5[10].t), closedAt: new Date(m5[12].t), m5, news: [] };
    // MongoDB keeps a missing R as null, not undefined.
    const res = computeEvidence({ ...base, exitPrice: 100.2, r: null });
    expect(res.items.find((i) => i.kind === "excursion")?.detail).not.toContain("null");
    expect(() => computeEvidence({ ...base, exitPrice: null, r: null })).not.toThrow();
  });
});
