// @vitest-environment jsdom

import { createPinia } from "pinia";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { describe, expect, it } from "vitest";
import { useUiStore } from "../../stores/ui";
import CalendarWorkspace from "./CalendarWorkspace.vue";

const CalendarBoardStub = defineComponent({
  emits: ["create"],
  template: `
    <button
      type="button"
      data-test="calendar-context-create"
      @click="$emit('create', '2026-08-06', '14:30')"
    >
      日历上下文新建
    </button>
  `,
});

describe("CalendarWorkspace", () => {
  it("removes the duplicate toolbar action while preserving contextual creation", async () => {
    const pinia = createPinia();
    const wrapper = mount(CalendarWorkspace, {
      global: {
        plugins: [pinia],
        stubs: { CalendarBoard: CalendarBoardStub },
      },
    });

    expect(wrapper.find(".page-toolbar > button").exists()).toBe(false);

    await wrapper.get('[data-test="calendar-context-create"]').trigger("click");

    const ui = useUiStore(pinia);
    expect(ui.appointmentDrawerOpen).toBe(true);
    expect(ui.requestedDate).toBe("2026-08-06");
    expect(ui.requestedStartTime).toBe("14:30");

    wrapper.unmount();
  });
});
