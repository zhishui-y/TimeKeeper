import { computed, shallowRef, type ShallowRef } from "vue";
import { errorMessage } from "../api/client";

export type AsyncResourceStatus = "idle" | "loading" | "ready" | "stale" | "error";

export interface AsyncResourceState<T, K> {
  data: Readonly<ShallowRef<T | null>>;
  status: Readonly<ShallowRef<AsyncResourceStatus>>;
  error: Readonly<ShallowRef<string | null>>;
  requestedKey: Readonly<ShallowRef<K | null>>;
  resolvedKey: Readonly<ShallowRef<K | null>>;
}

export function useAsyncResource<T, K>(equals: (left: K, right: K) => boolean) {
  const data = shallowRef<T | null>(null);
  const status = shallowRef<AsyncResourceStatus>("idle");
  const error = shallowRef<string | null>(null);
  const requestedKey = shallowRef<K | null>(null);
  const resolvedKey = shallowRef<K | null>(null);
  let requestVersion = 0;

  const loading = computed(() => status.value === "loading" || status.value === "stale");
  const stale = computed(
    () =>
      data.value !== null &&
      (status.value === "stale" ||
        status.value === "error" ||
        (requestedKey.value !== null &&
          resolvedKey.value !== null &&
          !equals(requestedKey.value, resolvedKey.value))),
  );
  const actionsDisabled = computed(() => loading.value || status.value === "error" || stale.value);

  async function load(
    key: K,
    request: () => Promise<T>,
    resolveKey: (result: T, requestedKey: K) => K = (_result, requestedKey) => requestedKey,
  ): Promise<T | null> {
    const version = ++requestVersion;
    requestedKey.value = key;
    error.value = null;
    status.value = data.value === null ? "loading" : "stale";
    try {
      const result = await request();
      if (version !== requestVersion) return null;
      const canonicalKey = resolveKey(result, key);
      data.value = result;
      requestedKey.value = canonicalKey;
      resolvedKey.value = canonicalKey;
      status.value = "ready";
      return result;
    } catch (cause) {
      if (version !== requestVersion) return null;
      error.value = errorMessage(cause);
      status.value = "error";
      return null;
    }
  }

  return {
    data,
    status,
    error,
    requestedKey,
    resolvedKey,
    loading,
    stale,
    actionsDisabled,
    load,
  } satisfies AsyncResourceState<T, K> & {
    loading: typeof loading;
    stale: typeof stale;
    actionsDisabled: typeof actionsDisabled;
    load(
      key: K,
      request: () => Promise<T>,
      resolveKey?: (result: T, requestedKey: K) => K,
    ): Promise<T | null>;
  };
}
