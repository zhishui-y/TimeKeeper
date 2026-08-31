<script setup lang="ts">
import { computed, type CSSProperties, type DeepReadonly } from "vue";
import type { RevenueAnalyticsHour } from "../../../types/domain";
import { formatBusinessHours } from "../../../utils/revenueAnalytics";

const props = defineProps<{
  hours: DeepReadonly<RevenueAnalyticsHour[]>;
}>();

const maximumMinutes = computed(() =>
  Math.max(0, ...props.hours.map((hour) => hour.businessMinutes)),
);

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function heatStyle(minutes: number): CSSProperties {
  const ratio = maximumMinutes.value > 0 ? minutes / maximumMinutes.value : 0;
  return { "--heat-alpha": String(0.06 + ratio * 0.74) } as CSSProperties;
}
</script>

<template>
  <section class="hour-report" aria-labelledby="hour-report-title">
    <header>
      <div>
        <span class="section-kicker">HOURLY HEATMAP</span>
        <h3 id="hour-report-title">24 小时工作热力</h3>
      </div>
      <span>按预约与每个整点小时的实际重叠分钟分摊</span>
    </header>

    <div class="hour-report__grid">
      <article
        v-for="hour in hours"
        :key="hour.hour"
        :style="heatStyle(hour.businessMinutes)"
        :aria-label="`${hourLabel(hour.hour)} 到 ${hourLabel((hour.hour + 1) % 24)}，${formatBusinessHours(hour.businessMinutes)}，涉及 ${hour.appointmentCount} 场预约`"
      >
        <strong class="mono-number">{{ hourLabel(hour.hour) }}</strong>
        <span class="mono-number">{{ formatBusinessHours(hour.businessMinutes) }}</span>
        <small>{{ hour.appointmentCount }} 场</small>
      </article>
    </div>
  </section>
</template>

<style scoped>
.hour-report {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 16px);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.hour-report > header {
  display: flex;
  min-height: 62px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-soft) 78%, transparent);
}

.hour-report h3 {
  margin-top: 2px;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: calc(16px + var(--app-font-size-offset, 0px));
}

.hour-report > header > span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.hour-report__grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 7px;
  padding: 14px 16px 16px;
}

.hour-report__grid article {
  display: grid;
  min-width: 0;
  min-height: 72px;
  align-content: center;
  gap: 2px;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--brand) 20%, var(--line));
  border-radius: 9px;
  color: var(--ink-muted);
  background: color-mix(in srgb, var(--brand) calc(var(--heat-alpha) * 100%), var(--surface));
  text-align: center;
}

.hour-report__grid strong {
  color: var(--ink-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.hour-report__grid span {
  color: var(--brand-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 700;
}

.hour-report__grid small {
  font-size: calc(11px + var(--app-font-size-offset, 0px));
}

@media (max-width: 900px) {
  .hour-report__grid {
    grid-template-columns: repeat(8, minmax(0, 1fr));
  }
}
</style>
