// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import AppointmentFiltersBar from "./AppointmentFiltersBar.vue";

describe("AppointmentFiltersBar", () => {
  it("applies search and categorical filters as soon as they change", async () => {
    const wrapper = mount(AppointmentFiltersBar, { props: { filters: {} } });
    const search = wrapper.get('input[placeholder="搜索联系人、内容或账号"]');
    const progress = wrapper.get('select[aria-label="预约进度"]');

    expect(wrapper.findAll("button").some((button) => button.text().trim() === "筛选")).toBe(false);
    await search.setValue("阿");
    await search.setValue("阿水");
    expect(progress.text()).toContain("待结算");
    await progress.setValue("pending_settlement");

    expect(wrapper.emitted("apply")?.map((event) => event[0])).toEqual([
      { query: "阿" },
      { query: "阿水" },
      { query: "阿水", progressStatus: "pending_settlement" },
    ]);
  });

  it("emits the unified pending-settlement filter", async () => {
    const wrapper = mount(AppointmentFiltersBar, { props: { filters: {} } });

    await wrapper.get('select[aria-label="预约进度"]').setValue("pending_settlement");

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
    expect(wrapper.emitted("apply")?.[0]?.[0]).not.toHaveProperty("progressStatus");
    expect(wrapper.emitted("apply")?.[0]?.[0]).toMatchObject({ mode: "entertainment" });
  });

  it("waits for a complete date range and shows friendly empty labels", async () => {
    const wrapper = mount(AppointmentFiltersBar, { props: { filters: {} } });
    const from = wrapper.get<HTMLInputElement>('input[aria-label="开始日期"]');
    const to = wrapper.get<HTMLInputElement>('input[aria-label="结束日期"]');

    expect(wrapper.text()).toContain("开始日期");
    expect(wrapper.text()).toContain("结束日期");
    expect(from.element.closest(".filters__date-field")?.classList).toContain("is-empty");
    expect(to.element.closest(".filters__date-field")?.classList).toContain("is-empty");

    await from.setValue("2026-08-03");
    expect(wrapper.emitted("apply")).toBeUndefined();
    expect(wrapper.text()).not.toContain("开始日期");

    await to.setValue("2026-08-09");
    expect(wrapper.emitted("apply")?.[0]?.[0]).toMatchObject({
      from: "2026-08-03",
      to: "2026-08-09",
    });
  });

  it("opens the native picker when clicking anywhere in a date input", async () => {
    const wrapper = mount(AppointmentFiltersBar, { props: { filters: {} } });
    const from = wrapper.get<HTMLInputElement>('input[aria-label="开始日期"]');
    const showPicker = vi.fn();
    Object.defineProperty(from.element, "showPicker", { value: showPicker });

    await from.trigger("click");

    expect(showPicker).toHaveBeenCalledOnce();
  });

  it("clears both dates when either side of an applied range is cleared", async () => {
    const wrapper = mount(AppointmentFiltersBar, {
      props: { filters: { from: "2026-08-03", to: "2026-08-09", mode: "business" } },
    });

    await wrapper.get('input[aria-label="开始日期"]').setValue("");

    expect(wrapper.get<HTMLInputElement>('input[aria-label="开始日期"]').element.value).toBe("");
    expect(wrapper.get<HTMLInputElement>('input[aria-label="结束日期"]').element.value).toBe("");
    expect(wrapper.emitted("apply")?.[0]?.[0]).toEqual({ mode: "business" });
  });

  it("keeps a partial date draft while applying another filter", async () => {
    const wrapper = mount(AppointmentFiltersBar, { props: { filters: {} } });

    await wrapper.get('input[aria-label="开始日期"]').setValue("2026-08-03");
    await wrapper.get('select[aria-label="预约模式"]').setValue("business");
    await wrapper.setProps({ filters: { mode: "business" } });

    expect(wrapper.emitted("apply")?.[0]?.[0]).toEqual({ mode: "business" });
    expect(wrapper.get<HTMLInputElement>('input[aria-label="开始日期"]').element.value).toBe(
      "2026-08-03",
    );
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
