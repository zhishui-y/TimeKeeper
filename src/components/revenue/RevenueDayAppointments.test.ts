// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Appointment } from "../../types/domain";
import RevenueDayAppointments from "./RevenueDayAppointments.vue";

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

describe("RevenueDayAppointments", () => {
  it("only shows non-cancelled business appointments that match the report", () => {
    const wrapper = mount(RevenueDayAppointments, {
      props: { appointments, loading: false, error: null },
    });

    expect(wrapper.get("h3").text()).toBe("当日业务预约");
    expect(wrapper.findAll(".day-appointment")).toHaveLength(1);
    expect(wrapper.text()).toContain("13:30–15:00");
    expect(wrapper.text()).toContain("小北");
    expect(wrapper.text()).toContain("¥180");
    expect(wrapper.text()).toContain("待结算");
    expect(wrapper.text()).not.toContain("青禾");
    expect(wrapper.text()).not.toContain("已取消业务");
  });

  it("shows an empty state after loading", () => {
    const wrapper = mount(RevenueDayAppointments, {
      props: { appointments: [], loading: false, error: null },
    });

    expect(wrapper.text()).toContain("当天没有符合收益口径的业务预约");
  });
});
