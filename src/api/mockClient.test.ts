import { afterEach, describe, expect, it, vi } from "vitest";
import { format } from "date-fns";
import type { AppointmentInput } from "../types/domain";
import { appointmentToInput } from "../utils/appointment";
import { mockApi } from "./mockClient";

function businessInput(
  serviceDate: string,
  startTime: string,
  endTime: string,
  contactName: string,
  amountMinor: number,
): AppointmentInput {
  return {
    serviceDate,
    startTime,
    endTime,
    contactName,
    content: "闭环回归",
    mode: "business",
    serviceStatus: "scheduled",
    settlementStatus: "unsettled",
    amountMinor,
  };
}

describe("browser mock API", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves an empty revenue range from first income through today", async () => {
    const summary = await mockApi.getRevenueSummary("", "", "month");

    expect(summary.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(summary.to).toBe(format(new Date(), "yyyy-MM-dd"));
    expect(summary.from <= summary.to).toBe(true);
    expect(summary.appointmentCount).toBeGreaterThan(0);
  });

  it("uses the same preview token then commit import flow without exposing passwords", async () => {
    const preview = await mockApi.previewExcelImport("C:\\demo\\account.xlsm", 2026);
    expect(preview.previewToken).toBeTruthy();
    expect(preview).not.toHaveProperty("password");
    expect(preview).not.toHaveProperty("passwords");

    const result = await mockApi.commitExcelImport(preview.previewToken, {
      appointments: true,
      accounts: false,
    });
    expect(result.importedAppointments).toBeGreaterThan(0);
    expect(result.importedProfiles).toBe(0);
    await expect(
      mockApi.commitExcelImport(preview.previewToken, {
        appointments: false,
        accounts: false,
      }),
    ).rejects.toThrow("至少选择");
  });

  it("removes billing data from entertainment appointments", async () => {
    const result = await mockApi.createAppointment({
      serviceDate: "2026-07-20",
      startTime: "20:00",
      endTime: "22:00",
      contactName: "测试联系人",
      content: "娱乐局",
      mode: "entertainment",
      serviceStatus: "scheduled",
      settlementStatus: "settled",
      amountMinor: 99_900,
      paymentMethod: "支付宝",
    });

    expect(result.appointment.settlementStatus).toBe("not_applicable");
    expect(result.appointment.amountMinor).toBeNull();
    expect(result.appointment.paymentMethod).toBeNull();
  });

  it("uses the reminder setting only when reminder minutes are omitted", async () => {
    const previousSettings = await mockApi.getSettings();
    await mockApi.updateSettings({ ...previousSettings, defaultReminderMinutes: 60 });

    try {
      const inherited = await mockApi.createAppointment(
        businessInput("2099-08-05", "10:00", "11:00", "继承默认提醒", 1_000),
      );
      const disabled = await mockApi.createAppointment({
        ...businessInput("2099-08-05", "12:00", "13:00", "关闭提醒", 1_000),
        reminderMinutes: null,
      });

      expect(inherited.appointment.reminderMinutes).toBe(60);
      expect(disabled.appointment.reminderMinutes).toBeNull();
    } finally {
      await mockApi.updateSettings(previousSettings);
    }
  });

  it("keeps conflicts, service completion, settlement, and revenue separate", async () => {
    const date = "2099-08-01";
    const first = await mockApi.createAppointment(
      businessInput(date, "20:00", "22:00", "闭环基准", 10_000),
    );
    const second = await mockApi.createAppointment(
      businessInput(date, "21:00", "23:00", "闭环目标", 20_000),
    );

    expect(second.conflicts.map((conflict) => conflict.id)).toContain(first.appointment.id);
    const pendingCountBeforeCompletion = (await mockApi.getDashboardSummary(date)).pendingCount;

    const completed = await mockApi.setAppointmentServiceStatus(second.appointment.id, "completed");
    expect(completed.settlementStatus).toBe("unsettled");
    expect((await mockApi.getDashboardSummary(date)).pendingCount).toBe(
      pendingCountBeforeCompletion + 1,
    );

    const beforeSettlement = await mockApi.getRevenueSummary(date, date, "day");
    expect(beforeSettlement.settledMinor).toBe(0);
    expect(beforeSettlement.unsettledMinor).toBe(30_000);
    expect(beforeSettlement.businessHours).toBe(2);

    await mockApi.settleAppointment(second.appointment.id, 25_000, "微信");
    expect((await mockApi.getDashboardSummary(date)).pendingCount).toBe(
      pendingCountBeforeCompletion,
    );
    const afterSettlement = await mockApi.getRevenueSummary(date, date, "day");
    expect(afterSettlement.settledMinor).toBe(25_000);
    expect(afterSettlement.unsettledMinor).toBe(10_000);
    expect(afterSettlement.businessHours).toBe(2);
  });

  it("matches native validation for equal times and settled appointments without an amount", async () => {
    await expect(
      mockApi.createAppointment(businessInput("2099-08-04", "10:00", "10:00", "同一时间", 100)),
    ).rejects.toThrow("开始时间和结束时间不能相同");

    await expect(
      mockApi.createAppointment({
        ...businessInput("2099-08-04", "11:00", "12:00", "空金额结算", 100),
        settlementStatus: "settled",
        amountMinor: null,
      }),
    ).rejects.toThrow("已结算预约必须填写金额");
  });

  it("automatically starts timed appointments and completes only those with an end time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-08-08T10:00:00+08:00"));
    const current = await mockApi.createAppointment(
      businessInput("2099-08-08", "10:00", "11:00", "自动进行", 8_800),
    );
    const missed = await mockApi.createAppointment(
      businessInput("2099-08-08", "08:00", "09:00", "自动完成", 8_800),
    );
    const openEnded = await mockApi.createAppointment({
      ...businessInput("2099-08-08", "10:00", "11:00", "结束待定", 8_800),
      endTime: null,
    });

    await expect(mockApi.syncAppointmentServiceStatuses()).resolves.toBeGreaterThanOrEqual(3);
    await expect(mockApi.getAppointment(current.appointment.id)).resolves.toMatchObject({
      serviceStatus: "in_progress",
    });
    await expect(mockApi.getAppointment(missed.appointment.id)).resolves.toMatchObject({
      serviceStatus: "completed",
    });
    await expect(mockApi.getAppointment(openEnded.appointment.id)).resolves.toMatchObject({
      serviceStatus: "in_progress",
    });

    vi.setSystemTime(new Date("2099-08-08T11:00:00+08:00"));
    await expect(mockApi.syncAppointmentServiceStatuses()).resolves.toBe(1);
    await expect(mockApi.getAppointment(current.appointment.id)).resolves.toMatchObject({
      serviceStatus: "completed",
    });
    await expect(mockApi.getAppointment(openEnded.appointment.id)).resolves.toMatchObject({
      serviceStatus: "in_progress",
    });
    await expect(mockApi.syncAppointmentServiceStatuses()).resolves.toBe(0);
  });

  it("excludes cancelled appointments from dashboard and revenue reports", async () => {
    const date = "2099-08-02";
    const created = await mockApi.createAppointment({
      ...businessInput(date, "18:00", "19:00", "取消统计回归", 12_345),
      serviceStatus: "completed",
      settlementStatus: "settled",
    });

    expect((await mockApi.getRevenueSummary(date, date, "day")).settledMinor).toBe(12_345);
    await mockApi.setAppointmentServiceStatus(created.appointment.id, "cancelled");

    expect((await mockApi.getRevenueSummary(date, date, "day")).settledMinor).toBe(0);
    expect((await mockApi.getDashboardSummary(date)).todaySettledMinor).toBe(0);
  });

  it("clears a deleted account link while preserving the appointment snapshot", async () => {
    await mockApi.unlockVault("test-password");
    const account = await mockApi.createAccountProfile({
      accountName: `snapshot-account-${Date.now()}`,
      password: "snapshot-secret",
      contactName: "历史联系人",
      server: "历史区服",
      characterName: "历史角色",
    });
    const created = await mockApi.createAppointment({
      ...businessInput("2099-08-06", "10:00", "11:00", "快照保留", 8_800),
      accountProfileId: account.id,
    });

    await mockApi.deleteAccountProfile(account.id);
    const unlinked = await mockApi.getAppointment(created.appointment.id);
    expect(unlinked.accountProfileId).toBeNull();
    expect(unlinked.accountSnapshot).toMatchObject({
      accountName: account.accountName,
      characterName: "历史角色",
    });

    await mockApi.updateAppointment(unlinked.id, {
      ...appointmentToInput(unlinked),
      notes: "删除账号后编辑",
    });
    const edited = await mockApi.getAppointment(unlinked.id);
    expect(edited.accountProfileId).toBeNull();
    expect(edited.accountSnapshot).toEqual(unlinked.accountSnapshot);
  });

  it("batch deletes account profiles, passwords, and live appointment links", async () => {
    await mockApi.unlockVault("test-password");
    const suffix = Date.now();
    const first = await mockApi.createAccountProfile({
      accountName: `batch-account-a-${suffix}`,
      password: "batch-secret-a",
    });
    const second = await mockApi.createAccountProfile({
      accountName: `batch-account-b-${suffix}`,
      password: "batch-secret-b",
    });
    const linked = await mockApi.createAppointment({
      ...businessInput("2099-08-07", "10:00", "11:00", "批量账号删除", 6_600),
      accountProfileId: first.id,
    });

    await expect(
      mockApi.deleteAccountProfiles([first.id, second.id, first.id, " ", "unknown-account"]),
    ).resolves.toBe(2);
    await expect(mockApi.getAccountProfile(first.id)).rejects.toThrow("账号档案不存在");
    await expect(mockApi.getAccountProfile(second.id)).rejects.toThrow("账号档案不存在");
    await expect(mockApi.revealAccountPassword(first.id)).rejects.toThrow("尚未保存密码");
    await expect(mockApi.getAppointment(linked.appointment.id)).resolves.toMatchObject({
      accountProfileId: null,
    });
    await expect(mockApi.deleteAccountProfiles(["unknown-account"])).resolves.toBe(0);
  });

  it("persists a complete manual account order and rejects incomplete input", async () => {
    const before = await mockApi.listAccountProfiles();
    const reversedIds = before.map((profile) => profile.id).reverse();

    await expect(mockApi.reorderAccountProfiles(reversedIds)).resolves.toBeUndefined();
    await expect(mockApi.listAccountProfiles()).resolves.toMatchObject(
      reversedIds.map((id) => ({ id })),
    );
    await expect(mockApi.reorderAccountProfiles(reversedIds.slice(1))).rejects.toThrow(
      "必须包含当前全部账号档案",
    );

    await mockApi.reorderAccountProfiles(before.map((profile) => profile.id));
  });

  it("updates non-secret account usage while the vault is locked", async () => {
    const profile = (await mockApi.listAccountProfiles())[0]!;
    await mockApi.lockVault();

    const updated = await mockApi.updateAccountProfileUsage(profile.id, "  今晚使用中  ");
    expect(updated).toMatchObject({
      id: profile.id,
      accountName: profile.accountName,
      usageInfo: "今晚使用中",
    });
    await expect(mockApi.updateAccountProfileUsage(profile.id, "   ")).resolves.toMatchObject({
      usageInfo: null,
    });
  });

  it("persists validated account table widths in browser demo mode", async () => {
    const previous = (await mockApi.getSettings()).accountTableColumnWidths;
    const widths = { ...previous, contactName: 72, weekly: 224 };

    await expect(mockApi.updateAccountTableColumnWidths(widths)).resolves.toEqual(widths);
    await expect(mockApi.getSettings()).resolves.toMatchObject({
      accountTableColumnWidths: widths,
    });
    expect(localStorage.getItem("timekeeper.demo.accountTableColumnWidths")).toBe(
      JSON.stringify(widths),
    );
    await expect(mockApi.updateAccountTableColumnWidths({ ...widths, weekly: 99 })).rejects.toThrow(
      "列宽超出允许范围",
    );

    await mockApi.updateAccountTableColumnWidths(previous);
  });

  it("preserves the first weekly usage marker then clears at China Monday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00Z"));
    const profile = (await mockApi.listAccountProfiles())[0]!;
    await mockApi.updateAccountProfileUsage(profile.id, "周日安排");
    const populatedCount = (await mockApi.listAccountProfiles()).filter(
      (account) => account.usageInfo != null,
    ).length;

    await expect(mockApi.syncAccountProfileUsageWeek()).resolves.toMatchObject({
      weekStart: "2026-07-27",
      clearedCount: 0,
    });

    vi.setSystemTime(new Date("2026-08-02T16:00:00Z"));
    await expect(mockApi.syncAccountProfileUsageWeek()).resolves.toMatchObject({
      weekStart: "2026-08-03",
      clearedCount: populatedCount,
    });
    await expect(mockApi.getAccountProfile(profile.id)).resolves.toMatchObject({
      usageInfo: null,
    });
    await expect(mockApi.syncAccountProfileUsageWeek()).resolves.toMatchObject({
      clearedCount: 0,
    });

    await mockApi.updateAccountProfileUsage(profile.id, "周一安排");
    await expect(mockApi.clearAccountProfileUsage()).resolves.toBe(1);
    await expect(mockApi.getAccountProfile(profile.id)).resolves.toMatchObject({
      usageInfo: null,
    });
  });

  it("restores the in-memory demo data captured by a backup", async () => {
    const created = await mockApi.createAppointment(
      businessInput("2099-08-03", "10:00", "11:00", "备份恢复回归", 8_800),
    );
    const backup = await mockApi.createBackup("C:\\demo\\closed-loop.tkbackup");

    await mockApi.deleteAppointment(created.appointment.id);
    await expect(mockApi.getAppointment(created.appointment.id)).rejects.toThrow("预约不存在");

    await mockApi.restoreBackup(backup.path);
    await expect(mockApi.getAppointment(created.appointment.id)).resolves.toMatchObject({
      contactName: "备份恢复回归",
      settlementStatus: "unsettled",
    });
    await expect(mockApi.vaultStatus()).resolves.toMatchObject({
      initialized: true,
      unlocked: false,
    });
  });
});
