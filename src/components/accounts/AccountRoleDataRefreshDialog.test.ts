// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountRoleDataRefreshResult } from "../../types/domain";
import AccountRoleDataRefreshDialog from "./AccountRoleDataRefreshDialog.vue";

function resultWithFailures(failedCount = 0): AccountRoleDataRefreshResult {
  return {
    requestedCount: 4,
    updatedCount: 1,
    noRecordCount: 1,
    skippedCount: 1,
    failedCount,
    items: [
      { accountId: "a", status: "updated" },
      { accountId: "b", status: "noRecord", message: "无角色战绩" },
      { accountId: "c", status: "skipped", message: "缺少服务器" },
      ...(failedCount ? [{ accountId: "d", status: "failed" as const, message: "请求失败" }] : []),
    ],
  };
}

function mountDialog(props: {
  result: AccountRoleDataRefreshResult | null;
  error: string | null;
  returnFocus?: { focus(): void } | null;
}) {
  const mountTarget = document.createElement("div");
  document.body.appendChild(mountTarget);
  return mount(AccountRoleDataRefreshDialog, {
    attachTo: mountTarget,
    props: { returnFocus: null, ...props },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AccountRoleDataRefreshDialog", () => {
  it("teleports a summary-only modal and closes from the backdrop", async () => {
    const wrapper = mountDialog({ result: resultWithFailures(), error: null });
    await nextTick();

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.textContent).toContain("角色数据更新完成");
    expect(dialog?.textContent).toContain("更新1");
    expect(dialog?.textContent).toContain("无战绩1");
    expect(dialog?.textContent).toContain("跳过1");
    expect(dialog?.textContent).toContain("失败0");
    expect(dialog?.textContent).not.toContain("无角色战绩");
    expect(dialog?.textContent).not.toContain("缺少服务器");

    document
      .querySelector<HTMLButtonElement>(".role-refresh-backdrop")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });

  it("shows command errors without a result summary", async () => {
    const wrapper = mountDialog({ result: null, error: "角色服务器暂不可用" });
    await nextTick();

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("角色数据更新失败");
    expect(dialog?.querySelector('[role="alert"]')?.textContent).toContain("角色服务器暂不可用");
    expect(dialog?.querySelector(".role-refresh-dialog__summary")).toBeNull();
    wrapper.unmount();
  });

  it("traps focus, closes with Escape, and restores the trigger focus", async () => {
    document.body.innerHTML = '<div id="app"><button id="trigger">更新</button></div>';
    const trigger = document.querySelector<HTMLButtonElement>("#trigger")!;
    trigger.focus();
    const wrapper = mountDialog({
      result: resultWithFailures(1),
      error: null,
      returnFocus: trigger,
    });
    trigger.disabled = true;
    await nextTick();
    await nextTick();

    const app = document.querySelector<HTMLElement>("#app")!;
    const closeButton = document.querySelector<HTMLButtonElement>("[data-role-refresh-close]");
    expect(document.activeElement).toBe(closeButton);
    expect(app.inert).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await nextTick();
    expect(wrapper.emitted("close")).toHaveLength(1);

    trigger.disabled = false;
    await wrapper.setProps({ result: null, error: null });
    await nextTick();
    expect(app.inert).toBe(false);
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
  });
});
