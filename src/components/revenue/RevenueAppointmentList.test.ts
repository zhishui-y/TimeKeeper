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
    voicePlatform: "yy",
    voiceChannel: "794676",
    notes: "优先安排晚间时段",
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
    expect(wrapper.text()).toContain("YY·794676");
    expect(wrapper.text()).toContain("备注：优先安排晚间时段");
    expect(wrapper.text()).not.toContain("青禾");

    const row = wrapper.get(".revenue-appointment");
    expect(row.element.tagName).toBe("BUTTON");
    await row.trigger("click");
    expect((wrapper.emitted("appointmentSelect")?.[0]?.[0] as Appointment).id).toBe(
      appointments[0]?.id,
    );
  });

  it("shows fixed voice and notes lines without nesting interactive controls", () => {
    const longNotes = "这是一条需要在狭窄信息列中省略但通过标题保留完整内容的长备注";
    const target = appointments[0]!;
    const voiceAppointments: Appointment[] = [
      {
        ...target,
        id: "yy-channel",
        voicePlatform: "yy",
        voiceChannel: "123456",
        notes: longNotes,
      },
      { ...target, id: "yy-empty", voicePlatform: "yy", voiceChannel: null, notes: null },
      { ...target, id: "qq", voicePlatform: "qq", voiceChannel: null, notes: "QQ备注" },
      {
        ...target,
        id: "no-voice",
        voicePlatform: null,
        voiceChannel: null,
        notes: null,
      },
    ];
    const wrapper = mount(RevenueAppointmentList, {
      props: { appointments: voiceAppointments, loading: false, error: null, showDate: true },
    });
    const rows = wrapper.findAll(".revenue-appointment");

    expect(rows.map((row) => row.get(".revenue-appointment__voice").text())).toEqual([
      "YY·123456",
      "YY",
      "QQ",
      "—",
    ]);
    expect(rows.map((row) => row.get(".revenue-appointment__notes").text())).toEqual([
      `备注：${longNotes}`,
      "备注：—",
      "备注：QQ备注",
      "备注：—",
    ]);
    expect(rows[0]?.get(".revenue-appointment__notes").attributes("title")).toBe(longNotes);
    for (const row of rows) expect(row.element.querySelector("button")).toBeNull();
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
