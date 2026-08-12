import type { AccountProfile } from "../types/domain";

export type AccountProfileSortKey =
  "contactName" | "server" | "specialization" | "gearScore" | "currentScore" | "highestScore";

export type SortDirection = "asc" | "desc";
export type AccountDropPlacement = "before" | "after";

export interface AccountProfileFilters {
  contactName: string;
  server: string;
  specialization: string;
}

export type AccountScoreParseResult =
  { ok: true; value: number | null } | { ok: false; value: null };

const textCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

export function uniqueAccountValues(
  profiles: readonly AccountProfile[],
  key: keyof AccountProfileFilters,
): string[] {
  return [
    ...new Set(
      profiles
        .map((profile) => profile[key]?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort(textCollator.compare);
}

export function parseGearScore(value?: string | null): number | null {
  if (!value) return null;

  const normalized = value.trim().replace(/[,，]/g, "");
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*万$/);
  if (match) return Number(match[1]) * 10_000;

  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function parseOptionalAccountScore(
  value: string | number | null | undefined,
): AccountScoreParseResult {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === "string" && value.trim() === "") return { ok: true, value: null };

  const score = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(score) && score >= 0
    ? { ok: true, value: score }
    : { ok: false, value: null };
}

function compareOptional<T>(
  left: T | null | undefined,
  right: T | null | undefined,
  direction: SortDirection,
  compare: (leftValue: T, rightValue: T) => number,
): number {
  const leftMissing = left === null || left === undefined || left === "";
  const rightMissing = right === null || right === undefined || right === "";
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  return compare(left, right) * (direction === "asc" ? 1 : -1);
}

function compareProfiles(
  left: AccountProfile,
  right: AccountProfile,
  sortKey: AccountProfileSortKey,
  direction: SortDirection,
): number {
  if (sortKey === "gearScore") {
    return compareOptional(
      parseGearScore(left.gearScore),
      parseGearScore(right.gearScore),
      direction,
      (leftValue, rightValue) => leftValue - rightValue,
    );
  }

  if (sortKey === "currentScore" || sortKey === "highestScore") {
    return compareOptional(left[sortKey], right[sortKey], direction, (leftValue, rightValue) => {
      return leftValue - rightValue;
    });
  }

  return compareOptional(left[sortKey], right[sortKey], direction, textCollator.compare);
}

export function filterAndSortAccountProfiles(
  profiles: readonly AccountProfile[],
  filters: AccountProfileFilters,
  sortKey: AccountProfileSortKey | null,
  direction: SortDirection,
): AccountProfile[] {
  const filtered = profiles.filter((profile) => {
    return (
      (!filters.contactName || profile.contactName === filters.contactName) &&
      (!filters.server || profile.server === filters.server) &&
      (!filters.specialization || profile.specialization === filters.specialization)
    );
  });

  if (!sortKey) return filtered;

  return filtered
    .map((profile, index) => ({ profile, index }))
    .sort((left, right) => {
      return (
        compareProfiles(left.profile, right.profile, sortKey, direction) || left.index - right.index
      );
    })
    .map(({ profile }) => profile);
}

export function orderAccountProfilesByIds(
  profiles: readonly AccountProfile[],
  orderedIds: readonly string[],
): AccountProfile[] {
  const positions = new Map(orderedIds.map((id, index) => [id, index]));
  return profiles
    .map((profile, index) => ({ profile, index }))
    .sort((left, right) => {
      const leftPosition = positions.get(left.profile.id);
      const rightPosition = positions.get(right.profile.id);
      if (leftPosition === undefined && rightPosition === undefined)
        return left.index - right.index;
      if (leftPosition === undefined) return 1;
      if (rightPosition === undefined) return -1;
      return leftPosition - rightPosition;
    })
    .map(({ profile }) => profile);
}

export function moveAccountProfileId(
  orderedIds: readonly string[],
  sourceId: string,
  targetId: string,
  placement: AccountDropPlacement,
): string[] {
  if (sourceId === targetId) return [...orderedIds];
  if (!orderedIds.includes(sourceId) || !orderedIds.includes(targetId)) return [...orderedIds];

  const next = orderedIds.filter((id) => id !== sourceId);
  const targetIndex = next.indexOf(targetId);
  next.splice(placement === "before" ? targetIndex : targetIndex + 1, 0, sourceId);
  return next;
}
