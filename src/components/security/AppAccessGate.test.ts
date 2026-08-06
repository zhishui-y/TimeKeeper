// @vitest-environment jsdom

import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppAccessStore } from "../../stores/appAccess";
import AppAccessGate from "./AppAccessGate.vue";

describe("AppAccessGate", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("validates both new password entries and the explicit reset confirmation", async () => {
    const store = useAppAccessStore();
    store.ready = true;
    store.status = {
      initialized: true,
      unlocked: false,
      legacyMigrationPendingCount: 0,
      recoveryQuestion: "常用角色？",
    };
    const reset = vi.spyOn(store, "resetPassword").mockResolvedValue({
      initialized: true,
      unlocked: true,
      legacyMigrationPendingCount: 0,
      recoveryQuestion: "常用角色？",
    });
    const wrapper = mount(AppAccessGate);

    await wrapper.get(".access-gate__link").trigger("click");
    const passwordInputs = wrapper.findAll('input[type="password"]');
    await passwordInputs[0]!.setValue("new-password");
    await passwordInputs[1]!.setValue("different-password");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("两次输入的入口密码不一致");
    expect(reset).not.toHaveBeenCalled();

    await passwordInputs[1]!.setValue("new-password");
    await wrapper.get('input[placeholder="输入恢复答案"]').setValue("青瓷");
    await wrapper.get('input[aria-label="操作确认"]').setValue("重置");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(reset).toHaveBeenCalledWith("new-password", "重置", {
      kind: "answer",
      answer: "青瓷",
    });
  });

  it("can return from reset to a pending legacy migration", async () => {
    const store = useAppAccessStore();
    store.ready = true;
    store.status = {
      initialized: false,
      unlocked: false,
      legacyMigrationPendingCount: 2,
      recoveryQuestion: null,
    };
    const wrapper = mount(AppAccessGate);

    expect(wrapper.text()).toContain("升级本地密码数据");
    await wrapper.get(".access-gate__link").trigger("click");
    expect(wrapper.text()).toContain("返回密码输入");
    await wrapper.get(".access-gate__link").trigger("click");
    expect(wrapper.text()).toContain("升级本地密码数据");
  });

  it("requires an unlocked legacy user to enroll recovery before entering the shell", async () => {
    const store = useAppAccessStore();
    store.ready = true;
    store.status = {
      initialized: true,
      unlocked: true,
      legacyMigrationPendingCount: 0,
      recoveryQuestion: null,
    };
    const setRecovery = vi.spyOn(store, "setRecovery").mockResolvedValue({
      initialized: true,
      unlocked: true,
      legacyMigrationPendingCount: 0,
      recoveryQuestion: "常用角色？",
    });
    const wrapper = mount(AppAccessGate);

    expect(wrapper.text()).toContain("补设恢复问题");
    await wrapper.get('input[aria-label="当前入口密码"]').setValue("old-password");
    await wrapper.get('input[aria-label="恢复问题"]').setValue("常用角色？");
    await wrapper.get('input[aria-label="恢复答案"]').setValue("青瓷");
    await wrapper.get('input[aria-label="再次输入恢复答案"]').setValue("青瓷");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(setRecovery).toHaveBeenCalledWith("old-password", {
      question: "常用角色？",
      answer: "青瓷",
    });
  });
});
