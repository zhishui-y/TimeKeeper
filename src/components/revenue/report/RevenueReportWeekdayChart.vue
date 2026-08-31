<script setup lang="ts">
import { computed, type CSSProperties, type DeepReadonly } from "vue";
import type { RevenueAnalyticsWeekday } from "../../../types/domain";
import { formatCurrency } from "../../../utils/formatters";
import { formatBusinessHours } from "../../../utils/revenueAnalytics";

const props = defineProps<{
  weekdays: DeepReadonly<RevenueAnalyticsWeekday[]>;
}>();

const maximumMinutes = computed(() =>
  Math.max(0, ...props.weekdays.map((weekday) => weekday.businessMinutes)),
);

function barStyle(minutes: number): CSSProperties {
  const percent = maximumMinutes.value > 0 ? (minutes / maximumMinutes.value) * 100 : 0;
  return { width: `${percent}%` };
}
</script>

<template>
  <section class="weekday-report" aria-labelledby="weekday-report-title">
    <header>
      <div>
        <span class="section-kicker">BY WEEKDAY</span>
        <h3 id="weekday-report-title">星期分布</h3>
      </div>
      <span>柱长按完成工时比较</span>
    </header>

    <div class="weekday-report__rows">
      <article v-for="weekday in weekdays" :key="weekday.weekday">
        <strong>{{ weekday.label }}</strong>
        <div class="weekday-report__bar" aria-hidden="true">
          <span :style="barStyle(weekday.businessMinutes)" />
        </div>
        <span class="mono-number">{{ formatBusinessHours(weekday.businessMinutes) }}</span>
        <span class="mono-number">{{ weekday.appointmentCount }} 场</span>
        <span class="mono-number weekday-report__income">
          {{ formatCurrency(weekday.settledMinor) }}
        </span>
      </article>
    </div>
  </section>
</template>

<style scoped>
.weekday-report {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 16px);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.weekday-report > header {
  display: flex;
  min-height: 62px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-soft) 78%, transparent);
}

.weekday-report h3 {
  margin-top: 2px;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: calc(16px + var(--app-font-size-offset, 0px));
}

.weekday-report > header > span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.weekday-report__rows {
  display: grid;
  padding: 8px 16px 12px;
}

.weekday-report__rows article {
  display: grid;
  grid-template-columns: 40px minmax(90px, 1fr) 54px 46px 74px;
  align-items: center;
  gap: 9px;
  min-height: 39px;
  border-bottom: 1px solid var(--line);
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.weekday-report__rows article:last-child {
  border-bottom: 0;
}

.weekday-report__rows strong {
  color: var(--ink-strong);
}

.weekday-report__bar {
  height: 9px;
  overflow: hidden;
  border-radius: 99px;
  background: var(--brand-soft);
}

.weekday-report__bar span {
  display: block;
  min-width: 0;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--brand), var(--brand-strong));
}

.weekday-report__income {
  color: var(--brand-strong);
  text-align: right;
}
</style>
