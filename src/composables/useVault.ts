import { readonly, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type { VaultStatus } from "../types/domain";

const status = shallowRef<VaultStatus>({
  initialized: false,
  unlocked: false,
  autoLockMinutes: 15,
});
const loading = shallowRef(false);
const error = shallowRef<string | null>(null);

export function useVault() {
  async function run(action: () => Promise<VaultStatus>): Promise<VaultStatus | null> {
    loading.value = true;
    error.value = null;
    try {
      status.value = await action();
      return status.value;
    } catch (cause) {
      error.value = errorMessage(cause);
      return null;
    } finally {
      loading.value = false;
    }
  }

  const load = () => run(() => api.vaultStatus());
  const initialize = (password: string) => run(() => api.initializeVault(password));
  const unlock = (password: string) => run(() => api.unlockVault(password));
  const lock = () => run(() => api.lockVault());

  return {
    status: readonly(status),
    loading: readonly(loading),
    error: readonly(error),
    load,
    initialize,
    unlock,
    lock,
  };
}
