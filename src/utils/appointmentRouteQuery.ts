import type {
  AppointmentFilters,
  AppointmentMode,
  AppointmentProgressStatus,
} from "../types/domain";
import { parseDateKey } from "./chinaDateTime";

export type AppointmentRouteQuery = Readonly<Record<string, unknown>>;

export interface ParsedAppointmentFilterQuery {
  filters: AppointmentFilters;
  normalizedQuery: Record<string, string>;
  isCanonical: boolean;
}

const APPOINTMENT_MODES = new Set<AppointmentMode>(["business", "entertainment"]);
const APPOINTMENT_PROGRESS_STATUSES = new Set<AppointmentProgressStatus>([
  "scheduled",
  "in_progress",
  "pending_settlement",
  "completed",
  "cancelled",
]);

function scalarQueryValue(query: AppointmentRouteQuery, key: string): string | undefined {
  const value = query[key];
  return typeof value === "string" ? value : undefined;
}

function isAppointmentMode(value: string | undefined): value is AppointmentMode {
  return value !== undefined && APPOINTMENT_MODES.has(value as AppointmentMode);
}

function isAppointmentProgressStatus(
  value: string | undefined,
): value is AppointmentProgressStatus {
  return (
    value !== undefined && APPOINTMENT_PROGRESS_STATUSES.has(value as AppointmentProgressStatus)
  );
}

function isDateKey(value: string): boolean {
  return parseDateKey(value) !== null;
}

function queryIsCanonical(
  query: AppointmentRouteQuery,
  normalizedQuery: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(query);
  const normalizedKeys = Object.keys(normalizedQuery);
  return (
    keys.length === normalizedKeys.length &&
    normalizedKeys.every((key) => query[key] === normalizedQuery[key])
  );
}

export function validateAppointmentFilterDateRange(filters: AppointmentFilters): string | null {
  const from = filters.from?.trim() ?? "";
  const to = filters.to?.trim() ?? "";
  if (!from && !to) return null;
  if (!from || !to) return "开始日期和结束日期必须同时填写";
  if (!isDateKey(from) || !isDateKey(to)) return "请输入有效的开始日期和结束日期";
  if (from > to) return "开始日期不能晚于结束日期";
  return null;
}

export function appointmentFiltersToQuery(filters: AppointmentFilters): Record<string, string> {
  const query: Record<string, string> = {};
  const from = filters.from?.trim();
  const to = filters.to?.trim();
  const searchQuery = filters.query?.trim();

  if (from && to && isDateKey(from) && isDateKey(to) && from <= to) {
    query.from = from;
    query.to = to;
  }
  if (searchQuery) query.query = searchQuery;
  if (filters.mode && APPOINTMENT_MODES.has(filters.mode)) query.mode = filters.mode;
  if (
    filters.progressStatus &&
    APPOINTMENT_PROGRESS_STATUSES.has(filters.progressStatus) &&
    !(filters.mode === "entertainment" && filters.progressStatus === "pending_settlement")
  ) {
    query.progressStatus = filters.progressStatus;
  }

  return query;
}

export function parseAppointmentFilterQuery(
  query: AppointmentRouteQuery,
): ParsedAppointmentFilterQuery {
  const filters: AppointmentFilters = {};
  const from = scalarQueryValue(query, "from");
  const to = scalarQueryValue(query, "to");
  const searchQuery = scalarQueryValue(query, "query")?.trim();
  const mode = scalarQueryValue(query, "mode");
  const progressStatus = scalarQueryValue(query, "progressStatus");

  if (from && to && isDateKey(from) && isDateKey(to) && from <= to) {
    filters.from = from;
    filters.to = to;
  }
  if (searchQuery) filters.query = searchQuery;
  if (isAppointmentMode(mode)) filters.mode = mode;
  if (
    isAppointmentProgressStatus(progressStatus) &&
    !(mode === "entertainment" && progressStatus === "pending_settlement")
  ) {
    filters.progressStatus = progressStatus;
  }

  const normalizedQuery = appointmentFiltersToQuery(filters);
  return {
    filters,
    normalizedQuery,
    isCanonical: queryIsCanonical(query, normalizedQuery),
  };
}

export function appointmentFiltersEqual(
  left: AppointmentFilters,
  right: AppointmentFilters,
): boolean {
  const leftQuery = appointmentFiltersToQuery(left);
  const rightQuery = appointmentFiltersToQuery(right);
  const keys = Object.keys(leftQuery);
  return (
    keys.length === Object.keys(rightQuery).length &&
    keys.every((key) => leftQuery[key] === rightQuery[key])
  );
}
