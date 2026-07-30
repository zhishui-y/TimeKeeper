import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import VaultGate from "./VaultGate.vue";

const uninitializedStatus = {
  initialized: false,
  unlocked: false,
  autoLockMinutes: 15,
};

describe("VaultGate", () => {
  it("accepts four-character master passwords but rejects shorter values", async () => {
    const wrapper = mount(VaultGate, {
      props: {
        status: uninitializedStatus,
        loading: false,
        ready: true,
      },
    });

    await wrapper.get('input[aria-label="主密码"]').setValue("123");
    await wrapper.get('input[aria-label="再次输入主密码"]').setValue("123");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.text()).toContain("至少需要4个字符");
    expect(wrapper.emitted("submit")).toBeUndefined();

    await wrapper.get('input[aria-label="主密码"]').setValue("1234");
    await wrapper.get('input[aria-label="再次输入主密码"]').setValue("1234");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("submit")).toEqual([["1234"]]);
  });

  it("requires the initial master password to be entered twice", async () => {
    const wrapper = mount(VaultGate, {
      props: {
        status: uninitializedStatus,
        loading: false,
        ready: true,
      },
    });

    await wrapper.get('input[aria-label="主密码"]').setValue("acceptance-password");
    await wrapper.get('input[aria-label="再次输入主密码"]').setValue("different-password");
    await wrapper.get("form").trigger("submit");

    expect(wrapper.text()).toContain("两次输入的主密码不一致");
    expect(wrapper.emitted("submit")).toBeUndefined();

    await wrapper.get('input[aria-label="再次输入主密码"]').setValue("acceptance-password");
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("submit")).toEqual([["acceptance-password"]]);
  });

  it("keeps normal unlock as a single-password flow", async () => {
    const wrapper = mount(VaultGate, {
      props: {
        status: { ...uninitializedStatus, initialized: true },
        loading: false,
        ready: true,
      },
    });

    expect(wrapper.find('input[aria-label="再次输入主密码"]').exists()).toBe(false);
    await wrapper.get('input[aria-label="主密码"]').setValue("existing-password");
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("submit")).toEqual([["existing-password"]]);
  });
});
