// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppointmentDrawer from "./AppointmentDrawer.vue";

describe("AppointmentDrawer", () => {
  function mountDrawer(defaultReminderMinutes = 30) {
    return mount(AppointmentDrawer, {
      props: {
        open: true,
        appointment: null,
        requestedDate: "2026-07-13",
        requestedStartTime: null,
        accounts: [],
        defaultReminderMinutes,
      },
      global: { stubs: { teleport: true } },
    });
  }

  it("uses the configured reminder default for new appointments", () => {
    const wrapper = mountDrawer(60);

    expect(
      (wrapper.get('input[aria-label="提前提醒分钟数"]').element as HTMLInputElement).value,
    ).toBe("60");
  });

  it("hides billing fields when entertainment mode is selected", async () => {
    const wrapper = mountDrawer();

    expect(wrapper.text()).toContain("账单信息");
    const entertainmentButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("娱乐模式"));
    expect(entertainmentButton).toBeDefined();
    await entertainmentButton?.trigger("click");
    expect(wrapper.text()).not.toContain("账单信息");
  });

  it("rejects equal start and end times", async () => {
    const wrapper = mountDrawer();
    const timeInputs = wrapper.findAll('input[type="time"]');
    await timeInputs[0].setValue("10:00");
    await timeInputs[1].setValue("10:00");

    await wrapper.get('button.button--primary[type="button"]').trigger("click");

    expect(wrapper.text()).toContain("开始时间和结束时间不能相同");
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("requires an amount before a business appointment can be settled", async () => {
    const wrapper = mountDrawer();
    const settlementSelect = wrapper
      .findAll("select")
      .find((select) => select.text().includes("待结算"));
    expect(settlementSelect).toBeDefined();
    await settlementSelect?.setValue("settled");

    await wrapper.get('button.button--primary[type="button"]').trigger("click");

    expect(wrapper.text()).toContain("已结算预约必须填写金额");
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("disables repeat submission while a save is in progress", async () => {
    const wrapper = mountDrawer();
    await wrapper.setProps({ saving: true });

    const saveButton = wrapper.get('button.button--primary[type="button"]');
    expect(saveButton.attributes("disabled")).toBeDefined();
    expect(saveButton.text()).toContain("保存中");
    await saveButton.trigger("click");

    expect(wrapper.emitted("save")).toBeUndefined();
  });
});
