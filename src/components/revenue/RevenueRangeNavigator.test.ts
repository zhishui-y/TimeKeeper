// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RevenueRangeNavigator from "./RevenueRangeNavigator.vue";

describe("RevenueRangeNavigator", () => {
  it("shows weekly actions and emits typed navigation requests", async () => {
    const wrapper = mount(RevenueRangeNavigator, {
      props: { unit: "week", activeRange: "week", isCurrentPeriod: true },
    });

    expect(wrapper.text()).toContain("上一周");
    expect(wrapper.text()).toContain("本周");
    expect(wrapper.text()).toContain("下一周");

    const buttons = wrapper.findAll("button");
    await buttons.find((button) => button.text() === "下一周")?.trigger("click");
    await buttons.find((button) => button.text() === "月")?.trigger("click");
    await buttons.find((button) => button.text() === "全部")?.trigger("click");

    expect(wrapper.emitted("navigate")).toEqual([[1]]);
    expect(wrapper.emitted("selectUnit")).toEqual([["month"]]);
    expect(wrapper.emitted("selectAll")).toEqual([[]]);
  });

  it("switches labels and active state for monthly navigation", () => {
    const wrapper = mount(RevenueRangeNavigator, {
      props: { unit: "month", activeRange: "custom", isCurrentPeriod: false },
    });

    expect(wrapper.text()).toContain("上一月");
    expect(wrapper.text()).toContain("本月");
    expect(wrapper.text()).toContain("下一月");
    expect(wrapper.find('[aria-pressed="true"]').text()).toBe("月");
  });

  it("does not mark the current-period action after moving to another period", () => {
    const wrapper = mount(RevenueRangeNavigator, {
      props: { unit: "week", activeRange: "week", isCurrentPeriod: false },
    });

    const currentWeek = wrapper.findAll("button").find((button) => button.text() === "本周");
    expect(currentWeek?.attributes("aria-pressed")).toBe("false");
    expect(currentWeek?.classes()).not.toContain("is-active");
  });
});
