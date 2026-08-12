import { describe, expect, it } from "vitest";
import { useRevenueRange } from "./useRevenueRange";

const referenceDate = new Date(2026, 7, 4, 12, 0, 0);

describe("useRevenueRange", () => {
  it("starts on the current week with independent daily granularity", () => {
    const range = useRevenueRange({ referenceDate });

    expect(range.rangeKind.value).toBe("week");
    expect(range.appliedRange.value).toEqual({ from: "2026-08-03", to: "2026-08-09" });
    expect(range.requestRange.value).toEqual({ from: "2026-08-03", to: "2026-08-09" });
    expect(range.granularity.value).toBe("day");
    expect(range.isCurrentPeriod.value).toBe(true);
  });

  it("navigates natural weeks and months and returns to the current period", () => {
    const range = useRevenueRange({ referenceDate });

    range.setGranularity("week");
    range.navigatePeriod(-1);
    expect(range.appliedRange.value).toEqual({ from: "2026-07-27", to: "2026-08-02" });
    expect(range.isCurrentPeriod.value).toBe(false);
    range.returnToCurrentPeriod();
    expect(range.appliedRange.value).toEqual({ from: "2026-08-03", to: "2026-08-09" });

    range.selectRange("month");
    range.navigatePeriod(1);
    expect(range.appliedRange.value).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(range.granularity.value).toBe("week");
    range.returnToCurrentPeriod();
    expect(range.appliedRange.value).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("uses an empty request for all records and retains the resolved display range", () => {
    const range = useRevenueRange({ referenceDate });

    range.selectRange("all");
    expect(range.requestRange.value).toEqual({ from: "", to: "" });
    expect(range.displayRange.value).toBeNull();

    expect(range.resolveAllRange({ from: "2024-01-02", to: "2026-08-04" })).toBe(true);
    expect(range.displayRange.value).toEqual({ from: "2024-01-02", to: "2026-08-04" });
    expect(range.requestRange.value).toEqual({ from: "", to: "" });

    range.selectRange("custom");
    expect(range.customDraft.value).toEqual({ from: "2024-01-02", to: "2026-08-04" });
    expect(range.appliedRange.value).toEqual({ from: "2024-01-02", to: "2026-08-04" });
    expect(range.requestRange.value).toEqual({ from: "2024-01-02", to: "2026-08-04" });
  });

  it("prefills custom dates from the current applied range", () => {
    const range = useRevenueRange({ referenceDate });

    range.selectRange("month");
    range.navigatePeriod(-1);
    range.selectRange("custom");

    expect(range.customDraft.value).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(range.customError.value).toBeNull();
  });

  it("keeps the applied request while a custom draft is incomplete, invalid, or reversed", () => {
    const range = useRevenueRange({ referenceDate });
    range.selectRange("custom");
    const previous = { ...range.appliedRange.value };

    range.updateCustomDate("from", "");
    expect(range.customError.value).toBe("请选择完整的开始和结束日期");
    expect(range.requestRange.value).toEqual(previous);

    range.updateCustomDate("from", "2026-02-30");
    expect(range.customError.value).toBe("请输入有效的开始和结束日期");
    expect(range.requestRange.value).toEqual(previous);

    range.updateCustomDate("from", "2026-08-10");
    expect(range.customError.value).toBe("开始日期不能晚于结束日期");
    expect(range.requestRange.value).toEqual(previous);
  });

  it("applies a complete valid custom draft immediately", () => {
    const range = useRevenueRange({ referenceDate });
    range.selectRange("custom");

    range.updateCustomDate("from", "2026-07-15");
    range.updateCustomDate("to", "2026-08-15");

    expect(range.customError.value).toBeNull();
    expect(range.appliedRange.value).toEqual({ from: "2026-07-15", to: "2026-08-15" });
    expect(range.requestRange.value).toEqual({ from: "2026-07-15", to: "2026-08-15" });
  });

  it("rejects an invalid resolved all-records range without replacing the last valid value", () => {
    const range = useRevenueRange({ referenceDate });
    range.resolveAllRange({ from: "2025-01-01", to: "2026-08-04" });

    expect(range.resolveAllRange({ from: "2026-08-04", to: "2025-01-01" })).toBe(false);
    expect(range.resolvedAllRange.value).toEqual({ from: "2025-01-01", to: "2026-08-04" });
  });

  it("rolls a current natural period across Beijing boundaries without moving history", () => {
    const range = useRevenueRange({ referenceDate });

    expect(range.refreshCurrentPeriod(new Date(2026, 7, 10, 0, 1))).toBe(true);
    expect(range.appliedRange.value).toEqual({ from: "2026-08-10", to: "2026-08-16" });
    range.navigatePeriod(-1);
    expect(range.refreshCurrentPeriod(new Date(2026, 7, 17, 0, 1))).toBe(false);
    expect(range.appliedRange.value).toEqual({ from: "2026-08-03", to: "2026-08-09" });
  });
});
