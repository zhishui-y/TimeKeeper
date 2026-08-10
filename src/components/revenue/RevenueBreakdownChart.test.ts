// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { RevenueBreakdownItem } from "../../types/domain";
import RevenueBreakdownChart from "./RevenueBreakdownChart.vue";

vi.mock("vue-echarts", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "VChart",
      props: {
        option: { type: Object, required: true },
      },
      setup: () => () => h("div", { class: "v-chart-stub" }),
    }),
  };
});

const items: RevenueBreakdownItem[] = [
  { name: "很长的联系人名称用于验证完整图例", amountMinor: 20_000, appointmentCount: 2 },
  { name: "小北", amountMinor: 10_000, appointmentCount: 1 },
];

describe("RevenueBreakdownChart", () => {
  it("renders every item in a horizontally scrollable bar chart", () => {
    const wrapper = mount(RevenueBreakdownChart, {
      props: { items, chartType: "bar", dimensionLabel: "收款对象" },
    });
    const option = wrapper.findComponent({ name: "VChart" }).props("option") as {
      yAxis: { data: string[] };
      series: Array<{ type: string; data: Array<{ value: number; appointmentCount: number }> }>;
    };

    expect(option.series[0]?.type).toBe("bar");
    expect(option.yAxis.data).toEqual(["小北", "很长的联系人名称用于验证完整图例"]);
    expect(option.series[0]?.data).toEqual([
      expect.objectContaining({ value: 10_000, appointmentCount: 1 }),
      expect.objectContaining({ value: 20_000, appointmentCount: 2 }),
    ]);
    expect(wrapper.find(".breakdown-chart__bar-scroll").exists()).toBe(true);
    expect(wrapper.get('[role="img"]').attributes("aria-label")).toContain("收款对象横向柱状图");
    expect(wrapper.findAll(".breakdown-chart__accessible-list li")).toHaveLength(items.length);
  });

  it("renders every pie slice and a scrollable amount, count, and percentage legend", () => {
    const wrapper = mount(RevenueBreakdownChart, {
      props: { items, chartType: "pie", dimensionLabel: "收款渠道" },
    });
    const option = wrapper.findComponent({ name: "VChart" }).props("option") as {
      series: Array<{
        type: string;
        data: Array<{ name: string; value: number; appointmentCount: number }>;
      }>;
    };

    expect(option.series[0]?.type).toBe("pie");
    expect(option.series[0]?.data).toEqual([
      { name: items[0]?.name, value: 20_000, appointmentCount: 2 },
      { name: "小北", value: 10_000, appointmentCount: 1 },
    ]);
    const legendRows = wrapper.findAll(".breakdown-chart__legend-row");
    expect(legendRows).toHaveLength(items.length);
    expect(legendRows[0]?.text()).toContain("2 笔");
    expect(legendRows[0]?.text()).toContain("66.7%");
    expect(legendRows[1]?.text()).toContain("¥100");
  });
});
