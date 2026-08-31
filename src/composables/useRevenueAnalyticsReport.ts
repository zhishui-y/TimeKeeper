import type { RevenueAnalyticsReport } from "../types/domain";
import { api } from "../api/client";
import { useAsyncResource } from "./useAsyncResource";

interface RevenueAnalyticsRequestKey {
  from: string;
  to: string;
}

function sameKey(left: RevenueAnalyticsRequestKey, right: RevenueAnalyticsRequestKey): boolean {
  return left.from === right.from && left.to === right.to;
}

export function useRevenueAnalyticsReport() {
  const resource = useAsyncResource<RevenueAnalyticsReport, RevenueAnalyticsRequestKey>(sameKey);
  const inFlight = new Map<string, Promise<RevenueAnalyticsReport>>();

  function fetchReport(from: string, to: string): Promise<RevenueAnalyticsReport> {
    const requestKey = JSON.stringify([from, to]);
    const existing = inFlight.get(requestKey);
    if (existing) return existing;
    const request = api.getRevenueAnalyticsReport(from, to);
    inFlight.set(requestKey, request);
    void request.finally(() => inFlight.delete(requestKey)).catch(() => undefined);
    return request;
  }

  async function load(from: string, to: string): Promise<void> {
    const key = { from, to };
    await resource.load(
      key,
      () => fetchReport(from, to),
      (result) => ({
        from: result.from,
        to: result.to,
      }),
    );
  }

  return {
    report: resource.data,
    loading: resource.loading,
    error: resource.error,
    stale: resource.stale,
    actionsDisabled: resource.actionsDisabled,
    resolvedRange: resource.resolvedKey,
    load,
  };
}
