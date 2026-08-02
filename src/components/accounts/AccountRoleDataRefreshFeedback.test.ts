// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AccountRoleDataRefreshFeedback from "./AccountRoleDataRefreshFeedback.vue";

describe("AccountRoleDataRefreshFeedback", () => {
  it("emits close while preserving all non-success details", async () => {
    const wrapper = mount(AccountRoleDataRefreshFeedback, {
      props: {
        profiles: [],
        result: {
          requestedCount: 3,
          updatedCount: 0,
          noRecordCount: 1,
          skippedCount: 1,
          failedCount: 1,
          items: [
            { accountId: "a", status: "noRecord", message: "无角色战绩" },
            { accountId: "b", status: "skipped", message: "缺少服务器" },
            { accountId: "c", status: "failed", message: "请求失败" },
          ],
        },
      },
    });

    expect(wrapper.text()).toContain("无角色战绩");
    expect(wrapper.text()).toContain("缺少服务器");
    expect(wrapper.text()).toContain("请求失败");
    await wrapper.get('button[aria-label="关闭角色数据更新信息"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
