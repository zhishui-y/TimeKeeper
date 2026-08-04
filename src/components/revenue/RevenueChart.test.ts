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
    pendingCount: 0,
    businessHours: 2,
    appointmentCount: 1,
  },
  {
    period: "2026-08-03",
    settledMinor: 20_000,
    unsettledMinor: 5_000,
    pendingCount: 1,
    businessHours: 4,
    appointmentCount: 2,
  },
];

describe("RevenueChart", () => {
  it("shows settled revenue and hours without a pending amount series", () => {
    const wrapper = mount(RevenueChart, {
      props: {
        points,
        granularity: "day",
        from: "2026-07-27",
        to: "2026-08-03",
        drillable: true,
      },
    });
    const chartOption = wrapper.findComponent({ name: "VChart" }).props("option") as {
      series: Array<{ name: string; stack?: string }>;
    };

    expect(chartOption.series[0].stack).toBe("revenue");
    expect(chartOption.series[1].stack).toBeUndefined();
    expect(chartOption.series.map((series) => series.name)).toEqual(["已结收益", "业务工时"]);
  });

  it("emits the clicked point for a drillable bar", async () => {
    const wrapper = mount(RevenueChart, {
      props: {
        points,
        granularity: "day",
        from: "2026-07-27",
        to: "2026-08-03",
        drillable: true,
      },
    });

    wrapper.findComponent({ name: "VChart" }).vm.$emit("click", {
      componentType: "series",
      seriesType: "bar",
      dataIndex: 1,
    });
    await nextTick();

    expect(wrapper.emitted("periodSelect")).toEqual([[points[1]]]);
  });

  it("emits line clicks and ignores non-series or disabled clicks", async () => {
    const wrapper = mount(RevenueChart, {
      props: {
        points,
        granularity: "day",
        from: "2026-07-27",
        to: "2026-08-03",
        drillable: true,
      },
    });
    const chart = wrapper.findComponent({ name: "VChart" });

    chart.vm.$emit("click", { componentType: "series", seriesType: "line", dataIndex: 0 });
    chart.vm.$emit("click", { componentType: "legend", dataIndex: 0 });
    await wrapper.setProps({ drillable: false });
    chart.vm.$emit("click", { componentType: "series", seriesType: "bar", dataIndex: 0 });
    await nextTick();

    expect(wrapper.emitted("periodSelect")).toEqual([[points[0]]]);
  });

  it.each([
    ["day", ["2026-07-27", "2026-08-03"], "2026-07-27", "2026-08-03", ["07-27", "08-03"]],
    ["week", ["2026-07-27", "2026-08-03"], "2026-07-27", "2026-08-03", ["07-27", "08-03"]],
    ["month", ["2026-07", "2026-08"], "2026-07-01", "2026-08-31", ["07", "08"]],
    [
      "day",
      ["2026-07-27", "2026-08-03"],
      "2025-12-31",
      "2026-08-03",
      ["2026\n07-27", "2026\n08-03"],
    ],
    [
      "week",
      ["2026-07-27", "2026-08-03"],
      "2025-12-29",
      "2026-08-09",
      ["2026\n07-27", "2026\n08-03"],
    ],
    ["month", ["2026-07", "2026-08"], "2021-01-11", "2026-08-03", ["2026\n07", "2026\n08"]],
  ] as const)(
    "formats %s labels for same-year and cross-year points",
    (granularity, periods, from, to, labels) => {
      const labelPoints = periods.map((period, index) => ({ ...points[index]!, period }));
      const wrapper = mount(RevenueChart, {
        props: { points: labelPoints, granularity, from, to },
      });
      const chartOption = wrapper.findComponent({ name: "VChart" }).props("option") as {
        grid: { bottom: number };
        xAxis: {
          data: string[];
          axisLabel: { formatter: (period: string) => string; hideOverlap: boolean };
        };
      };

      expect(chartOption.xAxis.data).toEqual(periods);
      expect(periods.map(chartOption.xAxis.axisLabel.formatter)).toEqual(labels);
      expect(chartOption.xAxis.axisLabel.hideOverlap).toBe(true);
      expect(chartOption.grid.bottom).toBe(from.slice(0, 4) === to.slice(0, 4) ? 36 : 50);
    },
  );
});
