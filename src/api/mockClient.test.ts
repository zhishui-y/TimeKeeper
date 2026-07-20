import { describe, expect, it } from "vitest";
import type { AppointmentInput } from "../types/domain";
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
