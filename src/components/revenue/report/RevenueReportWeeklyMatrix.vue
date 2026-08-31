<script setup lang="ts">
import type { DeepReadonly } from "vue";
import type { RevenueAnalyticsWeek } from "../../../types/domain";
import { formatCurrency } from "../../../utils/formatters";
import { formatBusinessHours } from "../../../utils/revenueAnalytics";

defineProps<{
  weeks: DeepReadonly<RevenueAnalyticsWeek[]>;
}>();

const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function compactDate(date: string): string {
  return date.slice(5);
}
</script>

<template>
  <section class="weekly-report" aria-labelledby="weekly-report-title">
    <header class="weekly-report__heading">
      <div>
        <span class="section-kicker">WEEKLY MATRIX</span>
        <h3 id="weekly-report-title">逐周与每日情况</h3>
      </div>
      <span>{{ weeks.length }} 个自然周</span>
    </header>

    <div class="weekly-report__scroll">
      <table>
        <caption class="sr-only">
          当前统计范围逐周及周一至周日业务数据
        </caption>
        <thead>
          <tr>
            <th scope="col">周汇总</th>
            <th v-for="label in weekdayLabels" :key="label" scope="col">{{ label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="week in weeks" :key="week.from">
            <th scope="row" class="weekly-report__total">
              <strong>{{ compactDate(week.from) }} — {{ compactDate(week.to) }}</strong>
              <span class="mono-number">{{ formatCurrency(week.settledMinor) }}</span>
              <small>
                {{ formatBusinessHours(week.businessMinutes) }} · {{ week.appointmentCount }} 场
              </small>
            </th>
            <td
              v-for="day in week.days"
              :key="day.date"
              :class="{ 'is-outside': !day.inRange, 'has-business': day.appointmentCount > 0 }"
            >
              <template v-if="day.inRange">
                <strong>{{ compactDate(day.date) }}</strong>
                <span class="mono-number">{{ formatCurrency(day.settledMinor) }}</span>
                <small>
                  {{ formatBusinessHours(day.businessMinutes) }} · {{ day.appointmentCount }} 场
                </small>
                <em v-if="day.pendingCount > 0">待结 {{ day.pendingCount }} 场</em>
              </template>
              <span v-else aria-label="不在统计范围内">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.weekly-report {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 16px);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.weekly-report__heading {
  display: flex;
  min-height: 62px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-soft) 78%, transparent);
}

.weekly-report__heading h3 {
  margin-top: 2px;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: calc(16px + var(--app-font-size-offset, 0px));
}

.weekly-report__heading > span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.weekly-report__scroll {
  max-height: 390px;
  overflow: auto;
}

.weekly-report table {
  width: 100%;
  min-width: 1010px;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.weekly-report th,
.weekly-report td {
  width: 118px;
  padding: 10px;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  vertical-align: top;
  text-align: left;
}

.weekly-report thead th {
  position: sticky;
  z-index: 2;
  top: 0;
  color: var(--ink-muted);
  background: var(--surface-soft);
  font-weight: 700;
}

.weekly-report thead th:first-child,
.weekly-report__total {
  position: sticky;
  z-index: 3;
  left: 0;
  width: 150px;
}

.weekly-report__total {
  background: color-mix(in srgb, var(--brand-soft) 42%, var(--surface));
}

.weekly-report__total strong,
.weekly-report td strong {
  display: block;
  color: var(--ink-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.weekly-report__total span,
.weekly-report td span {
  display: block;
  margin-top: 5px;
  color: var(--brand-strong);
  font-weight: 700;
}

.weekly-report__total small,
.weekly-report td small {
  display: block;
  margin-top: 3px;
  color: var(--ink-muted);
  line-height: 1.35;
}

.weekly-report td em {
  display: inline-block;
  padding: 2px 5px;
  margin-top: 5px;
  border-radius: 5px;
  color: #815414;
  background: var(--amber-soft);
  font-style: normal;
  font-size: calc(11px + var(--app-font-size-offset, 0px));
}

.weekly-report td.has-business {
  background: color-mix(in srgb, var(--brand-soft) 24%, var(--surface));
}

.weekly-report td.is-outside {
  color: var(--ink-muted);
  background: repeating-linear-gradient(
    -45deg,
    var(--surface-soft),
    var(--surface-soft) 5px,
    var(--surface) 5px,
    var(--surface) 10px
  );
  text-align: center;
}

.weekly-report tr:last-child > * {
  border-bottom: 0;
}

.weekly-report tr > *:last-child {
  border-right: 0;
}
</style>
