import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppearanceSettingsPanel from "./AppearanceSettingsPanel.vue";

describe("AppearanceSettingsPanel", () => {
  it("keeps intermediate number input text and emits only a valid complete size", async () => {
    const wrapper = mount(AppearanceSettingsPanel, {
      props: { modelValue: { fontFamily: "Microsoft YaHei UI", baseFontSize: 15 } },
    });
    const sizeInput = wrapper.get<HTMLInputElement>('input[aria-label="基础字号"]');

    await sizeInput.setValue("");
    expect(wrapper.emitted("update")).toBeUndefined();
    await sizeInput.setValue("18");
    expect(wrapper.emitted("update")).toEqual([
      [{ fontFamily: "Microsoft YaHei UI", baseFontSize: 18 }],
    ]);
    expect(sizeInput.element.value).toBe("18");
  });

  it("restores invalid drafts on blur without replacing the last valid setting", async () => {
    const wrapper = mount(AppearanceSettingsPanel, {
      props: { modelValue: { fontFamily: "DengXian", baseFontSize: 16 } },
    });
    const fontInput = wrapper.get<HTMLInputElement>('input[aria-label="已安装的单一系统字体名"]');
    const sizeInput = wrapper.get<HTMLInputElement>('input[aria-label="基础字号"]');

    await fontInput.setValue("   ");
    await fontInput.trigger("blur");
    await sizeInput.setValue("19");
    await sizeInput.trigger("blur");

    expect(wrapper.emitted("update")).toBeUndefined();
    expect(fontInput.element.value).toBe("DengXian");
    expect(sizeInput.element.value).toBe("16");
  });
});
