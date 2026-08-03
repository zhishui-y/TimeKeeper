import { inject, provide, readonly, shallowRef } from "vue";
import type { InjectionKey } from "vue";
import { api, errorMessage } from "../api/client";
import { useUiStore } from "../stores/ui";
import { appointmentPasswordMigrationFeedback } from "../utils/vault";

function createAppointmentPasswordCopyController() {
  const ui = useUiStore();
  const unlockOpen = shallowRef(false);
  const unlockLoading = shallowRef(false);
  const unlockError = shallowRef<string | null>(null);
  let pendingAction: (() => Promise<void>) | null = null;

  function promptUnlock(action: () => Promise<void>): void {
    pendingAction = action;
    unlockError.value = null;
    unlockOpen.value = true;
  }

  async function runWhenUnlocked(action: () => Promise<void>): Promise<boolean> {
    const status = await api.vaultStatus();
    if (!status.unlocked) {
      promptUnlock(action);
      return false;
    }
    await action();
    return true;
  }

  async function runWithUnlockRetry(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (cause) {
      try {
        const status = await api.vaultStatus();
        if (!status.unlocked) {
          promptUnlock(() => runWithUnlockRetry(action));
          return;
        }
      } catch {
        // 保留原始操作错误，避免状态检查覆盖真正原因。
      }
      throw cause;
    }
  }

  async function copy(appointmentId: string): Promise<void> {
    try {
      await runWhenUnlocked(async () => {
        await api.copyAppointmentAccountPassword(appointmentId);
        ui.notify("账号密码已复制，30秒后自动清空剪贴板", "success");
      });
    } catch (cause) {
      try {
        const status = await api.vaultStatus();
        if (!status.unlocked) {
          promptUnlock(() => copy(appointmentId));
          return;
        }
      } catch {
        // 保留原始秘密操作错误，避免状态检查覆盖真正原因。
      }
      ui.notify(errorMessage(cause), "danger");
    }
  }

  function closeUnlock(): void {
    unlockOpen.value = false;
    unlockError.value = null;
    pendingAction = null;
  }

  async function unlockAndRetry(password: string): Promise<void> {
    const action = pendingAction;
    if (!action || unlockLoading.value) return;
    unlockLoading.value = true;
    unlockError.value = null;
    let migrationFeedback: ReturnType<typeof appointmentPasswordMigrationFeedback> = null;
    try {
      const result = await api.unlockVault(password);
      migrationFeedback = appointmentPasswordMigrationFeedback(result);
      await action();
      unlockOpen.value = false;
      pendingAction = null;
    } catch (cause) {
      unlockError.value = errorMessage(cause);
    } finally {
      if (migrationFeedback) {
        ui.notifyAfterCurrent(migrationFeedback.message, migrationFeedback.tone);
      }
      unlockLoading.value = false;
    }
  }

  return {
    ownsUnlockDialog: true,
    unlockOpen: readonly(unlockOpen),
    unlockLoading: readonly(unlockLoading),
    unlockError: readonly(unlockError),
    copy,
    closeUnlock,
    runWhenUnlocked,
    runWithUnlockRetry,
    unlockAndRetry,
  };
}

export type AppointmentPasswordCopyController = ReturnType<
  typeof createAppointmentPasswordCopyController
>;

const appointmentPasswordCopyKey: InjectionKey<AppointmentPasswordCopyController> = Symbol(
  "appointment-password-copy",
);

export function useAppointmentPasswordCopy(): AppointmentPasswordCopyController {
  const shared = inject(appointmentPasswordCopyKey, null);
  if (shared) return { ...shared, ownsUnlockDialog: false };
  return createAppointmentPasswordCopyController();
}

export function provideAppointmentPasswordCopy(
  controller: AppointmentPasswordCopyController,
): void {
  provide(appointmentPasswordCopyKey, controller);
}
