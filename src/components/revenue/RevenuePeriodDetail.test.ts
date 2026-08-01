// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { RevenueSummary } from "../../types/domain";
import RevenuePeriodDetail from "./RevenuePeriodDetail.vue";

const summary: RevenueSummary = {
  from: "2026-07-27",
  to: "2026-08-02",
  settledMinor: 12_000,
  unsettledMinor: 5_000,
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
      businessHours: 2,
      appointmentCount: 1,
    },
    {
      period: "2026-08-01",
      settledMinor: 0,
      unsettledMinor: 5_000,
      businessHours: 1.5,
      appointmentCount: 1,
    },
  ],
};

describe("RevenuePeriodDetail", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the selected period as a daily breakdown and closes without changing it", async () => {
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
    expect(wrapper.findAll("tbody tr").map((row) => row.text())).toEqual([
      expect.stringContaining("7月29日"),
      expect.stringContaining("8月1日"),
    ]);

    await wrapper.get('button[aria-label="关闭"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
