import { describe, expect, it } from "vitest";
import type { DealDoc } from "../domain/types";
import { tradesFromDeals } from "./aggregate";

let ticket = 1000;
function deal(p: Partial<DealDoc> & Pick<DealDoc, "positionId" | "kind" | "entry" | "volume" | "price">, at: string): DealDoc {
  const time = new Date(at);
  return {
    accountId: "acc",
    ticket: ticket++,
    order: 0,
    time,
    timeMsc: time.getTime(),
    reason: "DEAL_REASON_CLIENT",
    symbol: "XAUUSD",
    rawSymbol: "XAUUSDm",
    profit: 0,
    commission: 0,
    swap: 0,
    fee: 0,
    sl: 0,
    tp: 0,
    magic: 0,
    comment: "",
    ...p,
  };
}
const spec = { tickSize: 0.01, tickValue: 1, pipSize: 0.1 };

describe("deals → trades", () => {
  it("merges partial closes of a hedging position", () => {
    const deals = [
      deal({ positionId: 100, kind: "buy", entry: "in", volume: 1, price: 2000, commission: -7, sl: 1995, tp: 2010 }, "2026-10-29T13:00:00Z"),
      deal({ positionId: 100, kind: "sell", entry: "out", volume: 0.5, price: 2005, profit: 250 }, "2026-10-29T13:30:00Z"),
      deal({ positionId: 100, kind: "sell", entry: "out", volume: 0.5, price: 2010, profit: 500, reason: "DEAL_REASON_TP", tp: 2010 }, "2026-10-29T14:00:00Z"),
    ];
    const [t] = tradesFromDeals(deals, { accountId: "acc", spec });
    expect(t.status).toBe("closed");
    expect(t.side).toBe("long");
    expect(t.entryPrice).toBe(2000);
    expect(t.exitPrice).toBe(2007.5);
    expect(t.net).toBe(743);
    expect(t.riskMoney).toBe(500);
    expect(t.r).toBe(1.49);
    expect(t.pips).toBe(75);
    expect(t.closeReason).toBe("tp");
    expect(t.session).toBe("ny_am");
    expect(t.tradingDay).toBe("2026-10-29");
    expect(t.durationSec).toBe(3600);
    expect(t._id).toBe("acc_100");
  });

  it("keeps an unclosed position open", () => {
    const [t] = tradesFromDeals([deal({ positionId: 101, kind: "sell", entry: "in", volume: 0.2, price: 2001 }, "2026-10-29T13:00:00Z")], { accountId: "acc" });
    expect(t.status).toBe("open");
    expect(t.side).toBe("short");
    expect(t.r).toBeUndefined();
  });

  it("splits a netting reversal into two trades", () => {
    const deals = [
      deal({ positionId: 200, kind: "buy", entry: "in", volume: 1, price: 1.1 }, "2026-10-29T08:00:00Z"),
      deal({ positionId: 200, kind: "sell", entry: "inout", volume: 2, price: 1.101, profit: 100, commission: -6 }, "2026-10-29T09:00:00Z"),
    ];
    const [a, b] = tradesFromDeals(deals, { accountId: "acc" });
    expect(a.status).toBe("closed");
    expect(a.net).toBe(97);
    expect(b.status).toBe("open");
    expect(b.side).toBe("short");
    expect(b.volume).toBe(1);
    expect(b.commission).toBe(-3);
    expect(b._id).toBe("acc_200-1");
  });

  it("treats a close without a known open as a finished trade", () => {
    const [t] = tradesFromDeals([deal({ positionId: 300, kind: "sell", entry: "out", volume: 0.1, price: 2010, profit: 12 }, "2026-10-29T08:00:00Z")], { accountId: "acc" });
    expect(t.status).toBe("closed");
    expect(t.side).toBe("long");
    expect(t.net).toBe(12);
  });
});
