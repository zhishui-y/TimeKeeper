// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Appointment } from "../../types/domain";
import TodayAppointmentList from "./TodayAppointmentList.vue";

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appointment-1",
    serviceDate: "2026-08-03",
    contactName: "测试联系人",
    mode: "business",
    serviceStatus: "completed",
    settlementStatus: "unsettled",
    amountMinor: 18_000,
    createdAt: "2026-08-03T00:00:00Z",
    updatedAt: "2026-08-03T00:00:00Z",
    ...overrides,
  };
}

describe("TodayAppointmentList", () => {
  it("shows one unified status and exposes settlement only for pending business appointments", () => {
    const wrapper = mount(TodayAppointmentList, {
      props: {
        appointments: [
          appointment(),
          appointment({ id: "settled", settlementStatus: "settled" }),
          appointment({
            id: "entertainment",
            mode: "entertainment",
            settlementStatus: "not_applicable",
          }),
        ],
        kicker: "TODAY",
        heading: "今日预约",
      },
    });

    const rows = wrapper.findAll(".appointment-row");
    expect(rows[0]?.findAll(".badge")).toHaveLength(1);
    expect(rows[0]?.get(".badge").text()).toBe("待结算");
    expect(rows[0]?.find('button[aria-label="编辑结算"]').exists()).toBe(true);
    expect(rows[1]?.get(".badge").text()).toBe("已完成");
    expect(rows[1]?.find('button[aria-label="编辑结算"]').exists()).toBe(false);
    expect(rows[2]?.get(".badge").text()).toBe("已完成");
  });
});
