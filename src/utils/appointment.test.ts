import { describe, expect, it } from "vitest";
import { differenceInHours, parseISO } from "date-fns";
import type { Appointment } from "../types/domain";
import {
  combineDateTime,
  findNextScheduledAppointment,
  rescheduledInput,
  sortAppointmentsByStartTime,
} from "./appointment";

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: "appointment-1",
    serviceDate: "2026-07-20",
    startsAt: "2026-07-20T14:00:00+08:00",
    endsAt: "2026-07-20T15:00:00+08:00",
    contactName: "小北",
    mode: "business",
    serviceStatus: "scheduled",
    settlementStatus: "unsettled",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

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

  it("keeps date-only appointments unscheduled when they are dragged", () => {
    const appointment: Appointment = {
      id: "date-only",
      serviceDate: "2026-07-19",
      startsAt: null,
      endsAt: null,
      contactName: "待定用户",
      mode: "business",
      serviceStatus: "scheduled",
      settlementStatus: "unsettled",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
    };

    expect(rescheduledInput(appointment, new Date(2026, 6, 20, 14, 30), null, false)).toMatchObject(
      {
        serviceDate: "2026-07-20",
        startTime: null,
        endTime: null,
      },
    );
  });

  it("sorts scheduled appointments from early to late and keeps pending times last", () => {
    const sorted = sortAppointmentsByStartTime([
      appointment({ id: "late", startsAt: "2026-07-20T20:30:00+08:00" }),
      appointment({ id: "pending-a", startsAt: null, endsAt: null }),
      appointment({ id: "early", startsAt: "2026-07-20T13:30:00+08:00" }),
      appointment({ id: "pending-b", startsAt: null, endsAt: null }),
    ]);

    expect(sorted.map(({ id }) => id)).toEqual(["early", "late", "pending-a", "pending-b"]);
  });

  it("finds the earliest future scheduled appointment", () => {
    const result = findNextScheduledAppointment(
      [
        appointment({
          id: "future-late",
          startsAt: "2026-07-20T20:30:00+08:00",
        }),
        appointment({
          id: "future-in-progress",
          startsAt: "2026-07-20T13:30:00+08:00",
          serviceStatus: "in_progress",
        }),
        appointment({
          id: "past-scheduled",
          startsAt: "2026-07-20T11:30:00+08:00",
          endsAt: "2026-07-20T11:45:00+08:00",
        }),
        appointment({ id: "pending", startsAt: null, endsAt: null }),
        appointment({
          id: "future-early",
          startsAt: "2026-07-20T18:00:00+08:00",
        }),
      ],
      new Date("2026-07-20T12:00:00+08:00"),
    );

    expect(result?.id).toBe("future-early");
  });

  it("keeps the current appointment marked while its time slot is ongoing", () => {
    const result = findNextScheduledAppointment(
      [
        appointment({
          id: "ongoing",
          startsAt: "2026-07-20T11:30:00+08:00",
          endsAt: "2026-07-20T12:30:00+08:00",
        }),
        appointment({
          id: "next",
          startsAt: "2026-07-20T18:00:00+08:00",
          endsAt: "2026-07-20T19:00:00+08:00",
        }),
      ],
      new Date("2026-07-20T12:00:00+08:00"),
    );

    expect(result?.id).toBe("ongoing");
  });

  it("marks the next appointment when the current time slot reaches its end", () => {
    const appointments = [
      appointment({
        id: "ended",
        startsAt: "2026-07-20T11:30:00+08:00",
        endsAt: "2026-07-20T12:30:00+08:00",
      }),
      appointment({
        id: "next",
        startsAt: "2026-07-20T18:00:00+08:00",
        endsAt: "2026-07-20T19:00:00+08:00",
      }),
    ];

    expect(
      findNextScheduledAppointment(appointments, new Date("2026-07-20T12:29:59+08:00")),
    ).toMatchObject({ id: "ended" });
    expect(
      findNextScheduledAppointment(appointments, new Date("2026-07-20T12:30:00+08:00"))?.id,
    ).toBe("next");
  });

  it("keeps an in-progress appointment without an end time active until its status changes", () => {
    const result = findNextScheduledAppointment(
      [
        appointment({
          id: "ongoing-without-end",
          startsAt: "2026-07-20T11:30:00+08:00",
          endsAt: null,
          serviceStatus: "in_progress",
        }),
        appointment({ id: "next", startsAt: "2026-07-20T18:00:00+08:00" }),
      ],
      new Date("2026-07-20T12:00:00+08:00"),
    );

    expect(result).toBeNull();
  });

  it("returns null when today has no future scheduled appointment", () => {
    const result = findNextScheduledAppointment(
      [
        appointment({ serviceStatus: "completed" }),
        appointment({ id: "pending", startsAt: null, endsAt: null }),
      ],
      new Date("2026-07-20T16:00:00+08:00"),
    );

    expect(result).toBeNull();
  });
});
