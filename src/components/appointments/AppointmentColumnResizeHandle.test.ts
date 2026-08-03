import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppointmentColumnResizeHandle from "./AppointmentColumnResizeHandle.vue";

function dispatchPointerEvent(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  pointerId: number,
): void {
  const event = new MouseEvent(type, { bubbles: true, clientX });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  target.dispatchEvent(event);
}

describe("AppointmentColumnResizeHandle", () => {
  it("previews a clamped pointer drag and commits on release", () => {
    const wrapper = mount(AppointmentColumnResizeHandle, {
      props: { columnKey: "content", label: "内容", width: 140, disabled: false },
    });
    const handle = wrapper.get("button");

    dispatchPointerEvent(handle.element, "pointerdown", 100, 1);
    dispatchPointerEvent(handle.element, "pointermove", -100, 1);
    expect(wrapper.emitted("preview")).toEqual([["content", 100]]);
    expect(wrapper.emitted("commit")).toBeUndefined();

    dispatchPointerEvent(handle.element, "pointerup", -100, 1);
    expect(wrapper.emitted("commit")).toEqual([["content", 100]]);
  });

  it("supports Escape cancellation and keyboard resizing", async () => {
    const wrapper = mount(AppointmentColumnResizeHandle, {
      props: { columnKey: "account", label: "账号", width: 180, disabled: false },
    });
    const handle = wrapper.get("button");

    dispatchPointerEvent(handle.element, "pointerdown", 100, 2);
    dispatchPointerEvent(handle.element, "pointermove", 140, 2);
    await handle.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("cancel")).toEqual([["account", 180]]);

    await handle.trigger("keydown", { key: "ArrowRight" });
    await wrapper.setProps({ width: 188 });
    await handle.trigger("keydown", { key: "ArrowLeft", shiftKey: true });
    expect(wrapper.emitted("commit")).toEqual([
      ["account", 188],
      ["account", 164],
    ]);
  });
});
