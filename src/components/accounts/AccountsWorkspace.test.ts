// @vitest-environment jsdom

import { createPinia } from "pinia";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../api/mockClient";
import { useUiStore } from "../../stores/ui";
import type { AccountProfile, AppSettings } from "../../types/domain";
import { DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS } from "../../utils/accountTableColumns";
import { DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS } from "../../utils/appointmentTableColumns";
import { DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL } from "../../utils/accountRoleData";
import AccountTable from "./AccountTable.vue";
import AccountsWorkspace from "./AccountsWorkspace.vue";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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
    password: "secret-1",
    currentScore: 2100,
    highestScore: 2300,
    scoreUpdatedAt: "2026-07-28",
    usageInfo: "今晚使用中",
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
    password: "secret-2",
    currentScore: 2000,
    highestScore: 2200,
    scoreUpdatedAt: "2026-07-28",
    usageInfo: null,
    notes: null,
    needsReview: false,
    createdAt: "2026-07-28T00:00:00Z",
    updatedAt: "2026-07-28T00:00:00Z",
  },
];

const settingsFixture: AppSettings = {
  defaultReminderMinutes: 30,
  backupRetention: 30,
  lastAutomaticBackupDate: null,
  accountTableColumnWidths: { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS },
  appointmentTableColumnWidths: { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS },
  lastAccountUsageWeekStart: "2026-07-27",
  accountRoleDataServerUrl: DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL,
};

describe("AccountsWorkspace batch delete feedback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("shows progress immediately and an inline success result after deletion", async () => {
    const pendingDelete = deferred<number>();
    vi.spyOn(mockApi, "listAccountProfiles").mockResolvedValue(profiles);
    const deleteProfiles = vi
      .spyOn(mockApi, "deleteAccountProfiles")
      .mockReturnValue(pendingDelete.promise);
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);

    const pinia = createPinia();
    const wrapper = mount(AccountsWorkspace, {
      global: { plugins: [pinia] },
    });
    const ui = useUiStore(pinia);
    await flushPromises();

    expect(wrapper.text()).toContain("暂不可用");
    expect(wrapper.text()).toContain("0 个暂不可用");
    expect(wrapper.text()).not.toContain("待完善");

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

    const wrapper = mount(AccountsWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    expect(wrapper.text()).not.toContain("secret-1");
    expect(wrapper.text()).not.toContain("••••••");
    expect(wrapper.find('button[aria-label^="显示账号一 的密码"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="复制账号一 的密码"]').exists()).toBe(true);

    await wrapper.get('select[aria-label="按服务器筛选账号"]').setValue("唯我独尊");
    expect(wrapper.findAll(".data-table tbody tr")).toHaveLength(1);
    expect(wrapper.get(".account-summary").text()).toContain("显示 1 / 共 2 个账号");
    expect(wrapper.text()).not.toContain("secret-1");

    await wrapper.get('select[aria-label="按服务器筛选账号"]').setValue("");
    expect(wrapper.text()).not.toContain("secret-1");
    expect(wrapper.text()).not.toContain("••••••");
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
  it("searches on every query change and keeps only the newest response", async () => {
    const firstSearch = deferred<AccountProfile[]>();
    const secondSearch = deferred<AccountProfile[]>();
    const listAccountProfiles = vi
      .spyOn(mockApi, "listAccountProfiles")
      .mockResolvedValueOnce(profiles)
      .mockReturnValueOnce(firstSearch.promise)
      .mockReturnValueOnce(secondSearch.promise)
      .mockResolvedValueOnce(profiles);

    const wrapper = mount(AccountsWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    await wrapper.get('input[aria-label="选择账号 账号一"]').setValue(true);
    expect(wrapper.get(".account-summary").text()).toContain("1 个已选中");

    const search = wrapper.get('input[aria-label="搜索账号"]');
    await search.setValue("角");
    expect(listAccountProfiles).toHaveBeenLastCalledWith("角", undefined);
    expect(wrapper.get(".account-summary").text()).not.toContain("1 个已选中");

    await search.setValue("角色二");
    expect(listAccountProfiles).toHaveBeenLastCalledWith("角色二", undefined);

    secondSearch.resolve([profiles[1]!]);
    await flushPromises();
    expect(wrapper.findAll(".data-table tbody tr")).toHaveLength(1);
    expect(wrapper.get(".data-table tbody tr").text()).toContain("角色二");

    firstSearch.resolve([profiles[0]!]);
    await flushPromises();
    expect(wrapper.findAll(".data-table tbody tr")).toHaveLength(1);
    expect(wrapper.get(".data-table tbody tr").text()).toContain("角色二");

    await search.setValue("");
    await flushPromises();
    expect(listAccountProfiles).toHaveBeenLastCalledWith("", undefined);
    expect(wrapper.findAll(".data-table tbody tr")).toHaveLength(2);
    wrapper.unmount();
  });

    const reorder = vi.spyOn(mockApi, "reorderAccountProfiles").mockResolvedValue();
    const copyAccountName = vi.spyOn(mockApi, "copyAccountName").mockResolvedValue();
    const copyAccountCharacterName = vi
      .spyOn(mockApi, "copyAccountCharacterName")
      .mockResolvedValue();
    const copyAccountPassword = vi.spyOn(mockApi, "copyAccountPassword").mockResolvedValue();

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

    await wrapper.get('button[aria-label="复制角色名 角色二"]').trigger("click");
    await flushPromises();
    expect(copyAccountCharacterName).toHaveBeenCalledWith("account-2");
    expect(ui.toast?.message).toBe("角色名已复制");

    await wrapper.get('button[aria-label="复制账号二 的密码"]').trigger("click");
    await flushPromises();
    expect(copyAccountPassword).toHaveBeenCalledWith("account-2");
    expect(ui.toast?.message).toBe("密码已复制，剪贴板将在30秒后清空");
    wrapper.unmount();
  });

  it("saves trimmed usage without a feature-level unlock", async () => {
    const updated = { ...profiles[0]!, usageInfo: "朋友使用到周末" };
    const cleared = { ...updated, usageInfo: null };
    const listProfiles = vi
      .spyOn(mockApi, "listAccountProfiles")
      .mockResolvedValueOnce(profiles)
      .mockResolvedValueOnce([updated, profiles[1]!])
      .mockResolvedValue([cleared, profiles[1]!]);
    const updateUsage = vi
      .spyOn(mockApi, "updateAccountProfileUsage")
      .mockResolvedValueOnce(updated)
      .mockResolvedValueOnce(cleared);

    const pinia = createPinia();
    const wrapper = mount(AccountsWorkspace, {
      global: { plugins: [pinia] },
    });
    const ui = useUiStore(pinia);
    await flushPromises();
    const usageInput = wrapper.get('input[aria-label="编辑本周 账号一"]');
    const emptyUsageInput = wrapper.get('input[aria-label="编辑本周 账号二"]');

    expect(usageInput.attributes("disabled")).toBeUndefined();
    expect(
      wrapper.get('button[aria-label="复制账号一 的密码"]').attributes("disabled"),
    ).toBeUndefined();
    await emptyUsageInput.trigger("focus");
    await emptyUsageInput.setValue("取消这次输入");
    await emptyUsageInput.trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(updateUsage).not.toHaveBeenCalled();
    expect(emptyUsageInput.element).toHaveProperty("value", "");

    await usageInput.trigger("focus");
    await usageInput.setValue("  朋友使用到周末  ");
    await usageInput.trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(updateUsage).toHaveBeenCalledWith("account-1", "朋友使用到周末");
    expect(listProfiles).toHaveBeenCalledTimes(2);
    expect(ui.toast?.message).toBe("本周已保存");
    expect(wrapper.get('input[aria-label="编辑本周 账号一"]').element).toHaveProperty(
      "value",
      "朋友使用到周末",
    );

    const updatedUsageInput = wrapper.get('input[aria-label="编辑本周 账号一"]');
    await updatedUsageInput.setValue("   ");
    await updatedUsageInput.trigger("blur");
    await flushPromises();
    expect(updateUsage).toHaveBeenLastCalledWith("account-1", null);
    expect(wrapper.get('input[aria-label="编辑本周 账号一"]').element).toHaveProperty("value", "");
    wrapper.unmount();
  });

  it("prevents duplicate usage saves and restores the original value on failure", async () => {
    vi.spyOn(mockApi, "listAccountProfiles").mockResolvedValue(profiles);
    const pendingUpdate = deferred<AccountProfile>();
    const updateUsage = vi
      .spyOn(mockApi, "updateAccountProfileUsage")
      .mockReturnValue(pendingUpdate.promise);

    const pinia = createPinia();
    const wrapper = mount(AccountsWorkspace, {
      global: { plugins: [pinia] },
    });
    const ui = useUiStore(pinia);
    await flushPromises();
    const table = wrapper.findComponent(AccountTable);
    table.vm.$emit("updateUsageDraft", "account-1", "保存中的内容");
    table.vm.$emit("saveUsage", profiles[0]!, "保存中的内容");
    table.vm.$emit("saveUsage", profiles[0]!, "保存中的内容");
    await flushPromises();

    expect(updateUsage).toHaveBeenCalledTimes(1);
    pendingUpdate.reject(new Error("使用情况保存失败"));
    await flushPromises();

    expect(ui.toast?.message).toBe("使用情况保存失败");
    expect(wrapper.get('input[aria-label="编辑本周 账号一"]').element).toHaveProperty(
      "value",
      "今晚使用中",
    );
    wrapper.unmount();
  });

  it("loads, previews, and persists account table column widths without a reset control", async () => {
    vi.spyOn(mockApi, "listAccountProfiles").mockResolvedValue(profiles);
    vi.spyOn(mockApi, "syncAccountProfileUsageWeek").mockResolvedValue({
      weekStart: "2026-07-27",
      clearedCount: 0,
    });
    vi.spyOn(mockApi, "getSettings").mockResolvedValue({
      ...settingsFixture,
      accountTableColumnWidths: { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS, accountName: 72 },
    });
    const updateWidths = vi
      .spyOn(mockApi, "updateAccountTableColumnWidths")
      .mockImplementation(async (widths) => ({ ...widths }));

    const wrapper = mount(AccountsWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();
    const table = wrapper.findComponent(AccountTable);
    expect(table.props("columnWidths").accountName).toBe(72);

    table.vm.$emit("previewColumnWidth", "accountName", 88);
    await wrapper.vm.$nextTick();
    expect(table.props("columnWidths").accountName).toBe(88);
    table.vm.$emit("commitColumnWidth", "accountName", 88);
    await flushPromises();
    expect(updateWidths).toHaveBeenCalledWith({
      ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS,
      accountName: 88,
    });
    expect(wrapper.text()).not.toContain("恢复默认列宽");
    wrapper.unmount();
  });

  it("rolls column widths back when persistence fails", async () => {
    vi.spyOn(mockApi, "listAccountProfiles").mockResolvedValue(profiles);
    vi.spyOn(mockApi, "syncAccountProfileUsageWeek").mockResolvedValue({
      weekStart: "2026-07-27",
      clearedCount: 0,
    });
    vi.spyOn(mockApi, "getSettings").mockResolvedValue(settingsFixture);
    vi.spyOn(mockApi, "updateAccountTableColumnWidths").mockRejectedValue(
      new Error("列宽保存失败"),
    );

    const pinia = createPinia();
    const wrapper = mount(AccountsWorkspace, { global: { plugins: [pinia] } });
    await flushPromises();
    const table = wrapper.findComponent(AccountTable);
    table.vm.$emit("previewColumnWidth", "notes", 260);
    table.vm.$emit("commitColumnWidth", "notes", 260);
    await flushPromises();

    expect(table.props("columnWidths").notes).toBe(DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS.notes);
    expect(useUiStore(pinia).toast?.message).toBe("列宽保存失败");
    wrapper.unmount();
  });

  it("confirms and clears weekly content for all accounts while preserving drafts on failure", async () => {
    vi.spyOn(mockApi, "listAccountProfiles").mockResolvedValue(profiles);
    vi.spyOn(mockApi, "syncAccountProfileUsageWeek").mockResolvedValue({
      weekStart: "2026-07-27",
      clearedCount: 0,
    });
    vi.spyOn(mockApi, "getSettings").mockResolvedValue(settingsFixture);
    const clearWeekly = vi
      .spyOn(mockApi, "clearAccountProfileUsage")
      .mockRejectedValueOnce(new Error("清空失败"))
      .mockResolvedValueOnce(1);
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);

    const pinia = createPinia();
    const wrapper = mount(AccountsWorkspace, { global: { plugins: [pinia] } });
    await flushPromises();
    const table = wrapper.findComponent(AccountTable);
    table.vm.$emit("updateUsageDraft", "account-1", "未保存内容");
    await wrapper.vm.$nextTick();

    await buttonWithText(wrapper, "清空本周").trigger("click");
    await flushPromises();
    expect(clearWeekly).toHaveBeenCalledTimes(1);
    expect(wrapper.get('input[aria-label="编辑本周 账号一"]').element).toHaveProperty(
      "value",
      "未保存内容",
    );

    await buttonWithText(wrapper, "清空本周").trigger("click");
    await flushPromises();
    expect(clearWeekly).toHaveBeenCalledTimes(2);
    expect(wrapper.get('input[aria-label="编辑本周 账号一"]').element).toHaveProperty("value", "");
    expect(useUiStore(pinia).toast?.message).toBe("已清空 1 个账号的本周内容");
    expect(globalThis.confirm).toHaveBeenCalledWith(
      "确定清空全部账号的本周内容吗？此操作无法撤销，未保存的本周输入也会被丢弃。",
    );
    wrapper.unmount();
  });

  it("reloads and reports an automatic weekly rollover", async () => {
    const listProfiles = vi.spyOn(mockApi, "listAccountProfiles").mockResolvedValue(profiles);
    vi.spyOn(mockApi, "getSettings").mockResolvedValue(settingsFixture);
    vi.spyOn(mockApi, "syncAccountProfileUsageWeek").mockResolvedValue({
      weekStart: "2026-08-03",
      clearedCount: 1,
    });

    const pinia = createPinia();
    const wrapper = mount(AccountsWorkspace, { global: { plugins: [pinia] } });
    await flushPromises();
    expect(listProfiles).toHaveBeenCalledTimes(1);
    expect(useUiStore(pinia).toast?.message).toBe("新的一周已开始，已清空 1 个账号的本周内容");
    wrapper.unmount();
  });

  it("refreshes the current filtered list, disables every entry while busy, and opens a summary dialog", async () => {
    const pendingRefresh =
      deferred<Awaited<ReturnType<typeof mockApi.refreshAccountProfileRoleData>>>();
    const listProfiles = vi.spyOn(mockApi, "listAccountProfiles").mockResolvedValue(profiles);
    vi.spyOn(mockApi, "getSettings").mockResolvedValue(settingsFixture);
    vi.spyOn(mockApi, "syncAccountProfileUsageWeek").mockResolvedValue({
      weekStart: "2026-07-27",
      clearedCount: 0,
    });
    const refresh = vi
      .spyOn(mockApi, "refreshAccountProfileRoleData")
      .mockReturnValue(pendingRefresh.promise);

    const pinia = createPinia();
    const wrapper = mount(AccountsWorkspace, { global: { plugins: [pinia] } });
    const ui = useUiStore(pinia);
    await flushPromises();
    await wrapper.get('select[aria-label="按服务器筛选账号"]').setValue("梦江南");
    await buttonWithText(wrapper, "更新当前列表").trigger("click");
    await flushPromises();

    expect(refresh).toHaveBeenCalledWith(["account-1"]);
    expect(buttonWithText(wrapper, "更新当前列表").attributes("disabled")).toBeDefined();
    expect(buttonWithText(wrapper, "更新选中").attributes("disabled")).toBeDefined();
    expect(
      wrapper.get('button[aria-label="更新角色数据 账号一"]').attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.get('button[aria-label="更新角色数据 账号一"]').attributes("aria-busy")).toBe(
      "true",
    );

    pendingRefresh.resolve({
      requestedCount: 1,
      updatedCount: 0,
      noRecordCount: 1,
      skippedCount: 0,
      failedCount: 0,
      items: [{ accountId: "account-1", status: "noRecord", message: "无角色战绩" }],
    });
    await flushPromises();

    expect(listProfiles).toHaveBeenCalledTimes(2);
    expect(wrapper.find(".role-refresh-dialog").exists()).toBe(false);
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("角色数据更新完成");
    expect(dialog?.textContent).toContain("无战绩1");
    expect(dialog?.textContent).not.toContain("无角色战绩");
    expect(ui.accountRevision).toBe(1);
    expect(ui.toast).toBeNull();
    document
      .querySelector<HTMLButtonElement>("[data-role-refresh-close]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    wrapper.unmount();
  });

  it("keeps request errors in the summary dialog without a duplicate toast", async () => {
    vi.spyOn(mockApi, "listAccountProfiles").mockResolvedValue(profiles);
    vi.spyOn(mockApi, "getSettings").mockResolvedValue(settingsFixture);
    vi.spyOn(mockApi, "syncAccountProfileUsageWeek").mockResolvedValue({
      weekStart: "2026-07-27",
      clearedCount: 0,
    });
    vi.spyOn(mockApi, "refreshAccountProfileRoleData").mockRejectedValue(
      new Error("角色服务器暂不可用"),
    );

    const pinia = createPinia();
    const wrapper = mount(AccountsWorkspace, { global: { plugins: [pinia] } });
    const ui = useUiStore(pinia);
    await flushPromises();
    await buttonWithText(wrapper, "更新当前列表").trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("角色数据更新失败");
    expect(dialog?.querySelector('[role="alert"]')?.textContent).toContain("角色服务器暂不可用");
    expect(ui.toast).toBeNull();
    document
      .querySelector<HTMLButtonElement>("[data-role-refresh-close]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    wrapper.unmount();
  });

  it("supports selected and single-row role data refresh targets", async () => {
    vi.spyOn(mockApi, "listAccountProfiles").mockResolvedValue(profiles);
    vi.spyOn(mockApi, "getSettings").mockResolvedValue(settingsFixture);
    vi.spyOn(mockApi, "syncAccountProfileUsageWeek").mockResolvedValue({
      weekStart: "2026-07-27",
      clearedCount: 0,
    });
    const refresh = vi.spyOn(mockApi, "refreshAccountProfileRoleData").mockResolvedValue({
      requestedCount: 1,
      updatedCount: 1,
      noRecordCount: 0,
      skippedCount: 0,
      failedCount: 0,
      items: [{ accountId: "account-2", status: "updated" }],
    });

    const wrapper = mount(AccountsWorkspace, { global: { plugins: [createPinia()] } });
    await flushPromises();
    await wrapper.get('input[aria-label="选择账号 账号二"]').setValue(true);
    await buttonWithText(wrapper, "更新选中").trigger("click");
    await flushPromises();
    expect(refresh).toHaveBeenLastCalledWith(["account-2"]);

    await wrapper.get('button[aria-label="更新角色数据 账号一"]').trigger("click");
    await flushPromises();
    expect(refresh).toHaveBeenLastCalledWith(["account-1"]);
    wrapper.unmount();
  });
});
