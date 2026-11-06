import { computed, onMounted, readonly, shallowRef } from "vue";
import { api } from "../api/client";
import type {
  AccountProfile,
  AccountProfileInput,
  AccountRoleDataRefreshPatch,
} from "../types/domain";
import { parseOptionalAccountScore, type AccountEditableField } from "../utils/accounts";
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
  const savingField = shallowRef(false);

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

  async function saveField(id: string, field: AccountEditableField, value: string): Promise<void> {
    if (savingField.value || resource.actionsDisabled.value) return;
    const profile = items.value.find((item) => item.id === id);
    if (!profile) throw new Error("账号档案已不存在，请刷新后重试");
    const parsed = parseOptionalAccountScore(field === "notes" ? null : value);
    if (!parsed.ok) throw new Error("分数必须是 0 或更大的有效整数");
    const nextValue = field === "notes" ? value.trim() || null : parsed.value;
    if (nextValue === (profile[field] ?? null)) return;
    const input: AccountProfileInput = {
      contactName: profile.contactName,
      server: profile.server,
      characterName: profile.characterName,
      specialization: profile.specialization,
      gearScore: profile.gearScore,
      accountName: profile.accountName,
      credential: { kind: "keep" },
      currentScore: profile.currentScore,
      highestScore: profile.highestScore,
      scoreUpdatedAt: profile.scoreUpdatedAt,
      notes: profile.notes,
      needsReview: profile.needsReview,
      [field]: nextValue,
    };
    savingField.value = true;
    try {
      const saved = await api.updateAccountProfile(id, input);
      resource.data.value = items.value.map((item) => (item.id === id ? saved : item));
    } finally {
      savingField.value = false;
    }
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
    savingField: readonly(savingField),
    saveField,
    applyRoleDataRefreshPatch,
  };
}
