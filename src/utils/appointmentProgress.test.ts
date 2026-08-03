import { describe, expect, it } from "vitest";
import type { Appointment } from "../types/domain";
import {
  appointmentProgressStatus,
  appointmentProgressStatusesForMode,
  appointmentStatusesFromProgress,
} from "./appointmentProgress";

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appointment-1",
    serviceDate: "2026-08-03",
    contactName: "测试联系人",
    mode: "business",
    serviceStatus: "scheduled",
    settlementStatus: "unsettled",
    createdAt: "2026-08-03T00:00:00Z",
    updatedAt: "2026-08-03T00:00:00Z",
    ...overrides,
  };
}

describe("appointment progress status", () => {
  it("derives entertainment and business progress from the stored pair", () => {
    expect(
      appointmentProgressStatus(appointment({ mode: "entertainment", serviceStatus: "completed" })),
    ).toBe("completed");
    expect(appointmentProgressStatus(appointment({ serviceStatus: "completed" }))).toBe(
      "pending_settlement",
    );
    expect(
      appointmentProgressStatus(
        appointment({ serviceStatus: "in_progress", settlementStatus: "settled" }),
      ),
    ).toBe("completed");
    expect(
      appointmentProgressStatus(
        appointment({ serviceStatus: "cancelled", settlementStatus: "settled" }),
      ),
    ).toBe("cancelled");
  });

  it("maps unified business progress back to canonical storage pairs", () => {
    expect(appointmentStatusesFromProgress("business", "pending_settlement", "settled")).toEqual({
      serviceStatus: "completed",
      settlementStatus: "unsettled",
    });
    expect(appointmentStatusesFromProgress("business", "completed", "unsettled")).toEqual({
      serviceStatus: "completed",
      settlementStatus: "settled",
    });
    expect(appointmentStatusesFromProgress("business", "cancelled", "settled")).toEqual({
      serviceStatus: "cancelled",
      settlementStatus: "settled",
    });
  });

  it("offers four entertainment states and five business states", () => {
    expect(appointmentProgressStatusesForMode("entertainment")).toEqual([
      "scheduled",
      "in_progress",
      "completed",
      "cancelled",
    ]);
    expect(appointmentProgressStatusesForMode("business")).toContain("pending_settlement");
  });
});
