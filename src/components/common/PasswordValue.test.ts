// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PasswordValue from "./PasswordValue.vue";

describe("PasswordValue", () => {
  it("starts masked and hides again when its reset key changes", async () => {
    const wrapper = mount(PasswordValue, {
      props: { password: "plain-secret", label: "测试密码", resetKey: 1 },
    });

    expect(wrapper.text()).toContain("••••••");
    expect(wrapper.text()).not.toContain("plain-secret");
    await wrapper.get('button[aria-label="显示测试密码"]').trigger("click");
    expect(wrapper.text()).toContain("plain-secret");

    await wrapper.setProps({ resetKey: 2 });
    expect(wrapper.text()).toContain("••••••");
    expect(wrapper.text()).not.toContain("plain-secret");
  });

  it("does not emit copy when no password exists", async () => {
    const wrapper = mount(PasswordValue, { props: { password: null, label: "测试密码" } });
    const copy = wrapper.get('button[aria-label="复制测试密码"]');
    expect(copy.attributes("disabled")).toBeDefined();
    await copy.trigger("click");
    expect(wrapper.emitted("copy")).toBeUndefined();
  });
});
