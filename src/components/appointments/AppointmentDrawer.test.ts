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

  function progressRadio(
    wrapper: ReturnType<typeof mountDrawer>,
    status: "scheduled" | "in_progress" | "pending_settlement" | "completed" | "cancelled",
  ) {
    return wrapper.get<HTMLInputElement>(
      `input[name="appointment-progress-status"][value="${status}"]`,
    );
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
      weeklyWins: null,
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
    const oneTimeRadio = wrapper.get('input[type="radio"][value="embedded"]');
    await oneTimeRadio.setValue(true);
    await wrapper
      .get('input[placeholder="仅保存到本条预约，不跟随账号档案更新"]')
      .setValue("secret");

    await wrapper.get('input[type="radio"][value="none"]').setValue(true);
    await oneTimeRadio.setValue(true);

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
    const entertainmentRadio = wrapper.get('input[type="radio"][value="entertainment"]');
    await entertainmentRadio.setValue(true);
    expect(wrapper.text()).not.toContain("账单信息");
    expect(wrapper.findAll('input[name="appointment-progress-status"]')).toHaveLength(4);
    expect(wrapper.find('input[value="pending_settlement"]').exists()).toBe(false);
    expect(wrapper.find('select[aria-label="结算状态"]').exists()).toBe(false);
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
    await wrapper.get('input[type="radio"][value="none"]').setValue(true);
    await wrapper.get('button.button--primary[type="submit"]').trigger("click");

    expect(wrapper.emitted("save")?.[0]?.[0]).toMatchObject({
      startTime: "21:08",
      endTime: null,
    });
  });

  it("requires an amount before a business appointment can be settled", async () => {
    const wrapper = mountDrawer();
    expect(wrapper.findAll('input[name="appointment-progress-status"]')).toHaveLength(5);
    await progressRadio(wrapper, "completed").setValue(true);

    await wrapper.get('button.button--primary[type="submit"]').trigger("click");

    expect(wrapper.text()).toContain("已结算预约必须填写金额");
    expect(wrapper.emitted("save")).toBeUndefined();
  });

  it("places account in the primary column and keeps progress before billing", () => {
    const wrapper = mountDrawer();
    const accountFields = wrapper.get(".account-fields").element;
    const progressGroup = wrapper.get(".status-choice").element;
    const amountInput = wrapper.get('input[inputmode="decimal"]').element;

    expect(wrapper.text()).toContain("状态与提醒");
    expect(accountFields.compareDocumentPosition(progressGroup)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(progressGroup.compareDocumentPosition(amountInput)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("accepts zero as an explicit amount for a completed business appointment", async () => {
    const wrapper = mountDrawer();
    await wrapper.get('input[placeholder="谁约的"]').setValue("零元预约");
    await wrapper.get('input[type="radio"][value="none"]').setValue(true);
    await progressRadio(wrapper, "completed").setValue(true);
    await wrapper.get('input[inputmode="decimal"]').setValue("0");
    await wrapper.get('button.button--primary[type="submit"]').trigger("click");

    expect(wrapper.find(".form-errors").exists() ? wrapper.find(".form-errors").text() : "").toBe(
      "",
    );

    expect(wrapper.emitted("save")?.[0]?.[0]).toMatchObject({
      serviceStatus: "completed",
      settlementStatus: "settled",
      amountMinor: 0,
    });
  });

  it("focuses the amount input when opened from the settlement action", async () => {
    const wrapper = mountDrawer(30, completedAppointment(), "amount");
    await flushPromises();

    const amountInput = wrapper.get('input[inputmode="decimal"]');
    expect(document.activeElement).toBe(amountInput.element);
  });

  it("associates the save action with the form for native Enter submission", () => {
    const wrapper = mountDrawer();
    const form = wrapper.get("form#appointment-form");
    const saveButton = wrapper.get('button.button--primary[type="submit"]');

    expect(saveButton.attributes("form")).toBe(form.attributes("id"));
  });

  it("offers completion and cancellation shortcuts only while editing", async () => {
    const createWrapper = mountDrawer();
    expect(createWrapper.find('button[aria-label="完成预约"]').exists()).toBe(false);
    expect(createWrapper.find('button[aria-haspopup="menu"]').exists()).toBe(false);
    createWrapper.unmount();

    const editWrapper = mountDrawer(30, completedAppointment());
    expect(editWrapper.get('button[aria-label="完成预约"]').text()).toContain("标记完成");
    await editWrapper.get('button[aria-haspopup="menu"]').trigger("click");
    const cancelButton = editWrapper
      .findAll('[role="menuitem"]')
      .find((button) => button.text().trim() === "取消预约");
    expect(cancelButton).toBeDefined();

    await cancelButton?.trigger("click");

    expect(editWrapper.emitted("save")?.[0]?.[0]).toMatchObject({
      serviceStatus: "cancelled",
      settlementStatus: "unsettled",
    });
  });

  it("copies current unsaved edits into a Beijing-today draft without saving", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T16:30:00Z"));
    const wrapper = mountDrawer(30, completedAppointment());
    await wrapper.get('input[placeholder="谁约的"]').setValue("  未保存联系人  ");
    await wrapper.get('input[placeholder="上分、陪练、日常…"]').setValue("未保存内容");
    await wrapper.get('textarea[placeholder="补充要求、临时约定等"]').setValue("未保存备注");

    await wrapper.get('button[aria-label="复制为今日预约"]').trigger("click");

    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.emitted("duplicate")?.[0]?.[0]).toEqual({
      sourceAppointmentId: "appointment-to-settle",
      input: expect.objectContaining({
        serviceDate: "2026-08-04",
        contactName: "  未保存联系人  ",
        content: "未保存内容",
        notes: "未保存备注",
        serviceStatus: "scheduled",
        settlementStatus: "unsettled",
      }),
    });
  });

  it("keeps copy and completion visible while using the edit save label", () => {
    const wrapper = mountDrawer(30, completedAppointment());
    const groups = wrapper.findAll(".drawer-footer__actions");

    expect(groups[0]!.findAll("button").map((button) => button.text().trim())).toEqual([
      "复制",
      "标记完成",
      "更多操作",
    ]);
    expect(groups[1]!.findAll("button").map((button) => button.text().trim())).toEqual([
      "关闭",
      "保存修改",
    ]);
    expect(wrapper.get(".drawer__title-row .badge").text()).toBe("待结算");
  });

  it("completes and saves an edited business appointment through the shortcut", async () => {
    const appointment = {
      ...completedAppointment(),
      serviceStatus: "in_progress" as const,
      settlementStatus: "unsettled" as const,
    };
    const wrapper = mountDrawer(30, appointment);
    const completeButton = wrapper
      .findAll("button")
      .find((button) => button.attributes("aria-label") === "完成预约");

    await completeButton?.trigger("click");

    expect(wrapper.emitted("save")?.[0]?.[0]).toMatchObject({
      serviceStatus: "completed",
      settlementStatus: "settled",
      amountMinor: 18_000,
    });
  });

  it("confirms before changing a settled appointment back to pending settlement", async () => {
    const confirm = vi
      .spyOn(globalThis, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const wrapper = mountDrawer(30, {
      ...completedAppointment(),
      serviceStatus: "completed",
      settlementStatus: "settled",
    });
    const pending = progressRadio(wrapper, "pending_settlement");
    const completed = progressRadio(wrapper, "completed");

    await pending.setValue(true);
    await wrapper.vm.$nextTick();
    expect((pending.element as HTMLInputElement).checked).toBe(false);
    expect((completed.element as HTMLInputElement).checked).toBe(true);
    await pending.setValue(true);
    await wrapper.vm.$nextTick();
    expect((pending.element as HTMLInputElement).checked).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("only shows the delete action while editing and emits a delete request", async () => {
    const createWrapper = mountDrawer();
    expect(createWrapper.find('button[aria-haspopup="menu"]').exists()).toBe(false);
    createWrapper.unmount();

    const editWrapper = mountDrawer(30, completedAppointment());
    await editWrapper.get('button[aria-haspopup="menu"]').trigger("click");
    const deleteButton = editWrapper
      .findAll('[role="menuitem"]')
      .find((button) => button.text().trim() === "永久删除");
    expect(deleteButton).toBeDefined();

    await deleteButton?.trigger("click");

    expect(editWrapper.emitted("delete")).toHaveLength(1);
    expect(editWrapper.emitted("save")).toBeUndefined();
  });

  it("disables conflicting footer actions while deletion is in progress", async () => {
    const wrapper = mountDrawer(30, completedAppointment());
    await wrapper.setProps({ deleting: true });

    const saveButton = wrapper.get('button.button--primary[type="submit"]');
    expect(wrapper.get('button[aria-label="复制为今日预约"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('button[aria-label="完成预约"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('button[aria-haspopup="menu"]').attributes("disabled")).toBeDefined();
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
