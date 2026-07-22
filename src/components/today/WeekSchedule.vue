<script setup lang="ts">
import { computed } from "vue";
import type { Appointment } from "../../types/domain";
import { formatTime } from "../../utils/formatters";

interface DaySchedule {
  date: string;
  weekday: string;
  dayNumber: string;
  isToday: boolean;
  appointments: Appointment[];
}

const props = defineProps<{
  days: DaySchedule[];
}>();

const emit = defineEmits<{
  edit: [appointment: Appointment];
  create: [serviceDate: string];
}>();

const maxCount = computed(() => Math.max(...props.days.map((day) => day.appointments.length), 1));
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
        :class="{ 'is-today': day.isToday }"
        @click.self="emit('create', day.date)"
      >
        <button class="week-day__heading" type="button" @click="emit('create', day.date)">
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
              { 'is-cancelled': appointment.serviceStatus === 'cancelled' },
            ]"
            type="button"
            :title="`${appointment.contactName} · ${appointment.content || '未填写内容'}`"
            @click.stop="emit('edit', appointment)"
          >
            <span class="schedule-chip__time">{{ formatTime(appointment.startsAt) }}</span>
            <strong>{{ appointment.contactName }}</strong>
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
  display: flex;
  width: 100%;
  min-width: 0;
  height: 34px;
  flex: 0 0 34px;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  overflow: hidden;
  border: 1px solid var(--brand-border, var(--line-strong));
  border-left: 3px solid var(--brand);
  border-radius: 8px;
  color: var(--brand-strong);
  background: var(--brand-soft);
  box-shadow: var(--shadow-control, none);
  cursor: pointer;
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease,
    transform 140ms ease;
}

.schedule-chip:hover {
  border-color: var(--brand);
  box-shadow: 0 5px 12px color-mix(in srgb, var(--brand) 12%, transparent);
  transform: translateY(-1px);
}

.schedule-chip--entertainment {
  border-color: var(--blue-border, var(--line-strong));
  border-left-color: var(--blue);
  color: var(--blue);
  background: var(--blue-soft);
}

.schedule-chip.is-cancelled {
  border-color: var(--line);
  border-left-color: var(--ink-faint, var(--ink-muted));
  color: var(--ink-muted);
  background: var(--neutral-soft, var(--surface-soft));
  box-shadow: none;
  text-decoration: line-through;
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
