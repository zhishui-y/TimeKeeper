<script setup lang="ts">
import FullCalendar from "@fullcalendar/vue3";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import zhCnLocale from "@fullcalendar/core/locales/zh-cn";
import type { CalendarOptions, EventInput } from "@fullcalendar/core";
import { CalendarDays, ChevronLeft, ChevronRight } from "@lucide/vue";
import { computed, shallowRef, useTemplateRef } from "vue";
import type { Appointment } from "../../types/domain";
import { formatCurrency } from "../../utils/formatters";

interface ReschedulePayload {
  appointment: Appointment;
  startsAt: Date;
  endsAt: Date | null;
  revert: () => void;
}

const props = defineProps<{
  appointments: readonly Appointment[];
}>();

const emit = defineEmits<{
  edit: [appointment: Appointment];
  create: [serviceDate: string, startTime?: string];
  reschedule: [payload: ReschedulePayload];
}>();

const calendarRef = useTemplateRef<InstanceType<typeof FullCalendar>>("calendar");
const currentTitle = shallowRef("");
const activeView = shallowRef("timeGridWeek");

const events = computed<EventInput[]>(() =>
  props.appointments.map((appointment) => ({
    id: appointment.id,
    title: appointment.contactName,
    start: appointment.startsAt ?? appointment.serviceDate,
    end: appointment.endsAt ?? undefined,
    allDay: !appointment.startsAt,
    editable: appointment.serviceStatus !== "cancelled",
    classNames: [
      `appointment-event--${appointment.mode}`,
      `appointment-event--${appointment.serviceStatus}`,
    ],
    extendedProps: { appointment },
  })),
);

function renderEventContent(appointment: Appointment) {
  const root = globalThis.document.createElement("div");
  root.className = "fc-event-inner";
  const contact = globalThis.document.createElement("strong");
  contact.textContent = appointment.contactName;
  const content = globalThis.document.createElement("small");
  content.textContent = appointment.content || "未填写内容";
  root.append(contact, content);
  if (appointment.mode === "business" && appointment.amountMinor) {
    const amount = globalThis.document.createElement("span");
    amount.textContent = formatCurrency(appointment.amountMinor);
    root.append(amount);
  }
  return { domNodes: [root] };
}

const calendarOptions = computed<CalendarOptions>(() => ({
  plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
  locale: zhCnLocale,
  initialView: "timeGridWeek",
  firstDay: 1,
  headerToolbar: false,
  allDayText: "待定",
  allDaySlot: true,
  nowIndicator: true,
  editable: true,
  selectable: true,
  selectMirror: true,
  eventDurationEditable: true,
  slotMinTime: "08:00:00",
  slotMaxTime: "26:00:00",
  scrollTime: "12:00:00",
  slotDuration: "00:30:00",
  expandRows: true,
  height: "100%",
  events: events.value,
  eventContent(info) {
    const appointment = info.event.extendedProps.appointment as Appointment;
    return renderEventContent(appointment);
  },
  datesSet(info) {
    currentTitle.value = info.view.title;
    activeView.value = info.view.type;
  },
  eventClick(info) {
    emit("edit", info.event.extendedProps.appointment as Appointment);
  },
  dateClick(info) {
    emit("create", info.dateStr.slice(0, 10), info.allDay ? undefined : info.dateStr.slice(11, 16));
  },
  eventDrop(info) {
    const appointment = info.event.extendedProps.appointment as Appointment;
    if (!info.event.start) return;
    emit("reschedule", {
      appointment,
      startsAt: info.event.start,
      endsAt: info.event.end,
      revert: info.revert,
    });
  },
  eventResize(info) {
    const appointment = info.event.extendedProps.appointment as Appointment;
    if (!info.event.start) return;
    emit("reschedule", {
      appointment,
      startsAt: info.event.start,
      endsAt: info.event.end,
      revert: info.revert,
    });
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
      <div class="segmented" aria-label="日历视图">
        <button
          class="segmented__item"
          :class="{ 'is-active': activeView === 'timeGridDay' }"
          type="button"
          @click="changeView('timeGridDay')"
        >
          日
        </button>
        <button
          class="segmented__item"
          :class="{ 'is-active': activeView === 'timeGridWeek' }"
          type="button"
          @click="changeView('timeGridWeek')"
        >
          周
        </button>
        <button
          class="segmented__item"
          :class="{ 'is-active': activeView === 'dayGridMonth' }"
          type="button"
          @click="changeView('dayGridMonth')"
        >
          月
        </button>
      </div>
    </header>
    <div class="calendar-board__canvas">
      <FullCalendar ref="calendar" :options="calendarOptions" />
    </div>
  </section>
</template>

<style scoped>
.calendar-board {
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: 52px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.calendar-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--line);
}

.calendar-toolbar__date {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.calendar-toolbar__date > svg {
  margin-left: 8px;
  color: var(--brand);
}

.calendar-toolbar__date h2 {
  overflow: hidden;
  color: var(--ink-strong);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-board__canvas {
  min-height: 0;
  overflow: hidden;
  padding: 0 10px 10px;
}

.calendar-board__canvas :deep(.fc) {
  height: 100%;
  color: var(--ink);
  font-size: 11px;
}

.calendar-board__canvas :deep(.fc-theme-standard td),
.calendar-board__canvas :deep(.fc-theme-standard th) {
  border-color: #e5e9e4;
}

.calendar-board__canvas :deep(.fc-scrollgrid) {
  border: 0;
}

.calendar-board__canvas :deep(.fc-col-header-cell) {
  height: 38px;
  color: #65716d;
  background: #f8faf7;
  font-weight: 650;
  vertical-align: middle;
}

.calendar-board__canvas :deep(.fc-timegrid-slot-label) {
  color: #929b98;
  font-family: "Bahnschrift", sans-serif;
  font-size: 9px;
}

.calendar-board__canvas :deep(.fc-timegrid-slot) {
  height: 24px;
}

.calendar-board__canvas :deep(.fc-timegrid-now-indicator-line) {
  border-color: var(--accent);
}

.calendar-board__canvas :deep(.fc-timegrid-now-indicator-arrow) {
  border-color: transparent transparent transparent var(--accent);
}

.calendar-board__canvas :deep(.fc-event) {
  border: 1px solid #b4d0c1;
  border-left: 3px solid var(--brand);
  border-radius: 3px;
  color: var(--brand-strong);
  background: var(--brand-soft);
  box-shadow: none;
  cursor: pointer;
}

.calendar-board__canvas :deep(.fc-event-main) {
  color: inherit;
}

.calendar-board__canvas :deep(.appointment-event--entertainment) {
  border-color: #bbced9;
  border-left-color: var(--blue);
  color: #365d74;
  background: var(--blue-soft);
}

.calendar-board__canvas :deep(.appointment-event--cancelled) {
  border-color: #d3d8d4;
  border-left-color: #909a96;
  color: #7d8582;
  background: #eff1ee;
  opacity: 0.68;
}

.calendar-board__canvas :deep(.fc-event-inner) {
  display: flex;
  min-width: 0;
  height: 100%;
  flex-direction: column;
  gap: 1px;
  padding: 2px 4px;
  overflow: hidden;
}

.calendar-board__canvas :deep(.fc-event-inner strong),
.calendar-board__canvas :deep(.fc-event-inner small),
.calendar-board__canvas :deep(.fc-event-inner span) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-board__canvas :deep(.fc-event-inner strong) {
  font-size: 10px;
}

.calendar-board__canvas :deep(.fc-event-inner small) {
  font-size: 9px;
  opacity: 0.82;
}

.calendar-board__canvas :deep(.fc-event-inner span) {
  margin-top: auto;
  font-family: "Bahnschrift", sans-serif;
  font-size: 8px;
}

.calendar-board__canvas :deep(.fc-day-today) {
  background: #f5f8f4 !important;
}
</style>
