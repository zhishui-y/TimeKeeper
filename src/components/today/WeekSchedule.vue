<script setup lang="ts">
import { computed } from "vue";
import type { Appointment } from "../../types/domain";
import { formatTime, formatTimeRange } from "../../utils/formatters";
import {
  appointmentProgressStatus,
  appointmentProgressStatusLabels,
} from "../../utils/appointmentProgress";

interface DaySchedule {
  date: string;
  weekday: string;
  dayNumber: string;
  isToday: boolean;
  appointments: Appointment[];
}

const props = defineProps<{
  days: DaySchedule[];
  nextAppointmentId?: string | null;
  selectedDate?: string;
}>();

const emit = defineEmits<{
  edit: [appointment: Appointment];
  create: [serviceDate: string];
  selectDate: [serviceDate: string];
}>();

const maxCount = computed(() => Math.max(...props.days.map((day) => day.appointments.length), 1));

function appointmentTitle(appointment: Appointment): string {
  const details = [
    formatTimeRange(appointment.startsAt, appointment.endsAt),
    appointment.contactName,
    appointment.content || "未填写内容",
    appointmentProgressStatusLabels[appointmentProgressStatus(appointment)],
  ];
  if (appointment.id === props.nextAppointmentId) {
    details.unshift("下一时段");
  }
  return details.join(" · ");
}
</script>

<template>
  <section class="week-schedule">
    <header class="week-schedule__header">
      <div>
        <span class="section-kicker">本周安排</span>
        <h2>本周排班</h2>
      </div>
      <span class="week-schedule__hint">点击空白处快速新增</span>
    </header>
    <div class="week-grid">
      <div
        v-for="day in days"
        :key="day.date"
        class="week-day"
        :class="{ 'is-today': day.isToday, 'is-selected': day.date === selectedDate }"
        @click.self="emit('create', day.date)"
      >
        <button
          class="week-day__heading"
          type="button"
          :aria-label="`查看${day.weekday}${day.dayNumber}日的预约`"
          :aria-pressed="day.date === selectedDate"
          @click="emit('selectDate', day.date)"
        >
          <span>{{ day.weekday }}</span>
          <strong>{{ day.dayNumber }}</strong>
        </button>
        <div
          class="week-day__track"
          :style="{ minHeight: `${76 + maxCount * 3}px` }"
          @click="emit('create', day.date)"
        >
          <button
            v-for="appointment in day.appointments.slice(0, 3)"
            :key="appointment.id"
            class="schedule-chip"
            :class="[
              `schedule-chip--${appointment.mode}`,
              `schedule-chip--${appointmentProgressStatus(appointment)}`,
              { 'schedule-chip--next': appointment.id === nextAppointmentId },
            ]"
            type="button"
            :title="appointmentTitle(appointment)"
            :aria-label="appointmentTitle(appointment)"
            @click.stop="emit('edit', appointment)"
          >
            <span class="schedule-chip__time">{{ formatTime(appointment.startsAt) }}</span>
            <strong>{{ appointment.contactName }}</strong>
            <span
              class="schedule-chip__progress"
              :title="appointmentProgressStatusLabels[appointmentProgressStatus(appointment)]"
              :aria-label="appointmentProgressStatusLabels[appointmentProgressStatus(appointment)]"
            >
              {{ appointmentProgressStatusLabels[appointmentProgressStatus(appointment)] }}
            </span>
          </button>
          <span v-if="day.appointments.length > 3" class="week-day__more week-day__more--regular">
            +{{ day.appointments.length - 3 }} 条
          </span>
          <span v-if="day.appointments.length > 2" class="week-day__more week-day__more--compact">
            +{{ day.appointments.length - 2 }} 条
          </span>
          <span v-if="day.appointments.length === 0" class="week-day__empty">暂无</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.week-schedule {
  display: grid;
  min-height: 0;
  grid-template-rows: 58px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, var(--radius));
  background: var(--surface);
  box-shadow: var(--shadow-sm, var(--shadow-soft));
}

.week-schedule__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(90deg, var(--surface-soft), var(--surface));
}

.week-schedule__header h2 {
  margin-top: 2px;
  color: var(--ink-strong);
  font-size: 16px;
  line-height: 1.2;
}

.week-schedule__hint {
  color: var(--ink-muted);
  font-size: 12px;
}

.week-grid {
  display: grid;
  min-height: 0;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.week-day {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 0;
  border: 0;
  border-right: 1px solid var(--line);
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background-color 140ms ease;
}

.week-day:last-child {
  border-right: 0;
}

.week-day:hover {
  background: var(--surface-soft);
}

.week-day.is-today {
  background: linear-gradient(
    180deg,
    var(--brand-soft),
    color-mix(in srgb, var(--surface) 90%, var(--brand-soft))
  );
}

.week-day.is-selected {
  box-shadow: inset 0 0 0 2px var(--brand-border);
}

.week-day.is-selected .week-day__heading {
  border-bottom-color: var(--brand);
  background: color-mix(in srgb, var(--brand-soft) 58%, transparent);
}

.week-day__heading {
  display: flex;
  height: 44px;
  flex: 0 0 44px;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border: 0;
  border-bottom: 1px solid var(--line);
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.week-day__heading span {
  color: var(--ink);
  font-size: 12px;
  font-weight: 650;
}

.week-day__heading strong {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 50%;
  color: var(--ink-strong);
  font-family: "Bahnschrift", var(--font-sans);
  font-size: 13px;
  font-weight: 700;
}

.is-today .week-day__heading strong {
  color: #fffaf0;
  background: var(--brand);
  box-shadow: 0 5px 12px color-mix(in srgb, var(--brand) 24%, transparent);
}

.week-day__track {
  display: flex;
  min-width: 0;
  min-height: 0 !important;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
  padding: 9px 8px;
}

.schedule-chip {
  --event-accent: var(--brand);
  --event-background: var(--brand-soft);
  --event-border: var(--brand-border);
  --event-ink: var(--brand-strong);
  --mode-accent: var(--brand);
  display: flex;
  width: 100%;
  min-width: 0;
  height: 34px;
  flex: 0 0 34px;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  overflow: hidden;
  border: 1px solid var(--event-border);
  border-left: 3px solid var(--mode-accent);
  border-radius: 8px;
  color: var(--event-ink);
  background: var(--event-background);
  box-shadow: var(--shadow-control, none);
  cursor: pointer;
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease,
    transform 140ms ease;
}

.schedule-chip:hover {
  border-color: var(--event-accent);
  border-left-color: var(--mode-accent);
  box-shadow: 0 5px 12px color-mix(in srgb, var(--event-accent) 12%, transparent);
  transform: translateY(-1px);
}

.schedule-chip--scheduled {
  --event-accent: var(--blue);
  --event-background: var(--blue-soft);
  --event-border: var(--blue-border);
  --event-ink: #365d70;
}

.schedule-chip--in_progress,
.schedule-chip--pending_settlement {
  --event-accent: var(--amber);
  --event-background: var(--amber-soft);
  --event-border: var(--amber-border);
  --event-ink: #815414;
}

.schedule-chip--completed {
  --event-accent: var(--brand);
  --event-background: var(--brand-soft);
  --event-border: var(--brand-border);
  --event-ink: var(--brand-strong);
}

.schedule-chip--cancelled {
  --event-accent: var(--ink-muted);
  --event-background: var(--neutral-soft);
  --event-border: var(--line);
  --event-ink: var(--ink-muted);
  box-shadow: none;
  text-decoration: line-through;
  opacity: 0.76;
}

.schedule-chip--business {
  --mode-accent: var(--brand);
}

.schedule-chip--entertainment {
  --mode-accent: var(--blue);
}

.schedule-chip--next {
  --event-accent: var(--gold);
  --event-background: color-mix(in srgb, var(--gold-soft) 90%, var(--surface));
  --event-border: var(--gold-border);
  --event-ink: var(--gold-strong);
  box-shadow:
    inset 0 0 0 2px var(--gold-border),
    0 5px 14px color-mix(in srgb, var(--gold) 18%, transparent);
}

.schedule-chip--next:hover {
  box-shadow:
    inset 0 0 0 2px var(--gold-border),
    0 6px 14px color-mix(in srgb, var(--gold) 18%, transparent);
}

.schedule-chip__time {
  flex: 0 0 auto;
  font-family: "Bahnschrift", var(--font-sans);
  font-size: 11px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.schedule-chip strong {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schedule-chip__progress {
  display: grid;
  height: 18px;
  flex: 0 0 auto;
  margin-left: auto;
  padding: 0 3px;
  place-items: center;
  border: 1px dashed currentColor;
  border-radius: 5px;
  font-family: "Bahnschrift", var(--font-sans);
  font-size: 9px;
  font-weight: 750;
  line-height: 1;
  background: color-mix(in srgb, var(--surface) 76%, transparent);
  text-decoration: none;
}

.week-day__more,
.week-day__empty {
  align-self: center;
  margin-top: 2px;
  color: var(--ink-muted);
  font-size: 11px;
  font-weight: 650;
}

.week-day__empty {
  margin: auto;
  color: var(--ink-muted);
  font-weight: 500;
}

.week-day__more--compact {
  display: none;
}

@media (max-height: 760px) {
  .week-day__track {
    gap: 4px;
    padding-block: 7px;
  }

  .schedule-chip {
    height: 32px;
    flex-basis: 32px;
  }

  .schedule-chip:nth-of-type(n + 3),
  .week-day__more--regular {
    display: none;
  }

  .week-day__more--compact {
    display: inline;
  }
}

@media (max-width: 1180px) {
  .week-schedule__header {
    padding-inline: 15px;
  }

  .week-day__heading {
    padding-inline: 8px;
  }

  .week-day__track {
    padding-inline: 6px;
  }

  .schedule-chip {
    gap: 5px;
    padding-inline: 6px;
  }
}
</style>
