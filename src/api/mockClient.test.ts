import { describe, expect, it } from "vitest";
import { mockApi } from "./mockClient";

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
});
