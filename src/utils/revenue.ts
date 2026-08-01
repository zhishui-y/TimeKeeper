import {
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parseISO,
  subMonths,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { ReportGranularity } from "../types/domain";

export interface RevenuePeriodRange {
  from: string;
  to: string;
}

export type RevenueRangePreset = "all" | "previous_month" | "current_month";

export function revenuePresetRange(
  preset: RevenueRangePreset,
  referenceDate: Date = new Date(),
): RevenuePeriodRange {
  if (preset === "all") return { from: "", to: "" };

  const target = preset === "previous_month" ? subMonths(referenceDate, 1) : referenceDate;
  return {
    from: format(startOfMonth(target), "yyyy-MM-dd"),
    to: format(endOfMonth(target), "yyyy-MM-dd"),
  };
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
