import { describe, expect, it } from "vitest";
import type { Appointment } from "../types/domain";
import {
  CALENDAR_VISIBLE_HALF_HOUR_SLOTS,
  calendarAppointmentCounts,
  calendarCardProgressLabel,
  calendarEventClassNames,
  calendarEventTimeLabel,
  calendarEventTooltip,
  calendarSlotHeight,
  isShortCalendarAppointment,
} from "./calendar";

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appointment-1",
    serviceDate: "2026-07-30",
    startsAt: "2026-07-30T14:00:00+08:00",
    endsAt: "2026-07-30T15:00:00+08:00",
    contactName: "小北",
    content: "手法陪练",
    mode: "business",
    serviceStatus: "completed",
    settlementStatus: "unsettled",
    amountMinor: 18_000,
    createdAt: "2026-07-30T00:00:00Z",
    updatedAt: "2026-07-30T00:00:00Z",
    ...overrides,
  };
}

describe("calendar appointment presentation", () => {
  it("fits exactly 27 half-hour slots into the timed viewport", () => {
    expect(CALENDAR_VISIBLE_HALF_HOUR_SLOTS).toBe(27);
    expect(calendarSlotHeight(540)).toBe(20);
    expect(calendarSlotHeight(405)).toBe(15);
    expect(calendarSlotHeight(-1)).toBe(0);
  });

  it("adds unified progress classes and labels to business appointments", () => {
    const unsettled = appointment();
    const settled = appointment({ settlementStatus: "settled", amountMinor: 36_000 });

    expect(calendarEventClassNames(unsettled)).toContain("appointment-event--pending_settlement");
    expect(calendarCardProgressLabel(unsettled)).toBe("待结算");
    expect(calendarEventClassNames(settled)).toContain("appointment-event--completed");
    expect(calendarCardProgressLabel(settled)).toBe("完成");
  });

  it("uses compact card labels without changing the full tooltip labels", () => {
    expect(
      calendarCardProgressLabel(
        appointment({ serviceStatus: "scheduled", settlementStatus: "unsettled" }),
      ),
    ).toBeNull();
    expect(
      calendarCardProgressLabel(
        appointment({ serviceStatus: "in_progress", settlementStatus: "unsettled" }),
      ),
    ).toBe("进行中");
    expect(
      calendarCardProgressLabel(
        appointment({
          mode: "entertainment",
          serviceStatus: "completed",
          settlementStatus: "not_applicable",
          amountMinor: null,
        }),
      ),
    ).toBe("完成");
    expect(calendarCardProgressLabel(appointment({ serviceStatus: "cancelled" }))).toBe("取消");
    expect(calendarEventTooltip(appointment({ serviceStatus: "cancelled" }))).toContain(
      "状态：已取消",
    );
    expect(calendarEventTooltip(appointment())).toContain("金额：¥180");
  });

  it("counts active appointments by service date and excludes cancelled records", () => {
    const counts = calendarAppointmentCounts([
      appointment(),
      appointment({ id: "pending", startsAt: null, endsAt: null }),
      appointment({
        id: "cross-day",
        serviceDate: "2026-07-31",
        startsAt: "2026-07-31T23:30:00+08:00",
        endsAt: "2026-08-01T01:30:00+08:00",
      }),
      appointment({ id: "cancelled", serviceStatus: "cancelled" }),
    ]);

    expect(counts.get("2026-07-30")).toBe(2);
    expect(counts.get("2026-07-31")).toBe(1);
    expect(counts.has("2026-08-01")).toBe(false);
  });

  it("derives compact card timing and keeps complete details in the tooltip", () => {
    const short = appointment({
      startsAt: "2026-07-30T14:00:00+08:00",
      endsAt: "2026-07-30T14:30:00+08:00",
    });
    const crossDay = appointment({
      startsAt: "2026-07-30T23:30:00+08:00",
      endsAt: "2026-07-31T01:30:00+08:00",
      serviceStatus: "in_progress",
      settlementStatus: "settled",
    });

    expect(isShortCalendarAppointment(short)).toBe(true);
    expect(isShortCalendarAppointment(appointment())).toBe(false);
    expect(calendarEventTimeLabel(short)).toBe("14:00–14:30");
    expect(calendarEventTimeLabel(appointment({ endsAt: null }))).toBe("14:00");
    expect(calendarEventTimeLabel(crossDay)).toBe("23:30–01:30 +1");
    expect(calendarEventTimeLabel(appointment({ startsAt: null, endsAt: null }))).toBe("待定");
    expect(calendarEventTooltip(crossDay)).toBe(
      ["小北", "时间：23:30–01:30 +1", "内容：手法陪练", "状态：已完成", "金额：¥180"].join("\n"),
    );
  });
});
