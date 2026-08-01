// @vitest-environment jsdom

import { createPinia } from "pinia";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../api/mockClient";
import RevenueDashboard from "./RevenueDashboard.vue";

const RevenueChartStub = defineComponent({
  name: "RevenueChart",
  props: ["points", "drillable"],
  emits: ["periodSelect"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "revenue-chart-stub",
          type: "button",
          onClick: () => emit("periodSelect", { period: "2026-07-27" }),
        },
        String(props.drillable),
      );
  },
});

const RevenuePeriodDetailStub = defineComponent({
  name: "RevenuePeriodDetail",
  props: ["granularity", "from", "to"],
  emits: ["close"],
  setup(props) {
    return () => h("div", { class: "period-detail-stub" }, `${props.from}—${props.to}`);
  },
});

describe("RevenueDashboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("opens daily details for a weekly bar without changing the main range or granularity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    const getRevenueSummary = vi.spyOn(mockApi, "getRevenueSummary");
    const wrapper = mount(RevenueDashboard, {
      global: {
        plugins: [createPinia()],
        stubs: {
          RevenueChart: RevenueChartStub,
          RevenuePeriodDetail: RevenuePeriodDetailStub,
        },
      },
    });
    await flushPromises();

    const dateInputs = wrapper.findAll<HTMLInputElement>('input[type="date"]');
    const originalRange = dateInputs.map((input) => input.element.value);
    const weekButton = wrapper.findAll("button").find((button) => button.text() === "按周");
    if (!weekButton) throw new Error("未找到按周按钮");

    await weekButton.trigger("click");
    await flushPromises();
    await wrapper.get(".revenue-chart-stub").trigger("click");
    await flushPromises();

    expect(dateInputs.map((input) => input.element.value)).toEqual(originalRange);
    expect(weekButton.classes()).toContain("is-active");
    expect(wrapper.get(".period-detail-stub").text()).toBe("2026-07-27—2026-08-02");
    expect(getRevenueSummary).toHaveBeenCalledWith("2026-07-27", "2026-08-02", "day");

    wrapper.unmount();
  });

  it("applies all, previous month, and current month shortcuts without changing granularity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    const expectedAllRange = await mockApi.getRevenueSummary("", "", "week");
    const getRevenueSummary = vi.spyOn(mockApi, "getRevenueSummary");
    const wrapper = mount(RevenueDashboard, {
      global: {
        plugins: [createPinia()],
        stubs: {
          RevenueChart: RevenueChartStub,
          RevenuePeriodDetail: RevenuePeriodDetailStub,
        },
      },
    });
    await flushPromises();

    const buttons = wrapper.findAll("button");
    const byText = (text: string) => {
      const button = buttons.find((candidate) => candidate.text() === text);
      if (!button) throw new Error(`未找到按钮：${text}`);
      return button;
    };
    const dateInputs = wrapper.findAll<HTMLInputElement>('input[type="date"]');

    await byText("按周").trigger("click");
    await byText("上月").trigger("click");
    await flushPromises();
    expect(dateInputs.map((input) => input.element.value)).toEqual(["2026-07-01", "2026-07-31"]);
    expect(getRevenueSummary).toHaveBeenCalledWith("2026-07-01", "2026-07-31", "week");

    await byText("本月").trigger("click");
    await flushPromises();
    expect(dateInputs.map((input) => input.element.value)).toEqual(["2026-08-01", "2026-08-31"]);
    expect(byText("按周").classes()).toContain("is-active");

    await byText("全部").trigger("click");
    await flushPromises();
    expect(dateInputs.map((input) => input.element.value)).toEqual([
      expectedAllRange.from,
      expectedAllRange.to,
    ]);
    expect(byText("全部").attributes("aria-pressed")).toBe("true");
    expect(getRevenueSummary).toHaveBeenCalledWith("", "", "week");
    expect(wrapper.get(".panel-header__meta").text()).toContain(
      `${expectedAllRange.from} — ${expectedAllRange.to}`,
    );

    wrapper.unmount();
  });
});
