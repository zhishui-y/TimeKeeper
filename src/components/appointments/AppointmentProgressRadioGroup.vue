<script setup lang="ts">
import { nextTick } from "vue";
import type { AppointmentProgressStatus } from "../../types/domain";
import { appointmentProgressStatusLabels } from "../../utils/appointmentProgress";

const props = withDefaults(
  defineProps<{
    value: AppointmentProgressStatus;
    options: readonly AppointmentProgressStatus[];
    disabled?: boolean;
  }>(),
  {
    disabled: false,
  },
);

const emit = defineEmits<{
  requestChange: [status: AppointmentProgressStatus];
}>();

function requestChange(event: Event, status: AppointmentProgressStatus): void {
  emit("requestChange", status);
  const fieldset = (event.currentTarget as HTMLInputElement).closest("fieldset");
  void nextTick(() => {
    fieldset?.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((radio) => {
      radio.checked = radio.value === props.value;
    });
  });
}
</script>

<template>
  <fieldset class="status-choice" :disabled="disabled">
    <legend class="status-choice__legend">预约状态</legend>
    <div class="status-choice__options">
      <label
        v-for="status in options"
        :key="status"
        class="status-choice__item"
        :class="[`status-choice__item--${status}`, { 'is-active': value === status }]"
      >
        <input
          type="radio"
          name="appointment-progress-status"
          :value="status"
          :checked="value === status"
          :disabled="disabled"
          @change="requestChange($event, status)"
        />
        <span>{{ appointmentProgressStatusLabels[status] }}</span>
      </label>
    </div>
  </fieldset>
</template>

<style scoped>
.status-choice {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.status-choice__legend {
  margin-bottom: 8px;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 650;
}

.status-choice__options {
  display: flex;
  flex-wrap: nowrap;
  gap: 5px;
  overflow-x: auto;
}

.status-choice__item {
  position: relative;
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink-muted);
  background: var(--surface);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 680;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.status-choice__item > input {
  position: absolute;
  z-index: 1;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: inherit;
}

.status-choice__item:has(input:focus-visible) {
  outline: 2px solid color-mix(in srgb, var(--brand) 66%, transparent);
  outline-offset: 2px;
}

.status-choice__item:has(input:disabled) {
  cursor: default;
  opacity: 0.5;
}

.status-choice__item--scheduled.is-active {
  border-color: var(--blue-border);
  color: var(--blue);
  background: var(--blue-soft);
}

.status-choice__item--in_progress.is-active {
  border-color: var(--accent-border);
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.status-choice__item--pending_settlement.is-active {
  border-color: var(--amber-border);
  color: var(--amber);
  background: var(--amber-soft);
}

.status-choice__item--completed.is-active {
  border-color: var(--brand-border);
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.status-choice__item--cancelled.is-active {
  color: #747f79;
  background: var(--neutral-soft);
}
</style>
