// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { RevenueAnalyticsReport } from "../../../types/domain";
import RevenueReportDialog from "./RevenueReportDialog.vue";

function analyticsReport(appointmentCount = 4): RevenueAnalyticsReport {
  const day = (date: string, weekday: number, inRange = true) => ({
    date,
    weekday,
    inRange,
    settledMinor: weekday === 1 ? 10_000 : 0,
    unsettledMinor: weekday === 2 ? 5_000 : 0,
    pendingCount: weekday === 2 ? 1 : 0,
    businessMinutes: weekday <= 2 ? 120 : 0,
    appointmentCount: weekday <= 2 ? 2 : 0,
    completedCount: weekday <= 2 ? 1 : 0,
  });
  return {
    from: "2026-08-03",
    to: "2026-08-09",
    overview: {
      settledMinor: appointmentCount ? 10_000 : 0,
      unsettledMinor: appointmentCount ? 5_000 : 0,
      pendingCount: appointmentCount ? 1 : 0,
      businessMinutes: appointmentCount ? 240 : 0,
      averageHourlyMinor: appointmentCount ? 2_500 : 0,
      appointmentCount,
      completedCount: appointmentCount ? 2 : 0,
    },
    weeks: [
      {
        from: "2026-08-03",
        to: "2026-08-09",
        settledMinor: appointmentCount ? 10_000 : 0,
        unsettledMinor: appointmentCount ? 5_000 : 0,
        pendingCount: appointmentCount ? 1 : 0,
        businessMinutes: appointmentCount ? 240 : 0,
        appointmentCount,
        completedCount: appointmentCount ? 2 : 0,
        days: Array.from({ length: 7 }, (_, index) =>
          day(`2026-08-${String(index + 3).padStart(2, "0")}`, index + 1),
        ),
      },
    ],
    weekdays: Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      label: `周${"一二三四五六日"[index]}`,
      settledMinor: index === 0 && appointmentCount ? 10_000 : 0,
      unsettledMinor: index === 1 && appointmentCount ? 5_000 : 0,
      pendingCount: index === 1 && appointmentCount ? 1 : 0,
      businessMinutes: index < 2 && appointmentCount ? 120 : 0,
      appointmentCount: index < 2 && appointmentCount ? 2 : 0,
      completedCount: index < 2 && appointmentCount ? 1 : 0,
    })),
    hours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      businessMinutes: hour === 20 && appointmentCount ? 120 : 0,
      appointmentCount: hour === 20 && appointmentCount ? 2 : 0,
    })),
    contacts: Array.from({ length: appointmentCount ? 12 : 0 }, (_, index) => ({
      name: `顾客${index + 1}`,
      settledMinor: 1_200 - index * 100,
      revenueShareBps: 100,
      appointmentCount: 1,
      settledCount: 1,
      completedCount: 1,
      businessMinutes: 60,
      averageTicketMinor: 1_200 - index * 100,
    })),
    paymentMethods: appointmentCount
      ? [{ name: "微信", amountMinor: 10_000, appointmentCount: 2 }]
      : [],
  };
}

function mountDialog(props: Partial<InstanceType<typeof RevenueReportDialog>["$props"]> = {}) {
  return mount(RevenueReportDialog, {
    attachTo: document.body,
    props: {
      report: analyticsReport(),
      loading: false,
      error: null,
      ...props,
    },
    global: { stubs: { Teleport: true } },
  });
}

describe("RevenueReportDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders every analysis section and compacts contacts after the top ten", () => {
    const wrapper = mountDialog();

    expect(wrapper.get('[role="dialog"]').attributes("aria-labelledby")).toBe(
      "analytics-report-title",
    );
    expect(wrapper.text()).toContain("经营总览");
    expect(wrapper.text()).toContain("逐周与每日情况");
    expect(wrapper.text()).toContain("星期分布");
    expect(wrapper.text()).toContain("24 小时工作热力");
    expect(wrapper.text()).toContain("顾客贡献与收款方式");
    expect(wrapper.findAll(".hour-report__grid article")).toHaveLength(24);
    expect(wrapper.text()).toContain("顾客10");
    expect(wrapper.text()).toContain("其他 2 位");
    expect(wrapper.text()).not.toContain("顾客11");
    expect(wrapper.text()).toContain("统计口径");
  });

  it("covers loading, error, retry, stale, and empty states", async () => {
    const loading = mountDialog({ report: null, loading: true });
    expect(loading.get('[role="status"]').text()).toContain("正在生成经营数据报表");
    loading.unmount();

    const error = mountDialog({ report: null, error: "生成失败" });
    expect(error.get('[role="alert"]').text()).toContain("生成失败");
    await error.get('[role="alert"] button').trigger("click");
    expect(error.emitted("retry")).toHaveLength(1);
    error.unmount();

    const stale = mountDialog({ stale: true });
    expect(stale.get('[role="status"]').text()).toContain("旧数据不会用于当前分析");
    expect(stale.find(".report-overview").exists()).toBe(false);
    stale.unmount();

    const empty = mountDialog({ report: analyticsReport(0) });
    expect(empty.text()).toContain("暂无未取消的业务预约");
    expect(empty.findAll(".hour-report__grid article")).toHaveLength(24);
    expect(empty.findAll(".weekday-report__rows article")).toHaveLength(7);
  });

  it("closes with Escape and restores focus to the generate button", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const wrapper = mountDialog({ restoreFocusElement: trigger });
    await flushPromises();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
    expect(document.activeElement).toBe(trigger);
  });
});
