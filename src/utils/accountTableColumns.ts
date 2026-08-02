import type { AccountTableColumnWidths } from "../types/domain";

export type AccountTableColumnKey = keyof AccountTableColumnWidths;

export const ACCOUNT_TABLE_COLUMN_KEYS: readonly AccountTableColumnKey[] = [
  "contactName",
  "server",
  "characterName",
  "specialization",
  "gearScore",
  "currentScore",
  "highestScore",
  "scoreUpdatedAt",
  "weekly",
  "notes",
];

export const DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS: AccountTableColumnWidths = {
  contactName: 90,
  server: 86,
  characterName: 86,
  specialization: 82,
  gearScore: 68,
  currentScore: 62,
  highestScore: 62,
  scoreUpdatedAt: 102,
  weekly: 160,
  notes: 160,
};

export const MIN_ACCOUNT_TABLE_COLUMN_WIDTHS: AccountTableColumnWidths = {
  contactName: 72,
  server: 72,
  characterName: 72,
  specialization: 80,
  gearScore: 60,
  currentScore: 60,
  highestScore: 60,
  scoreUpdatedAt: 92,
  weekly: 100,
  notes: 100,
};

export const MAX_ACCOUNT_TABLE_COLUMN_WIDTH = 480;
export const ACCOUNT_TABLE_FIXED_WIDTH = 58 + 40 + 40 + 72;

export function clampAccountTableColumnWidth(key: AccountTableColumnKey, width: number): number {
  return Math.min(
    MAX_ACCOUNT_TABLE_COLUMN_WIDTH,
    Math.max(MIN_ACCOUNT_TABLE_COLUMN_WIDTHS[key], Math.round(width)),
  );
}

export function cloneAccountTableColumnWidths(
  widths: AccountTableColumnWidths,
): AccountTableColumnWidths {
  return { ...widths };
}

export function accountTableColumnWidthsEqual(
  first: AccountTableColumnWidths,
  second: AccountTableColumnWidths,
): boolean {
  return ACCOUNT_TABLE_COLUMN_KEYS.every((key) => first[key] === second[key]);
}

export function accountTableTotalWidth(widths: AccountTableColumnWidths): number {
  return (
    ACCOUNT_TABLE_FIXED_WIDTH +
    ACCOUNT_TABLE_COLUMN_KEYS.reduce((total, key) => total + widths[key], 0)
  );
}
