// @vitest-environment jsdom

import { createPinia } from "pinia";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../api/mockClient";
import { useVault } from "../../composables/useVault";
import { useUiStore } from "../../stores/ui";
import type { AccountProfile } from "../../types/domain";
import AccountTable from "./AccountTable.vue";
import AccountsWorkspace from "./AccountsWorkspace.vue";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function buttonWithText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().includes(text));
  if (!button) throw new Error(`未找到按钮：${text}`);
  return button;
}

const profiles: AccountProfile[] = [
  {
    id: "account-1",
    contactName: "小林",
    server: "梦江南",
    characterName: "角色一",
    specialization: "冰心",
    gearScore: "128000",
    accountName: "账号一",
    currentScore: 2100,
    highestScore: 2300,
    scoreUpdatedAt: "2026-07-28",
    notes: null,
    needsReview: false,
    createdAt: "2026-07-28T00:00:00Z",
    updatedAt: "2026-07-28T00:00:00Z",
  },
  {
    id: "account-2",
    contactName: "小周",
    server: "唯我独尊",
    characterName: "角色二",
    specialization: "花间",
    gearScore: "126000",
    accountName: "账号二",
    currentScore: 2000,
    highestScore: 2200,
    scoreUpdatedAt: "2026-07-28",
    notes: null,
    needsReview: false,
    createdAt: "2026-07-28T00:00:00Z",
    updatedAt: "2026-07-28T00:00:00Z",
  },
];

describe("AccountsWorkspace batch delete feedback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows progress immediately and an inline success result after deletion", async () => {
    const pendingDelete = deferred<number>();
    vi.spyOn(mockApi, "listAccountProfiles").mockResolvedValue(profiles);
    vi.spyOn(mockApi, "vaultStatus").mockResolvedValue({
      initialized: true,
      unlocked: true,
      autoLockMinutes: 15,
    });
    const deleteProfiles = vi
      .spyOn(mockApi, "deleteAccountProfiles")
      .mockReturnValue(pendingDelete.promise);
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    await useVault().load();

    const pinia = createPinia();
    const wrapper = mount(AccountsWorkspace, {
      global: { plugins: [pinia] },
    });
    const ui = useUiStore(pinia);
    await flushPromises();

    await wrapper.get('input[aria-label="全选当前列表账号"]').setValue(true);
    await buttonWithText(wrapper, "批量删除").trigger("click");
    await flushPromises();

    expect(deleteProfiles).toHaveBeenCalledWith(["account-1", "account-2"]);
    expect(buttonWithText(wrapper, "正在删除").attributes("disabled")).toBeDefined();
    expect(buttonWithText(wrapper, "正在删除").attributes("aria-busy")).toBe("true");
    expect(wrapper.get('[role="status"]').text()).toContain("正在永久删除 2 个账号档案");

    pendingDelete.resolve(2);
    await flushPromises();

    expect(buttonWithText(wrapper, "批量删除").attributes("aria-busy")).toBe("false");
    expect(wrapper.get('[role="status"]').text()).toBe("已永久删除 2 个账号档案");
    expect(ui.toast?.message).toBe("已永久删除 2 个账号档案");
    wrapper.unmount();
  });

  it("filters account profiles and sorts numeric columns in both directions", async () => {
    vi.spyOn(mockApi, "listAccountProfiles").mockResolvedValue(profiles);
    vi.spyOn(mockApi, "vaultStatus").mockResolvedValue({
      initialized: true,
      unlocked: true,
      autoLockMinutes: 15,
    });
    await useVault().load();

    const wrapper = mount(AccountsWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    await wrapper.get('select[aria-label="按服务器筛选账号"]').setValue("唯我独尊");
    expect(wrapper.findAll(".data-table tbody tr")).toHaveLength(1);
    expect(wrapper.get(".account-summary").text()).toContain("显示 1 / 共 2 个账号");

    await wrapper.get('select[aria-label="按服务器筛选账号"]').setValue("");
    const currentScoreSort = wrapper.get('[data-sort-key="currentScore"]');
    await currentScoreSort.trigger("click");
    expect(
      wrapper.findAll(".data-table tbody tr").map((row) => row.findAll(".score-cell")[0]?.text()),
    ).toEqual(["2100", "2000"]);

    await currentScoreSort.trigger("click");
    expect(
      wrapper.findAll(".data-table tbody tr").map((row) => row.findAll(".score-cell")[0]?.text()),
    ).toEqual(["2000", "2100"]);
    wrapper.unmount();
  });

  it("persists drag order and copies the selected account name", async () => {
    vi.spyOn(mockApi, "listAccountProfiles").mockResolvedValue(profiles);
    vi.spyOn(mockApi, "vaultStatus").mockResolvedValue({
      initialized: true,
      unlocked: true,
      autoLockMinutes: 15,
    });
    const reorder = vi.spyOn(mockApi, "reorderAccountProfiles").mockResolvedValue();
    const copyAccountName = vi.spyOn(mockApi, "copyAccountName").mockResolvedValue();
    const copyAccountPassword = vi.spyOn(mockApi, "copyAccountPassword").mockResolvedValue();
    await useVault().load();

    const pinia = createPinia();
    const wrapper = mount(AccountsWorkspace, {
      global: { plugins: [pinia] },
    });
    const ui = useUiStore(pinia);
    await flushPromises();

    wrapper.findComponent(AccountTable).vm.$emit("reorder", "account-1", "account-2", "after");
    await flushPromises();
    expect(reorder).toHaveBeenCalledWith(["account-2", "account-1"]);
    expect(wrapper.findAll(".data-table tbody tr")[0]?.text()).toContain("小周");
    expect(ui.toast?.message).toBe("账号顺序已保存");

    await wrapper.get('button[aria-label="复制账号 账号二"]').trigger("click");
    await flushPromises();
    expect(copyAccountName).toHaveBeenCalledWith("account-2");
    expect(ui.toast?.message).toBe("账号已复制");

    await wrapper.get('button[aria-label="复制密码 账号二"]').trigger("click");
    await flushPromises();
    expect(copyAccountPassword).toHaveBeenCalledWith("account-2");
    expect(ui.toast?.message).toBe("密码已复制，剪贴板将在30秒后清空");
    wrapper.unmount();
  });
});
