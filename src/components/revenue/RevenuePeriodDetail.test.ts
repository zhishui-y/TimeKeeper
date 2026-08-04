// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { RevenueSummary } from "../../types/domain";
import RevenuePeriodDetail from "./RevenuePeriodDetail.vue";

const summary: RevenueSummary = {
  from: "2026-07-27",
  to: "2026-08-02",
  settledMinor: 12_000,
  unsettledMinor: 5_000,
  pendingCount: 1,
  businessHours: 3.5,
  averageHourlyMinor: 3_429,
  appointmentCount: 2,
  completedCount: 1,
  paymentMethods: [{ name: "微信", amountMinor: 12_000 }],
  points: [
    {
      period: "2026-07-29",
      settledMinor: 12_000,
      unsettledMinor: 0,
      pendingCount: 0,
      businessHours: 2,
      appointmentCount: 1,
    },
    {
      period: "2026-08-01",
      settledMinor: 0,
      unsettledMinor: 5_000,
      pendingCount: 1,
      businessHours: 1.5,
      appointmentCount: 1,
    },
  ],
};

describe("RevenuePeriodDetail", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("drills from a period into a day and returns without changing the parent range", async () => {
    const wrapper = mount(RevenuePeriodDetail, {
      props: {
        granularity: "week",
        from: summary.from,
        to: summary.to,
        summary,
        loading: false,
        error: null,
        appointments: [],
        appointmentsLoading: false,
        appointmentsError: null,
      },
      global: { stubs: { Teleport: true } },
    });

    expect(wrapper.get('[role="dialog"]').attributes("aria-modal")).toBe("true");
    expect(wrapper.get("#period-detail-title").text()).toBe("周收入明细");
    expect(wrapper.text()).toContain("2026年7月27日 — 2026年8月2日");
    expect(wrapper.text()).not.toContain("待结金额");
    expect(wrapper.get(".detail-summary").text()).toContain("待结场次1场");
    expect(wrapper.get(".daily-table__head").text()).toContain("待结场次");
    expect(wrapper.findAll(".daily-table__row")[1]!.text()).toContain("1场");
    expect(wrapper.findAll(".daily-table__row").map((row) => row.text())).toEqual([
      expect.stringContaining("7月29日"),
      expect.stringContaining("8月1日"),
    ]);

    await wrapper.findAll(".daily-table__row")[1]!.trigger("click");

    expect(wrapper.emitted("daySelect")?.[0]?.[0]).toEqual(summary.points[1]);
    expect(wrapper.get("#period-detail-title").text()).toBe("当日预约明细");
    expect(wrapper.text()).toContain("2026年8月1日");
    expect(wrapper.get(".detail-summary").text()).toContain("待结场次1场");
    expect(wrapper.get("h3").text()).toBe("当日业务预约");

    await wrapper.get('button[aria-label="返回周收入明细"]').trigger("click");
    expect(wrapper.emitted("dayBack")).toHaveLength(1);
    expect(wrapper.get("#period-detail-title").text()).toBe("周收入明细");

    await wrapper.get('button[aria-label="关闭"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("closes with Escape and restores focus when the parent removes the detail", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "打开收入明细";
    document.body.append(trigger);
    trigger.focus();

    const wrapper = mount(RevenuePeriodDetail, {
      attachTo: document.body,
      props: {
        granularity: "month",
        from: summary.from,
        to: summary.to,
        summary,
        loading: false,
        error: null,
        appointments: [],
        appointmentsLoading: false,
        appointmentsError: null,
      },
      global: { stubs: { Teleport: true } },
    });
    await flushPromises();

    expect(wrapper.get('button[aria-label="关闭"]').element).toBe(document.activeElement);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(wrapper.emitted("close")).toHaveLength(1);

    wrapper.unmount();
    expect(document.activeElement).toBe(trigger);
  });
});
