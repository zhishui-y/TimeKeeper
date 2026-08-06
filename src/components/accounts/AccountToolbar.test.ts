// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import AccountToolbar from "./AccountToolbar.vue";

function lastEvent(events: unknown[][] | undefined): unknown[] | undefined {
  return events?.[events.length - 1];
}

const baseProps = {
  query: "",
  needsReviewOnly: false,
  contactName: "",
  server: "",
  specialization: "",
  contactOptions: ["小林"],
  serverOptions: ["梦江南"],
  specializationOptions: ["冰心"],
  visibleCount: 2,
  selectedCount: 1,
  refreshBusy: false,
  deleting: false,
  canResetView: false,
};

describe("AccountToolbar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("binds search and filter models and emits toolbar operations", async () => {
    const wrapper = mount(AccountToolbar, { props: baseProps });

    expect(wrapper.find('button[title="查询账号"]').exists()).toBe(false);
    const search = wrapper.get('input[aria-label="搜索账号"]');
    const contactFilter = wrapper.get('select[aria-label="按联系人筛选账号"]');
    const serverFilter = wrapper.get('select[aria-label="按服务器筛选账号"]');
    const specializationFilter = wrapper.get('select[aria-label="按职业或心法筛选账号"]');
    expect(contactFilter.classes()).toContain("account-toolbar__select--contact");
    expect(serverFilter.classes()).toContain("account-toolbar__select--server");
    expect(specializationFilter.classes()).not.toContain("account-toolbar__select--contact");
    expect(specializationFilter.classes()).not.toContain("account-toolbar__select--server");
    expect(
      search.element
        .closest("label")
        ?.nextElementSibling?.classList.contains("account-toolbar__review"),
    ).toBe(true);
    const resetButton = wrapper.get<HTMLButtonElement>('button[aria-label="重置筛选和排序"]');
    expect(resetButton.attributes("disabled")).toBeDefined();
    expect(specializationFilter.element.nextElementSibling).toBe(resetButton.element);
    expect(
      resetButton.element
        .closest(".account-toolbar__filters")
        ?.nextElementSibling?.classList.contains("account-toolbar__actions"),
    ).toBe(true);
    await resetButton.trigger("click");
    expect(wrapper.emitted("resetView")).toBeUndefined();

    await search.setValue("角色一");
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await contactFilter.setValue("小林");
    await serverFilter.setValue("梦江南");
    await specializationFilter.setValue("冰心");
    await wrapper.get('button[aria-label="更新当前列表"]').trigger("click");
    await wrapper.get('button[aria-label="更新选中"]').trigger("click");
    await wrapper.get('button[aria-label="批量删除"]').trigger("click");
    await wrapper.get('button[aria-label="新建账号"]').trigger("click");
    await wrapper.setProps({ canResetView: true });
    expect(resetButton.attributes("disabled")).toBeUndefined();
    expect(wrapper.get('button[aria-label="重置筛选和排序"]').element).toBe(resetButton.element);
    await resetButton.trigger("click");

    expect(lastEvent(wrapper.emitted("update:query"))).toEqual(["角色一"]);
    expect(lastEvent(wrapper.emitted("update:needsReviewOnly"))).toEqual([true]);
    expect(lastEvent(wrapper.emitted("update:contactName"))).toEqual(["小林"]);
    expect(lastEvent(wrapper.emitted("update:server"))).toEqual(["梦江南"]);
    expect(lastEvent(wrapper.emitted("update:specialization"))).toEqual(["冰心"]);
    expect(wrapper.emitted("search")).toHaveLength(1);
    expect(wrapper.emitted("refreshVisible")).toHaveLength(1);
    expect(wrapper.emitted("refreshSelected")).toHaveLength(1);
    expect(wrapper.emitted("deleteSelected")).toHaveLength(1);
    expect(wrapper.emitted("create")).toHaveLength(1);
    expect(wrapper.emitted("resetView")).toHaveLength(1);
  });

  it("keeps application access controls out of the account toolbar", () => {
    const wrapper = mount(AccountToolbar, { props: baseProps });

    expect(wrapper.find('button[title="锁定时约管家"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("本次运行已解锁");
    expect(wrapper.text()).not.toContain("拖动左侧手柄调整默认顺序");
    expect(wrapper.text()).not.toContain("筛选");
  });
});
