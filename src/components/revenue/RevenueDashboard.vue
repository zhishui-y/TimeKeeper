<script setup lang="ts">
import { CalendarRange, CheckCircle2, Clock3, Coins, Gauge } from "@lucide/vue";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { computed, reactive, watch } from "vue";
import { useRevenue } from "../../composables/useRevenue";
import type { ReportGranularity } from "../../types/domain";
import { formatCurrency } from "../../utils/formatters";
import RevenueChart from "./RevenueChart.vue";

const today = new Date();
const range = reactive({
  from: format(startOfMonth(today), "yyyy-MM-dd"),
  to: format(endOfMonth(today), "yyyy-MM-dd"),
  granularity: "day" as ReportGranularity,
});
const { summary, loading, error, load } = useRevenue();

const completionRate = computed(() => {
  if (!summary.value?.appointmentCount) return 0;
  return Math.round((summary.value.completedCount / summary.value.appointmentCount) * 100);
});

const maxPayment = computed(() =>
  Math.max(...(summary.value?.paymentMethods.map((item) => item.amountMinor) ?? [1]), 1),
);

watch(
  () => [range.from, range.to, range.granularity] as const,
  ([from, to, granularity]) => {
    if (from && to) void load(from, to, granularity);
  },
  { immediate: true },
);
</script>

<template>
  <div class="revenue-dashboard page-stack">
    <div class="page-toolbar revenue-toolbar">
      <div class="revenue-toolbar__range">
        <CalendarRange :size="16" />
        <input v-model="range.from" class="input" type="date" aria-label="统计开始日期" />
        <span>至</span>
        <input v-model="range.to" class="input" type="date" aria-label="统计结束日期" />
      </div>
      <div class="segmented" aria-label="统计粒度">
        <button
          v-for="item in [
            ['day', '按日'],
            ['week', '按周'],
            ['month', '按月'],
          ] as const"
          :key="item[0]"
          class="segmented__item"
          :class="{ 'is-active': range.granularity === item[0] }"
          type="button"
          @click="range.granularity = item[0]"
        >
          {{ item[1] }}
        </button>
      </div>
    </div>
    <div v-if="loading" class="loading-line" />
    <div v-if="error" class="error-banner">{{ error }}</div>

    <section class="revenue-metrics">
      <div class="revenue-metric revenue-metric--primary">
        <Coins :size="18" />
        <span>已结收益</span>
        <strong class="mono-number">{{ formatCurrency(summary?.settledMinor) }}</strong>
        <small>按服务日期归属</small>
      </div>
      <div class="revenue-metric revenue-metric--pending">
        <Clock3 :size="18" />
        <span>待结金额</span>
        <strong class="mono-number">{{ formatCurrency(summary?.unsettledMinor) }}</strong>
        <small>未计入已结收益</small>
      </div>
      <div class="revenue-metric">
        <Gauge :size="18" />
        <span>业务工时 / 时薪</span>
        <strong class="mono-number">{{ (summary?.businessHours ?? 0).toFixed(1) }}h</strong>
        <small>平均 {{ formatCurrency(summary?.averageHourlyMinor) }}/h</small>
      </div>
      <div class="revenue-metric">
        <CheckCircle2 :size="18" />
        <span>完成率</span>
        <strong class="mono-number">{{ completionRate }}%</strong>
        <small>{{ summary?.completedCount ?? 0 }} / {{ summary?.appointmentCount ?? 0 }} 场</small>
      </div>
    </section>

    <section class="revenue-body">
      <div class="chart-panel">
        <header class="panel-header">
          <div>
            <span class="section-kicker">TREND</span>
            <h2>收益与工时趋势</h2>
          </div>
          <span>{{ summary?.from }} — {{ summary?.to }}</span>
        </header>
        <RevenueChart :points="summary?.points ?? []" />
      </div>
      <aside class="payment-panel">
        <header class="panel-header">
          <div>
            <span class="section-kicker">CHANNELS</span>
            <h2>收款渠道</h2>
          </div>
        </header>
        <div v-if="summary?.paymentMethods.length" class="payment-list">
          <div v-for="method in summary.paymentMethods" :key="method.name" class="payment-row">
            <div class="payment-row__label">
              <strong>{{ method.name }}</strong>
              <span class="mono-number">{{ formatCurrency(method.amountMinor) }}</span>
            </div>
            <div class="payment-row__track">
              <i :style="{ width: `${(method.amountMinor / maxPayment) * 100}%` }" />
            </div>
          </div>
        </div>
        <div v-else class="payment-empty">当前范围暂无已结收入</div>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.revenue-dashboard {
  height: 100%;
  gap: 12px;
}

.revenue-toolbar__range {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-muted);
  font-size: 10px;
}

.revenue-toolbar__range > svg {
  color: var(--brand);
}

.revenue-toolbar__range .input {
  width: 138px;
}

.revenue-metrics {
  display: grid;
  min-height: 104px;
  flex: 0 0 104px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.revenue-metric {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  grid-template-rows: auto auto auto;
  align-content: center;
  column-gap: 9px;
  padding: 14px 16px;
  border-right: 1px solid var(--line);
  color: var(--blue);
}

.revenue-metric:last-child {
  border-right: 0;
}

.revenue-metric > svg {
  grid-row: 1 / 4;
  margin-top: 2px;
}

.revenue-metric span {
  color: var(--ink-muted);
  font-size: 10px;
}

.revenue-metric strong {
  margin-top: 2px;
  color: var(--ink-strong);
  font-size: 20px;
}

.revenue-metric small {
  margin-top: 2px;
  color: #9aa39f;
  font-size: 9px;
}

.revenue-metric--primary {
  color: var(--brand);
  background: #f5f8f4;
}

.revenue-metric--pending {
  color: var(--amber);
}

.revenue-body {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) 270px;
  gap: 12px;
}

.chart-panel,
.payment-panel {
  display: grid;
  min-height: 0;
  grid-template-rows: 54px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 15px;
  border-bottom: 1px solid var(--line);
}

.panel-header h2 {
  margin-top: 1px;
  color: var(--ink-strong);
  font-size: 13px;
}

.panel-header > span {
  color: var(--ink-muted);
  font-size: 9px;
}

.payment-list {
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
}

.payment-row {
  margin-bottom: 17px;
}

.payment-row__label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 7px;
}

.payment-row__label strong {
  color: var(--ink-strong);
  font-size: 11px;
}

.payment-row__label span {
  color: var(--ink-muted);
  font-size: 10px;
}

.payment-row__track {
  height: 5px;
  overflow: hidden;
  border-radius: 2px;
  background: #edf0ec;
}

.payment-row__track i {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--brand);
}

.payment-row:nth-child(2) .payment-row__track i {
  background: var(--blue);
}

.payment-row:nth-child(3) .payment-row__track i {
  background: var(--amber);
}

.payment-empty {
  display: grid;
  place-items: center;
  color: var(--ink-muted);
  font-size: 11px;
}
</style>
