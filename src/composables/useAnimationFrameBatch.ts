import { onBeforeUnmount, shallowRef } from "vue";

export function useAnimationFrameBatch<T>(publish: (value: T) => void): {
  schedule: (value: T) => void;
  flush: () => void;
  cancel: () => void;
} {
  const pending = shallowRef<T | null>(null);
  let frameId: number | null = null;

  function cancelFrame(): void {
    if (frameId === null) return;
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frameId);
    else clearTimeout(frameId);
    frameId = null;
  }

  function flush(): void {
    cancelFrame();
    if (pending.value === null) return;
    const value = pending.value;
    pending.value = null;
    publish(value);
  }

  function schedule(value: T): void {
    pending.value = value;
    if (frameId !== null) return;
    frameId =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(flush)
        : window.setTimeout(flush, 16);
  }

  function cancel(): void {
    cancelFrame();
    pending.value = null;
  }

  onBeforeUnmount(cancel);
  return { schedule, flush, cancel };
}
