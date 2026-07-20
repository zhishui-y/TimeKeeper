import { describe, expect, it } from "vitest";
import { differenceInHours, parseISO } from "date-fns";
import { combineDateTime } from "./appointment";

describe("combineDateTime", () => {
  it("keeps date-only appointments unscheduled", () => {
    expect(combineDateTime("2026-07-13", null, null)).toEqual({
      startsAt: null,
      endsAt: null,
    });
  });

  it("moves an earlier end time to the following day", () => {
    const result = combineDateTime("2026-07-13", "23:00", "01:00");
    expect(result.startsAt).not.toBeNull();
    expect(result.endsAt).not.toBeNull();
    expect(
      differenceInHours(parseISO(result.endsAt as string), parseISO(result.startsAt as string)),
    ).toBe(2);
  });

  it("rejects equal start and end times instead of creating a 24-hour appointment", () => {
    expect(() => combineDateTime("2026-07-13", "10:00", "10:00")).toThrow(
      "开始时间和结束时间不能相同",
    );
  });
});
