import { readonly, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type { ReportGranularity, RevenueSummary } from "../types/domain";

export function useRevenue() {
  const summary = shallowRef<RevenueSummary | null>(null);
  const loading = shallowRef(false);
  const error = shallowRef<string | null>(null);
  const inFlight = new Map<string, Promise<RevenueSummary>>();
  let requestVersion = 0;

  function requestKey(from: string, to: string, granularity: ReportGranularity): string {
    return JSON.stringify([from, to, granularity]);
  }

  function fetchSummary(
    from: string,
    to: string,
    granularity: ReportGranularity,
  ): Promise<RevenueSummary> {
    const key = requestKey(from, to, granularity);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const request = api.getRevenueSummary(from, to, granularity);
    inFlight.set(key, request);
    const clear = () => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    };
    void request.then(clear, clear);
    return request;
  }

  async function load(from: string, to: string, granularity: ReportGranularity): Promise<void> {
    const version = ++requestVersion;
    loading.value = true;
    error.value = null;
    try {
      const nextSummary = await fetchSummary(from, to, granularity);
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
