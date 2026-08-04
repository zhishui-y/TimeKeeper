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

  it("clears stale draft fields when external filters are replaced", async () => {
    const wrapper = mount(AppointmentFiltersBar, {
      props: {
        filters: {
          from: "2026-08-03",
          to: "2026-08-09",
          mode: "business",
          progressStatus: "pending_settlement",
        },
      },
    });

    await wrapper.setProps({ filters: { query: "阿水" } });

    expect(wrapper.get<HTMLInputElement>('input[aria-label="开始日期"]').element.value).toBe("");
    expect(wrapper.get<HTMLInputElement>('input[aria-label="结束日期"]').element.value).toBe("");
    expect(
      wrapper.get<HTMLSelectElement>('select[aria-label="预约模式"]').element.selectedIndex,
    ).toBe(0);
    expect(
      wrapper.get<HTMLSelectElement>('select[aria-label="预约进度"]').element.selectedIndex,
    ).toBe(0);
    expect(
      wrapper.get<HTMLInputElement>('input[placeholder="搜索联系人、内容或账号"]').element.value,
    ).toBe("阿水");
  });
});
