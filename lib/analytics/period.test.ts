import { describe, expect, it } from "vitest";
import { inPeriod, resolvePeriod, shiftAnchor } from "./period";

const today = "2026-11-01"; // a Sunday

describe("period", () => {
  it("defaults to all time and ignores junk", () => {
    expect(resolvePeriod({}, today)).toMatchObject({ kind: "all", from: null, to: null });
    expect(resolvePeriod({ p: "nope" }, today).kind).toBe("all");
    expect(resolvePeriod({ p: "custom", from: "x" }, today).kind).toBe("all");
  });

  it("resolves calendar periods around the anchor", () => {
    expect(resolvePeriod({ p: "week" }, today)).toMatchObject({ from: "2026-10-26", to: "2026-11-01", label: "สัปดาห์นี้", current: true });
    expect(resolvePeriod({ p: "month", at: "2026-10-15" }, today)).toMatchObject({ from: "2026-10-01", to: "2026-10-31", label: "ตุลาคม 2026", current: false });
    expect(resolvePeriod({ p: "quarter" }, today)).toMatchObject({ from: "2026-10-01", to: "2026-12-31" });
    expect(resolvePeriod({ p: "year", at: "2025-06-01" }, today)).toMatchObject({ from: "2025-01-01", to: "2025-12-31", label: "ปี 2025" });
    expect(resolvePeriod({ p: "month", at: "2024-02-10" }, today).to).toBe("2024-02-29");
  });

  it("orders a custom range and allows open ends", () => {
    expect(resolvePeriod({ p: "custom", from: "2026-10-20", to: "2026-10-05" }, today)).toMatchObject({ from: "2026-10-05", to: "2026-10-20" });
    expect(resolvePeriod({ p: "custom", from: "2026-10-20" }, today)).toMatchObject({ from: "2026-10-20", to: null, current: true });
  });

  it("steps to neighbouring periods", () => {
    expect(shiftAnchor("month", "2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftAnchor("week", today, 1)).toBe("2026-11-02");
    expect(shiftAnchor("quarter", "2026-01-15", -1)).toBe("2025-12-31");
  });

  it("filters trading days inclusively", () => {
    const p = resolvePeriod({ p: "week" }, today);
    expect(["2026-10-25", "2026-10-26", "2026-11-01", "2026-11-02"].filter((d) => inPeriod(p, d))).toEqual(["2026-10-26", "2026-11-01"]);
  });
});
