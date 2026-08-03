// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountProfile, Appointment } from "../../types/domain";
import AppointmentDrawer from "./AppointmentDrawer.vue";

describe("AppointmentDrawer", () => {
  let unmount: (() => void) | undefined;

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    vi.useRealTimers();
  });

  function mountDrawer(
    defaultReminderMinutes = 30,
    appointment: Appointment | null = null,
    initialFocus: "default" | "amount" = "default",
    accounts: AccountProfile[] = [],
  ) {
    const wrapper = mount(AppointmentDrawer, {
      attachTo: document.body,
      props: {
        open: true,
        appointment,
        initialFocus,
        requestedDate: "2026-07-13",
        requestedStartTime: null,
        accounts,
        defaultReminderMinutes,
      },
      global: { stubs: { teleport: true } },
    });
    unmount = () => wrapper.unmount();
    return wrapper;
  }

  function completedAppointment(): Appointment {
    return {
      id: "appointment-to-settle",
      serviceDate: "2026-07-13",
      startsAt: "2026-07-13T20:00:00+08:00",
      endsAt: "2026-07-13T22:00:00+08:00",
      contactName: "待结算联系人",
      mode: "business",
      serviceStatus: "completed",
      settlementStatus: "unsettled",
      amountMinor: 18_000,
      createdAt: "2026-07-13T00:00:00Z",
      updatedAt: "2026-07-13T00:00:00Z",
    };
  }

  it("keeps the configured reminder value but leaves a new reminder disabled", () => {
    const wrapper = mountDrawer(60);

    const reminder = wrapper.get('input[aria-label="提前提醒分钟数"]');
    expect((reminder.element as HTMLInputElement).value).toBe("60");
    expect(reminder.attributes("disabled")).toBeDefined();
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false);
  });

  it("starts a blank appointment in profile mode with YY and shows the full profile label", () => {
    const account: AccountProfile = {
      id: "account-label",
      contactName: "联系人",
      server: "梦江南",
      characterName: "清心",
      specialization: "冰心",
      gearScore: "128000",
      accountName: "login-account",
      password: "demo-secret",
      currentScore: 2100,
      highestScore: 2300,
      scoreUpdatedAt: "2026-07-28",
      usageInfo: null,
      notes: null,
      needsReview: false,
      createdAt: "2026-07-28T00:00:00Z",
      updatedAt: "2026-07-28T00:00:00Z",
    };
    const wrapper = mountDrawer(30, null, "default", [account]);

    expect(wrapper.get(".account-kind__item.is-active").text()).toContain("从档案选择");
    expect((wrapper.get('select[aria-label="语音平台"]').element as HTMLSelectElement).value).toBe(
      "yy",
    );
    expect(wrapper.get(".profile-picker option[value='account-label']").text()).toBe(
      "梦江南 · 清心 · 2100 · 2300",
    );
  });

  it("shows an YY channel only for YY voice and filters non-digits", async () => {
    const wrapper = mountDrawer();
    const voice = wrapper.get('select[aria-label="语音平台"]');

    await voice.setValue("yy");
    const channel = wrapper.get('input[placeholder="可留空"]');
    await channel.setValue("12A");
    expect((channel.element as HTMLInputElement).value).toBe("12");

    await voice.setValue("qq");
    expect(wrapper.find('input[placeholder="可留空"]').exists()).toBe(false);
  });

  it("clears a one-time password when switching away from the embedded account", async () => {
    const wrapper = mountDrawer();
    const oneTimeButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("一次性账号"));
    expect(oneTimeButton).toBeDefined();
    await oneTimeButton?.trigger("click");
    await wrapper
      .get('input[placeholder="仅保存到本条预约，不跟随账号档案更新"]')
      .setValue("secret");

    const noneButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("不使用账号"));
    await noneButton?.trigger("click");
    await oneTimeButton?.trigger("click");

    expect(
      (
        wrapper.get('input[placeholder="仅保存到本条预约，不跟随账号档案更新"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("");
  });

  it("hides billing fields when entertainment mode is selected", async () => {
    const wrapper = mountDrawer();

    expect(wrapper.text()).toContain("账单信息");
    const entertainmentButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("娱乐模式"));
    expect(entertainmentButton).toBeDefined();
    await entertainmentButton?.trigger("click");
    expect(wrapper.text()).not.toContain("账单信息");
    expect(wrapper.get('select[aria-label="预约进度"]').findAll("option")).toHaveLength(4);
    expect(wrapper.get('select[aria-label="预约进度"]').text()).not.toContain("待结算");
  });

  it("rejects equal start and end times", async () => {
    const wrapper = mountDrawer();
    const timeInputs = wrapper.findAll('input[type="time"]');
    await timeInputs[0].setValue("10:00");
    await timeInputs[1].setValue("10:00");

    await wrapper.get('button.button--primary[type="submit"]').trigger("click");

    expect(wrapper.text()).toContain("开始时间和结束时间不能相同");
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("fills either time with the current minute and allows clearing the end time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 13, 21, 8, 0));
    const wrapper = mountDrawer();

    await wrapper.get('button[aria-label="开始时间选择现在"]').trigger("click");
    await wrapper.get('button[aria-label="结束时间选择现在"]').trigger("click");
    const timeInputs = wrapper.findAll('input[type="time"]');
    expect((timeInputs[0]?.element as HTMLInputElement).value).toBe("21:08");
    expect((timeInputs[1]?.element as HTMLInputElement).value).toBe("21:08");

    await wrapper.get('button[aria-label="清空结束时间"]').trigger("click");
    expect((timeInputs[1]?.element as HTMLInputElement).value).toBe("");
    await wrapper.get('input[placeholder="谁约的"]').setValue("结束时间待定");
    const noneButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("不使用账号"));
    await noneButton?.trigger("click");
    await wrapper.get('button.button--primary[type="submit"]').trigger("click");

    expect(wrapper.emitted("save")?.[0]?.[0]).toMatchObject({
      startTime: "21:08",
      endTime: null,
    });
  });

  it("requires an amount before a business appointment can be completed", async () => {
    const wrapper = mountDrawer();
    const progressSelect = wrapper.get('select[aria-label="预约进度"]');
    expect(progressSelect.findAll("option")).toHaveLength(5);
    expect(wrapper.text()).not.toContain("结算状态");
    await progressSelect.setValue("completed");

    await wrapper.get('button.button--primary[type="submit"]').trigger("click");

    expect(wrapper.text()).toContain("已完成预约必须填写金额");
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("focuses the amount input when opened from the settlement action", async () => {
    const wrapper = mountDrawer(30, completedAppointment(), "amount");
    await flushPromises();

    const amountInput = wrapper.get('input[type="number"][step="0.01"]');
    expect(document.activeElement).toBe(amountInput.element);
  });

  it("associates the save action with the form for native Enter submission", () => {
    const wrapper = mountDrawer();
    const form = wrapper.get("form#appointment-form");
    const saveButton = wrapper.get('button.button--primary[type="submit"]');

    expect(saveButton.attributes("form")).toBe(form.attributes("id"));
  });

  it("only shows the delete action while editing and emits a delete request", async () => {
    const createWrapper = mountDrawer();
    expect(createWrapper.find("button.button--danger").exists()).toBe(false);
    createWrapper.unmount();

    const editWrapper = mountDrawer(30, completedAppointment());
    const deleteButton = editWrapper.get("button.button--danger");
    expect(deleteButton.text()).toContain("删除预约");

    await deleteButton.trigger("click");

    expect(editWrapper.emitted("delete")).toHaveLength(1);
    expect(editWrapper.emitted("save")).toBeUndefined();
  });

  it("disables conflicting footer actions while deletion is in progress", async () => {
    const wrapper = mountDrawer(30, completedAppointment());
    await wrapper.setProps({ deleting: true });

    const deleteButton = wrapper.get("button.button--danger");
    const saveButton = wrapper.get('button.button--primary[type="submit"]');
    expect(deleteButton.attributes("disabled")).toBeDefined();
    expect(deleteButton.text()).toContain("删除中");
    expect(saveButton.attributes("disabled")).toBeDefined();
  });

  it("moves Tab directly between appointment fields", async () => {
    const wrapper = mountDrawer();
    await flushPromises();
    const dateInput = wrapper.get('input[type="date"]');
    const startTimeInput = wrapper.findAll('input[type="time"]')[0];

    expect(document.activeElement).toBe(dateInput.element);
    await dateInput.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(startTimeInput.element);

    await startTimeInput.trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(dateInput.element);
  });

  it("disables repeat submission while a save is in progress", async () => {
    const wrapper = mountDrawer();
    await wrapper.setProps({ saving: true });

    const saveButton = wrapper.get('button.button--primary[type="submit"]');
    expect(saveButton.attributes("disabled")).toBeDefined();
    expect(saveButton.text()).toContain("保存中");
    await saveButton.trigger("click");

    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("exposes a modal dialog and closes it with Escape", async () => {
    const wrapper = mountDrawer();
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[role="dialog"]').attributes("aria-modal")).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
