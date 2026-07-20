import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WeekSchedule from "./WeekSchedule.vue";

describe("WeekSchedule", () => {
  it("opens creation when the empty schedule track is clicked", async () => {
    const wrapper = mount(WeekSchedule, {
      props: {
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
});
