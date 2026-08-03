import { format, isToday, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { AppointmentMode } from "../types/domain";

export const modeLabels: Record<AppointmentMode, string> = {
  business: "业务",
  entertainment: "娱乐",
};

export function formatCurrency(amountMinor?: number | null): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format((amountMinor ?? 0) / 100);
}

export function formatShortDate(value: string): string {
  return format(parseISO(value), "M月d日 EEE", { locale: zhCN });
}

export function formatCompactDate(value: string): string {
  return format(parseISO(value), "MM.dd");
}

export function formatDateHeading(value: string): string {
  const date = parseISO(value);
  return isToday(date)
    ? `今天 · ${format(date, "M月d日 EEEE", { locale: zhCN })}`
    : format(date, "M月d日 EEEE", { locale: zhCN });
}

export function formatTime(value?: string | null): string {
  return value ? format(parseISO(value), "HH:mm") : "待定";
}

export function formatTimeRange(startsAt?: string | null, endsAt?: string | null): string {
  if (!startsAt) return "待定时段";
  const start = parseISO(startsAt);
  if (!endsAt) return format(start, "HH:mm");
  const end = parseISO(endsAt);
  const crossesDay = format(start, "yyyy-MM-dd") !== format(end, "yyyy-MM-dd");
  return `${format(start, "HH:mm")}–${format(end, "HH:mm")}${crossesDay ? " +1" : ""}`;
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}
