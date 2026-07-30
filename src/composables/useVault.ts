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
type VaultOperation = "load" | "initialize" | "unlock" | "change-password" | "lock";

interface InFlightVaultRequest {
  operation: VaultOperation;
  argument?: string;
  promise: Promise<VaultStatus>;
}

const inFlight = new Set<InFlightVaultRequest>();
let requestVersion = 0;

export function useVault() {
  function fetchStatus(
    operation: VaultOperation,
    argument: string | undefined,
    action: () => Promise<VaultStatus>,
  ): Promise<VaultStatus> {
    const existing = [...inFlight].find(
      (request) => request.operation === operation && request.argument === argument,
    );
    if (existing) return existing.promise;

    const request: InFlightVaultRequest = {
      operation,
      argument,
      promise: Promise.resolve().then(action),
    };
    inFlight.add(request);
    const clear = () => inFlight.delete(request);
    void request.promise.then(clear, clear);
    return request.promise;
  }

  async function run(
    operation: VaultOperation,
    argument: string | undefined,
    action: () => Promise<VaultStatus>,
  ): Promise<VaultStatus | null> {
    const version = ++requestVersion;
    loading.value = true;
    error.value = null;
    try {
      const nextStatus = await fetchStatus(operation, argument, action);
      if (version === requestVersion) status.value = nextStatus;
      return nextStatus;
    } catch (cause) {
      if (version === requestVersion) error.value = errorMessage(cause);
      return null;
    } finally {
      if (version === requestVersion) loading.value = false;
    }
  }

  const load = () => run("load", undefined, () => api.vaultStatus());
  const initialize = (password: string) =>
    run("initialize", password, () => api.initializeVault(password));
  const unlock = (password: string) => run("unlock", password, () => api.unlockVault(password));
  const changePassword = (currentPassword: string, newPassword: string) =>
    run("change-password", undefined, () => api.changeVaultPassword(currentPassword, newPassword));
  const lock = () => run("lock", undefined, () => api.lockVault());

  return {
    status: readonly(status),
    loading: readonly(loading),
    error: readonly(error),
    load,
    initialize,
    unlock,
    changePassword,
    lock,
  };
}
