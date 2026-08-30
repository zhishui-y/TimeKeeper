import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import {
  businessProgressStatuses,
  entertainmentProgressStatuses,
} from "../../utils/appointmentProgress";
import AppointmentProgressRadioGroup from "./AppointmentProgressRadioGroup.vue";

describe("AppointmentProgressRadioGroup", () => {
  it("renders every business status and marks the current value", () => {
    const wrapper = mount(AppointmentProgressRadioGroup, {
      props: {
        value: "pending_settlement",
        options: businessProgressStatuses,
      },
    });

    const radios = wrapper.findAll('input[type="radio"]');
    expect(radios).toHaveLength(5);
    expect(wrapper.text()).toContain("待结算");
    expect(
      (wrapper.get('input[value="pending_settlement"]').element as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("omits pending settlement for entertainment appointments", () => {
    const wrapper = mount(AppointmentProgressRadioGroup, {
      props: {
        value: "scheduled",
        options: entertainmentProgressStatuses,
      },
    });

    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(4);
    expect(wrapper.find('input[value="pending_settlement"]').exists()).toBe(false);
  });

  it("requests a status change without owning the value", async () => {
    const wrapper = mount(AppointmentProgressRadioGroup, {
      props: {
        value: "scheduled",
        options: businessProgressStatuses,
      },
    });

    await wrapper.get('input[value="completed"]').setValue(true);
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("requestChange")?.[0]).toEqual(["completed"]);
    expect(wrapper.props("value")).toBe("scheduled");
    expect((wrapper.get('input[value="scheduled"]').element as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("disables every radio while the group is disabled", () => {
    const wrapper = mount(AppointmentProgressRadioGroup, {
      props: {
        value: "scheduled",
        options: businessProgressStatuses,
        disabled: true,
      },
    });

    expect(
      wrapper
        .findAll('input[type="radio"]')
        .every((radio) => (radio.element as HTMLInputElement).disabled),
    ).toBe(true);
  });
});
