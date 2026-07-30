// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import VaultPasswordChangeForm from "./VaultPasswordChangeForm.vue";

describe("VaultPasswordChangeForm", () => {
  it("validates the new password before emitting secrets", async () => {
    const wrapper = mount(VaultPasswordChangeForm, {
      props: { loading: false },
    });

    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[role="alert"]').text()).toContain("当前主密码");

    await wrapper.get('input[aria-label="当前主密码"]').setValue("old password");
    await wrapper.get('input[aria-label="新主密码"]').setValue("123");
    await wrapper.get('input[aria-label="确认新主密码"]').setValue("123");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[role="alert"]').text()).toContain("至少需要4个字符");

    await wrapper.get('input[aria-label="新主密码"]').setValue("new secure password");
    await wrapper.get('input[aria-label="确认新主密码"]').setValue("different password");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.get('[role="alert"]').text()).toContain("两次输入");
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("accepts a four-character new master password", async () => {
    const wrapper = mount(VaultPasswordChangeForm, {
      props: { loading: false },
    });

    await wrapper.get('input[aria-label="当前主密码"]').setValue("old password");
    await wrapper.get('input[aria-label="新主密码"]').setValue("1234");
    await wrapper.get('input[aria-label="确认新主密码"]').setValue("1234");
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("submit")).toEqual([
      [{ currentPassword: "old password", newPassword: "1234" }],
    ]);
  });

  it("clears the current password after a valid submission", async () => {
    const wrapper = mount(VaultPasswordChangeForm, {
      props: { loading: false },
    });

    await wrapper.get('input[aria-label="当前主密码"]').setValue("old password");
    await wrapper.get('input[aria-label="新主密码"]').setValue("new secure password");
    await wrapper.get('input[aria-label="确认新主密码"]').setValue("new secure password");
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("submit")).toEqual([
      [{ currentPassword: "old password", newPassword: "new secure password" }],
    ]);
    expect((wrapper.get('input[aria-label="当前主密码"]').element as HTMLInputElement).value).toBe(
      "",
    );
    expect((wrapper.get('input[aria-label="新主密码"]').element as HTMLInputElement).value).toBe(
      "new secure password",
    );
  });
});
