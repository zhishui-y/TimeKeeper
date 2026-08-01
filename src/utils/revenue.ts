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
