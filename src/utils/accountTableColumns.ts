import type { AccountTableColumnWidths } from "../types/domain";
import { MAX_RESIZABLE_TABLE_COLUMN_WIDTH, MIN_RESIZABLE_TABLE_COLUMN_WIDTH } from "./tableColumns";

export type AccountTableColumnKey = keyof AccountTableColumnWidths;

export const ACCOUNT_TABLE_COLUMN_KEYS: readonly AccountTableColumnKey[] = [
  "contactName",
  "server",
  "characterName",
  "specialization",
  "gearScore",
  "accountName",
  "password",
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
  accountName: 48,
  password: 104,
  currentScore: 62,
  highestScore: 62,
  scoreUpdatedAt: 102,
  weekly: 160,
  notes: 160,
};

export const MIN_ACCOUNT_TABLE_COLUMN_WIDTHS: AccountTableColumnWidths = {
  contactName: MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
  server: MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
  characterName: MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
  specialization: MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
  gearScore: MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
  accountName: MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
  password: MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
  currentScore: MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
  highestScore: MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
  scoreUpdatedAt: MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
  weekly: MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
  notes: MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
};

export const MAX_ACCOUNT_TABLE_COLUMN_WIDTH = MAX_RESIZABLE_TABLE_COLUMN_WIDTH;
// Selection controls and sticky row actions.
export const ACCOUNT_TABLE_FIXED_WIDTH = 58 + 108;

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
