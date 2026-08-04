// @vitest-environment jsdom

import { createPinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../api/mockClient";
import { useUiStore } from "../../stores/ui";
import type { Appointment } from "../../types/domain";
import TodayWorkspace from "./TodayWorkspace.vue";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPush }),
}));

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
    routerPush.mockReset();
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

    const pendingMetric = wrapper.get('button[aria-label="查看待结算预约"]');
    expect(pendingMetric.get("span").text()).toBe("待结场次");
    expect(pendingMetric.get("strong").text()).toBe("3");
    expect(pendingMetric.get("small").text()).toBe("已完成但未结算");
    await pendingMetric.trigger("click");
    expect(routerPush).toHaveBeenCalledWith({
      name: "appointments",
      query: { progressStatus: "pending_settlement" },
    });
    expect(wrapper.get(".metric--next strong").text()).toBe("待定时段");
    expect(wrapper.get(".metric--next small").text()).toContain("待定联系人");

    wrapper.unmount();
  });

  it("does not render a duplicate appointment creation button in the lead section", async () => {
    vi.spyOn(mockApi, "listAppointments").mockResolvedValue([]);
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

    expect(wrapper.find(".today-lead__create").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("记一笔预约");

    wrapper.unmount();
  });

  it("labels an automatically started appointment as in progress", async () => {
    vi.spyOn(mockApi, "listAppointments").mockResolvedValue([]);
    vi.spyOn(mockApi, "getDashboardSummary").mockResolvedValue({
      todaySettledMinor: 0,
      weekSettledMinor: 0,
      pendingCount: 0,
      nextAppointment: appointment({
        id: "in-progress-next",
        serviceStatus: "in_progress",
      }),
    });

    const wrapper = mount(TodayWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    expect(wrapper.get(".metric--next strong").text()).toBe("进行中");

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

  it("shows the selected weekday's appointments in the lower schedule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 20, 12, 0, 0));
    vi.spyOn(mockApi, "listAppointments").mockResolvedValue([
      appointment({ id: "monday", contactName: "周一预约" }),
      appointment({
        id: "tuesday",
        serviceDate: "2026-07-21",
        startsAt: "2026-07-21T16:00:00+08:00",
        endsAt: "2026-07-21T18:00:00+08:00",
        contactName: "周二预约",
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

    const dayHeadings = wrapper.findAll(".week-day__heading");
    await dayHeadings[1]?.trigger("click");

    expect(wrapper.get(".today-list__header .section-kicker").text()).toBe("当日安排");
    expect(wrapper.get(".today-list__header h2").text()).toContain("7月21日");
    expect(wrapper.findAll(".appointment-row__title strong").map((item) => item.text())).toEqual([
      "周二预约",
    ]);
    expect(wrapper.find(".appointment-row--next").exists()).toBe(false);
    expect(wrapper.find(".week-day.is-today .schedule-chip--next").exists()).toBe(true);
    expect(wrapper.findAll(".week-day")[1]?.classes()).toContain("is-selected");

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

  it("copies account and YY metadata without opening a secondary password flow", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 20, 12, 0, 0));
    const target = appointment({
      id: "metadata-copy",
      account: {
        source: "embedded",
        specialization: "莫问",
        gearScore: "794676",
        server: "梦江南",
        accountName: "demo-account",
        password: "demo-secret",
      },
      voicePlatform: "yy",
      voiceChannel: "27364886",
    });
    vi.spyOn(mockApi, "listAppointments").mockResolvedValue([target]);
    vi.spyOn(mockApi, "getDashboardSummary").mockResolvedValue({
      todaySettledMinor: 0,
      weekSettledMinor: 0,
      pendingCount: 0,
      nextAppointment: null,
    });
    const copyAccount = vi.spyOn(mockApi, "copyAppointmentAccountName").mockResolvedValue();
    const copyVoice = vi.spyOn(mockApi, "copyAppointmentVoiceChannel").mockResolvedValue();
    const pinia = createPinia();
    const wrapper = mount(TodayWorkspace, { global: { plugins: [pinia] } });
    await flushPromises();

    await wrapper.get('button[aria-label="复制账号 demo-account"]').trigger("click");
    await flushPromises();
    expect(copyAccount).toHaveBeenCalledWith(target.id);
    expect(useUiStore(pinia).toast?.message).toBe("账号已复制");

    await wrapper.get('button[aria-label="复制YY频道 27364886"]').trigger("click");
    await flushPromises();
    expect(copyVoice).toHaveBeenCalledWith(target.id);
    expect(useUiStore(pinia).toast?.message).toBe("YY频道号已复制");
    wrapper.unmount();
  });

  it("shows metadata copy errors without opening a secondary password flow", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 20, 12, 0, 0));
    const target = appointment({
      id: "metadata-copy-error",
      account: {
        source: "embedded",
        specialization: "莫问",
        gearScore: "794676",
        server: "梦江南",
        accountName: "demo-account",
        password: null,
      },
      voicePlatform: "yy",
      voiceChannel: "27364886",
    });
    vi.spyOn(mockApi, "listAppointments").mockResolvedValue([target]);
    vi.spyOn(mockApi, "getDashboardSummary").mockResolvedValue({
      todaySettledMinor: 0,
      weekSettledMinor: 0,
      pendingCount: 0,
      nextAppointment: null,
    });
    vi.spyOn(mockApi, "copyAppointmentAccountName").mockRejectedValue(new Error("账号复制失败"));
    vi.spyOn(mockApi, "copyAppointmentVoiceChannel").mockRejectedValue(new Error("YY频道复制失败"));
    const pinia = createPinia();
    const wrapper = mount(TodayWorkspace, { global: { plugins: [pinia] } });
    await flushPromises();

    await wrapper.get('button[aria-label="复制账号 demo-account"]').trigger("click");
    await flushPromises();
    expect(useUiStore(pinia).toast?.message).toBe("账号复制失败");

    await wrapper.get('button[aria-label="复制YY频道 27364886"]').trigger("click");
    await flushPromises();
    expect(useUiStore(pinia).toast?.message).toBe("YY频道复制失败");
    wrapper.unmount();
  });

  it("confirms and deletes an appointment from the lower schedule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 20, 12, 0, 0));
    const target = appointment({ id: "appointment-to-delete", contactName: "待删除联系人" });
    vi.spyOn(mockApi, "listAppointments").mockResolvedValue([target]);
    vi.spyOn(mockApi, "getDashboardSummary").mockResolvedValue({
      todaySettledMinor: 0,
      weekSettledMinor: 0,
      pendingCount: 0,
      nextAppointment: null,
    });
    const remove = vi.spyOn(mockApi, "deleteAppointment").mockResolvedValue();
    const confirm = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const wrapper = mount(TodayWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    const actionLabels = wrapper
      .findAll(".appointment-row__actions button")
      .map((button) => button.attributes("aria-label"));
    expect(actionLabels.slice(-2)).toEqual(["编辑预约", "删除预约"]);
    await wrapper.get('button[aria-label="删除预约"]').trigger("click");
    await flushPromises();

    expect(confirm).toHaveBeenCalledWith("确定永久删除 待删除联系人 的这条预约吗？");
    expect(remove).toHaveBeenCalledWith(target.id);
    wrapper.unmount();
  });
});
