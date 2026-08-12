// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountProfile } from "../../types/domain";
import AccountDrawer from "./AccountDrawer.vue";

const existingProfile: AccountProfile = {
  id: "account-1",
  contactName: "青禾",
  server: "梦江南",
  characterName: "测试角色",
  specialization: "无方",
  gearScore: "20万",
  accountName: "demo-account",
  password: "saved-secret",
  currentScore: 2800,
  highestScore: 3100,
  scoreUpdatedAt: "2026-08-12",
  notes: null,
  needsReview: false,
  createdAt: "2026-08-12T00:00:00+08:00",
  updatedAt: "2026-08-12T00:00:00+08:00",
};

describe("AccountDrawer", () => {
  let unmount: (() => void) | undefined;

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    vi.unstubAllGlobals();
  });

  it("disables repeat submission while a save is in progress", async () => {
    const wrapper = mount(AccountDrawer, {
      props: { open: true, profile: null, saving: true },
      global: { stubs: { teleport: true } },
    });
    unmount = () => wrapper.unmount();

    const saveButton = wrapper.get('button.button--primary[type="button"]');
    expect(wrapper.text()).toContain("标记为暂不可用");
    expect(wrapper.text()).not.toContain("待完善");
    expect(saveButton.attributes("disabled")).toBeDefined();
    expect(saveButton.text()).toContain("保存中");
    await saveButton.trigger("click");

    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("emits a replacement credential and normalized scores for a new account", async () => {
    const wrapper = mount(AccountDrawer, {
      props: { open: true, profile: null },
      global: { stubs: { teleport: true } },
    });
    unmount = () => wrapper.unmount();

    await wrapper.get('input[autocomplete="off"]').setValue("new-account");
    await wrapper.get('input[type="password"]').setValue("new-secret");
    const scoreInputs = wrapper.findAll('input[type="number"]');
    await scoreInputs[0].setValue("0");
    await scoreInputs[1].setValue("3186");
    await wrapper.get("button.button--primary").trigger("click");

    expect(wrapper.emitted("save")?.[0]?.[0]).toMatchObject({
      accountName: "new-account",
      credential: { kind: "replace", password: "new-secret" },
      currentScore: 0,
      highestScore: 3186,
    });
  });

  it("keeps an existing credential when the password input stays empty", async () => {
    const wrapper = mount(AccountDrawer, {
      props: { open: true, profile: existingProfile },
      global: { stubs: { teleport: true } },
    });
    unmount = () => wrapper.unmount();

    await wrapper.get("button.button--primary").trigger("click");

    expect(wrapper.emitted("save")?.[0]?.[0]).toMatchObject({
      accountName: "demo-account",
      credential: { kind: "keep" },
    });
  });

  it("emits a replacement credential when editing with a new password", async () => {
    const wrapper = mount(AccountDrawer, {
      props: { open: true, profile: existingProfile },
      global: { stubs: { teleport: true } },
    });
    unmount = () => wrapper.unmount();

    await wrapper.get('input[type="password"]').setValue("replacement-secret");
    await wrapper.get("button.button--primary").trigger("click");

    expect(wrapper.emitted("save")?.[0]?.[0]).toMatchObject({
      credential: { kind: "replace", password: "replacement-secret" },
    });
  });

  it("requires confirmation before marking a saved password for removal", async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirm);
    const wrapper = mount(AccountDrawer, {
      props: { open: true, profile: existingProfile },
      global: { stubs: { teleport: true } },
    });
    unmount = () => wrapper.unmount();

    const removeButton = wrapper.get('button[aria-label="删除已保存密码"]');
    await removeButton.trigger("click");
    expect(wrapper.text()).not.toContain("保存后将删除本机密码");

    await removeButton.trigger("click");
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("保存后将删除本机密码，账号档案会保留");
    expect(wrapper.get('input[type="password"]').attributes("disabled")).toBeDefined();
    await wrapper.get("button.button--primary").trigger("click");

    expect(wrapper.emitted("save")?.[0]?.[0]).toMatchObject({
      credential: { kind: "remove" },
    });
  });

  it("rejects negative and fractional scores before emitting save", async () => {
    const wrapper = mount(AccountDrawer, {
      props: { open: true, profile: existingProfile },
      global: { stubs: { teleport: true } },
    });
    unmount = () => wrapper.unmount();

    const scoreInputs = wrapper.findAll('input[type="number"]');
    expect(scoreInputs.every((input) => input.attributes("step") === "1")).toBe(true);
    await scoreInputs[0].setValue("-1");
    await scoreInputs[1].setValue("1.5");
    await wrapper.get("button.button--primary").trigger("click");

    expect(wrapper.text()).toContain("当前分必须是 0 或更大的有效整数");
    expect(wrapper.text()).toContain("最高分必须是 0 或更大的有效整数");
    expect(wrapper.emitted("save")).toBeUndefined();
  });
});
