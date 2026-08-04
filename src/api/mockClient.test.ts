import { afterEach, describe, expect, it, vi } from "vitest";
import { format } from "date-fns";
import type { AppointmentInput } from "../types/domain";
import { appointmentToInput } from "../utils/appointment";
import { DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS } from "../utils/accountTableColumns";
import { DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS } from "../utils/appointmentTableColumns";
import { appointmentProgressStatus } from "../utils/appointmentProgress";
import { mockApi } from "./mockClient";

const allAppointmentDates = { from: "2000-01-01", to: "2100-12-31" } as const;

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
    expect(preview.yyChannelCount).toBeGreaterThan(0);
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

  it("refreshes role data deterministically without a network request", async () => {
    const result = await mockApi.refreshAccountProfileRoleData([
      "account-1",
      "account-3",
      "missing-account",
      "account-1",
    ]);

    expect(result.requestedCount).toBe(3);
    expect(result.items.map((item) => item.status)).toEqual(["updated", "noRecord", "failed"]);
    expect(result.updatedCount).toBe(1);
    expect(result.noRecordCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect((await mockApi.getAccountProfile("account-1")).scoreUpdatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("copies a profile character name through the demo client", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const profile = (await mockApi.listAccountProfiles()).find((item) => item.characterName);
    expect(profile).toBeDefined();

    await mockApi.copyAccountCharacterName(profile!.id);

    expect(writeText).toHaveBeenCalledWith(profile!.characterName);
    vi.unstubAllGlobals();
  });

  it("copies an appointment account name through the ID command", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const target = (await mockApi.listAppointments(allAppointmentDates)).find(
      (item) => item.account?.accountName,
    );
    expect(target?.account?.accountName).toBeTruthy();

    await mockApi.copyAppointmentAccountName(target!.id);

    expect(writeText).toHaveBeenCalledWith(target!.account!.accountName);
    vi.unstubAllGlobals();
  });

  it("copies only a valid YY channel without unlocking or scheduling clipboard cleanup", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const setTimeout = vi.spyOn(globalThis, "setTimeout");
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const yy = await mockApi.createAppointment({
      ...businessInput("2099-08-06", "10:00", "11:00", "YY频道", 1_000),
      voicePlatform: "yy",
      voiceChannel: "794676",
    });
    const qq = await mockApi.createAppointment({
      ...businessInput("2099-08-06", "11:00", "12:00", "QQ语音", 1_000),
      voicePlatform: "qq",
    });
    const emptyYy = await mockApi.createAppointment({
      ...businessInput("2099-08-06", "12:00", "13:00", "空YY频道", 1_000),
      voicePlatform: "yy",
    });

    try {
      await expect(mockApi.copyAppointmentVoiceChannel(yy.appointment.id)).resolves.toBeUndefined();
      expect(writeText).toHaveBeenCalledWith("794676");
      expect(setTimeout).not.toHaveBeenCalled();
      await expect(mockApi.copyAppointmentVoiceChannel(qq.appointment.id)).rejects.toThrow(
        "未选择YY语音",
      );
      await expect(mockApi.copyAppointmentVoiceChannel(emptyYy.appointment.id)).rejects.toThrow(
        "未填写YY频道号",
      );
      await expect(mockApi.copyAppointmentVoiceChannel("missing-appointment")).rejects.toThrow(
        "预约不存在",
      );
    } finally {
      await mockApi.deleteAppointments({
        kind: "explicit",
        ids: [yy.appointment.id, qq.appointment.id, emptyYy.appointment.id],
      });
      vi.unstubAllGlobals();
    }
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

  it("keeps reminders disabled when reminder minutes are omitted or null", async () => {
    const previousSettings = await mockApi.getSettings();
    await mockApi.updateSettings({ ...previousSettings, defaultReminderMinutes: 60 });

    try {
      const omitted = await mockApi.createAppointment(
        businessInput("2099-08-05", "10:00", "11:00", "省略提醒", 1_000),
      );
      const disabled = await mockApi.createAppointment({
        ...businessInput("2099-08-05", "12:00", "13:00", "关闭提醒", 1_000),
        reminderMinutes: null,
      });

      expect(omitted.appointment.reminderMinutes).toBeNull();
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
    expect(beforeSettlement.pendingCount).toBe(1);
    expect(beforeSettlement.points[0]?.pendingCount).toBe(1);
    expect(beforeSettlement.businessHours).toBe(2);

    await mockApi.settleAppointment(second.appointment.id, 25_000, "微信");
    expect((await mockApi.getDashboardSummary(date)).pendingCount).toBe(
      pendingCountBeforeCompletion,
    );
    const afterSettlement = await mockApi.getRevenueSummary(date, date, "day");
    expect(afterSettlement.settledMinor).toBe(25_000);
    expect(afterSettlement.unsettledMinor).toBe(10_000);
    expect(afterSettlement.pendingCount).toBe(0);
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
    ).rejects.toThrow("已完成预约必须填写金额");

    await expect(
      mockApi.createAppointment(businessInput("2099-08-04", "13:00", "14:00", "负金额", -1)),
    ).rejects.toThrow("金额不能为负数");
  });

  it("accepts zero for both direct completion and the settlement command", async () => {
    const date = "2099-12-29";
    const direct = await mockApi.createAppointment({
      ...businessInput(date, "10:00", "11:00", "零元直接结算", 0),
      settlementStatus: "settled",
    });
    const pending = await mockApi.createAppointment({
      ...businessInput(date, "12:00", "13:00", "零元快捷结算", 1_000),
      serviceStatus: "completed",
    });

    try {
      expect(direct.appointment).toMatchObject({
        serviceStatus: "completed",
        settlementStatus: "settled",
        amountMinor: 0,
      });
      await expect(
        mockApi.settleAppointment(pending.appointment.id, 0, "其他"),
      ).resolves.toMatchObject({
        serviceStatus: "completed",
        settlementStatus: "settled",
        amountMinor: 0,
      });
      await expect(mockApi.getRevenueSummary(date, date, "day")).resolves.toMatchObject({
        settledMinor: 0,
        pendingCount: 0,
      });
    } finally {
      await mockApi.deleteAppointments({
        kind: "explicit",
        ids: [direct.appointment.id, pending.appointment.id],
      });
    }
  });

  it("filters appointments by unified progress across both modes", async () => {
    const createdIds: string[] = [];
    try {
      const pending = await mockApi.createAppointment({
        ...businessInput("2099-08-20", "10:00", "11:00", "筛选待结算", 10_000),
        serviceStatus: "completed",
      });
      const settled = await mockApi.createAppointment({
        ...businessInput("2099-08-21", "10:00", "11:00", "筛选业务完成", 20_000),
        settlementStatus: "settled",
      });
      const entertainment = await mockApi.createAppointment({
        ...businessInput("2099-08-22", "10:00", "11:00", "筛选娱乐完成", 30_000),
        mode: "entertainment",
        serviceStatus: "completed",
      });
      createdIds.push(pending.appointment.id, settled.appointment.id, entertainment.appointment.id);

      expect(
        await mockApi.listAppointments({
          ...allAppointmentDates,
          progressStatus: "pending_settlement",
        }),
      ).toContainEqual(expect.objectContaining({ id: pending.appointment.id }));
      const completed = await mockApi.listAppointments({
        ...allAppointmentDates,
        progressStatus: "completed",
      });
      expect(completed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: settled.appointment.id }),
          expect.objectContaining({ id: entertainment.appointment.id }),
        ]),
      );
      expect(completed.some((item) => item.id === pending.appointment.id)).toBe(false);
    } finally {
      await mockApi.deleteAppointments({ kind: "explicit", ids: createdIds });
    }
  });

  it("automatically starts timed appointments and completes each mode with its proper progress", async () => {
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
    const entertainment = await mockApi.createAppointment({
      ...businessInput("2099-08-08", "10:00", "11:00", "娱乐完成", 0),
      mode: "entertainment",
      settlementStatus: "not_applicable",
      rateNote: null,
      amountMinor: null,
    });

    await expect(mockApi.syncAppointmentServiceStatuses()).resolves.toBeGreaterThanOrEqual(4);
    await expect(mockApi.getAppointment(current.appointment.id)).resolves.toMatchObject({
      serviceStatus: "in_progress",
    });
    await expect(mockApi.getAppointment(missed.appointment.id)).resolves.toMatchObject({
      serviceStatus: "completed",
    });
    await expect(mockApi.getAppointment(openEnded.appointment.id)).resolves.toMatchObject({
      serviceStatus: "in_progress",
    });
    await expect(mockApi.getAppointment(entertainment.appointment.id)).resolves.toMatchObject({
      serviceStatus: "in_progress",
      settlementStatus: "not_applicable",
    });

    vi.setSystemTime(new Date("2099-08-08T11:00:00+08:00"));
    await expect(mockApi.syncAppointmentServiceStatuses()).resolves.toBe(2);
    await expect(mockApi.getAppointment(current.appointment.id)).resolves.toMatchObject({
      serviceStatus: "completed",
      settlementStatus: "unsettled",
    });
    expect(appointmentProgressStatus(await mockApi.getAppointment(current.appointment.id))).toBe(
      "pending_settlement",
    );
    await expect(mockApi.getAppointment(entertainment.appointment.id)).resolves.toMatchObject({
      serviceStatus: "completed",
      settlementStatus: "not_applicable",
    });
    expect(
      appointmentProgressStatus(await mockApi.getAppointment(entertainment.appointment.id)),
    ).toBe("completed");
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

  it("keeps an appointment account independent after its source profile is deleted", async () => {
    const account = await mockApi.createAccountProfile({
      accountName: `snapshot-account-${Date.now()}`,
      password: "snapshot-secret",
      contactName: "历史联系人",
      server: "历史区服",
      characterName: "历史角色",
    });
    const created = await mockApi.createAppointment({
      ...businessInput("2099-08-06", "10:00", "11:00", "快照保留", 8_800),
      account: { kind: "profile", profileId: account.id },
    });

    await mockApi.deleteAccountProfile(account.id);
    const unlinked = await mockApi.getAppointment(created.appointment.id);
    expect(unlinked.account).toMatchObject({
      accountName: account.accountName,
      server: "历史区服",
      password: "snapshot-secret",
    });

    await mockApi.updateAppointment(unlinked.id, {
      ...appointmentToInput(unlinked),
      notes: "删除账号后编辑",
    });
    const edited = await mockApi.getAppointment(unlinked.id);
    expect(edited.account).toEqual(unlinked.account);
  });

  it("batch deletes account profiles without rewriting embedded appointment accounts", async () => {
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
      account: { kind: "profile", profileId: first.id },
    });

    await expect(
      mockApi.deleteAccountProfiles([first.id, second.id, first.id, " ", "unknown-account"]),
    ).resolves.toBe(2);
    await expect(mockApi.getAccountProfile(first.id)).rejects.toThrow("账号档案不存在");
    await expect(mockApi.getAccountProfile(second.id)).rejects.toThrow("账号档案不存在");
    await expect(mockApi.getAppointment(linked.appointment.id)).resolves.toMatchObject({
      account: { accountName: first.accountName, password: "batch-secret-a" },
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

  it("updates account usage without a feature-level unlock flow", async () => {
    const profile = (await mockApi.listAccountProfiles())[0]!;

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
    await expect(mockApi.updateAccountTableColumnWidths({ ...widths, weekly: 47 })).rejects.toThrow(
      "列宽超出允许范围",
    );

    await mockApi.updateAccountTableColumnWidths(previous);
  });

  it("persists validated appointment table widths in browser demo mode", async () => {
    const previous = (await mockApi.getSettings()).appointmentTableColumnWidths;
    const widths = { ...previous, content: 216, account: 232 };

    await expect(mockApi.updateAppointmentTableColumnWidths(widths)).resolves.toEqual(widths);
    await expect(mockApi.getSettings()).resolves.toMatchObject({
      appointmentTableColumnWidths: widths,
    });
    expect(localStorage.getItem("timekeeper.demo.appointmentTableColumnWidths")).toBe(
      JSON.stringify(widths),
    );
    await expect(
      mockApi.updateAppointmentTableColumnWidths({ ...widths, account: 47 }),
    ).rejects.toThrow("列宽超出允许范围");

    await mockApi.updateAppointmentTableColumnWidths(previous);
  });

  it("migrates the legacy payment-method width in browser demo mode", async () => {
    const current = (await mockApi.getSettings()).appointmentTableColumnWidths;
    const legacyWidths: Partial<typeof current> & { paymentMethod?: number } = {
      ...current,
    };
    delete legacyWidths.notes;
    delete legacyWidths.voice;
    localStorage.setItem(
      "timekeeper.demo.appointmentTableColumnWidths",
      JSON.stringify({ ...legacyWidths, paymentMethod: 88 }),
    );
    vi.resetModules();

    const { mockApi: migratedMockApi } = await import("./mockClient");
    await expect(migratedMockApi.getSettings()).resolves.toMatchObject({
      appointmentTableColumnWidths: {
        ...legacyWidths,
        voice: DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS.voice,
        notes: 88,
      },
    });
    expect(
      JSON.parse(localStorage.getItem("timekeeper.demo.appointmentTableColumnWidths")!),
    ).toEqual({
      ...legacyWidths,
      voice: DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS.voice,
      notes: 88,
    });
    localStorage.removeItem("timekeeper.demo.appointmentTableColumnWidths");
  });

  it("adds account and password widths to legacy browser settings", async () => {
    const current = (await mockApi.getSettings()).accountTableColumnWidths;
    const legacyWidths: Partial<typeof current> = { ...current };
    delete legacyWidths.accountName;
    delete legacyWidths.password;
    localStorage.setItem(
      "timekeeper.demo.accountTableColumnWidths",
      JSON.stringify({ ...legacyWidths, weekly: 224 }),
    );
    vi.resetModules();

    const { mockApi: migratedMockApi } = await import("./mockClient");
    await expect(migratedMockApi.getSettings()).resolves.toMatchObject({
      accountTableColumnWidths: {
        ...legacyWidths,
        accountName: DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS.accountName,
        password: DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS.password,
        weekly: 224,
      },
    });
    localStorage.removeItem("timekeeper.demo.accountTableColumnWidths");
  });

  it("preserves the first weekly usage marker then clears at China Monday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2098-08-03T12:00:00Z"));
    const profile = (await mockApi.listAccountProfiles())[0]!;
    await mockApi.updateAccountProfileUsage(profile.id, "周日安排");
    const populatedCount = (await mockApi.listAccountProfiles()).filter(
      (account) => account.usageInfo != null,
    ).length;

    await expect(mockApi.syncAccountProfileUsageWeek()).resolves.toMatchObject({
      weekStart: "2098-07-28",
      clearedCount: 0,
    });

    vi.setSystemTime(new Date("2098-08-03T16:00:00Z"));
    await expect(mockApi.syncAccountProfileUsageWeek()).resolves.toMatchObject({
      weekStart: "2098-08-04",
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

  it("returns one-time appointment passwords with appointment DTOs", async () => {
    const suffix = Date.now();
    const contactName = `模板联系人-${suffix}`;
    const first = await mockApi.createAppointment({
      ...businessInput("2099-08-11", "18:00", "19:00", contactName, 9_900),
      account: {
        kind: "embedded",
        details: {
          accountName: `temporary-${suffix}`,
          specialization: "冰心",
          server: "梦江南",
          gearScore: "20万",
        },
        credential: { kind: "replace", password: "one-time-secret" },
      },
      voicePlatform: "yy",
      voiceChannel: "123456",
    });

    expect(first.appointment.account).toMatchObject({
      accountName: `temporary-${suffix}`,
      password: "one-time-secret",
    });
    expect(JSON.stringify(first.appointment)).toContain("one-time-secret");

    const presets = await mockApi.listContactPresets(contactName, 10);
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({
      sourceAppointmentId: first.appointment.id,
      contactName,
      voicePlatform: "yy",
      voiceChannel: "123456",
      account: { password: "one-time-secret" },
    });
    expect(JSON.stringify(presets)).toContain("one-time-secret");
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
    await expect(mockApi.appAccessStatus()).resolves.toMatchObject({
      initialized: true,
      unlocked: false,
    });
  });

  it("paginates filtered appointments and deletes a token snapshot with exclusions", async () => {
    const suffix = Date.now();
    const query = `分页-${suffix}`;
    const created = await Promise.all(
      ["09:00", "10:00", "11:00"].map((startTime, index) =>
        mockApi.createAppointment(
          businessInput("2099-09-01", startTime, `${12 + index}:00`, `${query}-${index}`, 1_000),
        ),
      ),
    );
    const ids = created.map((result) => result.appointment.id);

    const secondPage = await mockApi.listAppointmentPage({ query }, 2, 2);
    expect(secondPage).toMatchObject({ totalCount: 3, page: 2, pageSize: 2, totalPages: 2 });
    expect(secondPage.items).toHaveLength(1);

    const snapshot = await mockApi.createAppointmentSelection({ query });
    expect(snapshot.totalCount).toBe(3);
    const result = await mockApi.deleteAppointments({
      kind: "token",
      token: snapshot.token,
      excludedIds: [ids[0]!],
    });
    expect(result).toEqual({ matchedCount: 2, deletedCount: 2 });
    await expect(
      mockApi.deleteAppointments({ kind: "token", token: snapshot.token, excludedIds: [] }),
    ).rejects.toThrow("已过期");

    await mockApi.deleteAppointments({ kind: "explicit", ids: [ids[0]!] });
  });
});
