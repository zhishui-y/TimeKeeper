import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Appointment } from "../../types/domain";
import WeekSchedule from "./WeekSchedule.vue";

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: "appointment-1",
    serviceDate: "2026-07-20",
    startsAt: "2026-07-20T14:00:00+08:00",
    endsAt: "2026-07-20T15:00:00+08:00",
    contactName: "小北",
    content: "手法陪练",
    mode: "business",
    serviceStatus: "scheduled",
    settlementStatus: "unsettled",
    amountMinor: 18_000,
    createdAt: "2026-07-20T00:00:00Z",
    updatedAt: "2026-07-20T00:00:00Z",
    ...overrides,
  };
}

describe("WeekSchedule", () => {
  it("opens creation when the empty schedule track is clicked", async () => {
    const wrapper = mount(WeekSchedule, {
      props: {
        selectedDate: "2026-07-20",
        days: [
          {
            date: "2026-07-20",
            weekday: "周一",
            dayNumber: "20",
            isToday: true,
            appointments: [],
          },
        ],
      },
    });

    await wrapper.get(".week-day__track").trigger("click");

    expect(wrapper.emitted("create")).toEqual([["2026-07-20"]]);
  });

  it("selects a day from its heading without opening creation", async () => {
    const wrapper = mount(WeekSchedule, {
      props: {
        selectedDate: "2026-07-20",
        days: [
          {
            date: "2026-07-20",
            weekday: "周一",
            dayNumber: "20",
            isToday: true,
            appointments: [],
          },
          {
            date: "2026-07-21",
            weekday: "周二",
            dayNumber: "21",
            isToday: false,
            appointments: [],
          },
        ],
      },
    });

    const headings = wrapper.findAll(".week-day__heading");
    await headings[1]?.trigger("click");

    expect(wrapper.emitted("selectDate")).toEqual([["2026-07-21"]]);
    expect(wrapper.emitted("create")).toBeUndefined();
    expect(headings[0]?.attributes("aria-pressed")).toBe("true");
    expect(headings[1]?.attributes("aria-pressed")).toBe("false");
  });

  it("applies service colors and compact settlement markers to schedule chips", () => {
    const wrapper = mount(WeekSchedule, {
      props: {
        nextAppointmentId: "scheduled",
        selectedDate: "2026-07-20",
        days: [
          {
            date: "2026-07-20",
            weekday: "周一",
            dayNumber: "20",
            isToday: true,
            appointments: [
              appointment({
                id: "scheduled",
                contactName: "待服务",
                startsAt: "2026-07-20T20:00:00+08:00",
                endsAt: "2026-07-20T22:00:00+08:00",
              }),
              appointment({
                id: "completed",
                contactName: "已完成",
                serviceStatus: "completed",
                settlementStatus: "settled",
              }),
              appointment({
                id: "cancelled",
                contactName: "已取消",
                serviceStatus: "cancelled",
              }),
            ],
          },
        ],
      },
    });

    const chips = wrapper.findAll(".schedule-chip");
    expect(chips[0]?.classes()).toEqual(
      expect.arrayContaining([
        "schedule-chip--scheduled",
        "schedule-chip--unsettled",
        "schedule-chip--next",
      ]),
    );
    expect(chips[0]?.get(".schedule-chip__settlement").text()).toBe("待");
    expect(chips[1]?.classes()).toEqual(
      expect.arrayContaining(["schedule-chip--completed", "schedule-chip--settled"]),
    );
    expect(chips[1]?.get(".schedule-chip__settlement").text()).toBe("已");
    expect(chips[2]?.classes()).toContain("schedule-chip--cancelled");
    expect(chips[2]?.find(".schedule-chip__settlement").exists()).toBe(false);
    expect(chips[0]?.attributes("title")).toContain("20:00–22:00");
    expect(chips[0]?.attributes("title")).toContain("下一时段");
    expect(chips[0]?.attributes("aria-label")).toContain("20:00–22:00");
  });
});
