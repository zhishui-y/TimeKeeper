import { api } from "../api/client";
import type { DashboardSummary } from "../types/domain";
import { useAsyncResource } from "./useAsyncResource";

export function useDashboard() {
  const resource = useAsyncResource<DashboardSummary, string>((left, right) => left === right);
  const inFlight = new Map<string, Promise<DashboardSummary>>();

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
    await resource.load(date, () => fetchSummary(date));
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
    load,
  };
}
