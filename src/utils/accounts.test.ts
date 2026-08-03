import { describe, expect, it } from "vitest";
import type { AccountProfile } from "../types/domain";
import {
  filterAndSortAccountProfiles,
  moveAccountProfileId,
  orderAccountProfilesByIds,
  parseGearScore,
  uniqueAccountValues,
} from "./accounts";

function profile(id: string, overrides: Partial<AccountProfile> = {}): AccountProfile {
  return {
    id,
    contactName: null,
    server: null,
    characterName: null,
    specialization: null,
    gearScore: null,
    accountName: `account-${id}`,
    password: overrides.password ?? null,
    currentScore: null,
    highestScore: null,
    scoreUpdatedAt: null,
    notes: null,
    needsReview: false,
    createdAt: "2026-07-30T00:00:00Z",
    updatedAt: "2026-07-30T00:00:00Z",
    ...overrides,
  };
}

const profiles = [
  profile("1", {
    contactName: "青禾",
    server: "剑胆琴心",
    specialization: "铁骨",
    gearScore: "20.1万",
    currentScore: 3050,
    highestScore: 3186,
  }),
  profile("2", {
    contactName: "南枝",
    server: "梦江南",
    specialization: "无方",
    gearScore: "198000",
    currentScore: 2680,
    highestScore: 2912,
  }),
  profile("3", {
    contactName: "小北",
    server: "梦江南",
    specialization: null,
    gearScore: null,
    currentScore: null,
    highestScore: 2120,
  }),
];

describe("account profile filtering and sorting", () => {
  it("parses both numeric and ten-thousand gear score formats", () => {
    expect(parseGearScore("19.8万")).toBe(198000);
    expect(parseGearScore("198,000")).toBe(198000);
    expect(parseGearScore(null)).toBeNull();
  });

  it("filters by exact categorical values", () => {
    const result = filterAndSortAccountProfiles(
      profiles,
      { contactName: "", server: "梦江南", specialization: "" },
      null,
      "asc",
    );

    expect(result.map((item) => item.id)).toEqual(["2", "3"]);
  });

  it("sorts requested text and numeric fields while keeping missing values last", () => {
    const noFilters = { contactName: "", server: "", specialization: "" };

    expect(
      filterAndSortAccountProfiles(profiles, noFilters, "contactName", "asc").map(
        (item) => item.id,
      ),
    ).toEqual(["2", "1", "3"]);
    expect(
      filterAndSortAccountProfiles(profiles, noFilters, "gearScore", "desc").map((item) => item.id),
    ).toEqual(["1", "2", "3"]);
    expect(
      filterAndSortAccountProfiles(profiles, noFilters, "currentScore", "asc").map(
        (item) => item.id,
      ),
    ).toEqual(["2", "1", "3"]);
  });

  it("builds deduplicated sorted filter options", () => {
    expect(uniqueAccountValues(profiles, "server")).toEqual(["剑胆琴心", "梦江南"]);
  });

  it("moves a profile before or after a target row without losing ids", () => {
    expect(moveAccountProfileId(["1", "2", "3"], "1", "3", "after")).toEqual(["2", "3", "1"]);
    expect(moveAccountProfileId(["1", "2", "3"], "3", "1", "before")).toEqual(["3", "1", "2"]);
    expect(moveAccountProfileId(["1", "2", "3"], "missing", "1", "before")).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("applies a stored manual order to profiles", () => {
    expect(orderAccountProfilesByIds(profiles, ["3", "1", "2"]).map((item) => item.id)).toEqual([
      "3",
      "1",
      "2",
    ]);
  });
});
