import { computed, onScopeDispose } from "vue";
import { useOperationStore } from "../stores/operations";
import type { AccountRoleDataRefreshProgress, AccountRoleDataRefreshResult } from "../types/domain";

export interface UseAccountRoleDataRefreshOptions {
  onProgress?: (progress: AccountRoleDataRefreshProgress) => void;
}

const SUCCESS_DISMISS_DELAY_MS = 3_000;

export function useAccountRoleDataRefresh({ onProgress }: UseAccountRoleDataRefreshOptions = {}) {
  const operations = useOperationStore();
  const busy = computed(() => operations.current?.kind === "accountRoleRefresh");
  const targetIds = computed(() => operations.roleRefreshTargetIds);
  const result = computed(() => operations.roleRefreshResult);
  const error = computed(() => operations.roleRefreshError);
  let dismissTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let disposed = false;

  function cancelDismissTimer(): void {
    if (dismissTimer === undefined) return;
    globalThis.clearTimeout(dismissTimer);
    dismissTimer = undefined;
  }

  function scheduleDismiss(nextResult: AccountRoleDataRefreshResult): void {
    if (disposed || nextResult.failedCount > 0) return;
    dismissTimer = globalThis.setTimeout(() => {
      operations.roleRefreshResult = null;
      dismissTimer = undefined;
    }, SUCCESS_DISMISS_DELAY_MS);
  }

  async function refresh(ids: readonly string[]): Promise<AccountRoleDataRefreshResult | null> {
    if (operations.busy) return null;
    const normalizedIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (!normalizedIds.length) return null;

    cancelDismissTimer();
    try {
      const nextResult = await operations.refreshRoleData(normalizedIds, onProgress);
      scheduleDismiss(nextResult);
      return nextResult;
    } catch {
      return null;
    }
  }

  function clearResult(): void {
    cancelDismissTimer();
    operations.roleRefreshResult = null;
    operations.roleRefreshError = null;
  }

  onScopeDispose(() => {
    disposed = true;
    cancelDismissTimer();
  });

  return {
    busy,
    targetIds,
    result,
    error,
    refresh,
    clearResult,
  };
}
