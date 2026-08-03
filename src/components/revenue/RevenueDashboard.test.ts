// @vitest-environment jsdom

import { createPinia } from "pinia";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../api/mockClient";
import RevenueDashboard from "./RevenueDashboard.vue";

const RevenueChartStub = defineComponent({
  name: "RevenueChart",
  props: {
    points: { type: Array, default: () => [] },
    drillable: { type: Boolean, default: false },
  },
  emits: ["periodSelect"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "revenue-chart-stub",
          type: "button",
          onClick: () => emit("periodSelect", props.points[0] ?? { period: "2026-07-27" }),
        },
        String(props.drillable),
      );
  },
});

const RevenuePeriodDetailStub = defineComponent({
  name: "RevenuePeriodDetail",
  props: ["granularity", "from", "to", "appointments"],
  emits: ["close"],
  setup(props) {
    return () =>
      h(
        "div",
        {
          class: "period-detail-stub",
          "data-granularity": props.granularity,
          "data-appointments": props.appointments.length,
        },
        `${props.from}—${props.to}`,
      );
  },
});

describe("RevenueDashboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("starts on the current Monday-to-Sunday week with daily granularity", async () => {
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
    expect(dateInputs.map((input) => input.element.value)).toEqual(["2026-07-27", "2026-08-02"]);
    expect(getRevenueSummary).toHaveBeenCalledWith("2026-07-27", "2026-08-02", "day");
    expect(
      wrapper
        .findAll("button")
        .find((button) => button.text() === "按日")
        ?.classes(),
    ).toContain("is-active");

    wrapper.unmount();
  });

  it("opens the selected day's appointments from the daily chart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    const listAppointments = vi.spyOn(mockApi, "listAppointments");
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

    expect(listAppointments).not.toHaveBeenCalled();
    const chart = wrapper.getComponent(RevenueChartStub);
    const selectedPeriod = (chart.props("points") as Array<{ period: string }>)[0]?.period;
    if (!selectedPeriod) throw new Error("日收益图缺少可下钻的数据点");
    expect(chart.text()).toBe("true");
    await wrapper.get(".revenue-chart-stub").trigger("click");
    await flushPromises();

    const detail = wrapper.get(".period-detail-stub");
    expect(detail.attributes("data-granularity")).toBe("day");
    expect(detail.text()).toBe(`${selectedPeriod}—${selectedPeriod}`);
    expect(listAppointments).toHaveBeenCalledWith({ from: selectedPeriod, to: selectedPeriod });

    wrapper.unmount();
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

  it("navigates weeks and months continuously without changing granularity", async () => {
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

    const buttons = wrapper.findAll("button");
    const byText = (text: string) => {
      const button = buttons.find((candidate) => candidate.text() === text);
      if (!button) throw new Error(`未找到按钮：${text}`);
      return button;
    };
    const dateInputs = wrapper.findAll<HTMLInputElement>('input[type="date"]');

    await byText("下一周").trigger("click");
    await flushPromises();
    expect(dateInputs.map((input) => input.element.value)).toEqual(["2026-08-03", "2026-08-09"]);
    expect(getRevenueSummary).toHaveBeenCalledWith("2026-08-03", "2026-08-09", "day");

    await byText("下一周").trigger("click");
    await flushPromises();
    expect(dateInputs.map((input) => input.element.value)).toEqual(["2026-08-10", "2026-08-16"]);

    await byText("按月").trigger("click");
    await byText("上一周").trigger("click");
    await flushPromises();
    expect(dateInputs.map((input) => input.element.value)).toEqual(["2026-08-03", "2026-08-09"]);
    expect(byText("按月").classes()).toContain("is-active");
    expect(getRevenueSummary).toHaveBeenCalledWith("2026-08-03", "2026-08-09", "month");

    await byText("月").trigger("click");
    await flushPromises();
    expect(dateInputs.map((input) => input.element.value)).toEqual(["2026-08-01", "2026-08-31"]);
    expect(byText("按月").classes()).toContain("is-active");

    await byText("上一月").trigger("click");
    await byText("上一月").trigger("click");
    await flushPromises();
    expect(dateInputs.map((input) => input.element.value)).toEqual(["2026-06-01", "2026-06-30"]);

    await byText("本月").trigger("click");
    await flushPromises();
    expect(dateInputs.map((input) => input.element.value)).toEqual(["2026-08-01", "2026-08-31"]);

    wrapper.unmount();
  });

  it("preserves granularity for all records and anchors custom navigation to the start date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    const expectedAllRange = await mockApi.getRevenueSummary("", "", "day");
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

    const byText = (text: string) => {
      const button = wrapper.findAll("button").find((candidate) => candidate.text() === text);
      if (!button) throw new Error(`未找到按钮：${text}`);
      return button;
    };
    const dateInputs = wrapper.findAll<HTMLInputElement>('input[type="date"]');

    await byText("全部").trigger("click");
    await flushPromises();
    expect(dateInputs.map((input) => input.element.value)).toEqual([
      expectedAllRange.from,
      expectedAllRange.to,
    ]);
    expect(byText("全部").attributes("aria-pressed")).toBe("true");
    expect(getRevenueSummary).toHaveBeenCalledWith("", "", "day");
    expect(wrapper.get(".panel-header__meta").text()).toContain(
      `${expectedAllRange.from} — ${expectedAllRange.to}`,
    );

    await dateInputs[0].setValue("2026-03-18");
    await dateInputs[1].setValue("2026-03-20");
    await flushPromises();
    expect(byText("全部").attributes("aria-pressed")).toBe("false");

    await byText("下一周").trigger("click");
    await flushPromises();
    expect(dateInputs.map((input) => input.element.value)).toEqual(["2026-03-23", "2026-03-29"]);
    expect(getRevenueSummary).toHaveBeenCalledWith("2026-03-23", "2026-03-29", "day");

    wrapper.unmount();
  });
});
