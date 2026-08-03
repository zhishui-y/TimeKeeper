// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { Appointment } from "../../types/domain";
import AppointmentDeleteDialog from "./AppointmentDeleteDialog.vue";

function appointment(serviceStatus: Appointment["serviceStatus"] = "scheduled"): Appointment {
  return {
    id: "appointment-1",
    serviceDate: "2026-08-03",
    startsAt: "2026-08-03T20:00:00",
    endsAt: "2026-08-03T22:00:00",
    contactName: "测试联系人",
    content: "竞技场",
    mode: "business",
    serviceStatus,
    settlementStatus: "unsettled",
    account: null,
    amountMinor: 8_000,
    paymentMethod: null,
    createdAt: "2026-08-03T00:00:00Z",
    updatedAt: "2026-08-03T00:00:00Z",
  };
}

describe("AppointmentDeleteDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers return, cancellation, and permanent deletion with modal semantics", async () => {
    const wrapper = mount(AppointmentDeleteDialog, {
      props: { open: true, appointment: appointment(), busy: false },
    });
    await wrapper.vm.$nextTick();

    const dialog = document.body.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.textContent).toContain("取消预约会保留历史记录");

    dialog
      ?.querySelector<HTMLButtonElement>(".appointment-delete-dialog__danger")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(wrapper.emitted("permanentDelete")).toHaveLength(1);

    const cancelButton = Array.from(dialog?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.trim() === "取消预约",
    );
    cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(wrapper.emitted("cancelAppointment")).toHaveLength(1);
    wrapper.unmount();
  });

  it("shows a disabled cancelled action for an already-cancelled appointment", async () => {
    const wrapper = mount(AppointmentDeleteDialog, {
      props: { open: true, appointment: appointment("cancelled"), busy: false },
    });
    await wrapper.vm.$nextTick();

    const cancelledButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "已取消",
    );
    expect(cancelledButton?.disabled).toBe(true);
    wrapper.unmount();
  });
});
