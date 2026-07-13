// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppointmentDrawer from "./AppointmentDrawer.vue";

describe("AppointmentDrawer", () => {
  it("hides billing fields when entertainment mode is selected", async () => {
    const wrapper = mount(AppointmentDrawer, {
      props: {
        open: true,
        appointment: null,
        requestedDate: "2026-07-13",
        requestedStartTime: null,
        accounts: [],
      },
      global: { stubs: { teleport: true } },
    });

    expect(wrapper.text()).toContain("账单信息");
    const entertainmentButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("娱乐模式"));
    expect(entertainmentButton).toBeDefined();
    await entertainmentButton?.trigger("click");
    expect(wrapper.text()).not.toContain("账单信息");
  });
});
