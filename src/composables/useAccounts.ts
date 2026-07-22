import { onMounted, readonly, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type { AccountProfile } from "../types/domain";

export interface UseAccountsOptions {
  immediate?: boolean;
}

export function useAccounts({ immediate = true }: UseAccountsOptions = {}) {
  const items = shallowRef<AccountProfile[]>([]);
  const loading = shallowRef(false);
  const error = shallowRef<string | null>(null);
  const inFlight = new Map<string, Promise<AccountProfile[]>>();
  let requestVersion = 0;

  function requestKey(query?: string, needsReview?: boolean): string {
    return JSON.stringify([query ?? null, needsReview ?? null]);
  }

  function fetchAccounts(query?: string, needsReview?: boolean): Promise<AccountProfile[]> {
    const key = requestKey(query, needsReview);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const request = api.listAccountProfiles(query, needsReview);
    inFlight.set(key, request);
    const clear = () => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    };
    void request.then(clear, clear);
    return request;
  }

  async function load(query?: string, needsReview?: boolean): Promise<void> {
    const version = ++requestVersion;
    loading.value = true;
    error.value = null;
    try {
      const nextItems = await fetchAccounts(query, needsReview);
      if (version === requestVersion) items.value = nextItems;
    } catch (cause) {
      if (version === requestVersion) error.value = errorMessage(cause);
    } finally {
      if (version === requestVersion) loading.value = false;
    }
  }

  onMounted(() => {
    if (immediate) void load();
  });

  return {
    items: readonly(items),
    loading: readonly(loading),
    error: readonly(error),
    load,
  };
}
