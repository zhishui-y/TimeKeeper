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
    dispatchPointerEvent(handle.element, "pointermove", 130, 1);
    expect(wrapper.emitted("preview")).toBeUndefined();
    expect(wrapper.emitted("commit")).toBeUndefined();

    dispatchPointerEvent(handle.element, "pointerup", 130, 1);
    expect(wrapper.emitted("preview")).toEqual([["contactName", 120]]);
    expect(wrapper.emitted("commit")).toEqual([["contactName", 120]]);
  });

  it("cancels an active drag with Escape and supports keyboard resizing", async () => {
    const wrapper = mount(AccountColumnResizeHandle, {
      props: { columnKey: "weeklyWins", label: "本周胜场", width: 96, disabled: false },
    });
    const handle = wrapper.get("button");

    dispatchPointerEvent(handle.element, "pointerdown", 100, 2);
    dispatchPointerEvent(handle.element, "pointermove", 140, 2);
    await handle.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("cancel")).toEqual([["weeklyWins", 96]]);

    await handle.trigger("keydown", { key: "ArrowRight" });
    await wrapper.setProps({ width: 96 });
    await handle.trigger("keydown", { key: "ArrowLeft", shiftKey: true });
    expect(wrapper.emitted("commit")).toEqual([
      ["weeklyWins", 104],
      ["weeklyWins", 72],
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
