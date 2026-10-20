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
  it("keeps week navigation available while result interactions are disabled", async () => {
    const wrapper = mount(WeekSchedule, {
      props: { days: [], isCurrentWeek: false, interactionsDisabled: true },
    });
    const buttons = wrapper.findAll(".week-schedule__header button");
    expect(buttons.map((button) => button.text())).toEqual(["上一周", "每周排班", "下一周"]);
    await buttons[0]!.trigger("click");
    await buttons[1]!.trigger("click");
    await buttons[2]!.trigger("click");
    expect(wrapper.emitted("changeWeek")).toEqual([[-1], [1]]);
    expect(wrapper.emitted("returnToCurrentWeek")).toEqual([[]]);
    expect(wrapper.attributes("inert")).toBeUndefined();
    expect(wrapper.get(".week-grid").attributes("inert")).toBeDefined();
    expect(wrapper.get("h2 button").attributes("title")).toBe("点击回到本周");
    await wrapper.setProps({ isCurrentWeek: true });
    expect(wrapper.get("h2").text()).toBe("本周排班");
    expect(wrapper.find("h2 button").exists()).toBe(false);
    wrapper.unmount();
  });

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

  it("applies unified progress colors and labels to schedule chips", () => {
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
      expect.arrayContaining(["schedule-chip--scheduled", "schedule-chip--next"]),
    );
    expect(chips[0]?.get(".schedule-chip__progress").text()).toBe("已预约");
    expect(chips[1]?.classes()).toContain("schedule-chip--completed");
    expect(chips[1]?.get(".schedule-chip__progress").text()).toBe("完成");
    expect(chips[2]?.classes()).toContain("schedule-chip--cancelled");
    expect(chips[2]?.get(".schedule-chip__progress").text()).toBe("已取消");
    expect(chips[0]?.attributes("title")).toContain("20:00–22:00");
    expect(chips[0]?.attributes("title")).toContain("下一时段");
    expect(chips[0]?.attributes("aria-label")).toContain("20:00–22:00");
  });

  it("renders every appointment in an accessible per-day scroll region", async () => {
    const appointments = Array.from({ length: 5 }, (_, index) =>
      appointment({
        id: `appointment-${index + 1}`,
        contactName: `联系人${index + 1}`,
        startsAt: `2026-07-20T${String(10 + index).padStart(2, "0")}:00:00+08:00`,
        endsAt: `2026-07-20T${String(11 + index).padStart(2, "0")}:00:00+08:00`,
      }),
    );
    const wrapper = mount(WeekSchedule, {
      props: {
        days: [
          {
            date: "2026-07-20",
            weekday: "周一",
            dayNumber: "20",
            isToday: true,
            appointments,
          },
        ],
      },
    });

    const track = wrapper.get(".week-day__track");
    expect(track.attributes("role")).toBe("region");
    expect(track.attributes("tabindex")).toBe("0");
    expect(track.attributes("aria-label")).toContain("可上下滚动查看更多");
    expect(wrapper.findAll(".schedule-chip")).toHaveLength(5);
    expect(wrapper.find(".week-day__more").exists()).toBe(false);

    await wrapper.findAll(".schedule-chip")[4]!.trigger("click");
    expect(wrapper.emitted("edit")?.[0]?.[0]).toMatchObject({ id: "appointment-5" });
    expect(wrapper.emitted("create")).toBeUndefined();
  });
});
