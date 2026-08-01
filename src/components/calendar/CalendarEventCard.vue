<script setup lang="ts">
import { computed } from "vue";
import type { Appointment } from "../../types/domain";
import {
  calendarEventTimeLabel,
  calendarEventTooltip,
  calendarSettlementLabel,
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
const settlementLabel = computed(() => calendarSettlementLabel(props.appointment));
const timeLabel = computed(
  () =>
    props.timeText?.trim().replace(/\s*-\s*/g, "–") || calendarEventTimeLabel(props.appointment),
);
const tooltip = computed(() => {
  const details = calendarEventTooltip(props.appointment);
  return props.isNext ? `下一时段\n${details}` : details;
});
const shortEvent = computed(
  () => props.compact && !props.allDay && isShortCalendarAppointment(props.appointment),
);
const showSecondary = computed(() => !props.compact || (!props.allDay && !shortEvent.value));
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
    <time v-if="compact" class="calendar-event-card__time">{{ timeLabel }}</time>
    <small v-if="showSecondary" class="calendar-event-card__content">{{ contentLabel }}</small>
    <span
      v-if="showSecondary && settlementLabel"
      class="fc-event-settlement calendar-event-card__settlement"
    >
      {{ settlementLabel }}
    </span>
  </div>
</template>

<style scoped>
.calendar-event-card {
  box-sizing: border-box;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.calendar-event-card--compact {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: repeat(2, minmax(0, 1fr));
  align-items: center;
  gap: 0 5px;
  padding: 2px 4px;
}

.calendar-event-card--legacy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 3px 5px;
}

.calendar-event-card--pending {
  width: max-content;
  max-width: 100%;
  height: 22px;
  min-height: 22px;
  grid-template-rows: 1fr;
  gap: 4px;
  padding-block: 1px;
}

.calendar-event-card--short {
  grid-template-rows: 1fr;
  padding-block: 0;
}

.calendar-event-card__contact,
.calendar-event-card__time,
.calendar-event-card__content,
.calendar-event-card__settlement {
  min-width: 0;
  overflow: hidden;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-event-card__contact {
  font-size: 10.5px;
  font-weight: 750;
}

.calendar-event-card__time {
  justify-self: end;
  font-family: "Bahnschrift", var(--font-sans);
  font-size: 9px;
  font-style: normal;
  font-weight: 700;
}

.calendar-event-card__content {
  font-size: 9px;
  opacity: 0.9;
}

.calendar-event-card__settlement {
  max-width: 76px;
  justify-self: end;
  padding: 0 3px;
  border: 1px dashed currentColor;
  border-radius: 4px;
  font-family: "Bahnschrift", var(--font-sans);
  font-size: 8.5px;
  font-weight: 650;
  background: color-mix(in srgb, var(--surface) 72%, transparent);
}

.calendar-event-card--legacy .calendar-event-card__settlement {
  max-width: 100%;
  align-self: flex-start;
  margin-top: auto;
  padding: 1px 4px;
  border-radius: 5px;
  font-size: 10px;
}

.calendar-event-card--pending .calendar-event-card__contact {
  max-width: 90px;
}

.calendar-event-card--pending .calendar-event-card__time {
  padding: 1px 3px;
  border: 1px dashed currentColor;
  border-radius: 4px;
}
</style>
