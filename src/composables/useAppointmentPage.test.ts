// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../api/mockClient";
import type { AppointmentPage } from "../types/domain";
import { useAppointmentPage } from "./useAppointmentPage";

function pageResult(page: number, totalPages: number): AppointmentPage {
  return { items: [], totalCount: totalPages, page, pageSize: 1, totalPages };
}

describe("useAppointmentPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the page clamped by the API as the canonical resolved key", async () => {
    const list = vi
      .spyOn(mockApi, "listAppointmentPage")
      .mockResolvedValueOnce(pageResult(1, 5))
      .mockResolvedValueOnce(pageResult(4, 4));
    let history!: ReturnType<typeof useAppointmentPage>;
    const wrapper = mount(
      defineComponent({
        setup() {
          history = useAppointmentPage({}, { pageSize: 1, immediate: false });
          return () => null;
        },
      }),
    );

    await history.load();
    await history.goToPage(5);

    expect(list).toHaveBeenLastCalledWith({}, 5, 1);
    expect(history.page.value).toBe(4);
    expect(history.requestedKey.value).toEqual({ filters: {}, page: 4, pageSize: 1 });
    expect(history.resolvedKey.value).toEqual({ filters: {}, page: 4, pageSize: 1 });
    expect(history.stale.value).toBe(false);
    wrapper.unmount();
  });
});
