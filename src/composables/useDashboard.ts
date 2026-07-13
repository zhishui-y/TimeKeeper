import { readonly, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type { DashboardSummary } from "../types/domain";

export function useDashboard() {
  const summary = shallowRef<DashboardSummary | null>(null);
  const loading = shallowRef(false);
  const error = shallowRef<string | null>(null);

  async function load(date: string): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      summary.value = await api.getDashboardSummary(date);
    } catch (cause) {
      error.value = errorMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  return {
    summary: readonly(summary),
    loading: readonly(loading),
    error: readonly(error),
    load,
  };
}
