import { onMounted, readonly, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type { AccountProfile } from "../types/domain";

export function useAccounts() {
  const items = shallowRef<AccountProfile[]>([]);
  const loading = shallowRef(false);
  const error = shallowRef<string | null>(null);

  async function load(query?: string, needsReview?: boolean): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      items.value = await api.listAccountProfiles(query, needsReview);
    } catch (cause) {
      error.value = errorMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => void load());

  return {
    items: readonly(items),
    loading: readonly(loading),
    error: readonly(error),
    load,
  };
}
