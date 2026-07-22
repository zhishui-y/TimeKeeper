<script setup lang="ts">
import { computed } from "vue";
import type { ServiceStatus, SettlementStatus } from "../../types/domain";
import { serviceStatusLabels, settlementStatusLabels } from "../../utils/formatters";

const props = defineProps<{
  serviceStatus?: ServiceStatus;
  settlementStatus?: SettlementStatus;
}>();

const label = computed(() => {
  if (props.serviceStatus) return serviceStatusLabels[props.serviceStatus];
  if (props.settlementStatus) return settlementStatusLabels[props.settlementStatus];
  return "—";
});

const tone = computed(() => props.serviceStatus ?? props.settlementStatus ?? "neutral");
</script>

<template>
  <span class="badge" :class="`badge--${tone}`">{{ label }}</span>
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

.badge--in_progress,
.badge--unsettled {
  border-color: var(--amber-border);
  color: var(--amber);
  background: var(--amber-soft);
}

.badge--completed,
.badge--settled {
  border-color: var(--brand-border);
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.badge--cancelled,
.badge--not_applicable {
  color: #747f79;
  background: var(--neutral-soft);
}

.badge--cancelled::before,
.badge--not_applicable::before {
  opacity: 0.42;
}
</style>
