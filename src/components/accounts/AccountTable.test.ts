import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { AccountProfile } from "../../types/domain";
import {
  accountTableTotalWidth,
  DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS,
} from "../../utils/accountTableColumns";
import AccountTable from "./AccountTable.vue";

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
    notes: "晚间优先，赛季末冲分，长备注用于验证列表中的单行省略展示",
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
    password: null,
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

describe("AccountTable", () => {
  it("selects all visible profiles and supports clearing one row", async () => {
    const wrapper = mount(AccountTable, {
      props: {
        profiles,
        selectedIds: [],
        sortKey: null,
        sortDirection: "asc",
        reorderEnabled: true,
        reorderDisabledReason: "",
        usageDrafts: { "account-1": "今晚使用中", "account-2": "" },
        savingUsageIds: new Set<string>(),
        columnWidths: { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS },
        savingColumnWidths: false,
        clearingWeekly: false,
      },
    });

    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    await checkboxes[0]?.setValue(true);
    let updates = wrapper.emitted("update:selectedIds") ?? [];
    expect(updates[updates.length - 1]?.[0]).toEqual(["account-1", "account-2"]);

    await wrapper.setProps({ selectedIds: ["account-1", "account-2"] });
    await checkboxes[1]?.setValue(false);
    updates = wrapper.emitted("update:selectedIds") ?? [];
    expect(updates[updates.length - 1]?.[0]).toEqual(["account-2"]);
  });

  it("keeps row actions available after the application has been unlocked", () => {
    const wrapper = mount(AccountTable, {
      props: {
        profiles: [profiles[0]!],
        selectedIds: [],
        sortKey: null,
        sortDirection: "asc",
        reorderEnabled: true,
        reorderDisabledReason: "",
        usageDrafts: { "account-1": "今晚使用中" },
        savingUsageIds: new Set<string>(),
        columnWidths: { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS },
        savingColumnWidths: false,
        clearingWeekly: false,
      },
    });

    expect(
      wrapper.get('button[aria-label="复制账号 账号一"]').attributes("disabled"),
    ).toBeUndefined();
    expect(
      wrapper.get('button[aria-label="复制账号一 的密码"]').attributes("disabled"),
    ).toBeUndefined();
    expect(wrapper.get('button[aria-label="删除账号"]').attributes("disabled")).toBeUndefined();
  });

  it("shows copy-only account credentials and a truncated notes column", () => {
    const wrapper = mount(AccountTable, {
      props: {
        profiles,
        selectedIds: [],
        sortKey: null,
        sortDirection: "asc",
        reorderEnabled: true,
        reorderDisabledReason: "",
        usageDrafts: { "account-1": "今晚使用中", "account-2": "" },
        savingUsageIds: new Set<string>(),
        columnWidths: { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS },
        savingColumnWidths: false,
        clearingWeekly: false,
      },
    });

    const rows = wrapper.findAll("tbody tr");
    const firstNotes = rows[0]!.get(".notes-cell");
    const secondNotes = rows[1]!.get(".notes-cell");
    const headers = wrapper.findAll("thead th").map((header) => header.text().trim());

    expect(wrapper.find(".account-name").exists()).toBe(false);
    expect(wrapper.find(".password-cell").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("••••••");
    expect(wrapper.find('button[aria-label^="显示账号一 的密码"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label^="隐藏账号一 的密码"]').exists()).toBe(false);
    expect(wrapper.get('button[aria-label="复制账号 账号一"]').text()).toBe("");
    expect(wrapper.find('button[aria-label="复制账号 账号一"] svg').exists()).toBe(true);
    expect(wrapper.get('button[aria-label="复制账号一 的密码"]').text()).toBe("");
    expect(wrapper.find('button[aria-label="复制账号一 的密码"] svg').exists()).toBe(true);
    expect(wrapper.get('button[aria-label="复制账号二 的密码"]').attributes("disabled")).toBe("");
    expect(wrapper.get('button[aria-label="复制账号二 的密码"]').attributes("title")).toBe(
      "未保存账号密码",
    );
    expect(firstNotes.classes()).toContain("truncate");
    expect(firstNotes.attributes("title")).toBe(profiles[0]!.notes);
    expect(firstNotes.text()).toBe(profiles[0]!.notes);
    expect(secondNotes.text()).toBe("—");
    expect(secondNotes.attributes("title")).toBeUndefined();
    expect(headers).toEqual([
      "",
      "联系人",
      "服务器",
      "角色名",
      "职业 / 心法",
      "装分",
      "账号",
      "密码",
      "当前分",
      "最高分",
      "更新日期",
      "本周",
      "备注",
      "",
    ]);
    expect(rows[0]!.findAll("td")[11]!.classes()).toContain("usage-cell");
    expect(rows[0]!.findAll("td")[12]!.classes()).toContain("notes-cell");
  });

  it("emits sortable header selections and exposes the active direction", async () => {
    const wrapper = mount(AccountTable, {
      props: {
        profiles,
        selectedIds: [],
        sortKey: "currentScore",
        sortDirection: "desc",
        reorderEnabled: false,
        reorderDisabledReason: "恢复默认排序后可拖动",
        usageDrafts: { "account-1": "今晚使用中", "account-2": "" },
        savingUsageIds: new Set<string>(),
        columnWidths: { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS },
        savingColumnWidths: false,
        clearingWeekly: false,
      },
    });

    expect(
      wrapper
        .get('th[aria-sort="descending"] [data-sort-key="currentScore"]')
        .attributes("data-sort-key"),
    ).toBe("currentScore");
    await wrapper.get('[data-sort-key="contactName"]').trigger("click");
    expect(wrapper.emitted("sort")).toEqual([["contactName"]]);
  });

  it("emits account copy and row drop actions", async () => {
    const wrapper = mount(AccountTable, {
      props: {
        profiles,
        selectedIds: [],
        sortKey: null,
        sortDirection: "asc",
        reorderEnabled: true,
        reorderDisabledReason: "",
        usageDrafts: { "account-1": "今晚使用中", "account-2": "" },
        savingUsageIds: new Set<string>(),
        columnWidths: { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS },
        savingColumnWidths: false,
        clearingWeekly: false,
      },
    });
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: () => undefined,
    };

    await wrapper.get('button[aria-label="复制账号 账号一"]').trigger("click");
    expect(wrapper.emitted("copyAccount")).toEqual([[profiles[0]]]);
    await wrapper.get('button[aria-label="复制角色名 角色一"]').trigger("click");
    expect(wrapper.emitted("copyCharacterName")).toEqual([[profiles[0]]]);
    await wrapper.get('button[aria-label="复制账号一 的密码"]').trigger("click");
    expect(wrapper.emitted("copy")).toEqual([[profiles[0]]]);

    await wrapper
      .get('button[aria-label="拖动账号 账号一 调整顺序"]')
      .trigger("dragstart", { dataTransfer });
    const rows = wrapper.findAll("tbody tr");
    await rows[1]?.trigger("dragover", { clientY: -1, dataTransfer });
    await rows[1]?.trigger("drop", { clientY: -1, dataTransfer });
    expect(wrapper.emitted("reorder")).toEqual([["account-1", "account-2", "before"]]);
  });

  it("emits inline usage draft, save, and cancel actions", async () => {
    const wrapper = mount(AccountTable, {
      props: {
        profiles: [profiles[0]!],
        selectedIds: [],
        sortKey: null,
        sortDirection: "asc",
        reorderEnabled: true,
        reorderDisabledReason: "",
        usageDrafts: { "account-1": "今晚使用中" },
        savingUsageIds: new Set<string>(),
        columnWidths: { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS },
        savingColumnWidths: false,
        clearingWeekly: false,
      },
    });
    const input = wrapper.get('input[aria-label="编辑本周 账号一"]');

    expect(input.attributes("disabled")).toBeUndefined();
    await input.setValue("朋友使用到周末");
    expect(wrapper.emitted("updateUsageDraft")).toEqual([["account-1", "朋友使用到周末"]]);

    await wrapper.setProps({ usageDrafts: { "account-1": "朋友使用到周末" } });
    await input.trigger("blur");
    expect(wrapper.emitted("saveUsage")).toEqual([[profiles[0], "朋友使用到周末"]]);

    await input.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("cancelUsage")).toEqual([[profiles[0]]]);
    await wrapper.setProps({ savingUsageIds: new Set(["account-1"]) });
    expect(input.attributes("disabled")).toBeDefined();
  });

  it("leaves an empty weekly field visually blank", () => {
    const wrapper = mount(AccountTable, {
      props: {
        profiles: [profiles[0]!],
        selectedIds: [],
        sortKey: null,
        sortDirection: "asc",
        reorderEnabled: true,
        reorderDisabledReason: "",
        usageDrafts: { "account-1": "" },
        savingUsageIds: new Set<string>(),
        columnWidths: { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS },
        savingColumnWidths: false,
        clearingWeekly: false,
      },
    });

    const input = wrapper.get('input[aria-label="编辑本周 账号一"]');
    expect(input.element).toHaveProperty("value", "");
    expect(input.attributes("placeholder")).toBeUndefined();
    expect(input.attributes("title")).toBeUndefined();
  });

  it("renders twelve resizable content columns including account and password", () => {
    const columnWidths = { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS, weekly: 240 };
    const wrapper = mount(AccountTable, {
      props: {
        profiles: [profiles[0]!],
        selectedIds: [],
        sortKey: null,
        sortDirection: "asc",
        reorderEnabled: true,
        reorderDisabledReason: "",
        usageDrafts: { "account-1": "今晚使用中" },
        savingUsageIds: new Set<string>(),
        columnWidths,
        savingColumnWidths: false,
        clearingWeekly: true,
      },
    });

    expect(wrapper.findAll('button[aria-label^="调整"]')).toHaveLength(12);
    expect(wrapper.get("table").attributes("style")).toContain(
      `min-width: ${accountTableTotalWidth(columnWidths)}px`,
    );
    expect(wrapper.get('input[aria-label="编辑本周 账号一"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('th:nth-child(7) button[aria-label="调整账号列宽"]')).toBeTruthy();
    expect(wrapper.get('th:nth-child(8) button[aria-label="调整密码列宽"]')).toBeTruthy();
    expect(wrapper.find('th:last-child button[aria-label^="调整"]').exists()).toBe(false);
  });
});
