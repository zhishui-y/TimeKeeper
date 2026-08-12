import type { AccountTableColumnWidths, AppointmentTableColumnWidths } from "../../types/domain";
import {
  ACCOUNT_TABLE_COLUMN_KEYS,
  DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS,
  MAX_ACCOUNT_TABLE_COLUMN_WIDTH,
  MIN_ACCOUNT_TABLE_COLUMN_WIDTHS,
} from "../../utils/accountTableColumns";
import {
  APPOINTMENT_TABLE_COLUMN_KEYS,
  DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS,
  MAX_APPOINTMENT_TABLE_COLUMN_WIDTH,
  MIN_APPOINTMENT_TABLE_COLUMN_WIDTHS,
} from "../../utils/appointmentTableColumns";

const ACCOUNT_TABLE_WIDTHS_STORAGE_KEY = "timekeeper.demo.accountTableColumnWidths";
const APPOINTMENT_TABLE_WIDTHS_STORAGE_KEY = "timekeeper.demo.appointmentTableColumnWidths";

export function accountTableColumnWidthsAreValid(widths: AccountTableColumnWidths): boolean {
  return ACCOUNT_TABLE_COLUMN_KEYS.every((key) => {
    const width = widths[key];
    return (
      Number.isInteger(width) &&
      width >= MIN_ACCOUNT_TABLE_COLUMN_WIDTHS[key] &&
      width <= MAX_ACCOUNT_TABLE_COLUMN_WIDTH
    );
  });
}

export function storeAccountTableColumnWidths(widths: AccountTableColumnWidths): void {
  globalThis.localStorage?.setItem(ACCOUNT_TABLE_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
}

export function loadStoredAccountTableColumnWidths(): AccountTableColumnWidths {
  try {
    const stored = globalThis.localStorage?.getItem(ACCOUNT_TABLE_WIDTHS_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS };
    const parsed = JSON.parse(stored) as Partial<AccountTableColumnWidths> & { weekly?: number };
    const widths = {
      ...parsed,
      accountName: parsed.accountName ?? DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS.accountName,
      password: parsed.password ?? DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS.password,
      weeklyWins:
        parsed.weeklyWins ?? parsed.weekly ?? DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS.weeklyWins,
    } as AccountTableColumnWidths;
    delete (widths as AccountTableColumnWidths & { weekly?: number }).weekly;
    if (!accountTableColumnWidthsAreValid(widths)) {
      return { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS };
    }
    storeAccountTableColumnWidths(widths);
    return widths;
  } catch {
    return { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS };
  }
}

export function appointmentTableColumnWidthsAreValid(
  widths: AppointmentTableColumnWidths,
): boolean {
  return APPOINTMENT_TABLE_COLUMN_KEYS.every((key) => {
    const width = widths[key];
    return (
      Number.isInteger(width) &&
      width >= MIN_APPOINTMENT_TABLE_COLUMN_WIDTHS[key] &&
      width <= MAX_APPOINTMENT_TABLE_COLUMN_WIDTH
    );
  });
}

export function storeAppointmentTableColumnWidths(widths: AppointmentTableColumnWidths): void {
  globalThis.localStorage?.setItem(APPOINTMENT_TABLE_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
}

export function loadStoredAppointmentTableColumnWidths(): AppointmentTableColumnWidths {
  try {
    const stored = globalThis.localStorage?.getItem(APPOINTMENT_TABLE_WIDTHS_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS };
    const parsed = JSON.parse(stored) as Partial<AppointmentTableColumnWidths> & {
      paymentMethod?: number;
    };
    const widths = {
      ...parsed,
      voice: parsed.voice ?? DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS.voice,
      notes: parsed.notes ?? parsed.paymentMethod,
    } as AppointmentTableColumnWidths;
    delete (widths as AppointmentTableColumnWidths & { paymentMethod?: number }).paymentMethod;
    if (!appointmentTableColumnWidthsAreValid(widths)) {
      return { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS };
    }
    storeAppointmentTableColumnWidths(widths);
    return widths;
  } catch {
    return { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS };
  }
}
