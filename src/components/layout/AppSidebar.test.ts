import { mount, RouterLinkStub } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppSidebar from "./AppSidebar.vue";

describe("AppSidebar", () => {
  it("places account profiles before appointment records", () => {
    const wrapper = mount(AppSidebar, {
      global: { stubs: { RouterLink: RouterLinkStub } },
    });

    expect(wrapper.findAll(".nav__item").map((item) => item.text())).toEqual([
      "今日",
      "排班日历",
      "账号档案",
      "预约记录",
      "收益总结",
      "数据与设置",
    ]);
  });
});
