import type { ToastTone } from "../stores/ui";
import type { VaultStatus, VaultUnlockResult } from "../types/domain";

export interface VaultUnlockFeedback {
  message: string;
  tone: ToastTone;
}

export function appointmentPasswordMigrationFeedback(
  result: VaultStatus | VaultUnlockResult,
): VaultUnlockFeedback | null {
  const migration = (result as VaultUnlockResult).appointmentPasswordMigration;
  if (!migration) return null;

  const details = [`已迁移 ${migration.migratedCount} 条历史预约密码`];
  if (migration.missingCount > 0) details.push(`${migration.missingCount} 条缺少来源密码`);
  if (migration.pendingCount > 0) details.push(`${migration.pendingCount} 条待下次解锁重试`);
  return {
    message: `密码库已解锁；${details.join("，")}`,
    tone: migration.missingCount > 0 || migration.pendingCount > 0 ? "warning" : "success",
  };
}

export function vaultUnlockFeedback(result: VaultStatus | VaultUnlockResult): VaultUnlockFeedback {
  return (
    appointmentPasswordMigrationFeedback(result) ?? {
      message: "密码库已解锁",
      tone: "success",
    }
  );
}
