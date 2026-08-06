<script setup lang="ts">
import FullCalendar from "@fullcalendar/vue3";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import zhCnLocale from "@fullcalendar/core/locales/zh-cn";
import type { CalendarOptions, EventApi, EventInput } from "@fullcalendar/core";
import { CalendarDays, ChevronLeft, ChevronRight } from "@lucide/vue";
import { format, subDays } from "date-fns";
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from "vue";
import type { Appointment } from "../../types/domain";
import { calendarAppointmentCounts, calendarEventClassNames } from "../../utils/calendar";
import CalendarEventCard from "./CalendarEventCard.vue";

const props = defineProps<{
  appointments: readonly Appointment[];
  nextAppointmentId?: string | null;
}>();

const emit = defineEmits<{
  edit: [appointment: Appointment];
  create: [serviceDate: string, startTime?: string];
  rangeChange: [from: string, to: string];
}>();

const calendarRef = useTemplateRef<InstanceType<typeof FullCalendar>>("calendar");
const currentTitle = shallowRef("");
const activeView = shallowRef("timeGridWeek");
const appointmentCounts = computed(() => calendarAppointmentCounts(props.appointments));

const events = computed<EventInput[]>(() =>
  props.appointments.map((appointment) => ({
    id: appointment.id,
    title: appointment.contactName,
    start: appointment.startsAt ?? appointment.serviceDate,
    end: appointment.endsAt ?? undefined,
    allDay: !appointment.startsAt,
    classNames: [
      ...calendarEventClassNames(appointment),
      ...(appointment.id === props.nextAppointmentId ? ["appointment-event--next"] : []),
    ],
    extendedProps: { appointment },
  })),
);

function isCompactTimeGrid(viewType: string): boolean {
  return viewType === "timeGridDay" || viewType === "timeGridWeek";
}

function appointmentFromEvent(event: EventApi): Appointment {
  return event.extendedProps.appointment as Appointment;
}

function appointmentCountForDate(date: Date): number {
  return appointmentCounts.value.get(format(date, "yyyy-MM-dd")) ?? 0;
}

const calendarOptions = computed<CalendarOptions>(() => ({
  plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
  locale: zhCnLocale,
  initialView: "timeGridWeek",
  firstDay: 1,
  headerToolbar: false,
  allDayText: "待定",
  allDaySlot: true,
  views: {
    timeGridDay: { dayMaxEvents: 1 },
    timeGridWeek: { dayMaxEvents: 1 },
  },
  nowIndicator: true,
  editable: false,
  selectable: true,
  selectMirror: true,
  eventStartEditable: false,
  eventDurationEditable: false,
  eventMinHeight: 36,
  eventShortHeight: 36,
  slotMinTime: "08:00:00",
  slotMaxTime: "26:00:00",
  scrollTime: "12:00:00",
  slotDuration: "00:30:00",
  expandRows: true,
  height: "100%",
  events: events.value,
  datesSet(info) {
    currentTitle.value = info.view.title;
    activeView.value = info.view.type;
    emit(
      "rangeChange",
      format(info.start, "yyyy-MM-dd"),
      format(subDays(info.end, 1), "yyyy-MM-dd"),
    );
  },
  eventClick(info) {
    emit("edit", info.event.extendedProps.appointment as Appointment);
  },
  dateClick(info) {
    emit("create", info.dateStr.slice(0, 10), info.allDay ? undefined : info.dateStr.slice(11, 16));
  },
}));

function changeView(view: string): void {
  calendarRef.value?.getApi().changeView(view);
}

function move(direction: "prev" | "next" | "today"): void {
  const calendar = calendarRef.value?.getApi();
  if (!calendar) return;
  calendar[direction]();
}

function refreshCalendarSize(): void {
  globalThis.requestAnimationFrame(() => calendarRef.value?.getApi().updateSize());
}

onMounted(() => globalThis.addEventListener("timekeeper-appearance-changed", refreshCalendarSize));
onBeforeUnmount(() =>
  globalThis.removeEventListener("timekeeper-appearance-changed", refreshCalendarSize),
);
</script>

<template>
  <section class="calendar-board">
    <header class="calendar-toolbar">
      <div class="calendar-toolbar__date">
        <button
          class="icon-button"
          type="button"
          title="上一个时间段"
          aria-label="上一个时间段"
          @click="move('prev')"
        >
          <ChevronLeft :size="17" />
        </button>
        <button class="button button--compact" type="button" @click="move('today')">今天</button>
        <button
          class="icon-button"
          type="button"
          title="下一个时间段"
          aria-label="下一个时间段"
          @click="move('next')"
        >
          <ChevronRight :size="17" />
        </button>
        <CalendarDays :size="17" />
        <h2>{{ currentTitle }}</h2>
      </div>
      <div class="segmented" role="group" aria-label="日历视图">
        <button
          class="segmented__item"
          :class="{ 'is-active': activeView === 'timeGridDay' }"
          :aria-pressed="activeView === 'timeGridDay'"
          type="button"
          @click="changeView('timeGridDay')"
        >
          日
        </button>
        <button
          class="segmented__item"
          :class="{ 'is-active': activeView === 'timeGridWeek' }"
          :aria-pressed="activeView === 'timeGridWeek'"
          type="button"
          @click="changeView('timeGridWeek')"
        >
          周
        </button>
        <button
          class="segmented__item"
          :class="{ 'is-active': activeView === 'dayGridMonth' }"
          :aria-pressed="activeView === 'dayGridMonth'"
          type="button"
          @click="changeView('dayGridMonth')"
        >
          月
        </button>
      </div>
    </header>
    <div class="calendar-board__canvas">
      <FullCalendar ref="calendar" :options="calendarOptions">
        <template #eventContent="content">
          <CalendarEventCard
            :appointment="appointmentFromEvent(content.event)"
            :compact="isCompactTimeGrid(content.view.type)"
            :all-day="content.event.allDay"
            :time-text="content.timeText"
            :is-next="appointmentFromEvent(content.event).id === nextAppointmentId"
          />
        </template>
        <template #dayHeaderContent="header">
          <span
            v-if="isCompactTimeGrid(header.view.type)"
            class="calendar-day-heading"
            :aria-label="`${header.text}，${appointmentCountForDate(header.date)}场预约`"
          >
            <span class="calendar-day-heading__date">{{ header.text }}</span>
            <small class="calendar-day-heading__count">
              {{ appointmentCountForDate(header.date) }}场
            </small>
          </span>
          <span v-else>{{ header.text }}</span>
        </template>
      </FullCalendar>
    </div>
  </section>
</template>

<style scoped>
.calendar-board {
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: 56px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, var(--radius));
  background: var(--surface);
  box-shadow: var(--shadow-sm, var(--shadow-soft));
}

.calendar-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(90deg, var(--surface-soft), var(--surface));
}

.calendar-toolbar__date {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.calendar-toolbar__date > svg {
  margin-left: 7px;
  color: var(--brand);
}

.calendar-toolbar__date h2 {
  overflow: hidden;
  color: var(--ink-strong);
  font-size: calc(16px + var(--app-font-size-offset, 0px));
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-board__canvas {
  min-height: 0;
  overflow: hidden;
  padding: 0 12px 12px;
}

.calendar-board__canvas :deep(.fc) {
  --fc-border-color: var(--line);
  --fc-neutral-bg-color: var(--surface-soft);
  --fc-page-bg-color: var(--surface);
  --fc-today-bg-color: color-mix(in srgb, var(--brand-soft) 54%, transparent);
  height: 100%;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.calendar-board__canvas :deep(.fc-theme-standard td),
.calendar-board__canvas :deep(.fc-theme-standard th) {
  border-color: var(--line);
}

.calendar-board__canvas :deep(.fc-scrollgrid) {
  border: 0;
}

.calendar-board__canvas :deep(.fc-col-header-cell) {
  height: 42px;
  color: var(--ink);
  background: var(--surface-soft);
  font-weight: 700;
  vertical-align: middle;
}

.calendar-board__canvas :deep(.fc-col-header-cell-cushion) {
  width: 100%;
  padding: 7px 5px;
}

.calendar-day-heading {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.calendar-day-heading__date {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-day-heading__count {
  flex: 0 0 auto;
  padding: 2px 5px;
  border: 1px solid color-mix(in srgb, var(--brand-border) 78%, transparent);
  border-radius: 999px;
  color: var(--brand-strong);
  background: color-mix(in srgb, var(--brand-soft) 72%, var(--surface));
  font-family: var(--app-font-family), "Bahnschrift", var(--font-sans);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 750;
  line-height: 1;
}

.calendar-board__canvas :deep(.fc-timegrid-slot-label) {
  color: var(--ink-muted);
  font-family: var(--app-font-family), "Bahnschrift", var(--font-sans);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 600;
}

.calendar-board__canvas :deep(.fc-timegrid-slot) {
  height: 18px;
}

.calendar-board__canvas :deep(.fc-timegrid-axis-cushion),
.calendar-board__canvas :deep(.fc-timegrid-slot-label-cushion) {
  padding-inline: 5px;
}

.calendar-board__canvas :deep(.fc-timegrid-now-indicator-line) {
  border-color: var(--accent);
}

.calendar-board__canvas :deep(.fc-timegrid-now-indicator-arrow) {
  border-color: transparent transparent transparent var(--accent);
}

.calendar-board__canvas :deep(.fc-event) {
  border: 1px solid var(--event-border, var(--brand-border));
  border-left: 3px solid var(--mode-accent, var(--brand));
  border-radius: 7px;
  color: var(--event-ink, var(--brand-strong));
  background: var(--event-background, var(--brand-soft));
  box-shadow: var(--shadow-control, none);
  cursor: pointer;
  transition:
    border-color 130ms ease,
    box-shadow 130ms ease,
    filter 130ms ease;
}

.calendar-board__canvas :deep(.fc-event:hover) {
  border-color: var(--event-accent, var(--brand));
  border-left-color: var(--mode-accent, var(--brand));
  box-shadow: 0 6px 14px color-mix(in srgb, var(--event-accent, var(--brand)) 14%, transparent);
  filter: saturate(1.04);
}

.calendar-board__canvas :deep(.fc-event-main) {
  color: inherit;
}

.calendar-board__canvas :deep(.appointment-event--scheduled) {
  --event-accent: var(--blue);
  --event-background: var(--blue-soft);
  --event-border: var(--blue-border);
  --event-ink: #365d70;
}

.calendar-board__canvas :deep(.appointment-event--in_progress) {
  --event-accent: var(--accent);
  --event-background: var(--accent-soft);
  --event-border: var(--accent-border);
  --event-ink: var(--accent-strong);
}

.calendar-board__canvas :deep(.appointment-event--pending_settlement) {
  --event-accent: var(--amber);
  --event-background: var(--amber-soft);
  --event-border: var(--amber-border);
  --event-ink: #815414;
}

.calendar-board__canvas :deep(.appointment-event--completed) {
  --event-accent: var(--brand);
  --event-background: var(--brand-soft);
  --event-border: var(--brand-border);
  --event-ink: var(--brand-strong);
}

.calendar-board__canvas :deep(.appointment-event--cancelled) {
  --event-accent: var(--ink-muted);
  --event-background: var(--neutral-soft);
  --event-border: var(--line);
  --event-ink: var(--ink-muted);
  box-shadow: none;
  opacity: 0.76;
}

.calendar-board__canvas :deep(.appointment-event--business) {
  --mode-accent: var(--brand);
}

.calendar-board__canvas :deep(.appointment-event--entertainment) {
  --mode-accent: var(--blue);
}

.calendar-board__canvas :deep(.appointment-event--next) {
  --event-accent: var(--gold);
  --event-background: color-mix(in srgb, var(--gold-soft) 90%, var(--surface));
  --event-border: var(--gold-border);
  --event-ink: var(--gold-strong);
  box-shadow:
    inset 0 0 0 2px var(--gold-border),
    0 5px 14px color-mix(in srgb, var(--gold) 18%, transparent);
}

.calendar-board__canvas :deep(.appointment-event--next:hover) {
  box-shadow:
    inset 0 0 0 2px var(--gold-border),
    0 6px 14px color-mix(in srgb, var(--gold) 18%, transparent);
}

.calendar-board__canvas :deep(.appointment-event--cancelled .calendar-event-card__contact) {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.calendar-board__canvas :deep(.appointment-event--pending_settlement .fc-event-progress) {
  color: #815414;
  background: color-mix(in srgb, var(--amber-soft) 82%, var(--surface));
}

.calendar-board__canvas :deep(.appointment-event--in_progress .fc-event-progress) {
  color: var(--accent-strong);
  background: color-mix(in srgb, var(--accent-soft) 84%, var(--surface));
}

.calendar-board__canvas :deep(.appointment-event--completed .fc-event-progress) {
  color: var(--brand-strong);
  background: color-mix(in srgb, var(--brand-soft) 84%, var(--surface));
}

.calendar-board__canvas :deep(.fc-day-today) {
  background: color-mix(in srgb, var(--brand-soft) 58%, transparent) !important;
}

.calendar-board__canvas :deep(.fc-daygrid-day-number) {
  padding: 7px;
  color: var(--ink);
  font-family: var(--app-font-family), "Bahnschrift", var(--font-sans);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 700;
}

.calendar-board__canvas :deep(.fc-daygrid .fc-daygrid-day-frame) {
  min-height: 82px;
}

.calendar-board__canvas :deep(.fc-timegrid .fc-daygrid-day-frame) {
  min-height: 34px;
}

.calendar-board__canvas :deep(.fc-timegrid .fc-daygrid-day-events) {
  min-height: 26px;
  margin-bottom: 2px;
}

.calendar-board__canvas :deep(.fc-timegrid .fc-daygrid-event-harness) {
  margin-top: 2px;
}

.calendar-board__canvas :deep(.fc-timegrid .fc-daygrid-event) {
  width: max-content;
  max-width: calc(100% - 4px);
  min-height: 22px;
  margin-inline: 2px;
}

.calendar-board__canvas :deep(.fc-timegrid .fc-daygrid-more-link) {
  margin: 1px 3px 0;
  color: var(--brand-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 750;
}

@media (max-width: 1180px) {
  .calendar-toolbar {
    gap: 10px;
    padding-inline: 10px;
  }

  .calendar-toolbar__date {
    gap: 5px;
  }

  .calendar-toolbar__date > svg {
    margin-left: 4px;
  }

  .calendar-toolbar__date h2 {
    font-size: calc(15px + var(--app-font-size-offset, 0px));
  }

  .calendar-board__canvas {
    padding-inline: 9px;
    padding-bottom: 9px;
  }

  .calendar-day-heading {
    gap: 4px;
  }

  .calendar-day-heading__count {
    padding-inline: 4px;
    font-size: calc(12px + var(--app-font-size-offset, 0px));
  }
}

@media (max-height: 760px) {
  .calendar-board {
    grid-template-rows: 52px minmax(0, 1fr);
  }

  .calendar-board__canvas :deep(.fc-col-header-cell) {
    height: 38px;
  }

  .calendar-board__canvas :deep(.fc-timegrid-slot) {
    height: 12px;
    font-size: calc(12px + var(--app-font-size-offset, 0px));
    line-height: 1;
  }

  .calendar-board__canvas :deep(.fc-timegrid .fc-daygrid-day-frame) {
    min-height: 32px;
  }
}
</style>
