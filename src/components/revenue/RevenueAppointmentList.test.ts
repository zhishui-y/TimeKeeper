// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Appointment } from "../../types/domain";
import RevenueAppointmentList from "./RevenueAppointmentList.vue";

const appointments: Appointment[] = [
  {
    id: "business-appointment",
    serviceDate: "2026-08-01",
    startsAt: "2026-08-01T13:30:00+08:00",
    endsAt: "2026-08-01T15:00:00+08:00",
    contactName: "小北",
    content: "日常清体力",
    mode: "business",
    serviceStatus: "completed",
    settlementStatus: "unsettled",
    amountMinor: 18_000,
    account: { source: "embedded", accountName: "剑胆琴心", password: null },
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  },
  {
    id: "entertainment-appointment",
    serviceDate: "2026-08-01",
    contactName: "青禾",
    mode: "entertainment",
    serviceStatus: "scheduled",
    settlementStatus: "not_applicable",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  },
  {
    id: "cancelled-business-appointment",
    serviceDate: "2026-08-01",
    contactName: "已取消业务",
    mode: "business",
    serviceStatus: "cancelled",
    settlementStatus: "unsettled",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  },
];

describe("RevenueAppointmentList", () => {
  it("shows report appointments and emits the selected appointment from a keyboard-operable row", async () => {
    const wrapper = mount(RevenueAppointmentList, {
      props: { appointments, loading: false, error: null, showDate: true },
    });

    expect(wrapper.get("h3").text()).toBe("当日业务预约");
    expect(wrapper.findAll(".revenue-appointment")).toHaveLength(1);
    expect(wrapper.text()).toContain("2026年8月1日");
    expect(wrapper.text()).toContain("13:30–15:00");
    expect(wrapper.text()).toContain("小北");
    expect(wrapper.text()).toContain("¥180");
    expect(wrapper.text()).toContain("待结算");
    expect(wrapper.text()).not.toContain("青禾");

    const row = wrapper.get(".revenue-appointment");
    expect(row.element.tagName).toBe("BUTTON");
    await row.trigger("click");
    expect((wrapper.emitted("appointmentSelect")?.[0]?.[0] as Appointment).id).toBe(
      appointments[0]?.id,
    );
  });

  it("disables selection while loading, errored, stale, or explicitly disabled", async () => {
    const wrapper = mount(RevenueAppointmentList, {
      props: {
        appointments,
        loading: false,
        error: null,
        actionsDisabled: true,
      },
    });

    expect(wrapper.get(".revenue-appointment").attributes("disabled")).toBeDefined();
    await wrapper.get(".revenue-appointment").trigger("click");
    expect(wrapper.emitted("appointmentSelect")).toBeUndefined();
  });

  it("shows a configurable empty state after loading", () => {
    const wrapper = mount(RevenueAppointmentList, {
      props: {
        appointments: [],
        loading: false,
        error: null,
        emptyMessage: "暂无计入收益的预约",
      },
    });

    expect(wrapper.text()).toContain("暂无计入收益的预约");
  });
});
