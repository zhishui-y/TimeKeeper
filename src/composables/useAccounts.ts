import { computed, onMounted, readonly } from "vue";
import { api } from "../api/client";
import type { AccountProfile, AccountRoleDataRefreshPatch } from "../types/domain";
import { useAsyncResource } from "./useAsyncResource";

export interface UseAccountsOptions {
  immediate?: boolean;
}

export function useAccounts({ immediate = true }: UseAccountsOptions = {}) {
  interface AccountRequestKey {
    query: string | null;
    needsReview: boolean | null;
  }
  const resource = useAsyncResource<AccountProfile[], AccountRequestKey>(
    (left, right) => left.query === right.query && left.needsReview === right.needsReview,
  );
  const items = computed<AccountProfile[]>(() => resource.data.value ?? []);
  const inFlight = new Map<string, Promise<AccountProfile[]>>();

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
    await resource.load({ query: query ?? null, needsReview: needsReview ?? null }, () =>
      fetchAccounts(query, needsReview),
    );
  }

  function applyRoleDataRefreshPatch(patch: AccountRoleDataRefreshPatch): void {
    if (!resource.data.value) return;
    resource.data.value = resource.data.value.map((profile: AccountProfile) =>
      profile.id === patch.accountId
        ? {
            ...profile,
            gearScore: patch.gearScore,
            currentScore: patch.currentScore,
            highestScore: patch.highestScore,
            scoreUpdatedAt: patch.scoreUpdatedAt,
            weeklyWins: patch.weeklyWins,
            updatedAt: patch.updatedAt,
          }
        : profile,
    );
  }

  onMounted(() => {
    if (immediate) void load();
  });

  return {
    items: readonly(items),
    loading: resource.loading,
    error: resource.error,
    status: resource.status,
    stale: resource.stale,
    actionsDisabled: resource.actionsDisabled,
    requestedKey: resource.requestedKey,
    resolvedKey: resource.resolvedKey,
    load,
    applyRoleDataRefreshPatch,
  };
}
