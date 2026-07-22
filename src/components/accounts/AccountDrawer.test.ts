// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import AccountDrawer from "./AccountDrawer.vue";

describe("AccountDrawer", () => {
  let unmount: (() => void) | undefined;

  afterEach(() => {
    unmount?.();
    unmount = undefined;
  });

  it("disables repeat submission while a save is in progress", async () => {
    const wrapper = mount(AccountDrawer, {
      props: { open: true, profile: null, saving: true },
      global: { stubs: { teleport: true } },
    });
    unmount = () => wrapper.unmount();

    const saveButton = wrapper.get('button.button--primary[type="button"]');
    expect(saveButton.attributes("disabled")).toBeDefined();
    expect(saveButton.text()).toContain("保存中");
    await saveButton.trigger("click");

    expect(wrapper.emitted("save")).toBeUndefined();
  });
});
