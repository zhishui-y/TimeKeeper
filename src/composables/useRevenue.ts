import { readonly, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type { ReportGranularity, RevenueSummary } from "../types/domain";

export function useRevenue() {
  const summary = shallowRef<RevenueSummary | null>(null);
  const loading = shallowRef(false);
  const error = shallowRef<string | null>(null);

  async function load(from: string, to: string, granularity: ReportGranularity): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      summary.value = await api.getRevenueSummary(from, to, granularity);
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
