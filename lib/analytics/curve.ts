/** Balance curve, time-weighted return and drawdown, with deposits/withdrawals excluded from performance. */

export interface CurveEvent {
  time: Date;
  kind: "trade" | "flow";
  amount: number;
}

export interface CurvePoint {
  t: number;
  balance: number;
  index: number; // growth of 1 unit, cash flows removed
}

export interface CurveResult {
  points: CurvePoint[];
  balance: number;
  highestBalance: number;
  netDeposits: number;
  tradingPnl: number;
  gainPct: number; // time-weighted
  absGainPct: number;
  maxDrawdownPct: number; // on the cash-flow-adjusted index
  currentDrawdownPct: number;
  periodReturns: { daily: number; weekly: number; monthly: number; annualized: number };
}

/** `startBalance` is the balance carried in from before the first event (for a period of a longer history). */
export function buildCurve(events: CurveEvent[], startBalance = 0): CurveResult {
  const sorted = [...events].sort((a, b) => a.time.getTime() - b.time.getTime());
  let balance = startBalance, index = 1, peak = 1, maxDd = 0, highest = startBalance, deposits = 0, pnl = 0;
  const points: CurvePoint[] = [];
  for (const e of sorted) {
    if (e.kind === "flow") {
      balance += e.amount;
      deposits += e.amount;
    } else {
      // A loss can't take more than the whole balance (time-weighted return bottoms out at -100%).
      if (balance > 0) index *= Math.max(0, 1 + e.amount / balance);
      balance += e.amount;
      pnl += e.amount;
      peak = Math.max(peak, index);
      maxDd = Math.max(maxDd, 1 - index / peak);
    }
    highest = Math.max(highest, balance);
    points.push({ t: e.time.getTime(), balance: Math.round(balance * 100) / 100, index });
  }
  const gain = index - 1;
  const first = sorted.find((e) => e.kind === "trade")?.time.getTime();
  const last = sorted.at(-1)?.time.getTime();
  const days = first && last ? Math.max(1, (last - first) / 86_400_000) : 1;
  const comp = (period: number) => (gain > -1 ? (1 + gain) ** (period / days) - 1 : -1);
  return {
    points,
    balance: Math.round(balance * 100) / 100,
    highestBalance: Math.round(highest * 100) / 100,
    netDeposits: Math.round(deposits * 100) / 100,
    tradingPnl: Math.round(pnl * 100) / 100,
    gainPct: gain * 100,
    absGainPct: deposits > 0 ? (pnl / deposits) * 100 : 0,
    maxDrawdownPct: maxDd * 100,
    currentDrawdownPct: (1 - index / peak) * 100,
    periodReturns: {
      daily: comp(1) * 100,
      weekly: comp(7) * 100,
      monthly: comp(30.44) * 100,
      annualized: comp(365) * 100,
    },
  };
}
