import {
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { ReportGranularity } from "../types/domain";

export interface RevenuePeriodRange {
  from: string;
  to: string;
}

export type RevenueRangeUnit = "week" | "month";
export type RevenueRangeKind = "all" | "custom" | RevenueRangeUnit;

export function isRevenueDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseISO(value);
  return isValid(parsed) && format(parsed, "yyyy-MM-dd") === value;
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
  const target =
    unit === "week" ? addWeeks(referenceDate, offset) : addMonths(referenceDate, offset);
  const from = unit === "week" ? startOfWeek(target, { weekStartsOn: 1 }) : startOfMonth(target);
  const to = unit === "week" ? endOfWeek(target, { weekStartsOn: 1 }) : endOfMonth(target);
  return {
    from: format(from, "yyyy-MM-dd"),
    to: format(to, "yyyy-MM-dd"),
  };
}

export function shiftRevenueRange(
  from: string,
  unit: RevenueRangeUnit,
  offset: number,
): RevenuePeriodRange | null {
  const anchor = parseISO(from);
  if (!isValid(anchor)) return null;
  return revenueNaturalRange(unit, anchor, offset);
}

export function revenuePeriodRange(
  period: string,
  granularity: Exclude<ReportGranularity, "day">,
): RevenuePeriodRange | null {
  const periodDate = parseISO(granularity === "month" ? `${period}-01` : period);
  if (!isValid(periodDate)) return null;

  const from =
    granularity === "week"
      ? startOfWeek(periodDate, { weekStartsOn: 1 })
      : startOfMonth(periodDate);
  const to =
    granularity === "week" ? endOfWeek(periodDate, { weekStartsOn: 1 }) : endOfMonth(periodDate);

  return {
    from: format(from, "yyyy-MM-dd"),
    to: format(to, "yyyy-MM-dd"),
  };
}
