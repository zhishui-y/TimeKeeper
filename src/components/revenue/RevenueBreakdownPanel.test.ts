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
    selectable: { type: Boolean, default: false },
  },
  emits: ["itemSelect"],
  setup: (props) => () =>
    h("div", {
      class: "breakdown-chart-stub",
      "data-chart-type": props.chartType,
      "data-dimension": props.dimensionLabel,
      "data-items": props.items.length,
      "data-selectable": props.selectable,
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
  it("defaults to contacts in a pie chart", () => {
    const wrapper = mountPanel();
    const chart = wrapper.getComponent(RevenueBreakdownChartStub);

    expect(wrapper.get("h2").text()).toBe("收款对象");
    expect(chart.props()).toMatchObject({
      items: contacts,
      chartType: "pie",
      dimensionLabel: "收款对象",
      selectable: true,
    });
    expect(
      wrapper
        .findAll('[aria-label="收款分析维度"] button')
        .find((button) => button.text() === "收款对象")
        ?.attributes("aria-pressed"),
    ).toBe("true");
    expect(
      wrapper
        .findAll('[aria-label="图表类型"] button')
        .find((button) => button.text() === "饼图")
        ?.attributes("aria-pressed"),
    ).toBe("true");
  });

  it("switches payment methods and chart types without mutating the source data", async () => {
    const wrapper = mountPanel();
    const paymentMethodButton = wrapper
      .findAll('[aria-label="收款分析维度"] button')
      .find((button) => button.text() === "收款渠道");
    const barButton = wrapper
      .findAll('[aria-label="图表类型"] button')
      .find((button) => button.text() === "柱状");
    if (!paymentMethodButton || !barButton) throw new Error("收款分析切换按钮未完整渲染");

    await paymentMethodButton.trigger("click");
    await barButton.trigger("click");

    expect(wrapper.get("h2").text()).toBe("收款渠道");
    expect(wrapper.getComponent(RevenueBreakdownChartStub).props()).toMatchObject({
      items: paymentMethods,
      chartType: "bar",
      dimensionLabel: "收款渠道",
    });
    expect(paymentMethodButton.attributes("aria-pressed")).toBe("true");
    expect(barButton.attributes("aria-pressed")).toBe("true");
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
      { name: "南枝", amountMinor: 20_000, appointmentCount: 4, memberNames: ["南枝"] },
      {
        name: "其他",
        amountMinor: 200,
        appointmentCount: 3,
        memberNames: ["其他", "临时联系人"],
      },
    ]);

    const paymentMethodButton = wrapper
      .findAll('[aria-label="收款分析维度"] button')
      .find((button) => button.text() === "收款渠道");
    const barButton = wrapper
      .findAll('[aria-label="图表类型"] button')
      .find((button) => button.text() === "柱状");
    if (!paymentMethodButton || !barButton) throw new Error("收款分析切换按钮未完整渲染");

    await paymentMethodButton.trigger("click");
    await barButton.trigger("click");

    expect(wrapper.getComponent(RevenueBreakdownChartStub).props()).toMatchObject({
      items: [
        { name: "微信", amountMinor: 10_000, appointmentCount: 3 },
        { name: "其他", amountMinor: 99, appointmentCount: 2 },
      ],
      chartType: "bar",
      dimensionLabel: "收款渠道",
      selectable: false,
    });
  });

  it("emits compacted contacts but never drills into payment methods", async () => {
    const wrapper = mountPanel({
      contacts: [
        { name: "南枝", amountMinor: 10_000, appointmentCount: 2 },
        { name: "临时对象", amountMinor: 50, appointmentCount: 1 },
      ],
    });
    wrapper.getComponent(RevenueBreakdownChartStub).vm.$emit("itemSelect", "其他");
    expect(wrapper.emitted("itemSelect")?.[0]?.[0]).toEqual({
      name: "其他",
      amountMinor: 50,
      appointmentCount: 1,
      memberNames: ["临时对象"],
    });

    const paymentMethodButton = wrapper
      .findAll('[aria-label="收款分析维度"] button')
      .find((button) => button.text() === "收款渠道");
    if (!paymentMethodButton) throw new Error("未找到收款渠道按钮");
    await paymentMethodButton.trigger("click");
    wrapper.getComponent(RevenueBreakdownChartStub).vm.$emit("itemSelect", "微信");
    expect(wrapper.emitted("itemSelect")).toHaveLength(1);
  });

  it("shows the empty state when all default contact amounts are zero", () => {
    const zeroContacts = [
      { name: "零额一", amountMinor: 0, appointmentCount: 2 },
      { name: "零额二", amountMinor: 0, appointmentCount: 1 },
    ];
    const wrapper = mountPanel({ contacts: zeroContacts });

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
