import { describe, expect, it } from "vitest";
import { revenuePeriodRange, revenuePresetRange } from "./revenue";

describe("revenuePresetRange", () => {
  const referenceDate = new Date(2026, 7, 1, 12, 0, 0);

  it("returns an open range for all records", () => {
    expect(revenuePresetRange("all", referenceDate)).toEqual({ from: "", to: "" });
  });

  it("returns the previous and current natural month", () => {
    expect(revenuePresetRange("previous_month", referenceDate)).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(revenuePresetRange("current_month", referenceDate)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });
});

describe("revenuePeriodRange", () => {
  it("expands a weekly point to Monday through Sunday", () => {
    expect(revenuePeriodRange("2026-07-29", "week")).toEqual({
      from: "2026-07-27",
      to: "2026-08-02",
    });
  });

  it("expands a monthly point to the full calendar month", () => {
    expect(revenuePeriodRange("2026-02", "month")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("rejects an invalid period", () => {
    expect(revenuePeriodRange("not-a-period", "month")).toBeNull();
  });
});
