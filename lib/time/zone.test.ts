import { describe, expect, it } from "vitest";
import { sessionOf, sessionSpans } from "./sessions";
import { addDays, nyDst, tradingDayBounds, tradingDayOf, weekLabel, weekStartOf } from "./zone";

const utc = (s: string) => new Date(s);

describe("trading day (17:00 New York boundary)", () => {
  it("keeps the afternoon on the same day and rolls the evening forward", () => {
    expect(tradingDayOf(utc("2026-10-30T20:30:00Z"))).toBe("2026-10-30"); // 16:30 EDT
    expect(tradingDayOf(utc("2026-10-30T21:30:00Z"))).toBe("2026-10-31"); // 17:30 EDT
  });
  it("handles the US DST change on 2026-11-01", () => {
    expect(nyDst(utc("2026-11-01T05:59:00Z"))).toBe(true);
    expect(nyDst(utc("2026-11-01T06:01:00Z"))).toBe(false);
    // Sunday evening session after the change opens Monday's trading day at 22:00Z.
    const mon = tradingDayBounds("2026-11-02");
    expect(mon.start.toISOString()).toBe("2026-11-01T22:00:00.000Z");
    expect(mon.end.toISOString()).toBe("2026-11-02T22:00:00.000Z");
    const fri = tradingDayBounds("2026-10-30");
    expect(fri.start.toISOString()).toBe("2026-10-29T21:00:00.000Z");
    expect(tradingDayOf(utc("2026-11-01T22:30:00Z"))).toBe("2026-11-02");
  });
  it("computes weeks", () => {
    expect(weekStartOf("2026-10-30")).toBe("2026-10-26");
    expect(weekStartOf("2026-11-01")).toBe("2026-10-26");
    expect(weekLabel("2026-10-26")).toBe("2026-W44");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("sessions", () => {
  it("classifies by New York time", () => {
    expect(sessionOf(utc("2026-10-30T12:00:00Z"))).toBe("ny_am"); // 08:00 EDT
    expect(sessionOf(utc("2026-10-30T07:00:00Z"))).toBe("london"); // 03:00 EDT
    expect(sessionOf(utc("2026-10-29T23:00:00Z"))).toBe("asia"); // 19:00 EDT
    expect(sessionOf(utc("2026-10-30T18:00:00Z"))).toBe("ny_pm"); // 14:00 EDT
    expect(sessionOf(utc("2026-11-02T13:00:00Z"))).toBe("ny_am"); // 08:00 EST
  });
  it("builds UTC spans for a trading day", () => {
    const spans = sessionSpans("2026-10-30");
    const london = spans.find((s) => s.id === "london")!;
    expect(london.start.toISOString()).toBe("2026-10-30T05:00:00.000Z");
    expect(london.kzStart?.toISOString()).toBe("2026-10-30T06:00:00.000Z");
    const asia = sessionSpans("2026-11-02").find((s) => s.id === "asia")!;
    expect(asia.start.toISOString()).toBe("2026-11-01T23:00:00.000Z");
  });
});
