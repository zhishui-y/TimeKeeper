// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RevenueRangeNavigator from "./RevenueRangeNavigator.vue";

const baseProps = {
  rangeKind: "week" as const,
  displayRange: { from: "2026-08-03", to: "2026-08-09" },
  isCurrentPeriod: true,
  customFrom: "2026-08-03",
  customTo: "2026-08-09",
  customError: null,
};

describe("RevenueRangeNavigator", () => {
  it("emits range selection requests from the four explicit choices", async () => {
    const wrapper = mount(RevenueRangeNavigator, { props: baseProps });

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "月")
      ?.trigger("click");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "全部")
      ?.trigger("click");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "自定义")
      ?.trigger("click");

    expect(wrapper.emitted("selectRange")).toEqual([["month"], ["all"], ["custom"]]);
    expect(wrapper.get('button[aria-pressed="true"]').text()).toBe("周");
  });

  it("shows the actual weekly range and emits previous, next, and return requests", async () => {
    const wrapper = mount(RevenueRangeNavigator, {
      props: { ...baseProps, isCurrentPeriod: false },
    });

    expect(wrapper.text()).toContain("2026-08-03 — 2026-08-09");
    expect(wrapper.text()).toContain("回到本周");
    await wrapper.get('button[aria-label="上一周"]').trigger("click");
    await wrapper.get('button[aria-label="下一周"]').trigger("click");
    await wrapper.get(".range-navigator__return").trigger("click");

    expect(wrapper.emitted("navigate")).toEqual([[-1], [1]]);
    expect(wrapper.emitted("returnCurrent")).toEqual([[]]);
  });

  it("hides natural navigation for all records and displays the resolved backend range", () => {
    const wrapper = mount(RevenueRangeNavigator, {
      props: {
        ...baseProps,
        rangeKind: "all",
        displayRange: { from: "2024-01-02", to: "2026-08-04" },
        isCurrentPeriod: false,
      },
    });

    expect(wrapper.text()).toContain("实际范围");
    expect(wrapper.text()).toContain("2024-01-02 — 2026-08-04");
    expect(wrapper.find(".range-navigator__natural").exists()).toBe(false);
  });

  it("shows unresolved all-records state without inventing a range", () => {
    const wrapper = mount(RevenueRangeNavigator, {
      props: { ...baseProps, rangeKind: "all", displayRange: null, isCurrentPeriod: false },
    });

    expect(wrapper.text()).toContain("加载后显示实际范围");
  });

  it("renders custom date errors and emits draft values without mutating props", async () => {
    const wrapper = mount(RevenueRangeNavigator, {
      props: {
        ...baseProps,
        rangeKind: "custom",
        customError: "开始日期不能晚于结束日期",
        isCurrentPeriod: false,
      },
    });

    const fromInput = wrapper.get<HTMLInputElement>('input[aria-label="统计开始日期"]');
    const toInput = wrapper.get<HTMLInputElement>('input[aria-label="统计结束日期"]');
    expect(wrapper.get('[role="alert"]').text()).toBe("开始日期不能晚于结束日期");
    expect(fromInput.attributes("aria-invalid")).toBe("true");

    await fromInput.setValue("2026-07-01");
    await toInput.setValue("2026-07-31");

    expect(wrapper.emitted("updateCustomFrom")).toEqual([["2026-07-01"]]);
    expect(wrapper.emitted("updateCustomTo")).toEqual([["2026-07-31"]]);
    expect(baseProps.customFrom).toBe("2026-08-03");
    expect(baseProps.customTo).toBe("2026-08-09");
  });
});
