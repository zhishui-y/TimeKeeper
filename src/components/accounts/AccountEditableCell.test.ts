// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { AccountEditableField } from "../../utils/accounts";
import AccountEditableCell from "./AccountEditableCell.vue";

function mountCell(field: AccountEditableField = "currentScore", value: string | number = 2100) {
  return mount(AccountEditableCell, {
    props: { field, value, label: "编辑单元格", disabled: false },
    attachTo: document.body,
  });
}

describe("AccountEditableCell", () => {
  it.each(["currentScore", "highestScore", "notes"] as const)(
    "focuses %s on click, saves once on Enter and exits editing",
    async (field) => {
      const wrapper = mountCell(field);
      await wrapper.get("button").trigger("click");
      const input = wrapper.get("input");
      expect(document.activeElement).toBe(input.element);
      expect(input.element.value).toBe("2100");
      await input.setValue("2300");
      await input.trigger("keydown", { key: "Enter" });
      expect(wrapper.emitted("save")).toEqual([["2300"]]);
      expect(wrapper.find("input").exists()).toBe(false);
      expect(document.activeElement).not.toBe(input.element);
      wrapper.unmount();
    },
  );

  it.each(["currentScore", "highestScore", "notes"] as const)(
    "saves %s on blur, including clearing the cell",
    async (field) => {
      const wrapper = mountCell(field);
      await wrapper.get("button").trigger("click");
      await wrapper.get("input").setValue("");
      wrapper.get("input").element.blur();
      await wrapper.vm.$nextTick();
      expect(wrapper.emitted("save")).toEqual([[""]]);
      expect(wrapper.find("input").exists()).toBe(false);
      wrapper.unmount();
    },
  );

  it.each(["currentScore", "highestScore", "notes"] as const)(
    "discards %s changes and blurs on Escape",
    async (field) => {
      const wrapper = mountCell(field);
      await wrapper.get("button").trigger("click");
      const input = wrapper.get("input");
      await input.setValue("invalid unsaved draft");
      await input.trigger("keydown", { key: "Escape" });
      expect(wrapper.emitted("save")).toBeUndefined();
      expect(wrapper.get("button").text()).toBe("2100");
      expect(document.activeElement).not.toBe(input.element);
      await wrapper.get("button").trigger("click");
      expect(wrapper.get("input").element.value).toBe("2100");
      wrapper.unmount();
    },
  );

  it.each(["-1", "2.5", "9007199254740992", "abc"])(
    "rejects invalid score %s without saving",
    async (value) => {
      const wrapper = mountCell();
      await wrapper.get("button").trigger("click");
      await wrapper.get("input").setValue(value);
      await wrapper.get("input").trigger("keydown", { key: "Enter" });
      await wrapper.get("input").trigger("blur");
      expect(wrapper.get('[role="alert"]').text()).toContain("有效整数");
      expect(wrapper.emitted("save")).toBeUndefined();
      await wrapper.get("input").trigger("keydown", { key: "Escape" });
      expect(wrapper.find("input").exists()).toBe(false);
      wrapper.unmount();
    },
  );

  it("ignores IME confirmation, skips unchanged saves and cancels when disabled", async () => {
    const wrapper = mountCell("notes", "原备注");
    await wrapper.get("button").trigger("click");
    await wrapper.get("input").trigger("keydown", { key: "Enter", isComposing: true });
    expect(wrapper.find("input").exists()).toBe(true);
    await wrapper.get("input").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("save")).toBeUndefined();
    await wrapper.get("button").trigger("click");
    await wrapper.get("input").setValue("不应保存");
    await wrapper.setProps({ disabled: true });
    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.find("input").exists()).toBe(false);
    await wrapper.get("button").trigger("click");
    expect(wrapper.find("input").exists()).toBe(false);
    wrapper.unmount();
  });
});
