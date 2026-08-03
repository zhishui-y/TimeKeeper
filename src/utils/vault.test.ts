import { describe, expect, it } from "vitest";
import { appointmentPasswordMigrationFeedback, vaultUnlockFeedback } from "./vault";

describe("vault unlock feedback", () => {
  it("reports migrated, missing, and retryable appointment passwords", () => {
    expect(
      vaultUnlockFeedback({
        initialized: true,
        unlocked: true,
        autoLockMinutes: 15,
        appointmentPasswordMigration: {
          migratedCount: 4,
          missingCount: 2,
          pendingCount: 1,
        },
      }),
    ).toEqual({
      message: "密码库已解锁；已迁移 4 条历史预约密码，2 条缺少来源密码，1 条待下次解锁重试",
      tone: "warning",
    });
  });

  it("omits migration detail when no backfill ran", () => {
    const status = { initialized: true, unlocked: true, autoLockMinutes: 15 };
    expect(appointmentPasswordMigrationFeedback(status)).toBeNull();
    expect(vaultUnlockFeedback(status)).toEqual({ message: "密码库已解锁", tone: "success" });
  });
});
