import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { CalendarOptions } from "@fullcalendar/core";
import type { Appointment } from "../../types/domain";
import CalendarBoard from "./CalendarBoard.vue";

vi.mock("@fullcalendar/vue3", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "FullCalendarMock",
      props: {
        options: {
          type: Object,
          required: true,
        },
      },
      setup(_props, { slots }) {
        return () =>
          h("div", { "data-testid": "full-calendar" }, [
            slots.dayHeaderContent?.({
              date: new Date("2026-07-30T00:00:00+08:00"),
              text: "7/30周四",
              view: { type: "timeGridWeek" },
            }),
          ]);
      },
    }),
  };
});

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appointment-1",
    serviceDate: "2026-07-30",
    startsAt: "2026-07-30T14:00:00+08:00",
    endsAt: "2026-07-30T15:00:00+08:00",
    contactName: "小北",
    content: "手法陪练",
    mode: "business",
    serviceStatus: "scheduled",
    settlementStatus: "unsettled",
    amountMinor: 18_000,
    createdAt: "2026-07-30T00:00:00Z",
    updatedAt: "2026-07-30T00:00:00Z",
    ...overrides,
  };
}

function mountBoard() {
  const profile = appointment();
  const wrapper = mount(CalendarBoard, {
    props: { appointments: [profile] },
  });
  const calendar = wrapper.findComponent({ name: "FullCalendarMock" });
  const options = calendar.props("options") as CalendarOptions;
  const event = {
    allDay: false,
    start: new Date("2026-07-30T15:00:00+08:00"),
    end: new Date("2026-07-30T16:00:00+08:00"),
    extendedProps: { appointment: profile },
  };
  return { wrapper, options, event, profile };
}

describe("CalendarBoard", () => {
  it("configures compact time-grid views without changing the available time range", () => {
    const { options } = mountBoard();

    expect(options.initialView).toBe("timeGridWeek");
    expect(options.slotMinTime).toBe("08:00:00");
    expect(options.slotMaxTime).toBe("26:00:00");
    expect(options.scrollTime).toBe("12:00:00");
    expect(options.eventMinHeight).toBe(15);
    expect(options.eventShortHeight).toBe(36);
    expect(options.views?.timeGridDay?.dayMaxEvents).toBe(1);
    expect(options.views?.timeGridWeek?.dayMaxEvents).toBe(1);
  });

  it("keeps edit, create and reschedule events explicit", () => {
    const { wrapper, options, event, profile } = mountBoard();
    const dropRevert = vi.fn();
    const resizeRevert = vi.fn();

    options.eventClick?.({ event } as never);
    options.dateClick?.({
      dateStr: "2026-07-30T15:30:00+08:00",
      allDay: false,
    } as never);
    options.eventDrop?.({
      event,
      revert: dropRevert,
    } as never);
    options.eventResize?.({
      event,
      revert: resizeRevert,
    } as never);

    expect(wrapper.emitted("edit")).toEqual([[profile]]);
    expect(wrapper.emitted("create")).toEqual([["2026-07-30", "15:30"]]);
    expect(wrapper.emitted("reschedule")).toEqual([
      [
        {
          appointment: profile,
          startsAt: event.start,
          endsAt: event.end,
          allDay: false,
          revert: dropRevert,
        },
      ],
      [
        {
          appointment: profile,
          startsAt: event.start,
          endsAt: event.end,
          allDay: false,
          revert: resizeRevert,
        },
      ],
    ]);
  });

  it("shows the active appointment count in compact day headings", async () => {
    const { wrapper } = mountBoard();
    await wrapper.setProps({
      appointments: [
        appointment(),
        appointment({ id: "pending", startsAt: null, endsAt: null }),
        appointment({ id: "cancelled", serviceStatus: "cancelled" }),
      ],
    });

    expect(wrapper.get(".calendar-day-heading").attributes("aria-label")).toBe("7/30周四，2场预约");
    expect(wrapper.get(".calendar-day-heading__count").text()).toBe("2场");
  });
});
