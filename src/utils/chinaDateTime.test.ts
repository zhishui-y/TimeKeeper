import { describe, expect, it } from "vitest";
import {
  addDateKeyDays,
  addDateKeyMonths,
  buildCivilDateTime,
  chinaCivilDateTime,
  chinaDateKey,
  civilDifferenceInMinutes,
  civilDurationInMinutes,
  civilTime,
  endOfChinaMonth,
  endOfChinaWeek,
  formatChinaAuditInstant,
  isDateKey,
  startOfChinaMonth,
  startOfChinaWeek,
} from "./chinaDateTime";

describe("北京时间民用时间", () => {
  it("uses the Beijing date and clock at an UTC boundary", () => {
    const instant = new Date("2026-08-03T16:30:15Z");
    expect(chinaDateKey(instant)).toBe("2026-08-04");
    expect(chinaCivilDateTime(instant)).toBe("2026-08-04T00:30:15");
  });

  it("keeps appointment wall-clock values independent from offsets", () => {
    expect(civilTime("2026-08-04T09:30:00")).toBe("09:30");
    expect(civilTime("2026-08-04T09:30:00+08:00")).toBe("09:30");
    expect(buildCivilDateTime("2026-08-04", "09:30")).toBe("2026-08-04T09:30:00");
  });

  it("calculates civil durations and Beijing countdowns without host timezone", () => {
    expect(civilDurationInMinutes("2026-08-04T23:30:00", "2026-08-05T01:00:00")).toBe(90);
    expect(civilDifferenceInMinutes("2026-08-04T01:00:00", new Date("2026-08-03T16:30:00Z"))).toBe(
      30,
    );
  });
});

describe("北京时间日期运算", () => {
  it("validates real zero-padded dates", () => {
    expect(isDateKey("2024-02-29")).toBe(true);
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2026-2-09")).toBe(false);
  });

  it("handles week month and leap-year boundaries", () => {
    expect(startOfChinaWeek("2026-08-02")).toBe("2026-07-27");
    expect(endOfChinaWeek("2026-08-02")).toBe("2026-08-02");
    expect(startOfChinaMonth("2024-02-29")).toBe("2024-02-01");
    expect(endOfChinaMonth("2024-02-12")).toBe("2024-02-29");
    expect(addDateKeyDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDateKeyMonths("2026-12-15", 1)).toBe("2027-01-01");
  });

  it("formats audit instants explicitly in Asia/Shanghai", () => {
    expect(formatChinaAuditInstant("2026-08-03T16:30:00Z")).toContain("2026/08/04");
  });
});
