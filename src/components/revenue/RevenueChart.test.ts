// @vitest-environment jsdom

import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { RevenuePoint } from "../../types/domain";
import RevenueChart from "./RevenueChart.vue";

vi.mock("vue-echarts", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "VChart",
      props: {
        option: { type: Object, required: true },
      },
      emits: ["click"],
      setup: () => () => h("div", { class: "v-chart-stub" }),
    }),
  };
});

const points: RevenuePoint[] = [
  {
    period: "2026-07-27",
    settledMinor: 10_000,
    unsettledMinor: 0,
    businessHours: 2,
    appointmentCount: 1,
  },
  {
    period: "2026-08-03",
    settledMinor: 20_000,
    unsettledMinor: 5_000,
    businessHours: 4,
    appointmentCount: 2,
  },
];

describe("RevenueChart", () => {
  it("centers both revenue bars in one stack under the hours line", () => {
    const wrapper = mount(RevenueChart, { props: { points, drillable: true } });
    const chartOption = wrapper.findComponent({ name: "VChart" }).props("option") as {
      series: Array<{ stack?: string }>;
    };

    expect(chartOption.series[0].stack).toBe("revenue");
    expect(chartOption.series[1].stack).toBe("revenue");
    expect(chartOption.series[2].stack).toBeUndefined();
  });

  it("emits the clicked point for a drillable bar", async () => {
    const wrapper = mount(RevenueChart, { props: { points, drillable: true } });

    wrapper.findComponent({ name: "VChart" }).vm.$emit("click", {
      componentType: "series",
      seriesType: "bar",
      dataIndex: 1,
    });
    await nextTick();

    expect(wrapper.emitted("periodSelect")).toEqual([[points[1]]]);
  });

  it("emits line clicks and ignores non-series or disabled clicks", async () => {
    const wrapper = mount(RevenueChart, { props: { points, drillable: true } });
    const chart = wrapper.findComponent({ name: "VChart" });

    chart.vm.$emit("click", { componentType: "series", seriesType: "line", dataIndex: 0 });
    chart.vm.$emit("click", { componentType: "legend", dataIndex: 0 });
    await wrapper.setProps({ drillable: false });
    chart.vm.$emit("click", { componentType: "series", seriesType: "bar", dataIndex: 0 });
    await nextTick();

    expect(wrapper.emitted("periodSelect")).toEqual([[points[0]]]);
  });
});
