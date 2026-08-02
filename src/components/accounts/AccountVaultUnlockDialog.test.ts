// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import AccountVaultUnlockDialog from "./AccountVaultUnlockDialog.vue";

describe("AccountVaultUnlockDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("focuses the password, submits with Enter, and keeps failures visible", async () => {
    const wrapper = mount(AccountVaultUnlockDialog, {
      attachTo: document.body,
      props: { open: true, loading: false, error: null },
    });
    await flushPromises();

    const password = document.body.querySelector<HTMLInputElement>("#account-vault-password");
    expect(document.activeElement).toBe(password);
    password!.value = "wrong-password";
    password!.dispatchEvent(new Event("input", { bubbles: true }));
    password!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    document.body.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
    await wrapper.setProps({ error: "主密码不正确" });

    const submitEvents = wrapper.emitted("submit");
    expect(submitEvents?.[submitEvents.length - 1]).toEqual(["wrong-password"]);
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("主密码不正确");
    wrapper.unmount();
  });

  it("supports Escape and clears the password after closing", async () => {
    const wrapper = mount(AccountVaultUnlockDialog, {
      attachTo: document.body,
      props: { open: true, loading: false, error: null },
    });
    await flushPromises();
    const password = document.body.querySelector<HTMLInputElement>("#account-vault-password")!;
    password.value = "temporary-password";
    password.dispatchEvent(new Event("input", { bubbles: true }));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(wrapper.emitted("close")).toHaveLength(1);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(document.body.querySelector<HTMLInputElement>("#account-vault-password")?.value).toBe(
      "",
    );
    wrapper.unmount();
  });
});
