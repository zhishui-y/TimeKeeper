// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Appointment } from "../../types/domain";
import { DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS } from "../../utils/appointmentTableColumns";
import AppointmentTable from "./AppointmentTable.vue";

function appointment(withAccount = true, overrides: Partial<Appointment> = {}): Appointment {
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
          source: "profile",
          characterName: "唯满侠",
          specialization: "冰心",
          gearScore: "19.8万",
          server: "梦江南",
          accountName: "demo-account",
          password: "demo-secret",
        }
      : null,
    amountMinor: 8_000,
    paymentMethod: "支付宝",
    notes: "只接晚间时段",
    createdAt: "2026-08-03T00:00:00Z",
    updatedAt: "2026-08-03T00:00:00Z",
    ...overrides,
  };
}

describe("AppointmentTable", () => {
  it("splits content and account columns and places copy controls in the account cell", async () => {
    const wrapper = mount(AppointmentTable, {
      props: {
        appointments: [appointment(), appointment(false)],
        selectedIds: [],
        allSelected: false,
        selectionIndeterminate: false,
        selectingAll: false,
        columnWidths: { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS },
        savingColumnWidths: false,
      },
    });

    const headers = wrapper.findAll("thead th").map((header) => header.text().trim());
    expect(headers).toContain("内容");
    expect(headers).toContain("账号");
    expect(headers).toContain("语音");
    expect(headers).toContain("备注");
    expect(headers).not.toContain("结算");
    expect(headers).not.toContain("收款");
    expect(headers).not.toContain("内容 / 账号");
    expect(wrapper.text()).toContain("冰心");
    expect(wrapper.text()).toContain("19.8万");
    expect(wrapper.text()).toContain("梦江南");
    expect(wrapper.text()).toContain("只接晚间时段");
    expect(wrapper.text()).not.toContain("支付宝");
    expect(wrapper.text()).toContain("未使用账号");

    const accountLines = wrapper
      .find(".appointment-account-summary")
      .findAll(".appointment-account-summary__line");
    expect(accountLines[0]!.text()).toBe("冰心·19.8万");
    expect(accountLines[0]!.findAll("button")).toHaveLength(0);
    expect(accountLines[1]!.text()).toBe("梦江南·唯满侠");
    expect(accountLines[1]!.findAll("button")).toHaveLength(2);
    expect(accountLines[1]!.text()).not.toContain("demo-account");
    expect(accountLines[1]!.text()).not.toContain("••••••");
    expect(accountLines[1]!.find('button[aria-label^="显示"]').exists()).toBe(false);

    await wrapper.get('button[aria-label="复制账号 demo-account"]').trigger("click");
    await wrapper.get('button[aria-label="复制测试联系人 的预约密码"]').trigger("click");
    expect(wrapper.emitted("copyAccount")?.[0]?.[0]).toMatchObject({ id: "appointment-account" });
    expect(wrapper.emitted("copyPassword")?.[0]?.[0]).toMatchObject({ id: "appointment-account" });

    const actionCell = wrapper.findAll("tbody tr")[0]!.find(".row-actions");
    expect(actionCell.findAll("button")).toHaveLength(3);
    expect(actionCell.find('button[aria-label="删除"]').exists()).toBe(true);
    expect(actionCell.find('button[aria-label="取消预约"]').exists()).toBe(false);
    expect(actionCell.find('button[aria-label="复制账号密码"]').exists()).toBe(false);
  });

  it("renders YY, QQ and empty voice states and emits channel copy", async () => {
    const yy = appointment(true, {
      id: "appointment-yy",
      voicePlatform: "yy",
      voiceChannel: "794676",
    });
    const wrapper = mount(AppointmentTable, {
      props: {
        appointments: [
          yy,
          appointment(false, {
            id: "appointment-yy-empty",
            voicePlatform: "yy",
            voiceChannel: null,
          }),
          appointment(false, {
            id: "appointment-qq",
            voicePlatform: "qq",
            voiceChannel: null,
          }),
          appointment(false, { id: "appointment-no-voice" }),
        ],
        selectedIds: [],
        allSelected: false,
        selectionIndeterminate: false,
        selectingAll: false,
        columnWidths: { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS },
        savingColumnWidths: false,
      },
    });

    const headers = wrapper.findAll("thead th").map((header) => header.text().trim());
    expect(headers.indexOf("语音")).toBe(headers.indexOf("账号") + 1);
    expect(headers.indexOf("模式")).toBe(headers.indexOf("语音") + 1);
    const voiceCells = wrapper.findAll("tbody tr").map((row) => row.findAll("td")[6]!);
    expect(voiceCells[0]!.text()).toBe("794676");
    expect(voiceCells[1]!.text()).toBe("—");
    expect(voiceCells[1]!.find("button").exists()).toBe(false);
    expect(voiceCells[2]!.text()).toBe("QQ");
    expect(voiceCells[3]!.text()).toBe("—");

    await wrapper.get('button[aria-label="复制YY频道 794676"]').trigger("click");
    expect(wrapper.get('button[aria-label="复制YY频道 794676"]').find("svg").exists()).toBe(false);
    expect(wrapper.emitted("copyVoiceChannel")?.[0]?.[0]).toMatchObject({
      id: "appointment-yy",
    });
  });

  it("makes only pending settlement status actionable and emits settle", async () => {
    const pending = appointment(true, {
      id: "appointment-pending-settlement",
      serviceStatus: "completed",
      settlementStatus: "unsettled",
    });
    const scheduled = appointment(true, { id: "appointment-scheduled" });
    const wrapper = mount(AppointmentTable, {
      props: {
        appointments: [pending, scheduled],
        selectedIds: [],
        allSelected: false,
        selectionIndeterminate: false,
        selectingAll: false,
        columnWidths: { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS },
        savingColumnWidths: false,
      },
    });

    const settlementButton = wrapper.get('button[aria-label="填写测试联系人 的结算金额"]');
    expect(settlementButton.text()).toBe("待结算");
    expect(wrapper.findAll(".settlement-status-button")).toHaveLength(1);

    await settlementButton.trigger("click");
    expect(wrapper.emitted("settle")?.[0]?.[0]).toMatchObject({
      id: "appointment-pending-settlement",
    });
  });

  it("exposes all ten resizable data columns and emits typed width actions", async () => {
    const wrapper = mount(AppointmentTable, {
      props: {
        appointments: [appointment()],
        selectedIds: [],
        allSelected: false,
        selectionIndeterminate: false,
        selectingAll: false,
        columnWidths: { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS },
        savingColumnWidths: false,
      },
    });

    expect(wrapper.findAll(".column-resizer")).toHaveLength(10);
    await wrapper.get('button[aria-label="调整语音列宽"]').trigger("keydown", {
      key: "ArrowRight",
    });
    expect(wrapper.emitted("previewColumnWidth")).toEqual([["voice", 96]]);
    expect(wrapper.emitted("commitColumnWidth")).toEqual([["voice", 96]]);
  });
});
