// @vitest-environment jsdom

import { createPinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../api/mockClient";
import TodayWorkspace from "./TodayWorkspace.vue";

describe("TodayWorkspace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("refreshes the date, week range, and dashboard after midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 19, 23, 59, 50));
    const listAppointments = vi.spyOn(mockApi, "listAppointments");
    const getDashboardSummary = vi.spyOn(mockApi, "getDashboardSummary");

    const wrapper = mount(TodayWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    expect(wrapper.get(".today-lead__date h2").text()).toContain("7月19日");
    expect(listAppointments).toHaveBeenCalledWith({
      from: "2026-07-13",
      to: "2026-07-19",
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await flushPromises();

    expect(wrapper.get(".today-lead__date h2").text()).toContain("7月20日");
    expect(listAppointments).toHaveBeenLastCalledWith({
      from: "2026-07-20",
      to: "2026-07-26",
    });
    expect(getDashboardSummary).toHaveBeenLastCalledWith("2026-07-20");

    wrapper.unmount();
  });

  it("labels a date-only next appointment as pending time instead of empty", async () => {
    vi.spyOn(mockApi, "listAppointments").mockResolvedValue([]);
    vi.spyOn(mockApi, "getDashboardSummary").mockResolvedValue({
      todaySettledMinor: 0,
      weekSettledMinor: 0,
      pendingMinor: 8_800,
      nextAppointment: {
        id: "date-only-next",
        serviceDate: "2026-07-20",
        startsAt: null,
        endsAt: null,
        contactName: "待定联系人",
        mode: "business",
        serviceStatus: "scheduled",
        settlementStatus: "unsettled",
        amountMinor: 8_800,
        createdAt: "2026-07-20T08:00:00Z",
        updatedAt: "2026-07-20T08:00:00Z",
      },
    });

    const wrapper = mount(TodayWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    expect(wrapper.get(".metric--next strong").text()).toBe("待定时段");
    expect(wrapper.get(".metric--next small").text()).toContain("待定联系人");

    wrapper.unmount();
  });
});
