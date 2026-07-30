// @vitest-environment jsdom

import { createPinia } from "pinia";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../api/mockClient";
import { useUiStore } from "../../stores/ui";
import type { VaultStatus } from "../../types/domain";
import VaultSettingsPanel from "./VaultSettingsPanel.vue";

const unlockedStatus: VaultStatus = {
  initialized: true,
  unlocked: true,
  autoLockMinutes: 15,
};

function buttonWithText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().includes(text));
  if (!button) throw new Error(`未找到按钮：${text}`);
  return button;
}

describe("VaultSettingsPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses zero minutes for disabled auto-lock and restores the last enabled value", async () => {
    vi.spyOn(mockApi, "vaultStatus").mockResolvedValue(unlockedStatus);
    const wrapper = mount(VaultSettingsPanel, {
      props: { autoLockMinutes: 15 },
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    await wrapper.get('[role="switch"]').setValue(true);
    expect(wrapper.emitted("update:autoLockMinutes")).toEqual([[0]]);

    await wrapper.setProps({ autoLockMinutes: 0 });
    await wrapper.get('[role="switch"]').setValue(false);
    expect(wrapper.emitted("update:autoLockMinutes")).toEqual([[0], [15]]);
    wrapper.unmount();
  });

  it("submits a password change and explains the old-backup consequence", async () => {
    vi.spyOn(mockApi, "vaultStatus").mockResolvedValue(unlockedStatus);
    const changeRequest = vi
      .spyOn(mockApi, "changeVaultPassword")
      .mockResolvedValue(unlockedStatus);
    const pinia = createPinia();
    const wrapper = mount(VaultSettingsPanel, {
      props: { autoLockMinutes: 15 },
      global: { plugins: [pinia] },
    });
    const ui = useUiStore(pinia);
    await flushPromises();

    await buttonWithText(wrapper, "修改主密码").trigger("click");
    await wrapper.get('input[aria-label="当前主密码"]').setValue("old password");
    await wrapper.get('input[aria-label="新主密码"]').setValue("new secure password");
    await wrapper.get('input[aria-label="确认新主密码"]').setValue("new secure password");
    await wrapper.get(".password-change").trigger("submit");
    await flushPromises();

    expect(changeRequest).toHaveBeenCalledWith("old password", "new secure password");
    expect(wrapper.find(".password-change").exists()).toBe(false);
    expect(ui.toast?.message).toContain("旧备份仍需旧主密码");
    wrapper.unmount();
  });

  it("keeps the form open and shows a backend password error", async () => {
    vi.spyOn(mockApi, "vaultStatus").mockResolvedValue(unlockedStatus);
    vi.spyOn(mockApi, "changeVaultPassword").mockRejectedValue(new Error("当前主密码不正确"));
    const wrapper = mount(VaultSettingsPanel, {
      props: { autoLockMinutes: 15 },
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    await buttonWithText(wrapper, "修改主密码").trigger("click");
    await wrapper.get('input[aria-label="当前主密码"]').setValue("wrong password");
    await wrapper.get('input[aria-label="新主密码"]').setValue("new secure password");
    await wrapper.get('input[aria-label="确认新主密码"]').setValue("new secure password");
    await wrapper.get(".password-change").trigger("submit");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain("当前主密码不正确");
    expect(wrapper.find(".password-change").exists()).toBe(true);
    wrapper.unmount();
  });
});
