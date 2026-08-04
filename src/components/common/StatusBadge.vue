<script setup lang="ts">
import { computed } from "vue";
import type { AppointmentProgressStatus } from "../../types/domain";
import { appointmentProgressStatusLabels } from "../../utils/appointmentProgress";

const props = defineProps<{
  progressStatus: AppointmentProgressStatus;
}>();

const label = computed(() => appointmentProgressStatusLabels[props.progressStatus]);
</script>

<template>
  <span class="badge" :class="`badge--${progressStatus}`">{{ label }}</span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  height: 26px;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink-muted);
  background: var(--surface-soft);
  font-size: 11px;
  font-weight: 680;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.badge::before {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: currentColor;
  content: "";
  opacity: 0.72;
}

.badge--scheduled {
  border-color: var(--blue-border);
  color: var(--blue);
  background: var(--blue-soft);
}

.badge--in_progress {
  border-color: var(--accent-border);
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.badge--pending_settlement {
  border-color: var(--amber-border);
  color: var(--amber);
  background: var(--amber-soft);
}

.badge--completed {
  border-color: var(--brand-border);
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.badge--cancelled {
  color: #747f79;
  background: var(--neutral-soft);
}

.badge--cancelled::before {
  opacity: 0.42;
}
</style>
