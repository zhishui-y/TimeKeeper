import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { Appointment } from "../../types/domain";
import CalendarEventCard from "./CalendarEventCard.vue";

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appointment-1",
    serviceDate: "2026-07-30",
    startsAt: "2026-07-30T14:00:00+08:00",
    endsAt: "2026-07-30T15:00:00+08:00",
    contactName: "小北",
    content: "手法陪练",
    mode: "business",
    serviceStatus: "completed",
    settlementStatus: "settled",
    amountMinor: 18_000,
    createdAt: "2026-07-30T00:00:00Z",
    updatedAt: "2026-07-30T00:00:00Z",
    ...overrides,
  };
}

describe("CalendarEventCard", () => {
  it("uses a balanced two-line layout for normal compact appointments", () => {
    const wrapper = mount(CalendarEventCard, {
      props: {
        appointment: appointment(),
        compact: true,
        allDay: false,
        timeText: "14:00 - 15:00",
      },
    });

    expect(wrapper.get(".calendar-event-card__contact").text()).toBe("小北");
    expect(wrapper.get(".calendar-event-card__time").text()).toBe("14:00–15:00");
    expect(wrapper.get(".calendar-event-card__content").text()).toBe("手法陪练");
    expect(wrapper.get(".calendar-event-card__amount").text()).toBe("¥180");
    expect(wrapper.get(".calendar-event-card__progress").text()).toBe("已完成");
    expect(wrapper.attributes("title")).toContain("时间：14:00–15:00");
  });

  it("keeps appointments shorter than one hour in the same two-line layout", () => {
    const wrapper = mount(CalendarEventCard, {
      props: {
        appointment: appointment({ endsAt: "2026-07-30T14:30:00+08:00" }),
        compact: true,
        allDay: false,
        timeText: "14:00 - 14:30",
      },
    });

    expect(wrapper.classes()).toContain("calendar-event-card--short");
    expect(wrapper.get(".calendar-event-card__time").text()).toBe("14:00–14:30");
    expect(wrapper.get(".calendar-event-card__content").text()).toBe("手法陪练");
    expect(wrapper.get(".calendar-event-card__amount").text()).toBe("¥180");
    expect(wrapper.get(".calendar-event-card__progress").text()).toBe("已完成");
    expect(wrapper.attributes("title")).toContain("内容：手法陪练");
  });

  it("renders date-only appointments as a compact pending label", () => {
    const wrapper = mount(CalendarEventCard, {
      props: {
        appointment: appointment({ startsAt: null, endsAt: null }),
        compact: true,
        allDay: true,
        timeText: "",
      },
    });

    expect(wrapper.classes()).toContain("calendar-event-card--pending");
    expect(wrapper.get(".calendar-event-card__time").text()).toBe("待定");
    expect(wrapper.get(".calendar-event-card__content").text()).toBe("手法陪练");
    expect(wrapper.get(".calendar-event-card__amount").text()).toBe("¥180");
    expect(wrapper.get(".calendar-event-card__progress").text()).toBe("已完成");
  });

  it("keeps the legacy content layout outside compact time-grid views", () => {
    const wrapper = mount(CalendarEventCard, {
      props: { appointment: appointment(), compact: false, allDay: false },
    });

    expect(wrapper.classes()).toContain("calendar-event-card--legacy");
    expect(wrapper.get(".calendar-event-card__time").text()).toBe("14:00–15:00");
    expect(wrapper.get(".calendar-event-card__content").text()).toBe("手法陪练");
    expect(wrapper.get(".calendar-event-card__amount").text()).toBe("¥180");
    expect(wrapper.get(".calendar-event-card__progress").text()).toBe("已完成");
  });

  it("shows a dash when an appointment has no applicable amount", () => {
    const wrapper = mount(CalendarEventCard, {
      props: {
        appointment: appointment({
          mode: "entertainment",
          settlementStatus: "not_applicable",
          amountMinor: null,
        }),
        compact: true,
        allDay: false,
      },
    });

    expect(wrapper.get(".calendar-event-card__amount").text()).toBe("—");
    expect(wrapper.get(".calendar-event-card__progress").text()).toBe("已完成");
  });

  it("prefers FullCalendar live time text while an appointment is being moved", () => {
    const wrapper = mount(CalendarEventCard, {
      props: {
        appointment: appointment(),
        compact: true,
        allDay: false,
        timeText: "16:00 - 17:00",
      },
    });

    expect(wrapper.get(".calendar-event-card__time").text()).toBe("16:00–17:00");
  });

  it("exposes the next time slot in the card semantics", () => {
    const wrapper = mount(CalendarEventCard, {
      props: {
        appointment: appointment({ serviceStatus: "scheduled" }),
        compact: true,
        allDay: false,
        isNext: true,
      },
    });

    expect(wrapper.classes()).toContain("calendar-event-card--next");
    expect(wrapper.attributes("aria-label")).toMatch(/^下一时段\n/);
  });
});
