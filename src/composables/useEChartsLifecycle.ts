import { onBeforeUnmount, onMounted, readonly, shallowRef, type ShallowRef } from "vue";

export interface ResizableEChartsInstance {
  resize?: () => void;
}

type ChartInstanceRef = Readonly<ShallowRef<ResizableEChartsInstance | null>>;

export function useEChartsLifecycle(chartInstance: ChartInstanceRef) {
  const reducedMotionQuery =
    typeof globalThis.matchMedia === "function"
      ? globalThis.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  const prefersReducedMotion = shallowRef(reducedMotionQuery?.matches ?? false);
  let resizeFrame: number | null = null;

  function updateReducedMotion(): void {
    prefersReducedMotion.value = reducedMotionQuery?.matches ?? false;
  }

  function refreshChartSize(): void {
    if (resizeFrame !== null && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(resizeFrame);
    }
    if (typeof globalThis.requestAnimationFrame !== "function") {
      chartInstance.value?.resize?.();
      return;
    }
    resizeFrame = globalThis.requestAnimationFrame(() => {
      resizeFrame = null;
      chartInstance.value?.resize?.();
    });
  }

  onMounted(() => {
    reducedMotionQuery?.addEventListener("change", updateReducedMotion);
    globalThis.addEventListener("timekeeper-appearance-changed", refreshChartSize);
  });

  onBeforeUnmount(() => {
    reducedMotionQuery?.removeEventListener("change", updateReducedMotion);
    globalThis.removeEventListener("timekeeper-appearance-changed", refreshChartSize);
    if (resizeFrame !== null && typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(resizeFrame);
      resizeFrame = null;
    }
  });

  return {
    prefersReducedMotion: readonly(prefersReducedMotion),
    refreshChartSize,
  };
}
