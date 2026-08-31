// @vitest-environment jsdom

import { createPinia } from "pinia";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../api/mockClient";
import { useUiStore } from "../../stores/ui";
import type {
  Appointment,
  ReportGranularity,
  RevenueAnalyticsReport,
  RevenueSummary,
} from "../../types/domain";
import RevenueDashboard from "./RevenueDashboard.vue";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPush }),
}));

const RevenueChartStub = defineComponent({
  name: "RevenueChart",
  props: {
    points: { type: Array, default: () => [] },
    granularity: { type: String, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    drillable: { type: Boolean, default: false },
  },
  emits: ["periodSelect"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "revenue-chart-stub",
          type: "button",
          onClick: () => emit("periodSelect", props.points[0] ?? { period: "2026-07-27" }),
        },
        String(props.drillable),
      );
  },
});

const RevenuePeriodDetailStub = defineComponent({
  name: "RevenuePeriodDetail",
  props: ["granularity", "from", "to", "appointments", "suspended"],
  emits: ["close", "daySelect", "appointmentSelect"],
  setup(props, { emit }) {
    return () =>
      h(
        "div",
        {
          class: "period-detail-stub",
          "data-granularity": props.granularity,
          "data-appointments": props.appointments.length,
          "data-suspended": String(props.suspended),
        },
        [
          `${props.from}—${props.to}`,
          h(
            "button",
            {
              class: "period-appointment-select",
              onClick: () => emit("appointmentSelect", dashboardAppointment),
            },
            "编辑预约",
          ),
        ],
      );
  },
});

const RevenueBreakdownPanelStub = defineComponent({
  name: "RevenueBreakdownPanel",
  props: ["from", "to", "paymentMethods", "contacts"],
  emits: ["itemSelect"],
  setup:
    (props, { emit }) =>
    () =>
      h(
        "button",
        {
          class: "breakdown-panel-stub",
          "data-from": props.from,
          "data-to": props.to,
          "data-payment-methods": props.paymentMethods.length,
          "data-contacts": props.contacts.length,
          onClick: () =>
            emit("itemSelect", {
              name: "其他",
              amountMinor: 20_000,
              appointmentCount: 3,
              memberNames: ["南枝", "小北"],
            }),
        },
        "收款对象",
      ),
});

const RevenueContactDetailStub = defineComponent({
  name: "RevenueContactDetail",
  props: ["item", "from", "to", "appointments", "loading", "error", "stale", "suspended"],
  emits: ["close", "appointmentSelect"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "contact-detail-stub",
          "data-appointments": props.appointments.length,
          "data-suspended": String(props.suspended),
          onClick: () => emit("appointmentSelect", dashboardAppointment),
        },
        props.item.name,
      );
  },
});

const RevenueReportDialogStub = defineComponent({
  name: "RevenueReportDialog",
  props: ["report", "loading", "error", "stale", "restoreFocusElement"],
  emits: ["close", "retry"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "analytics-report-stub",
          "data-from": props.report?.from ?? "",
          "data-loading": String(props.loading),
          onClick: () => emit("close"),
        },
        "经营数据报表",
      );
  },
});

const dashboardAppointment: Appointment = {
  id: "dashboard-appointment",
  serviceDate: "2026-07-27",
  contactName: "南枝",
  mode: "business",
  serviceStatus: "completed",
  settlementStatus: "settled",
  amountMinor: 20_000,
  createdAt: "2026-07-27T00:00:00Z",
  updatedAt: "2026-07-27T00:00:00Z",
};

function revenueSummary(from: string, to: string, granularity: ReportGranularity): RevenueSummary {
  return {
    from,
    to,
    settledMinor: 20_000,
    unsettledMinor: 8_000,
    pendingCount: 2,
    businessHours: 4,
    averageHourlyMinor: 5_000,
    appointmentCount: 4,
    completedCount: 3,
    paymentMethods: [{ name: "微信", amountMinor: 20_000, appointmentCount: 3 }],
    contacts: [{ name: "南枝", amountMinor: 20_000, appointmentCount: 3 }],
    points: [
      {
        period: granularity === "month" ? from.slice(0, 7) : from,
        settledMinor: 20_000,
        unsettledMinor: 8_000,
        pendingCount: 2,
        businessHours: 4,
        appointmentCount: 4,
      },
    ],
  };
}

function analyticsReport(from: string, to: string): RevenueAnalyticsReport {
  return {
    from,
    to,
    overview: {
      settledMinor: 20_000,
      unsettledMinor: 8_000,
      pendingCount: 2,
      businessMinutes: 240,
      averageHourlyMinor: 5_000,
      appointmentCount: 4,
      completedCount: 3,
    },
    weeks: [],
    weekdays: [],
    hours: [],
    contacts: [],
    paymentMethods: [],
  };
}

function mockRevenueSummaryRequests(allRange = { from: "2024-03-02", to: "2026-08-01" }) {
  return vi
    .spyOn(mockApi, "getRevenueSummary")
    .mockImplementation(async (from, to, granularity) => {
      const resolvedFrom = from || allRange.from;
      const resolvedTo = to || allRange.to;
      return revenueSummary(resolvedFrom, resolvedTo, granularity);
    });
}

function mountDashboard() {
  return mount(RevenueDashboard, {
    global: {
      plugins: [createPinia()],
      stubs: {
        RevenueChart: RevenueChartStub,
        RevenuePeriodDetail: RevenuePeriodDetailStub,
        RevenueBreakdownPanel: RevenueBreakdownPanelStub,
        RevenueContactDetail: RevenueContactDetailStub,
        RevenueReportDialog: RevenueReportDialogStub,
      },
    },
  });
}

describe("RevenueDashboard", () => {
  afterEach(() => {
    routerPush.mockReset();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("exposes an expandable data table with keyboard-operable period drill-down", async () => {
    mockRevenueSummaryRequests();
    const wrapper = mountDashboard();
    await flushPromises();

    expect(wrapper.get(".chart-data-table summary").text()).toBe("查看数据表");
    const periodButton = wrapper.get(".chart-data-table tbody button");
    expect(periodButton.attributes("aria-label")).toContain("查看");
    await periodButton.trigger("click");
    await flushPromises();
    expect(wrapper.find(".period-detail-stub").exists()).toBe(true);
  });

  it("starts on the current Monday-to-Sunday week with daily trend grouping", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    const getRevenueSummary = mockRevenueSummaryRequests();
    const wrapper = mountDashboard();
    await flushPromises();

    expect(getRevenueSummary).toHaveBeenCalledWith("2026-07-27", "2026-08-02", "day");
    expect(wrapper.get(".range-navigator__actual").text()).toBe("2026-07-27 — 2026-08-02");
    expect(
      wrapper
        .findAll(".range-navigator__kind")
        .find((button) => button.text() === "周")
        ?.attributes("aria-pressed"),
    ).toBe("true");
    expect(
      wrapper
        .findAll(".segmented__item")
        .find((button) => button.text() === "日")
        ?.classes(),
    ).toContain("is-active");
    expect(wrapper.getComponent(RevenueChartStub).props()).toMatchObject({
      granularity: "day",
      from: "2026-07-27",
      to: "2026-08-02",
    });
    expect(wrapper.getComponent(RevenueBreakdownPanelStub).props()).toMatchObject({
      from: "2026-07-27",
      to: "2026-08-02",
      paymentMethods: [{ name: "微信", amountMinor: 20_000, appointmentCount: 3 }],
      contacts: [{ name: "南枝", amountMinor: 20_000, appointmentCount: 3 }],
    });

    wrapper.unmount();
  });

  it("keeps the statistics range and trend grouping independent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    const getRevenueSummary = mockRevenueSummaryRequests();
    const wrapper = mountDashboard();
    await flushPromises();

    const trendMonth = wrapper.findAll(".segmented__item").find((button) => button.text() === "月");
    const rangeWeek = wrapper
      .findAll(".range-navigator__kind")
      .find((button) => button.text() === "周");
    const rangeMonth = wrapper
      .findAll(".range-navigator__kind")
      .find((button) => button.text() === "月");
    if (!trendMonth || !rangeWeek || !rangeMonth) throw new Error("收益范围控件未完整渲染");

    await trendMonth.trigger("click");
    await flushPromises();
    expect(rangeWeek.attributes("aria-pressed")).toBe("true");
    expect(getRevenueSummary).toHaveBeenLastCalledWith("2026-07-27", "2026-08-02", "month");

    await rangeMonth.trigger("click");
    await flushPromises();
    expect(trendMonth.classes()).toContain("is-active");
    expect(getRevenueSummary).toHaveBeenLastCalledWith("2026-08-01", "2026-08-31", "month");
    expect(wrapper.getComponent(RevenueChartStub).props("granularity")).toBe("month");

    wrapper.unmount();
  });

  it("keeps the last applied range for invalid custom dates and loads valid dates immediately", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    const getRevenueSummary = mockRevenueSummaryRequests();
    const wrapper = mountDashboard();
    await flushPromises();

    const customButton = wrapper
      .findAll(".range-navigator__kind")
      .find((button) => button.text() === "自定义");
    if (!customButton) throw new Error("未找到自定义统计范围按钮");
    await customButton.trigger("click");
    await flushPromises();

    const callsBeforeEditing = getRevenueSummary.mock.calls.length;
    const fromInput = wrapper.get<HTMLInputElement>('input[aria-label="统计开始日期"]');
    const toInput = wrapper.get<HTMLInputElement>('input[aria-label="统计结束日期"]');
    await fromInput.setValue("2026-08-10");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe("开始日期不能晚于结束日期");
    expect(getRevenueSummary).toHaveBeenCalledTimes(callsBeforeEditing);
    expect(
      wrapper.get('button[aria-label="查看当前统计范围内的待结算预约"]').attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.get(".revenue-report-button").attributes("disabled")).toBeDefined();

    await toInput.setValue("2026-08-12");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(getRevenueSummary).toHaveBeenCalledTimes(callsBeforeEditing + 1);
    expect(getRevenueSummary).toHaveBeenLastCalledWith("2026-08-10", "2026-08-12", "day");

    wrapper.unmount();
  });

  it("clips weekly drill-down to the active custom range", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    const getRevenueSummary = mockRevenueSummaryRequests();
    const wrapper = mountDashboard();
    await flushPromises();

    const customButton = wrapper
      .findAll(".range-navigator__kind")
      .find((button) => button.text() === "自定义");
    const trendWeek = wrapper.findAll(".segmented__item").find((button) => button.text() === "周");
    if (!customButton || !trendWeek) throw new Error("收益范围控件未完整渲染");

    await customButton.trigger("click");
    await wrapper.get('input[aria-label="统计开始日期"]').setValue("2026-07-29");
    await wrapper.get('input[aria-label="统计结束日期"]').setValue("2026-08-01");
    await trendWeek.trigger("click");
    await flushPromises();

    await wrapper.get(".revenue-chart-stub").trigger("click");
    await flushPromises();

    expect(wrapper.get(".period-detail-stub").text()).toContain("2026-07-29—2026-08-01");
    expect(getRevenueSummary).toHaveBeenLastCalledWith("2026-07-29", "2026-08-01", "day");

    wrapper.unmount();
  });

  it("opens pending appointments with the last successful normalized summary range", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    const allRange = { from: "2024-03-02", to: "2026-08-01" };
    const getRevenueSummary = mockRevenueSummaryRequests(allRange);
    const wrapper = mountDashboard();
    await flushPromises();

    const allButton = wrapper
      .findAll(".range-navigator__kind")
      .find((button) => button.text() === "全部");
    if (!allButton) throw new Error("未找到全部统计范围按钮");
    await allButton.trigger("click");
    await flushPromises();

    expect(getRevenueSummary).toHaveBeenLastCalledWith("", "", "day");
    const pendingButton = wrapper.get<HTMLButtonElement>(
      'button[aria-label="查看当前统计范围内的待结算预约"]',
    );
    expect(pendingButton.attributes("disabled")).toBeUndefined();
    await pendingButton.trigger("click");

    expect(routerPush).toHaveBeenCalledWith({
      name: "appointments",
      query: {
        from: allRange.from,
        to: allRange.to,
        progressStatus: "pending_settlement",
      },
    });

    wrapper.unmount();
  });

  it("generates the report from the resolved all-records range and closes it on range change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    const allRange = { from: "2024-03-02", to: "2026-08-01" };
    mockRevenueSummaryRequests(allRange);
    const getRevenueAnalyticsReport = vi
      .spyOn(mockApi, "getRevenueAnalyticsReport")
      .mockImplementation(async (from, to) => analyticsReport(from, to));
    const wrapper = mountDashboard();
    await flushPromises();

    const toolbarButtons = wrapper.findAll(".revenue-toolbar button");
    expect(toolbarButtons[toolbarButtons.length - 1]?.text()).toContain("生成数据报表");
    const allButton = toolbarButtons.find((button) => button.text() === "全部");
    if (!allButton) throw new Error("未找到全部统计范围按钮");
    await allButton.trigger("click");
    await flushPromises();

    const reportButton = wrapper.get(".revenue-report-button");
    expect(reportButton.attributes("disabled")).toBeUndefined();
    await reportButton.trigger("click");
    await flushPromises();

    expect(getRevenueAnalyticsReport).toHaveBeenCalledWith(allRange.from, allRange.to);
    expect(wrapper.get(".analytics-report-stub").attributes("data-from")).toBe(allRange.from);

    const monthButton = toolbarButtons.find((button) => button.text() === "月");
    if (!monthButton) throw new Error("未找到月统计范围按钮");
    await monthButton.trigger("click");
    await flushPromises();
    expect(wrapper.find(".analytics-report-stub").exists()).toBe(false);

    wrapper.unmount();
  });

  it("loads business appointments for the day selected from the daily chart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    mockRevenueSummaryRequests();
    const listAppointments = vi.spyOn(mockApi, "listAppointments").mockResolvedValue([]);
    const wrapper = mountDashboard();
    await flushPromises();

    expect(listAppointments).not.toHaveBeenCalled();
    const chart = wrapper.getComponent(RevenueChartStub);
    const selectedPeriod = (chart.props("points") as Array<{ period: string }>)[0]?.period;
    if (!selectedPeriod) throw new Error("日收益图缺少可下钻的数据点");

    await wrapper.get(".revenue-chart-stub").trigger("click");
    await flushPromises();

    expect(wrapper.get(".period-detail-stub").attributes("data-granularity")).toBe("day");
    expect(listAppointments).toHaveBeenCalledWith({
      from: selectedPeriod,
      to: selectedPeriod,
      mode: "business",
    });

    wrapper.unmount();
  });

  it("keeps the period detail suspended while editing its selected appointment", async () => {
    mockRevenueSummaryRequests();
    vi.spyOn(mockApi, "listAppointments").mockResolvedValue([dashboardAppointment]);
    const wrapper = mountDashboard();
    await flushPromises();
    await wrapper.get(".revenue-chart-stub").trigger("click");
    await flushPromises();

    await wrapper.get(".period-appointment-select").trigger("click");
    await flushPromises();
    const ui = useUiStore();
    expect(wrapper.get(".period-detail-stub").attributes("data-suspended")).toBe("true");
    expect(ui.appointmentDrawerOpen).toBe(true);
    expect(ui.activeAppointment?.id).toBe(dashboardAppointment.id);
    wrapper.unmount();
  });

  it("loads all merged contact members and opens their appointment in the existing editor", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    mockRevenueSummaryRequests();
    const listContactAppointments = vi
      .spyOn(mockApi, "listRevenueContactAppointments")
      .mockResolvedValue([dashboardAppointment]);
    const wrapper = mountDashboard();
    await flushPromises();

    await wrapper.get(".breakdown-panel-stub").trigger("click");
    await flushPromises();
    expect(listContactAppointments).toHaveBeenCalledWith("2026-07-27", "2026-08-02", [
      "南枝",
      "小北",
    ]);
    expect(wrapper.get(".contact-detail-stub").attributes("data-appointments")).toBe("1");

    await wrapper.get(".contact-detail-stub").trigger("click");
    await flushPromises();
    const ui = useUiStore();
    expect(wrapper.get(".contact-detail-stub").attributes("data-suspended")).toBe("true");
    expect(ui.appointmentDrawerOpen).toBe(true);
    expect(ui.activeAppointment?.id).toBe(dashboardAppointment.id);
    wrapper.unmount();
  });
});
