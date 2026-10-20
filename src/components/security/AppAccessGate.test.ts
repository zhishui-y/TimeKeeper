// @vitest-environment jsdom

import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../api/mockClient";
import { useAppAccessStore } from "../../stores/appAccess";
import AppAccessGate from "./AppAccessGate.vue";

describe("AppAccessGate", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("keeps the unlock error while clearing and refocusing the password for a retry", async () => {
    const store = useAppAccessStore();
    store.ready = true;
    store.status = {
      initialized: true,
      unlocked: false,
      legacyMigrationPendingCount: 0,
      recoveryQuestion: "常用角色？",
      dataRepairIssueCount: 0,
      dataRepairIssues: [],
    };
    let rejectUnlock!: (cause: Error) => void;
    const unlock = vi
      .spyOn(mockApi, "unlockAppAccess")
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectUnlock = reject;
          }),
      )
      .mockResolvedValueOnce({ ...store.status, unlocked: true });
    const wrapper = mount(AppAccessGate, { attachTo: document.body });
    const input = wrapper.get<HTMLInputElement>('input[aria-label="入口密码"]');

    await input.setValue("incorrect-password");
    await wrapper.get("form").trigger("submit");
    expect(input.element.disabled).toBe(true);
    await flushPromises();
    rejectUnlock(new Error("入口密码错误"));
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe("入口密码错误");
    expect(input.element.value).toBe("");
    expect(input.element.disabled).toBe(false);
    expect(document.activeElement).toBe(input.element);

    await input.setValue("correct-password");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(unlock).toHaveBeenCalledTimes(2);
    expect(store.unlocked).toBe(true);
    expect(input.element.value).toBe("");
    wrapper.unmount();
  });

  it("validates both new password entries and the explicit reset confirmation", async () => {
    const store = useAppAccessStore();
    store.ready = true;
    store.status = {
      initialized: true,
      unlocked: false,
      legacyMigrationPendingCount: 0,
      recoveryQuestion: "常用角色？",
      dataRepairIssueCount: 0,
      dataRepairIssues: [],
    };
    const reset = vi.spyOn(store, "resetPassword").mockResolvedValue({
      initialized: true,
      unlocked: true,
      legacyMigrationPendingCount: 0,
      recoveryQuestion: "常用角色？",
      dataRepairIssueCount: 0,
      dataRepairIssues: [],
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
      dataRepairIssueCount: 0,
      dataRepairIssues: [],
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
      dataRepairIssueCount: 0,
      dataRepairIssues: [],
    };
    const setRecovery = vi.spyOn(store, "setRecovery").mockResolvedValue({
      initialized: true,
      unlocked: true,
      legacyMigrationPendingCount: 0,
      recoveryQuestion: "常用角色？",
      dataRepairIssueCount: 0,
      dataRepairIssues: [],
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
