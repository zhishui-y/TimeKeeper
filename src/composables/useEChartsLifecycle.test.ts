// @vitest-environment jsdom

import { defineComponent, h, nextTick, shallowRef, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEChartsLifecycle } from "./useEChartsLifecycle";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useEChartsLifecycle", () => {
  it("tracks reduced motion and resizes once for the latest appearance change", async () => {
    const observed: {
      mediaChange?: () => void;
      reducedMotion?: Readonly<Ref<boolean>>;
    } = {};
    const removeMediaListener = vi.fn();
    const mediaQuery = {
      matches: false,
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        observed.mediaChange = listener;
      }),
      removeEventListener: removeMediaListener,
    };
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const cancelFrame = vi.fn((id: number) => frames.delete(id));
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mediaQuery),
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        nextFrame += 1;
        frames.set(nextFrame, callback);
        return nextFrame;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);

    const resize = vi.fn();
    const TestHost = defineComponent({
      setup() {
        const chart = shallowRef({ resize });
        const lifecycle = useEChartsLifecycle(chart);
        observed.reducedMotion = lifecycle.prefersReducedMotion;
        return () => h("div");
      },
    });
    const wrapper = mount(TestHost);

    expect(observed.reducedMotion?.value).toBe(false);
    mediaQuery.matches = true;
    observed.mediaChange?.();
    await nextTick();
    expect(observed.reducedMotion?.value).toBe(true);

    globalThis.dispatchEvent(new Event("timekeeper-appearance-changed"));
    globalThis.dispatchEvent(new Event("timekeeper-appearance-changed"));
    expect(cancelFrame).toHaveBeenCalledWith(1);
    expect(frames.size).toBe(1);
    frames.get(2)?.(0);
    expect(resize).toHaveBeenCalledOnce();

    wrapper.unmount();
    expect(removeMediaListener).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
