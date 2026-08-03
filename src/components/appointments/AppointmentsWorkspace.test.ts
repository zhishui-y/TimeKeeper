// @vitest-environment jsdom

import { createPinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../api/mockClient";
import { useUiStore } from "../../stores/ui";
import type { AppSettings, Appointment } from "../../types/domain";
import { DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL } from "../../utils/accountRoleData";
import { DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS } from "../../utils/accountTableColumns";
import { DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS } from "../../utils/appointmentTableColumns";
import AppointmentTable from "./AppointmentTable.vue";
import AppointmentsWorkspace from "./AppointmentsWorkspace.vue";

function appointment(serviceStatus: Appointment["serviceStatus"] = "scheduled"): Appointment {
  return {
    id: `appointment-${serviceStatus}`,
    serviceDate: "2026-08-03",
    startsAt: "2026-08-03T20:00:00",
    endsAt: "2026-08-03T22:00:00",
    contactName: "测试联系人",
    content: "竞技场",
    mode: "business",
    serviceStatus,
    settlementStatus: "unsettled",
    account: {
      specialization: "冰心",
      gearScore: "19.8万",
      server: "梦江南",
      accountName: "demo-account",
      passwordAvailable: false,
    },
    amountMinor: 8_000,
    paymentMethod: "支付宝",
    createdAt: "2026-08-03T00:00:00Z",
    updatedAt: "2026-08-03T00:00:00Z",
  };
}

function settings(): AppSettings {
  return {
    defaultReminderMinutes: 30,
    autoLockMinutes: 15,
    backupRetention: 30,
    lastAutomaticBackupDate: null,
    accountTableColumnWidths: { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS },
    appointmentTableColumnWidths: { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS },
    lastAccountUsageWeekStart: null,
    accountRoleDataServerUrl: DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL,
  };
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`未找到按钮：${text}`);
  return button;
}

describe("AppointmentsWorkspace", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("copies the embedded account and persists appointment table widths", async () => {
    const target = appointment();
    vi.spyOn(mockApi, "listAppointments").mockResolvedValue([target]);
    vi.spyOn(mockApi, "getSettings").mockResolvedValue(settings());
    const copyAccount = vi.spyOn(mockApi, "copyAppointmentAccountName").mockResolvedValue();
    const updateWidths = vi
      .spyOn(mockApi, "updateAppointmentTableColumnWidths")
      .mockImplementation(async (widths) => widths);
    const pinia = createPinia();
    const wrapper = mount(AppointmentsWorkspace, { global: { plugins: [pinia] } });
    await flushPromises();

    await wrapper.get('button[aria-label="复制账号 demo-account"]').trigger("click");
    await flushPromises();
    expect(copyAccount).toHaveBeenCalledWith(target.id);
    expect(useUiStore(pinia).toast?.message).toBe("账号已复制");

    const table = wrapper.findComponent(AppointmentTable);
    table.vm.$emit("previewColumnWidth", "content", 208);
    await wrapper.vm.$nextTick();
    expect(table.props("columnWidths").content).toBe(208);
    table.vm.$emit("commitColumnWidth", "content", 208);
    await flushPromises();
    expect(updateWidths).toHaveBeenCalledWith({
      ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS,
      content: 208,
    });
    wrapper.unmount();
  });

  it("rolls column widths back when persistence fails", async () => {
    vi.spyOn(mockApi, "listAppointments").mockResolvedValue([appointment()]);
    vi.spyOn(mockApi, "getSettings").mockResolvedValue(settings());
    vi.spyOn(mockApi, "updateAppointmentTableColumnWidths").mockRejectedValue(
      new Error("保存列宽失败"),
    );
    const pinia = createPinia();
    const wrapper = mount(AppointmentsWorkspace, { global: { plugins: [pinia] } });
    await flushPromises();

    const table = wrapper.findComponent(AppointmentTable);
    table.vm.$emit("previewColumnWidth", "account", 240);
    table.vm.$emit("commitColumnWidth", "account", 240);
    await flushPromises();
    expect(table.props("columnWidths").account).toBe(
      DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS.account,
    );
    expect(useUiStore(pinia).toast?.message).toBe("保存列宽失败");
    wrapper.unmount();
  });

  it("routes deletion through cancellation or permanent deletion", async () => {
    const scheduled = appointment();
    const cancelled = appointment("cancelled");
    const list = vi
      .spyOn(mockApi, "listAppointments")
      .mockResolvedValueOnce([scheduled])
      .mockResolvedValueOnce([cancelled])
      .mockResolvedValueOnce([cancelled]);
    vi.spyOn(mockApi, "getSettings").mockResolvedValue(settings());
    const cancel = vi.spyOn(mockApi, "setAppointmentServiceStatus").mockResolvedValue({
      ...scheduled,
      serviceStatus: "cancelled",
    });
    const remove = vi.spyOn(mockApi, "deleteAppointment").mockResolvedValue();
    const wrapper = mount(AppointmentsWorkspace, { global: { plugins: [createPinia()] } });
    await flushPromises();

    await wrapper.get('button[aria-label="删除"]').trigger("click");
    expect(document.body.querySelector("[role='dialog']")?.textContent).toContain("处理预约记录");
    buttonByText("取消预约").click();
    await flushPromises();
    expect(cancel).toHaveBeenCalledWith(scheduled.id, "cancelled");

    await wrapper.get('button[aria-label="删除"]').trigger("click");
    expect(buttonByText("已取消").disabled).toBe(true);
    buttonByText("永久删除").click();
    await flushPromises();
    expect(remove).toHaveBeenCalledWith(cancelled.id);
    expect(list).toHaveBeenCalledTimes(3);
    wrapper.unmount();
  });
});
