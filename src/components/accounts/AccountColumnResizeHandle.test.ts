import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AccountColumnResizeHandle from "./AccountColumnResizeHandle.vue";

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

describe("AccountColumnResizeHandle", () => {
  it("previews a clamped pointer drag and commits only on release", async () => {
    const wrapper = mount(AccountColumnResizeHandle, {
      props: { columnKey: "contactName", label: "联系人", width: 90, disabled: false },
    });
    const handle = wrapper.get("button");

    dispatchPointerEvent(handle.element, "pointerdown", 100, 1);
    dispatchPointerEvent(handle.element, "pointermove", -100, 1);
    expect(wrapper.emitted("preview")).toEqual([["contactName", 72]]);
    expect(wrapper.emitted("commit")).toBeUndefined();

    dispatchPointerEvent(handle.element, "pointerup", -100, 1);
    expect(wrapper.emitted("commit")).toEqual([["contactName", 72]]);
  });

  it("cancels an active drag with Escape and supports keyboard resizing", async () => {
    const wrapper = mount(AccountColumnResizeHandle, {
      props: { columnKey: "weekly", label: "本周", width: 160, disabled: false },
    });
    const handle = wrapper.get("button");

    dispatchPointerEvent(handle.element, "pointerdown", 100, 2);
    dispatchPointerEvent(handle.element, "pointermove", 140, 2);
    await handle.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("cancel")).toEqual([["weekly", 160]]);

    await handle.trigger("keydown", { key: "ArrowRight" });
    await wrapper.setProps({ width: 168 });
    await handle.trigger("keydown", { key: "ArrowLeft", shiftKey: true });
    expect(wrapper.emitted("commit")).toEqual([
      ["weekly", 168],
      ["weekly", 144],
    ]);
  });

  it("blocks resize interactions while persistence is pending", async () => {
    const wrapper = mount(AccountColumnResizeHandle, {
      props: { columnKey: "notes", label: "备注", width: 160, disabled: true },
    });
    const handle = wrapper.get("button");
    expect(handle.attributes("disabled")).toBeDefined();
    await handle.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("preview")).toBeUndefined();
  });
});
