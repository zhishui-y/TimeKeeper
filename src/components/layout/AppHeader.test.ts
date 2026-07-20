import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppHeader from "./AppHeader.vue";

describe("AppHeader", () => {
  it("emits an explicit notification-settings action", async () => {
    const wrapper = mount(AppHeader, {
      props: { title: "今日工作台", subtitle: "今天的安排" },
    });

    await wrapper.get('button[aria-label="通知设置"]').trigger("click");

    expect(wrapper.emitted("openNotificationSettings")).toHaveLength(1);
  });
});
