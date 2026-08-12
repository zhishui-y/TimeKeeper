export const CHINA_TIME_ZONE = "Asia/Shanghai";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CIVIL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

interface CalendarParts {
  year: number;
  month: number;
  day: number;
}

interface CivilDateTimeParts extends CalendarParts {
  hour: number;
  minute: number;
  second: number;
}

const chinaDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CHINA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const chinaAuditDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: CHINA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const WEEKDAY_LABELS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const SHORT_WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function numericParts(value: Date): Record<string, number> {
  return Object.fromEntries(
    chinaDateTimeFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKeyFromParts({ year, month, day }: CalendarParts): string {
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}

function validCalendarParts(parts: CalendarParts): boolean {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return (
    value.getUTCFullYear() === parts.year &&
    value.getUTCMonth() === parts.month - 1 &&
    value.getUTCDate() === parts.day
  );
}

export function parseDateKey(value: string): CalendarParts | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return validCalendarParts(parts) ? parts : null;
}

export function isDateKey(value: string): boolean {
  return parseDateKey(value) !== null;
}

export function chinaDateKey(now = new Date()): string {
  const parts = numericParts(now);
  return dateKeyFromParts({ year: parts.year, month: parts.month, day: parts.day });
}

export function chinaTime(now = new Date()): string {
  const parts = numericParts(now);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function chinaCivilDateTime(now = new Date()): string {
  const parts = numericParts(now);
  return `${dateKeyFromParts({ year: parts.year, month: parts.month, day: parts.day })}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

export function parseCivilDateTime(value: string): CivilDateTimeParts | null {
  const match = CIVIL_DATE_TIME_PATTERN.exec(value);
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  if (!validCalendarParts(parts) || parts.hour > 23 || parts.minute > 59 || parts.second > 59) {
    return null;
  }
  return parts;
}

export function civilDateTimeValue(value: string): number {
  const parts = parseCivilDateTime(value);
  if (!parts) return Number.NaN;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function chinaCivilNowValue(now = new Date()): number {
  return civilDateTimeValue(chinaCivilDateTime(now));
}

export function civilDifferenceInMinutes(value: string, now = new Date()): number {
  return Math.floor((civilDateTimeValue(value) - chinaCivilNowValue(now)) / 60_000);
}

export function civilDurationInMinutes(from: string, to: string): number {
  return Math.floor((civilDateTimeValue(to) - civilDateTimeValue(from)) / 60_000);
}

export function civilTime(value?: string | null): string | null {
  const parts = value ? parseCivilDateTime(value) : null;
  return parts ? `${pad(parts.hour)}:${pad(parts.minute)}` : null;
}

export function civilDateKey(value?: string | null): string | null {
  const parts = value ? parseCivilDateTime(value) : null;
  return parts ? dateKeyFromParts(parts) : null;
}

export function buildCivilDateTime(date: string, time: string): string | null {
  const value = `${date}T${time}:00`;
  return parseCivilDateTime(value) ? value : null;
}

export function calendarDateKey(value: Date): string {
  return dateKeyFromParts({
    year: value.getFullYear(),
    month: value.getMonth() + 1,
    day: value.getDate(),
  });
}

export function calendarTime(value: Date): string {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function dateKeyValue(value: string): number {
  const parts = parseDateKey(value);
  return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) : Number.NaN;
}

export function addDateKeyDays(value: string, amount: number): string {
  const epoch = dateKeyValue(value);
  if (!Number.isFinite(epoch)) throw new Error(`无效日期：${value}`);
  const date = new Date(epoch);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKeyFromParts({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

export function addDateKeyMonths(value: string, amount: number): string {
  const parts = parseDateKey(value);
  if (!parts) throw new Error(`无效日期：${value}`);
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + amount, 1));
  return dateKeyFromParts({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: 1,
  });
}

export function startOfChinaWeek(value: string): string {
  const epoch = dateKeyValue(value);
  if (!Number.isFinite(epoch)) throw new Error(`无效日期：${value}`);
  const weekday = new Date(epoch).getUTCDay();
  return addDateKeyDays(value, -(weekday === 0 ? 6 : weekday - 1));
}

export function endOfChinaWeek(value: string): string {
  return addDateKeyDays(startOfChinaWeek(value), 6);
}

export function startOfChinaMonth(value: string): string {
  const parts = parseDateKey(value);
  if (!parts) throw new Error(`无效日期：${value}`);
  return dateKeyFromParts({ ...parts, day: 1 });
}

export function endOfChinaMonth(value: string): string {
  return addDateKeyDays(addDateKeyMonths(startOfChinaMonth(value), 1), -1);
}

export function dateKeyWeekday(value: string, short = false): string {
  const epoch = dateKeyValue(value);
  if (!Number.isFinite(epoch)) return "";
  return (short ? SHORT_WEEKDAY_LABELS : WEEKDAY_LABELS)[new Date(epoch).getUTCDay()] ?? "";
}

export function formatChinaDate(
  value: string,
  options: { compact?: boolean; weekday?: boolean; year?: boolean } = {},
): string {
  const parts = parseDateKey(value);
  if (!parts) return value;
  if (options.compact) return `${pad(parts.month)}.${pad(parts.day)}`;
  const date = `${options.year ? `${parts.year}年` : ""}${parts.month}月${parts.day}日`;
  return options.weekday ? `${date} ${dateKeyWeekday(value, true)}` : date;
}

export function formatChinaAuditInstant(value: string): string {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? value : chinaAuditDateTimeFormatter.format(instant);
}
