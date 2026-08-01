// @vitest-environment jsdom

import { createPinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../api/mockClient";
import { useUiStore } from "../../stores/ui";
import type { Appointment } from "../../types/domain";
import TodayWorkspace from "./TodayWorkspace.vue";

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: "appointment-1",
    serviceDate: "2026-07-20",
    startsAt: "2026-07-20T14:00:00+08:00",
    endsAt: "2026-07-20T15:00:00+08:00",
    contactName: "小北",
    mode: "business",
    serviceStatus: "scheduled",
    settlementStatus: "unsettled",
    amountMinor: 0,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

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
      pendingCount: 3,
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

    expect(wrapper.get(".metric--pending span").text()).toBe("待结场次");
    expect(wrapper.get(".metric--pending strong").text()).toBe("3");
    expect(wrapper.get(".metric--pending small").text()).toBe("已完成但未结算");
    expect(wrapper.get(".metric--next strong").text()).toBe("待定时段");
    expect(wrapper.get(".metric--next small").text()).toContain("待定联系人");

    wrapper.unmount();
  });

  it("sorts every day and today's list from early to late with pending times last", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 20, 12, 0, 0));
    vi.spyOn(mockApi, "listAppointments").mockResolvedValue([
      appointment({
        id: "late",
        startsAt: "2026-07-20T20:30:00+08:00",
        endsAt: "2026-07-20T22:30:00+08:00",
      }),
      appointment({ id: "pending", startsAt: null, endsAt: null }),
      appointment({
        id: "early",
        startsAt: "2026-07-20T13:30:00+08:00",
        endsAt: "2026-07-20T14:30:00+08:00",
      }),
    ]);
    vi.spyOn(mockApi, "getDashboardSummary").mockResolvedValue({
      todaySettledMinor: 0,
      weekSettledMinor: 0,
      pendingCount: 0,
      nextAppointment: null,
    });

    const wrapper = mount(TodayWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    expect(
      wrapper.findAll(".week-day.is-today .schedule-chip__time").map((item) => item.text()),
    ).toEqual(["13:30", "20:30", "待定"]);
    expect(wrapper.findAll(".appointment-row__time").map((item) => item.text())).toEqual([
      "13:30–14:30",
      "20:30–22:30",
      "待定时段",
    ]);
    expect(wrapper.get(".week-day.is-today .schedule-chip--next .schedule-chip__time").text()).toBe(
      "13:30",
    );
    expect(wrapper.get(".appointment-row--next .appointment-row__time").text()).toBe("13:30–14:30");
    expect(wrapper.get(".appointment-row--next .appointment-row__next").text()).toBe("下一时段");

    wrapper.unmount();
  });

  it("opens completed unsettled appointments with the settlement focus intent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 20, 12, 0, 0));
    const target = appointment({
      id: "appointment-to-settle",
      serviceStatus: "completed",
      settlementStatus: "unsettled",
      amountMinor: 18_000,
    });
    vi.spyOn(mockApi, "listAppointments").mockResolvedValue([target]);
    vi.spyOn(mockApi, "getDashboardSummary").mockResolvedValue({
      todaySettledMinor: 0,
      weekSettledMinor: 0,
      pendingCount: 1,
      nextAppointment: null,
    });
    const pinia = createPinia();
    const ui = useUiStore(pinia);
    const wrapper = mount(TodayWorkspace, {
      global: { plugins: [pinia] },
    });
    await flushPromises();

    await wrapper.get('button[aria-label="编辑结算"]').trigger("click");

    expect(ui.activeAppointment?.id).toBe(target.id);
    expect(ui.appointmentDrawerInitialFocus).toBe("amount");
    wrapper.unmount();
  });
});
