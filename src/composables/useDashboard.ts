import { readonly, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type { DashboardSummary } from "../types/domain";

export function useDashboard() {
  const summary = shallowRef<DashboardSummary | null>(null);
  const loading = shallowRef(false);
  const error = shallowRef<string | null>(null);
  const inFlight = new Map<string, Promise<DashboardSummary>>();
  let requestVersion = 0;

  function fetchSummary(date: string): Promise<DashboardSummary> {
    const existing = inFlight.get(date);
    if (existing) return existing;

    const request = api.getDashboardSummary(date);
    inFlight.set(date, request);
    const clear = () => {
      if (inFlight.get(date) === request) inFlight.delete(date);
    };
    void request.then(clear, clear);
    return request;
  }

  async function load(date: string): Promise<void> {
    const version = ++requestVersion;
    loading.value = true;
    error.value = null;
    try {
      const nextSummary = await fetchSummary(date);
      if (version === requestVersion) summary.value = nextSummary;
    } catch (cause) {
      if (version === requestVersion) error.value = errorMessage(cause);
    } finally {
      if (version === requestVersion) loading.value = false;
    }
  }

  return {
    summary: readonly(summary),
    loading: readonly(loading),
    error: readonly(error),
    load,
  };
}
