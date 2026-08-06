<script setup lang="ts">
import { computed } from "vue";
import type { Appointment } from "../../types/domain";
import {
  calendarAmountLabel,
  calendarEventTimeLabel,
  calendarEventTooltip,
  calendarProgressLabel,
  isShortCalendarAppointment,
} from "../../utils/calendar";

const props = defineProps<{
  appointment: Appointment;
  compact: boolean;
  allDay: boolean;
  timeText?: string;
  isNext?: boolean;
}>();

const contentLabel = computed(() => props.appointment.content?.trim() || "未填写内容");
const amountLabel = computed(() => calendarAmountLabel(props.appointment));
const progressLabel = computed(() => calendarProgressLabel(props.appointment));
const timeLabel = computed(
  () =>
    props.timeText?.trim().replace(/\s*-\s*/g, "–") || calendarEventTimeLabel(props.appointment),
);
const tooltip = computed(() => {
  const details = calendarEventTooltip(props.appointment);
  return props.isNext ? `下一时段\n${details}` : details;
});
const shortEvent = computed(() => !props.allDay && isShortCalendarAppointment(props.appointment));
</script>

<template>
  <div
    class="fc-event-inner calendar-event-card"
    :class="{
      'calendar-event-card--compact': compact,
      'calendar-event-card--legacy': !compact,
      'calendar-event-card--pending': compact && allDay,
      'calendar-event-card--short': shortEvent,
      'calendar-event-card--next': isNext,
    }"
    :title="tooltip"
    :aria-label="tooltip"
  >
    <strong class="calendar-event-card__contact">{{ appointment.contactName }}</strong>
    <time class="calendar-event-card__time">{{ timeLabel }}</time>
    <small class="calendar-event-card__content">{{ contentLabel }}</small>
    <span class="calendar-event-card__amount">{{ amountLabel }}</span>
    <span class="fc-event-progress calendar-event-card__progress">
      {{ progressLabel }}
    </span>
  </div>
</template>

<style scoped>
.calendar-event-card {
  display: grid;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 36px;
  height: 100%;
  grid-template-columns: minmax(0, 1fr) auto auto;
  grid-template-rows: repeat(2, minmax(0, 1fr));
  align-items: center;
  gap: 0 5px;
  overflow: hidden;
  padding: 2px 4px;
}

.calendar-event-card--compact {
  width: 100%;
}

.calendar-event-card--legacy {
  padding: 3px 5px;
}

.calendar-event-card--pending {
  min-height: 36px;
}

.calendar-event-card__contact,
.calendar-event-card__time,
.calendar-event-card__content,
.calendar-event-card__amount,
.calendar-event-card__progress {
  min-width: 0;
  overflow: hidden;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-event-card__contact {
  grid-column: 1 / 3;
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 750;
}

.calendar-event-card__time {
  grid-column: 3;
  justify-self: end;
  font-family: var(--app-font-family), "Bahnschrift", var(--font-sans);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-style: normal;
  font-weight: 700;
}

.calendar-event-card__content {
  grid-column: 1;
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  opacity: 0.9;
}

.calendar-event-card__amount {
  grid-column: 2;
  justify-self: center;
  font-family: var(--app-font-family), "Bahnschrift", var(--font-sans);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 700;
}

.calendar-event-card__progress {
  grid-column: 3;
  max-width: 76px;
  justify-self: end;
  padding: 0 3px;
  border: 1px dashed currentColor;
  border-radius: 4px;
  font-family: var(--app-font-family), "Bahnschrift", var(--font-sans);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 650;
  background: color-mix(in srgb, var(--surface) 72%, transparent);
}
</style>
