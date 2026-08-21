// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mockApi } from "../../api/mockClient";
import type { ContactPreset } from "../../types/domain";
import AppointmentContactFields from "./AppointmentContactFields.vue";

const preset: ContactPreset = {
  sourceAppointmentId: "preset-source",
  serviceDate: "2026-08-20",
  contactName: "南枝",
  startTime: "19:30",
  endTime: "22:00",
  content: "赛季冲分",
  mode: "business",
  account: null,
  reminderMinutes: 30,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("AppointmentContactFields", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("debounces contact search and applies a template only after explicit selection", async () => {
    vi.useFakeTimers();
    const listContactPresets = vi.spyOn(mockApi, "listContactPresets").mockResolvedValue([preset]);
    const wrapper = mount(
      defineComponent({
        setup() {
          const value = ref("");
          return () =>
            h(AppointmentContactFields, {
              modelValue: value.value,
              "onUpdate:modelValue": (nextValue: string) => {
                value.value = nextValue;
              },
            });
        },
      }),
    );
    const contactFields = wrapper.getComponent(AppointmentContactFields);

    const input = wrapper.get('input[aria-label="联系人"]');
    await input.trigger("focus");
    await vi.advanceTimersByTimeAsync(199);
    expect(listContactPresets).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(listContactPresets).toHaveBeenCalledWith(undefined, 10);

    await input.setValue("南");
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(listContactPresets).toHaveBeenLastCalledWith("南", 10);
    expect(wrapper.get('[role="option"]').text()).toContain("08.20 · 19:30");
    expect(contactFields.emitted("select")).toBeUndefined();

    await wrapper.get('[role="option"]').trigger("mousedown");
    expect(contactFields.emitted("select")?.[0]?.[0]).toEqual(preset);
  });

  it("does not let an older request overwrite a query changed during the debounce window", async () => {
    vi.useFakeTimers();
    const oldRequest = deferred<ContactPreset[]>();
    const oldPreset = { ...preset, sourceAppointmentId: "old", contactName: "旧联系人" };
    vi.spyOn(mockApi, "listContactPresets")
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce([preset]);
    const wrapper = mount(AppointmentContactFields, { props: { modelValue: "" } });
    const input = wrapper.get('input[aria-label="联系人"]');

    await input.trigger("focus");
    await vi.advanceTimersByTimeAsync(200);
    await wrapper.setProps({ modelValue: "南" });
    oldRequest.resolve([oldPreset]);
    await flushPromises();
    expect(wrapper.text()).not.toContain("旧联系人");

    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(wrapper.text()).toContain("南枝");
  });

  it("supports arrow navigation, active descendant, Enter selection, and Escape", async () => {
    vi.useFakeTimers();
    const secondPreset = { ...preset, sourceAppointmentId: "preset-2", contactName: "青禾" };
    vi.spyOn(mockApi, "listContactPresets").mockResolvedValue([preset, secondPreset]);
    const wrapper = mount(AppointmentContactFields, { props: { modelValue: "" } });
    const input = wrapper.get('input[aria-label="联系人"]');

    await input.trigger("focus");
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    await input.trigger("keydown", { key: "ArrowDown" });
    expect(input.attributes("aria-activedescendant")).toBe("contact-preset-0");
    expect(wrapper.get("#contact-preset-0").attributes("aria-selected")).toBe("true");
    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("select")?.[0]?.[0]).toEqual(secondPreset);

    await input.trigger("focus");
    await input.trigger("keydown", { key: "Escape" });
    expect(input.attributes("aria-expanded")).toBe("false");
  });
});
