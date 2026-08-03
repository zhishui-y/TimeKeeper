import type { AppointmentTableColumnWidths } from "../types/domain";

export type AppointmentTableColumnKey = keyof AppointmentTableColumnWidths;

export const APPOINTMENT_TABLE_COLUMN_KEYS: readonly AppointmentTableColumnKey[] = [
  "serviceDate",
  "timeRange",
  "contactName",
  "content",
  "account",
  "voice",
  "mode",
  "serviceStatus",
  "settlementStatus",
  "amount",
  "notes",
];

export const DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS: AppointmentTableColumnWidths = {
  serviceDate: 60,
  timeRange: 88,
  contactName: 72,
  content: 140,
  account: 180,
  voice: 88,
  mode: 56,
  serviceStatus: 74,
  settlementStatus: 74,
  amount: 68,
  notes: 120,
};

export const MIN_APPOINTMENT_TABLE_COLUMN_WIDTHS: AppointmentTableColumnWidths = {
  serviceDate: 60,
  timeRange: 88,
  contactName: 72,
  content: 100,
  account: 150,
  voice: 72,
  mode: 56,
  serviceStatus: 74,
  settlementStatus: 74,
  amount: 64,
  notes: 58,
};

export const MAX_APPOINTMENT_TABLE_COLUMN_WIDTH = 480;
export const APPOINTMENT_TABLE_FIXED_WIDTH = 44 + 112;

export function clampAppointmentTableColumnWidth(
  key: AppointmentTableColumnKey,
  width: number,
): number {
  return Math.min(
    MAX_APPOINTMENT_TABLE_COLUMN_WIDTH,
    Math.max(MIN_APPOINTMENT_TABLE_COLUMN_WIDTHS[key], Math.round(width)),
  );
}

export function cloneAppointmentTableColumnWidths(
  widths: AppointmentTableColumnWidths,
): AppointmentTableColumnWidths {
  return { ...widths };
}

export function appointmentTableColumnWidthsEqual(
  first: AppointmentTableColumnWidths,
  second: AppointmentTableColumnWidths,
): boolean {
  return APPOINTMENT_TABLE_COLUMN_KEYS.every((key) => first[key] === second[key]);
}

export function appointmentTableTotalWidth(widths: AppointmentTableColumnWidths): number {
  return (
    APPOINTMENT_TABLE_FIXED_WIDTH +
    APPOINTMENT_TABLE_COLUMN_KEYS.reduce((total, key) => total + widths[key], 0)
  );
}
