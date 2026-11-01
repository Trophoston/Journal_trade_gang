import { describe, expect, it } from "vitest";
import { observedOffset, serverToUtc, utcToServer } from "./servertime";
import { canonicalSymbol, newsCurrencies } from "./symbols";

const sec = (iso: string) => Date.parse(iso) / 1000;

describe("server time", () => {
  const ny = { mode: "auto" as const, observedOffsetMin: 120 };
  it("follows US DST for GMT+2/+3 brokers", () => {
    expect(serverToUtc(sec("2026-10-30T15:00:00Z"), ny).toISOString()).toBe("2026-10-30T12:00:00.000Z");
    expect(serverToUtc(sec("2026-11-02T14:00:00Z"), ny).toISOString()).toBe("2026-11-02T12:00:00.000Z");
  });
  it("round-trips", () => {
    for (const iso of ["2026-03-09T12:00:00Z", "2026-07-01T00:30:00Z", "2026-12-24T23:59:00Z"]) {
      expect(serverToUtc(utcToServer(new Date(iso), ny), ny).toISOString()).toBe(new Date(iso).toISOString());
    }
  });
  it("uses a fixed offset for GMT+0 brokers like Exness", () => {
    const exness = { mode: "auto" as const, observedOffsetMin: 0 };
    expect(serverToUtc(sec("2026-10-30T15:00:00Z"), exness).toISOString()).toBe("2026-10-30T15:00:00.000Z");
    expect(observedOffset(sec("2026-10-30T15:00:10Z"), sec("2026-10-30T12:00:00Z"))).toBe(180);
  });
});

describe("symbols", () => {
  it("strips broker suffixes", () => {
    expect(canonicalSymbol("XAUUSDm")).toBe("XAUUSD");
    expect(canonicalSymbol("XAUUSDc")).toBe("XAUUSD");
    expect(canonicalSymbol("EURUSD.r")).toBe("EURUSD");
    expect(canonicalSymbol("GOLD#")).toBe("XAUUSD");
    expect(canonicalSymbol("USTECm")).toBe("NAS100");
    expect(canonicalSymbol("XAUUSDm", { XAUUSDm: "GOLD-X" })).toBe("GOLD-X");
  });
  it("maps news currencies", () => {
    expect(newsCurrencies("XAUUSD")).toEqual(["USD"]);
    expect(newsCurrencies("EURJPY")).toEqual(["EUR", "JPY"]);
  });
});
