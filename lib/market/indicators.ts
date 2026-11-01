import type { Bar } from "../domain/types";

export function atr(bars: Bar[], n = 14): number[] {
  const out: number[] = [];
  let prev: number | undefined;
  bars.forEach((b, i) => {
    const pc = i ? bars[i - 1].c : b.c;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
    prev = prev === undefined ? tr : (prev * (n - 1) + tr) / n;
    out.push(prev);
  });
  return out;
}

export function ema(values: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i ? v * k + out[i - 1] * (1 - k) : v));
  return out;
}

export interface Swing {
  i: number;
  t: number;
  price: number;
  kind: "high" | "low";
}

/** Fractal swing points: a high/low with `side` lower highs/higher lows on each side. */
export function swings(bars: Bar[], side = 2): Swing[] {
  const out: Swing[] = [];
  for (let i = side; i < bars.length - side; i++) {
    let hi = true, lo = true;
    for (let j = 1; j <= side; j++) {
      if (bars[i - j].h >= bars[i].h || bars[i + j].h > bars[i].h) hi = false;
      if (bars[i - j].l <= bars[i].l || bars[i + j].l < bars[i].l) lo = false;
    }
    if (hi) out.push({ i, t: bars[i].t, price: bars[i].h, kind: "high" });
    if (lo) out.push({ i, t: bars[i].t, price: bars[i].l, kind: "low" });
  }
  return out;
}

export interface Fvg {
  dir: "bull" | "bear";
  top: number;
  bottom: number;
  /** Index/time of the third candle, when the gap is confirmed. */
  i: number;
  t: number;
}

/** Three-candle imbalances. Bullish: low[i+1] > high[i-1]. */
export function findFvgs(bars: Bar[]): Fvg[] {
  const out: Fvg[] = [];
  for (let i = 1; i < bars.length - 1; i++) {
    const a = bars[i - 1], c = bars[i + 1];
    if (c.l > a.h) out.push({ dir: "bull", bottom: a.h, top: c.l, i: i + 1, t: c.t });
    else if (c.h < a.l) out.push({ dir: "bear", bottom: c.h, top: a.l, i: i + 1, t: c.t });
  }
  return out;
}

export function rangeOf(bars: Bar[]): { high: number; low: number } | null {
  if (!bars.length) return null;
  let high = -Infinity, low = Infinity;
  for (const b of bars) {
    if (b.h > high) high = b.h;
    if (b.l < low) low = b.l;
  }
  return { high, low };
}

/** Index of the first bar with t >= time (binary search). */
export function indexAt(bars: Bar[], t: number): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
