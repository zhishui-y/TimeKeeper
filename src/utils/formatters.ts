import type { AppointmentMode } from "../types/domain";
import { civilDateKey, civilTime, chinaDateKey, formatChinaDate } from "./chinaDateTime";

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
  return formatChinaDate(value, { weekday: true });
}

export function formatCompactDate(value: string): string {
  return formatChinaDate(value, { compact: true });
}

export function formatDateHeading(value: string): string {
  const label = formatChinaDate(value, { weekday: true });
  return value === chinaDateKey() ? `今天 · ${label}` : label;
}

export function formatTime(value?: string | null): string {
  return civilTime(value) ?? "待定";
}

export function formatTimeRange(startsAt?: string | null, endsAt?: string | null): string {
  if (!startsAt) return "待定时段";
  const start = civilTime(startsAt);
  if (!start) return "待定时段";
  if (!endsAt) return start;
  const end = civilTime(endsAt);
  if (!end) return start;
  const crossesDay = civilDateKey(startsAt) !== civilDateKey(endsAt);
  return `${start}–${end}${crossesDay ? " +1" : ""}`;
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}
