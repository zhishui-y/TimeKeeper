// @vitest-environment jsdom

import { createPinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../api/mockClient";
import { useUiStore } from "../stores/ui";
import { useAppointmentStatusAutomation } from "./useAppointmentStatusAutomation";

describe("useAppointmentStatusAutomation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("syncs immediately, refreshes changed data, and continues on the configured interval", async () => {
    vi.useFakeTimers();
    const syncStatuses = vi
      .spyOn(mockApi, "syncAppointmentServiceStatuses")
      .mockResolvedValueOnce(1)
      .mockResolvedValue(0);
    const pinia = createPinia();
    const ui = useUiStore(pinia);
    const Host = defineComponent({
      setup() {
        useAppointmentStatusAutomation({ intervalMs: 1_000 });
        return () => h("div");
      },
    });

    const wrapper = mount(Host, { global: { plugins: [pinia] } });
    await flushPromises();
    expect(syncStatuses).toHaveBeenCalledTimes(1);
    expect(ui.dataRevision).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();
    expect(syncStatuses).toHaveBeenCalledTimes(2);

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(syncStatuses).toHaveBeenCalledTimes(2);
  });
});
