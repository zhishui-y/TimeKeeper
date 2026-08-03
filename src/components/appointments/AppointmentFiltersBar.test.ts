// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppointmentFiltersBar from "./AppointmentFiltersBar.vue";

describe("AppointmentFiltersBar", () => {
  it("emits the unified pending-settlement filter", async () => {
    const wrapper = mount(AppointmentFiltersBar, { props: { filters: {} } });
    const progress = wrapper.get('select[aria-label="预约进度"]');

    expect(progress.text()).toContain("待结算");
    await progress.setValue("pending_settlement");
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("apply")?.[0]?.[0]).toMatchObject({
      progressStatus: "pending_settlement",
    });
  });

  it("removes pending settlement when switching to entertainment mode", async () => {
    const wrapper = mount(AppointmentFiltersBar, {
      props: { filters: { progressStatus: "pending_settlement" } },
    });

    await wrapper.get('select[aria-label="预约模式"]').setValue("entertainment");
    const progress = wrapper.get('select[aria-label="预约进度"]');
    expect(progress.text()).not.toContain("待结算");
    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("apply")?.[0]?.[0]).not.toHaveProperty("progressStatus");
  });
});
