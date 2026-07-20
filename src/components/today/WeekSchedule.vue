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
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.week-schedule__header {
  display: flex;
  height: 56px;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
}

.week-schedule__header h2 {
  margin-top: 2px;
  color: var(--ink-strong);
  font-size: 14px;
}

.week-schedule__hint {
  color: var(--ink-muted);
  font-size: 11px;
}

.week-grid {
  display: grid;
  height: calc(100% - 56px);
  min-height: 128px;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.week-day {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 0;
  border: 0;
  border-right: 1px solid #e8ebe7;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.week-day:last-child {
  border-right: 0;
}

.week-day:hover {
  background: #fbfcfa;
}

.week-day.is-today {
  background: #f5f8f4;
}

.week-day__heading {
  display: flex;
  height: 42px;
  align-items: center;
  justify-content: space-between;
  padding: 0 9px;
  width: 100%;
  border: 0;
  border-bottom: 1px solid #edf0ec;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.week-day__heading span {
  color: var(--ink-muted);
  font-size: 11px;
}

.week-day__heading strong {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 50%;
  color: var(--ink-strong);
  font-family: "Bahnschrift", sans-serif;
  font-size: 12px;
  font-weight: 650;
}

.is-today .week-day__heading strong {
  color: #fff;
  background: var(--brand);
}

.week-day__track {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 5px;
  padding: 8px 7px;
}

.schedule-chip {
  display: flex;
  width: 100%;
  min-width: 0;
  height: 31px;
  align-items: center;
  gap: 5px;
  padding: 0 6px;
  overflow: hidden;
  border: 1px solid #c2d6ca;
  border-left: 3px solid var(--brand);
  border-radius: 3px;
  color: var(--brand-strong);
  background: var(--brand-soft);
  cursor: pointer;
}

.schedule-chip--entertainment {
  border-color: #c8d7e0;
  border-left-color: var(--blue);
  color: #3f6278;
  background: var(--blue-soft);
}

.schedule-chip.is-cancelled {
  border-color: var(--line);
  border-left-color: #a0a9a5;
  color: #7f8885;
  background: #f1f3f0;
  text-decoration: line-through;
}

.schedule-chip__time {
  flex: 0 0 auto;
  font-family: "Bahnschrift", sans-serif;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.schedule-chip strong {
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.week-day__more,
.week-day__empty {
  align-self: center;
  margin-top: 2px;
  color: var(--ink-muted);
  font-size: 10px;
}

.week-day__empty {
  margin: auto;
  color: #74807b;
}

.week-day__more--compact {
  display: none;
}

@media (max-height: 760px) {
  .week-day__track {
    gap: 4px;
    padding-block: 6px;
  }

  .schedule-chip {
    height: 30px;
  }

  .schedule-chip:nth-of-type(n + 3),
  .week-day__more--regular {
    display: none;
  }

  .week-day__more--compact {
    display: inline;
  }
}
</style>
