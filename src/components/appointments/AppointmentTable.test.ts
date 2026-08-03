// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Appointment } from "../../types/domain";
import { DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS } from "../../utils/appointmentTableColumns";
import AppointmentTable from "./AppointmentTable.vue";

function appointment(withAccount = true): Appointment {
  return {
    id: withAccount ? "appointment-account" : "appointment-no-account",
    serviceDate: "2026-08-03",
    startsAt: "2026-08-03T20:00:00",
    endsAt: "2026-08-03T22:00:00",
    contactName: "测试联系人",
    content: "很长的预约内容",
    mode: "business",
    serviceStatus: "scheduled",
    settlementStatus: "unsettled",
    account: withAccount
      ? {
          specialization: "冰心",
          gearScore: "19.8万",
          server: "梦江南",
          accountName: "demo-account",
          passwordAvailable: true,
        }
      : null,
    amountMinor: 8_000,
    paymentMethod: "支付宝",
    createdAt: "2026-08-03T00:00:00Z",
    updatedAt: "2026-08-03T00:00:00Z",
  };
}

describe("AppointmentTable", () => {
  it("splits content and account columns and places copy controls in the account cell", async () => {
    const wrapper = mount(AppointmentTable, {
      props: {
        appointments: [appointment(), appointment(false)],
        selectedIds: [],
        columnWidths: { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS },
        savingColumnWidths: false,
        "onUpdate:selectedIds": () => undefined,
      },
    });

    const headers = wrapper.findAll("thead th").map((header) => header.text().trim());
    expect(headers).toContain("内容");
    expect(headers).toContain("账号");
    expect(headers).not.toContain("内容 / 账号");
    expect(wrapper.text()).toContain("冰心");
    expect(wrapper.text()).toContain("19.8万");
    expect(wrapper.text()).toContain("梦江南");
    expect(wrapper.text()).toContain("未使用账号");

    await wrapper.get('button[aria-label="复制账号 demo-account"]').trigger("click");
    await wrapper.get('button[aria-label="复制密码 测试联系人"]').trigger("click");
    expect(wrapper.emitted("copyAccount")?.[0]?.[0]).toMatchObject({ id: "appointment-account" });
    expect(wrapper.emitted("copyPassword")?.[0]?.[0]).toMatchObject({ id: "appointment-account" });

    const actionCell = wrapper.findAll("tbody tr")[0]!.find(".row-actions");
    expect(actionCell.findAll("button")).toHaveLength(3);
    expect(actionCell.find('button[aria-label="删除"]').exists()).toBe(true);
    expect(actionCell.find('button[aria-label="取消预约"]').exists()).toBe(false);
    expect(actionCell.find('button[aria-label="复制账号密码"]').exists()).toBe(false);
  });

  it("exposes all ten resizable data columns and emits typed width actions", async () => {
    const wrapper = mount(AppointmentTable, {
      props: {
        appointments: [appointment()],
        selectedIds: [],
        columnWidths: { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS },
        savingColumnWidths: false,
        "onUpdate:selectedIds": () => undefined,
      },
    });

    expect(wrapper.findAll(".column-resizer")).toHaveLength(10);
    await wrapper.get('button[aria-label="调整内容列宽"]').trigger("keydown", {
      key: "ArrowRight",
    });
    expect(wrapper.emitted("previewColumnWidth")).toEqual([["content", 148]]);
    expect(wrapper.emitted("commitColumnWidth")).toEqual([["content", 148]]);
  });
});
