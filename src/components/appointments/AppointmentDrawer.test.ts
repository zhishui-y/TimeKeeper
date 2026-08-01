// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { Appointment } from "../../types/domain";
import AppointmentDrawer from "./AppointmentDrawer.vue";

describe("AppointmentDrawer", () => {
  let unmount: (() => void) | undefined;

  afterEach(() => {
    unmount?.();
    unmount = undefined;
  });

  function mountDrawer(
    defaultReminderMinutes = 30,
    appointment: Appointment | null = null,
    initialFocus: "default" | "amount" = "default",
  ) {
    const wrapper = mount(AppointmentDrawer, {
      attachTo: document.body,
      props: {
        open: true,
        appointment,
        initialFocus,
        requestedDate: "2026-07-13",
        requestedStartTime: null,
        accounts: [],
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

  it("uses the configured reminder default for new appointments", () => {
    const wrapper = mountDrawer(60);

    expect(
      (wrapper.get('input[aria-label="提前提醒分钟数"]').element as HTMLInputElement).value,
    ).toBe("60");
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

  it("requires an amount before a business appointment can be settled", async () => {
    const wrapper = mountDrawer();
    const settlementSelect = wrapper
      .findAll("select")
      .find((select) => select.text().includes("待结算"));
    expect(settlementSelect).toBeDefined();
    await settlementSelect?.setValue("settled");

    await wrapper.get('button.button--primary[type="submit"]').trigger("click");

    expect(wrapper.text()).toContain("已结算预约必须填写金额");
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
