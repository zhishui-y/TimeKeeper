import { readonly, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type { AccountRoleDataRefreshResult } from "../types/domain";

export interface UseAccountRoleDataRefreshOptions {
  afterRefresh?: (result: AccountRoleDataRefreshResult) => Promise<void> | void;
}

export function useAccountRoleDataRefresh({ afterRefresh }: UseAccountRoleDataRefreshOptions = {}) {
  const busy = shallowRef(false);
  const targetIds = shallowRef<ReadonlySet<string>>(new Set());
  const result = shallowRef<AccountRoleDataRefreshResult | null>(null);
  const error = shallowRef<string | null>(null);

  async function refresh(ids: readonly string[]): Promise<AccountRoleDataRefreshResult | null> {
    if (busy.value) return null;
    const normalizedIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (!normalizedIds.length) return null;

    busy.value = true;
    targetIds.value = new Set(normalizedIds);
    result.value = null;
    error.value = null;
    try {
      const nextResult = await api.refreshAccountProfileRoleData(normalizedIds);
      result.value = nextResult;
      await afterRefresh?.(nextResult);
      return nextResult;
    } catch (cause) {
      error.value = errorMessage(cause);
      return null;
    } finally {
      targetIds.value = new Set();
      busy.value = false;
    }
  }

  function clearResult(): void {
    result.value = null;
    error.value = null;
  }

  return {
    busy: readonly(busy),
    targetIds: readonly(targetIds),
    result: readonly(result),
    error: readonly(error),
    refresh,
    clearResult,
  };
}
