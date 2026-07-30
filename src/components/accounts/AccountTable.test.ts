import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { AccountProfile } from "../../types/domain";
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

describe("AccountTable", () => {
  it("selects all visible profiles and supports clearing one row", async () => {
    const wrapper = mount(AccountTable, {
      props: {
        profiles,
        revealedPasswords: {},
        vaultUnlocked: true,
        selectedIds: [],
        sortKey: null,
        sortDirection: "asc",
        reorderEnabled: true,
        reorderDisabledReason: "",
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

  it("disables destructive row actions while the vault is locked", () => {
    const wrapper = mount(AccountTable, {
      props: {
        profiles: [profiles[0]!],
        revealedPasswords: {},
        vaultUnlocked: false,
        selectedIds: [],
        sortKey: null,
        sortDirection: "asc",
        reorderEnabled: true,
        reorderDisabledReason: "",
      },
    });

    expect(wrapper.get('button[aria-label="删除账号"]').attributes("disabled")).toBeDefined();
  });

  it("emits sortable header selections and exposes the active direction", async () => {
    const wrapper = mount(AccountTable, {
      props: {
        profiles,
        revealedPasswords: {},
        vaultUnlocked: true,
        selectedIds: [],
        sortKey: "currentScore",
        sortDirection: "desc",
        reorderEnabled: false,
        reorderDisabledReason: "恢复默认排序后可拖动",
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
        revealedPasswords: {},
        vaultUnlocked: true,
        selectedIds: [],
        sortKey: null,
        sortDirection: "asc",
        reorderEnabled: true,
        reorderDisabledReason: "",
      },
    });
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: () => undefined,
    };

    await wrapper.get('button[aria-label="复制账号 账号一"]').trigger("click");
    expect(wrapper.emitted("copyAccount")).toEqual([[profiles[0]]]);

    await wrapper
      .get('button[aria-label="拖动账号 账号一 调整顺序"]')
      .trigger("dragstart", { dataTransfer });
    const rows = wrapper.findAll("tbody tr");
    await rows[1]?.trigger("dragover", { clientY: -1, dataTransfer });
    await rows[1]?.trigger("drop", { clientY: -1, dataTransfer });
    expect(wrapper.emitted("reorder")).toEqual([["account-1", "account-2", "before"]]);
  });
});
