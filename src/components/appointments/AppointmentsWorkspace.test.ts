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
    voicePlatform: "yy",
    voiceChannel: "794676",
    mode: "business",
    serviceStatus,
    settlementStatus: "unsettled",
    account: {
      specialization: "冰心",
      gearScore: "19.8万",
      server: "梦江南",
      accountName: "demo-account",
      password: null,
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
    backupRetention: 30,
    lastAutomaticBackupDate: null,
    accountTableColumnWidths: { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS },
    appointmentTableColumnWidths: { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS },
    lastAccountUsageWeekStart: null,
    accountRoleDataServerUrl: DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL,
  };
}

function appointmentPage(items: Appointment[]) {
  return {
    items,
    totalCount: items.length,
    page: 1,
    pageSize: 100,
    totalPages: items.length ? 1 : 0,
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

  it("copies account and YY channel, then persists table widths", async () => {
    const target = appointment();
    vi.spyOn(mockApi, "listAppointmentPage").mockResolvedValue(appointmentPage([target]));
    vi.spyOn(mockApi, "getSettings").mockResolvedValue(settings());
    const copyAccount = vi.spyOn(mockApi, "copyAppointmentAccountName").mockResolvedValue();
    const copyVoice = vi.spyOn(mockApi, "copyAppointmentVoiceChannel").mockResolvedValue();
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

    await wrapper.get('button[aria-label="复制YY频道 794676"]').trigger("click");
    await flushPromises();
    expect(copyVoice).toHaveBeenCalledWith(target.id);
    expect(useUiStore(pinia).toast?.message).toBe("YY频道号已复制");

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

  it("shows a YY channel copy error", async () => {
    const target = appointment();
    vi.spyOn(mockApi, "listAppointmentPage").mockResolvedValue(appointmentPage([target]));
    vi.spyOn(mockApi, "getSettings").mockResolvedValue(settings());
    vi.spyOn(mockApi, "copyAppointmentVoiceChannel").mockRejectedValue(
      new Error("该预约未填写YY频道号"),
    );
    const pinia = createPinia();
    const wrapper = mount(AppointmentsWorkspace, { global: { plugins: [pinia] } });
    await flushPromises();

    wrapper.findComponent(AppointmentTable).vm.$emit("copyVoiceChannel", target);
    await flushPromises();
    expect(useUiStore(pinia).toast?.message).toBe("该预约未填写YY频道号");
    expect(document.body.querySelector("[role='dialog']")).toBeNull();
    wrapper.unmount();
  });

  it("opens pending settlement appointments with the amount field as initial focus", async () => {
    const target = appointment("completed");
    vi.spyOn(mockApi, "listAppointmentPage").mockResolvedValue(appointmentPage([target]));
    vi.spyOn(mockApi, "getSettings").mockResolvedValue(settings());
    const pinia = createPinia();
    const wrapper = mount(AppointmentsWorkspace, { global: { plugins: [pinia] } });
    await flushPromises();

    await wrapper.get('button[aria-label="填写测试联系人 的结算金额"]').trigger("click");

    const ui = useUiStore(pinia);
    expect(ui.appointmentDrawerOpen).toBe(true);
    expect(ui.activeAppointment?.id).toBe(target.id);
    expect(ui.appointmentDrawerInitialFocus).toBe("amount");
    wrapper.unmount();
  });

  it("rolls column widths back when persistence fails", async () => {
    vi.spyOn(mockApi, "listAppointmentPage").mockResolvedValue(appointmentPage([appointment()]));
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
      .spyOn(mockApi, "listAppointmentPage")
      .mockResolvedValueOnce(appointmentPage([scheduled]))
      .mockResolvedValueOnce(appointmentPage([cancelled]))
      .mockResolvedValueOnce(appointmentPage([cancelled]));
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

  it("uses one token plus exclusions when selecting all filtered results", async () => {
    const target = appointment();
    vi.spyOn(mockApi, "listAppointmentPage").mockResolvedValue({
      items: [target],
      totalCount: 10_000,
      page: 1,
      pageSize: 100,
      totalPages: 100,
    });
    vi.spyOn(mockApi, "getSettings").mockResolvedValue(settings());
    const createSelection = vi.spyOn(mockApi, "createAppointmentSelection").mockResolvedValue({
      token: "all-filtered",
      totalCount: 10_000,
      expiresAt: "2099-08-03T00:00:00Z",
    });
    const remove = vi.spyOn(mockApi, "deleteAppointments").mockResolvedValue({
      matchedCount: 9_999,
      deletedCount: 9_999,
    });
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    const wrapper = mount(AppointmentsWorkspace, { global: { plugins: [createPinia()] } });
    await flushPromises();

    await wrapper.get('input[aria-label="全选全部筛选结果"]').setValue(true);
    await flushPromises();
    expect(createSelection).toHaveBeenCalledWith({});
    expect(wrapper.text()).toContain("10000 条已选中");

    await wrapper.get('input[aria-label="选择该预约"]').setValue(false);
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("批量删除"))!
      .trigger("click");
    await flushPromises();
    expect(remove).toHaveBeenCalledWith({
      kind: "token",
      token: "all-filtered",
      excludedIds: [target.id],
    });
    wrapper.unmount();
  });
});
