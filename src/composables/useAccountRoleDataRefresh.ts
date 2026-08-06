import { onScopeDispose, readonly, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type { AccountRoleDataRefreshResult } from "../types/domain";

export interface UseAccountRoleDataRefreshOptions {
  afterRefresh?: (result: AccountRoleDataRefreshResult) => Promise<void> | void;
}

const SUCCESS_DISMISS_DELAY_MS = 3_000;

export function useAccountRoleDataRefresh({ afterRefresh }: UseAccountRoleDataRefreshOptions = {}) {
  const busy = shallowRef(false);
  const targetIds = shallowRef<ReadonlySet<string>>(new Set());
  const result = shallowRef<AccountRoleDataRefreshResult | null>(null);
  const error = shallowRef<string | null>(null);
  let dismissTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

  function cancelDismissTimer(): void {
    if (dismissTimer === undefined) return;
    globalThis.clearTimeout(dismissTimer);
    dismissTimer = undefined;
  }

  function scheduleDismiss(nextResult: AccountRoleDataRefreshResult): void {
    if (nextResult.failedCount > 0) return;
    dismissTimer = globalThis.setTimeout(() => {
      result.value = null;
      dismissTimer = undefined;
    }, SUCCESS_DISMISS_DELAY_MS);
  }

  async function refresh(ids: readonly string[]): Promise<AccountRoleDataRefreshResult | null> {
    if (busy.value) return null;
    const normalizedIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (!normalizedIds.length) return null;

    cancelDismissTimer();
    busy.value = true;
    targetIds.value = new Set(normalizedIds);
    result.value = null;
    error.value = null;
    try {
      const nextResult = await api.refreshAccountProfileRoleData(normalizedIds);
      result.value = nextResult;
      await afterRefresh?.(nextResult);
      scheduleDismiss(nextResult);
      return nextResult;
    } catch (cause) {
      result.value = null;
      error.value = errorMessage(cause);
      return null;
    } finally {
      targetIds.value = new Set();
      busy.value = false;
    }
  }

  function clearResult(): void {
    cancelDismissTimer();
    result.value = null;
    error.value = null;
  }

  onScopeDispose(cancelDismissTimer);

  return {
    busy: readonly(busy),
    targetIds: readonly(targetIds),
    result: readonly(result),
    error: readonly(error),
    refresh,
    clearResult,
  };
}
