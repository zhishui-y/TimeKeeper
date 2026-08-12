import type { ReportGranularity } from "../types/domain";
import {
  addDateKeyDays,
  addDateKeyMonths,
  chinaDateKey,
  endOfChinaMonth,
  endOfChinaWeek,
  isDateKey,
  startOfChinaMonth,
  startOfChinaWeek,
} from "./chinaDateTime";

export interface RevenuePeriodRange {
  from: string;
  to: string;
}

export type RevenueRangeUnit = "week" | "month";
export type RevenueRangeKind = "all" | "custom" | RevenueRangeUnit;

export function isRevenueDate(value: string): boolean {
  return isDateKey(value);
}

export function isRevenueRange(range: RevenuePeriodRange): boolean {
  return isRevenueDate(range.from) && isRevenueDate(range.to) && range.from <= range.to;
}

export function intersectRevenueRanges(
  first: RevenuePeriodRange,
  second: RevenuePeriodRange,
): RevenuePeriodRange | null {
  if (!isRevenueRange(first) || !isRevenueRange(second)) return null;

  const from = first.from > second.from ? first.from : second.from;
  const to = first.to < second.to ? first.to : second.to;
  return from <= to ? { from, to } : null;
}

export function revenueNaturalRange(
  unit: RevenueRangeUnit,
  referenceDate: Date = new Date(),
  offset = 0,
): RevenuePeriodRange {
  const referenceKey = chinaDateKey(referenceDate);
  const target =
    unit === "week"
      ? addDateKeyDays(referenceKey, offset * 7)
      : addDateKeyMonths(referenceKey, offset);
  const from = unit === "week" ? startOfChinaWeek(target) : startOfChinaMonth(target);
  const to = unit === "week" ? endOfChinaWeek(target) : endOfChinaMonth(target);
  return {
    from,
    to,
  };
}

export function shiftRevenueRange(
  from: string,
  unit: RevenueRangeUnit,
  offset: number,
): RevenuePeriodRange | null {
  if (!isRevenueDate(from)) return null;
  const target =
    unit === "week" ? addDateKeyDays(from, offset * 7) : addDateKeyMonths(from, offset);
  return unit === "week"
    ? { from: startOfChinaWeek(target), to: endOfChinaWeek(target) }
    : { from: startOfChinaMonth(target), to: endOfChinaMonth(target) };
}

export function revenuePeriodRange(
  period: string,
  granularity: Exclude<ReportGranularity, "day">,
): RevenuePeriodRange | null {
  const value = granularity === "month" ? `${period}-01` : period;
  if (!isRevenueDate(value)) return null;
  return granularity === "week"
    ? { from: startOfChinaWeek(value), to: endOfChinaWeek(value) }
    : { from: startOfChinaMonth(value), to: endOfChinaMonth(value) };
}
