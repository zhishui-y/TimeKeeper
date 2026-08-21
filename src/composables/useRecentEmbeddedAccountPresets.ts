import { readonly, shallowRef, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { api, errorMessage } from "../api/client";
import type { EmbeddedAccountPreset } from "../types/domain";

export function useRecentEmbeddedAccountPresets(enabled: MaybeRefOrGetter<boolean>) {
  const items = shallowRef<EmbeddedAccountPreset[]>([]);
  const loading = shallowRef(false);
  const error = shallowRef<string | null>(null);
  let requestVersion = 0;

  async function load(): Promise<void> {
    const version = ++requestVersion;
    loading.value = true;
    error.value = null;
    try {
      const nextItems = await api.listRecentEmbeddedAccountPresets(10);
      if (version === requestVersion) items.value = nextItems;
    } catch (cause) {
      if (version === requestVersion) error.value = errorMessage(cause);
    } finally {
      if (version === requestVersion) loading.value = false;
    }
  }

  watch(
    () => toValue(enabled),
    (isEnabled) => {
      requestVersion += 1;
      if (!isEnabled) {
        items.value = [];
        loading.value = false;
        error.value = null;
        return;
      }
      void load();
    },
    { immediate: true },
  );

  return {
    items: readonly(items),
    loading: readonly(loading),
    error: readonly(error),
    load,
  };
}
