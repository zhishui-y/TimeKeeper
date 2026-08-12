import { computed } from "vue";
import { api } from "../api/client";
import type { ReportGranularity, RevenueSummary } from "../types/domain";
import { useAsyncResource } from "./useAsyncResource";

export interface RevenueRequestKey {
  from: string;
  to: string;
  granularity: ReportGranularity;
}

export function useRevenue() {
  const resource = useAsyncResource<RevenueSummary, RevenueRequestKey>(
    (left, right) =>
      left.from === right.from && left.to === right.to && left.granularity === right.granularity,
  );
  const inFlight = new Map<string, Promise<RevenueSummary>>();

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
    const key = { from, to, granularity };
    await resource.load(key, () => fetchSummary(from, to, granularity));
  }

  return {
    summary: resource.data,
    loading: resource.loading,
    error: resource.error,
    status: resource.status,
    stale: resource.stale,
    actionsDisabled: resource.actionsDisabled,
    requestedKey: resource.requestedKey,
    resolvedKey: resource.resolvedKey,
    resolvedRange: computed(() => {
      const key = resource.resolvedKey.value;
      return key ? { from: key.from, to: key.to } : null;
    }),
    load,
  };
}
