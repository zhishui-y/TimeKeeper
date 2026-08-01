// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ExcelImportScopeSelector from "./ExcelImportScopeSelector.vue";

describe("ExcelImportScopeSelector", () => {
  it("emits independent appointment and account selections", async () => {
    const wrapper = mount(ExcelImportScopeSelector, {
      props: { appointments: true, accounts: true },
    });

    await wrapper.get('input[aria-label="导入预约记录"]').setValue(false);
    await wrapper.get('input[aria-label="导入账号档案"]').setValue(false);

    expect(wrapper.emitted("update:appointments")).toEqual([[false]]);
    expect(wrapper.emitted("update:accounts")).toEqual([[false]]);
  });

  it("disables both choices while an import operation is running", () => {
    const wrapper = mount(ExcelImportScopeSelector, {
      props: { appointments: true, accounts: false, disabled: true },
    });

    expect(wrapper.get("fieldset").attributes("disabled")).toBeDefined();
  });
});
