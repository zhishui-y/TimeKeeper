import { describe, expect, it } from "vitest";
import {
  intersectRevenueRanges,
  isRevenueDate,
  isRevenueRange,
  revenueNaturalRange,
  revenuePeriodRange,
  shiftRevenueRange,
} from "./revenue";

describe("revenue range validation", () => {
  it("accepts only real, zero-padded ISO calendar dates", () => {
    expect(isRevenueDate("2026-08-04")).toBe(true);
    expect(isRevenueDate("2026-8-4")).toBe(false);
    expect(isRevenueDate("2026-02-30")).toBe(false);
  });

  it("requires an ordered pair of valid dates", () => {
    expect(isRevenueRange({ from: "2026-08-01", to: "2026-08-04" })).toBe(true);
    expect(isRevenueRange({ from: "2026-08-04", to: "2026-08-01" })).toBe(false);
  });
});

describe("intersectRevenueRanges", () => {
  it("returns the inclusive overlap between two ranges", () => {
    expect(
      intersectRevenueRanges(
        { from: "2026-08-01", to: "2026-08-10" },
        { from: "2026-08-08", to: "2026-08-15" },
      ),
    ).toEqual({ from: "2026-08-08", to: "2026-08-10" });

    expect(
      intersectRevenueRanges(
        { from: "2026-08-10", to: "2026-08-10" },
        { from: "2026-08-10", to: "2026-08-12" },
      ),
    ).toEqual({ from: "2026-08-10", to: "2026-08-10" });
  });

  it("returns null for disjoint or invalid ranges", () => {
    expect(
      intersectRevenueRanges(
        { from: "2026-08-01", to: "2026-08-05" },
        { from: "2026-08-06", to: "2026-08-10" },
      ),
    ).toBeNull();
    expect(
      intersectRevenueRanges(
        { from: "2026-08-10", to: "2026-08-01" },
        { from: "2026-08-01", to: "2026-08-10" },
      ),
    ).toBeNull();
  });
});

describe("revenueNaturalRange", () => {
  const referenceDate = new Date(2026, 7, 1, 12, 0, 0);

  it("returns the natural Monday-to-Sunday week", () => {
    expect(revenueNaturalRange("week", referenceDate)).toEqual({
      from: "2026-07-27",
      to: "2026-08-02",
    });
  });

  it("returns a natural month and supports offsets", () => {
    expect(revenueNaturalRange("month", referenceDate)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(revenueNaturalRange("month", referenceDate, -2)).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    });
  });

  it("crosses years and keeps leap-year February intact", () => {
    expect(revenueNaturalRange("week", new Date(2026, 0, 1), -1)).toEqual({
      from: "2025-12-22",
      to: "2025-12-28",
    });
    expect(revenueNaturalRange("month", new Date(2024, 2, 15), -1)).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
  });
});

describe("shiftRevenueRange", () => {
  it("normalizes the anchor and moves continuously by week or month", () => {
    expect(shiftRevenueRange("2026-08-05", "week", 1)).toEqual({
      from: "2026-08-10",
      to: "2026-08-16",
    });
    expect(shiftRevenueRange("2026-08-31", "month", 1)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("rejects an invalid anchor", () => {
    expect(shiftRevenueRange("not-a-date", "week", -1)).toBeNull();
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
