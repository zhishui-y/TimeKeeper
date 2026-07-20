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
  height: 24px;
  align-items: center;
  padding: 0 7px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--ink-muted);
  background: var(--surface-soft);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.badge--scheduled {
  border-color: #c6d7df;
  color: #466a7f;
  background: var(--blue-soft);
}

.badge--in_progress,
.badge--unsettled {
  border-color: #e1c696;
  color: #8a5917;
  background: var(--amber-soft);
}

.badge--completed,
.badge--settled {
  border-color: #b8d3c3;
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.badge--cancelled,
.badge--not_applicable {
  color: #7f8784;
  background: #f0f2ef;
}
</style>
