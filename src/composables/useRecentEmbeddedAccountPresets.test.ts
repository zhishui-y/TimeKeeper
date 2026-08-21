// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, nextTick, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../api/mockClient";
import type { EmbeddedAccountPreset } from "../types/domain";
import { useRecentEmbeddedAccountPresets } from "./useRecentEmbeddedAccountPresets";

const preset: EmbeddedAccountPreset = {
  sourceAppointmentId: "appointment-1",
  accountName: "recent-login",
  specialization: "冰心诀",
  server: "梦江南",
  gearScore: "20万",
  hasPassword: true,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("useRecentEmbeddedAccountPresets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads only while enabled and ignores a response completed after disabling", async () => {
    const oldRequest = deferred<EmbeddedAccountPreset[]>();
    const list = vi
      .spyOn(mockApi, "listRecentEmbeddedAccountPresets")
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce([preset]);
    const enabled = shallowRef(false);
    let state!: ReturnType<typeof useRecentEmbeddedAccountPresets>;
    const wrapper = mount(
      defineComponent({
        setup() {
          state = useRecentEmbeddedAccountPresets(enabled);
          return () => null;
        },
      }),
    );

    enabled.value = true;
    await nextTick();
    await flushPromises();
    expect(list).toHaveBeenCalledWith(10);
    enabled.value = false;
    await nextTick();
    oldRequest.resolve([{ ...preset, accountName: "stale-login" }]);
    await flushPromises();
    expect(state.items.value).toEqual([]);

    enabled.value = true;
    await nextTick();
    await flushPromises();
    expect(state.items.value).toEqual([preset]);
    wrapper.unmount();
  });
});
