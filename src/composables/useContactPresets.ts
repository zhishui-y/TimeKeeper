import { readonly, shallowRef, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { api, errorMessage } from "../api/client";
import type { ContactPreset } from "../types/domain";

export function useContactPresets(
  query: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean>,
) {
  const items = shallowRef<ContactPreset[]>([]);
  const loading = shallowRef(false);
  const error = shallowRef<string | null>(null);
  let requestVersion = 0;

  async function load(value = toValue(query)): Promise<void> {
    const version = ++requestVersion;
    loading.value = true;
    error.value = null;
    try {
      const nextItems = await api.listContactPresets(value.trim() || undefined, 10);
      if (version === requestVersion) items.value = nextItems;
    } catch (cause) {
      if (version === requestVersion) error.value = errorMessage(cause);
    } finally {
      if (version === requestVersion) loading.value = false;
    }
  }

  watch(
    () => [toValue(query), toValue(enabled)] as const,
    ([value, isEnabled], _previous, onCleanup) => {
      requestVersion += 1;
      if (!isEnabled) {
        loading.value = false;
        return;
      }
      const timer = globalThis.setTimeout(() => void load(value), 200);
      onCleanup(() => globalThis.clearTimeout(timer));
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
