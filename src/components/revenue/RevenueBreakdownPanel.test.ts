// @vitest-environment jsdom

import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { RevenueBreakdownItem } from "../../types/domain";
import RevenueBreakdownPanel from "./RevenueBreakdownPanel.vue";

const RevenueBreakdownChartStub = defineComponent({
  name: "RevenueBreakdownChart",
  props: {
    items: { type: Array, required: true },
    chartType: { type: String, required: true },
    dimensionLabel: { type: String, required: true },
  },
  setup: (props) => () =>
    h("div", {
      class: "breakdown-chart-stub",
      "data-chart-type": props.chartType,
      "data-dimension": props.dimensionLabel,
      "data-items": props.items.length,
    }),
});

const paymentMethods: RevenueBreakdownItem[] = [
  { name: "微信", amountMinor: 20_000, appointmentCount: 2 },
  { name: "支付宝", amountMinor: 10_000, appointmentCount: 1 },
];
const contacts: RevenueBreakdownItem[] = [
  { name: "南枝", amountMinor: 18_000, appointmentCount: 2 },
  { name: "小北", amountMinor: 12_000, appointmentCount: 1 },
];

function mountPanel(overrides: Partial<InstanceType<typeof RevenueBreakdownPanel>["$props"]> = {}) {
  return mount(RevenueBreakdownPanel, {
    props: {
      from: "2026-08-03",
      to: "2026-08-09",
      paymentMethods,
      contacts,
      ...overrides,
    },
    global: { stubs: { RevenueBreakdownChart: RevenueBreakdownChartStub } },
  });
}

describe("RevenueBreakdownPanel", () => {
  it("defaults to payment methods in a bar chart", () => {
    const wrapper = mountPanel();
    const chart = wrapper.getComponent(RevenueBreakdownChartStub);

    expect(wrapper.get("h2").text()).toBe("收款渠道");
    expect(chart.props()).toMatchObject({
      items: paymentMethods,
      chartType: "bar",
      dimensionLabel: "收款渠道",
    });
    expect(
      wrapper
        .findAll('[aria-label="收款分析维度"] button')
        .find((button) => button.text() === "收款渠道")
        ?.attributes("aria-pressed"),
    ).toBe("true");
    expect(
      wrapper
        .findAll('[aria-label="图表类型"] button')
        .find((button) => button.text() === "柱状")
        ?.attributes("aria-pressed"),
    ).toBe("true");
  });

  it("switches contacts and chart types without mutating the source data", async () => {
    const wrapper = mountPanel();
    const contactButton = wrapper
      .findAll('[aria-label="收款分析维度"] button')
      .find((button) => button.text() === "收款对象");
    const pieButton = wrapper
      .findAll('[aria-label="图表类型"] button')
      .find((button) => button.text() === "饼图");
    if (!contactButton || !pieButton) throw new Error("收款分析切换按钮未完整渲染");

    await contactButton.trigger("click");
    await pieButton.trigger("click");

    expect(wrapper.get("h2").text()).toBe("收款对象");
    expect(wrapper.getComponent(RevenueBreakdownChartStub).props()).toMatchObject({
      items: contacts,
      chartType: "pie",
      dimensionLabel: "收款对象",
    });
    expect(contactButton.attributes("aria-pressed")).toBe("true");
    expect(pieButton.attributes("aria-pressed")).toBe("true");
    expect(paymentMethods).toHaveLength(2);
    expect(contacts).toHaveLength(2);
  });

  it("passes compacted payment-method and contact data to both chart types", async () => {
    const wrapper = mountPanel({
      paymentMethods: [
        { name: "微信", amountMinor: 10_000, appointmentCount: 3 },
        { name: "零散渠道", amountMinor: 99, appointmentCount: 2 },
        { name: "零额渠道", amountMinor: 0, appointmentCount: 1 },
      ],
      contacts: [
        { name: "南枝", amountMinor: 20_000, appointmentCount: 4 },
        { name: "其他", amountMinor: 100, appointmentCount: 1 },
        { name: "临时联系人", amountMinor: 100, appointmentCount: 2 },
        { name: "零额联系人", amountMinor: 0, appointmentCount: 1 },
      ],
    });

    expect(wrapper.getComponent(RevenueBreakdownChartStub).props("items")).toEqual([
      { name: "微信", amountMinor: 10_000, appointmentCount: 3 },
      { name: "其他", amountMinor: 99, appointmentCount: 2 },
    ]);

    const contactButton = wrapper
      .findAll('[aria-label="收款分析维度"] button')
      .find((button) => button.text() === "收款对象");
    const pieButton = wrapper
      .findAll('[aria-label="图表类型"] button')
      .find((button) => button.text() === "饼图");
    if (!contactButton || !pieButton) throw new Error("收款分析切换按钮未完整渲染");

    await contactButton.trigger("click");
    await pieButton.trigger("click");

    expect(wrapper.getComponent(RevenueBreakdownChartStub).props()).toMatchObject({
      items: [
        { name: "南枝", amountMinor: 20_000, appointmentCount: 4 },
        { name: "其他", amountMinor: 200, appointmentCount: 3 },
      ],
      chartType: "pie",
      dimensionLabel: "收款对象",
    });
  });

  it("shows the empty state when all selected amounts are zero", async () => {
    const zeroContacts = [
      { name: "零额一", amountMinor: 0, appointmentCount: 2 },
      { name: "零额二", amountMinor: 0, appointmentCount: 1 },
    ];
    const wrapper = mountPanel({ contacts: zeroContacts });
    const contactButton = wrapper
      .findAll('[aria-label="收款分析维度"] button')
      .find((button) => button.text() === "收款对象");
    if (!contactButton) throw new Error("未找到收款对象按钮");

    await contactButton.trigger("click");

    expect(wrapper.findComponent(RevenueBreakdownChartStub).exists()).toBe(false);
    expect(wrapper.get(".breakdown-panel__empty").text()).toBe("当前范围暂无已结收入");
    expect(wrapper.text()).not.toContain("零额一");
  });

  it("shows an empty state when the selected dimension has no settled data", () => {
    const wrapper = mountPanel({ paymentMethods: [], contacts: [] });

    expect(wrapper.findComponent(RevenueBreakdownChartStub).exists()).toBe(false);
    expect(wrapper.get(".breakdown-panel__empty").text()).toBe("当前范围暂无已结收入");
  });
});
