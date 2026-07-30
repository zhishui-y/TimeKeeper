import { describe, expect, it } from "vitest";
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
  it("uses the same preview token then commit import flow without exposing passwords", async () => {
    const preview = await mockApi.previewExcelImport("C:\\demo\\account.xlsm", 2026);
    expect(preview.previewToken).toBeTruthy();
    expect(preview).not.toHaveProperty("password");
    expect(preview).not.toHaveProperty("passwords");

    const result = await mockApi.commitExcelImport(preview.previewToken);
    expect(result.importedAppointments).toBeGreaterThan(0);
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

    const completed = await mockApi.setAppointmentServiceStatus(second.appointment.id, "completed");
    expect(completed.settlementStatus).toBe("unsettled");

    const beforeSettlement = await mockApi.getRevenueSummary(date, date, "day");
    expect(beforeSettlement.settledMinor).toBe(0);
    expect(beforeSettlement.unsettledMinor).toBe(30_000);
    expect(beforeSettlement.businessHours).toBe(2);

    await mockApi.settleAppointment(second.appointment.id, 25_000, "微信");
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
