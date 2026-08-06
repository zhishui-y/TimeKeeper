import { defineStore } from "pinia";
import { computed, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type {
  AppAccessRecoveryProof,
  AppAccessRecoverySetup,
  AppAccessStatus,
  LegacyCredentialMigrationResult,
} from "../types/domain";

const emptyStatus: AppAccessStatus = {
  initialized: false,
  unlocked: false,
  legacyMigrationPendingCount: 0,
  recoveryQuestion: null,
};

export const useAppAccessStore = defineStore("appAccess", () => {
  const status = shallowRef<AppAccessStatus>(emptyStatus);
  const ready = shallowRef(false);
  const loading = shallowRef(false);
  const error = shallowRef<string | null>(null);
  let bootstrapRequest: Promise<void> | null = null;

  const initialized = computed(() => status.value.initialized);
  const unlocked = computed(() => status.value.unlocked);
  const legacyMigrationPendingCount = computed(() => status.value.legacyMigrationPendingCount);
  const recoveryQuestion = computed(() => status.value.recoveryQuestion);

  function applyStatus(next: AppAccessStatus): AppAccessStatus {
    status.value = next;
    return next;
  }

  function clearError(): void {
    error.value = null;
  }

  async function runStatusAction(
    action: () => Promise<AppAccessStatus>,
  ): Promise<AppAccessStatus | null> {
    if (loading.value) return null;
    loading.value = true;
    error.value = null;
    try {
      return applyStatus(await action());
    } catch (cause) {
      error.value = errorMessage(cause);
      return null;
    } finally {
      loading.value = false;
    }
  }

  function bootstrap(): Promise<void> {
    if (bootstrapRequest) return bootstrapRequest;
    loading.value = true;
    error.value = null;
    const request = api
      .appAccessStatus()
      .then((next) => {
        applyStatus(next);
      })
      .catch((cause) => {
        error.value = errorMessage(cause);
      })
      .finally(() => {
        ready.value = true;
        loading.value = false;
        bootstrapRequest = null;
      });
    bootstrapRequest = request;
    return request;
  }

  const initialize = (password: string, recovery: AppAccessRecoverySetup) =>
    runStatusAction(() => api.initializeAppAccess(password, recovery));
  const unlock = (password: string) => runStatusAction(() => api.unlockAppAccess(password));
  const lock = () => runStatusAction(() => api.lockAppAccess());
  const changePassword = (currentPassword: string, newPassword: string) =>
    runStatusAction(() => api.changeAppAccessPassword(currentPassword, newPassword));
  const resetPassword = (
    newPassword: string,
    confirmationText: string,
    recoveryProof: AppAccessRecoveryProof,
  ) =>
    runStatusAction(() => api.resetAppAccessPassword(newPassword, confirmationText, recoveryProof));

  const setRecovery = (currentPassword: string, recovery: AppAccessRecoverySetup) =>
    runStatusAction(() => api.setAppAccessRecovery(currentPassword, recovery));

  async function migrateLegacyCredentials(
    password: string,
    recovery?: AppAccessRecoverySetup,
  ): Promise<LegacyCredentialMigrationResult | null> {
    if (loading.value) return null;
    loading.value = true;
    error.value = null;
    try {
      const result = await api.migrateLegacyCredentials(password, recovery);
      applyStatus(await api.appAccessStatus());
      return result;
    } catch (cause) {
      error.value = errorMessage(cause);
      return null;
    } finally {
      loading.value = false;
    }
  }

  return {
    status,
    ready,
    loading,
    error,
    initialized,
    unlocked,
    legacyMigrationPendingCount,
    recoveryQuestion,
    bootstrap,
    initialize,
    unlock,
    lock,
    changePassword,
    resetPassword,
    setRecovery,
    migrateLegacyCredentials,
    clearError,
  };
});
