<script setup lang="ts">
import { CalendarRange, CheckCircle2, Clock3, Coins, Gauge } from "@lucide/vue";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { computed, defineAsyncComponent, reactive, watch } from "vue";
import { useRevenue } from "../../composables/useRevenue";
import { useUiStore } from "../../stores/ui";
import type { ReportGranularity } from "../../types/domain";
import { formatCurrency } from "../../utils/formatters";

const RevenueChart = defineAsyncComponent({
  loader: () => import("./RevenueChart.vue"),
  delay: 180,
  timeout: 20_000,
});

const today = new Date();
const range = reactive({
  from: format(startOfMonth(today), "yyyy-MM-dd"),
  to: format(endOfMonth(today), "yyyy-MM-dd"),
  granularity: "day" as ReportGranularity,
});
const ui = useUiStore();
const { summary, loading, error, load } = useRevenue();

const completionRate = computed(() => {
  if (!summary.value?.appointmentCount) return 0;
  return Math.round((summary.value.completedCount / summary.value.appointmentCount) * 100);
});

const maxPayment = computed(() =>
  Math.max(...(summary.value?.paymentMethods.map((item) => item.amountMinor) ?? [1]), 1),
);

const chartDescription = computed(
  () =>
    `收益与工时趋势，${summary.value?.from ?? range.from} 至 ${summary.value?.to ?? range.to}，共 ${summary.value?.points.length ?? 0} 个数据点`,
);

watch(
  () => [range.from, range.to, range.granularity, ui.dataRevision] as const,
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
        <RevenueChart role="img" :aria-label="chartDescription" :points="summary?.points ?? []" />
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
  gap: 14px;
}

.revenue-toolbar__range {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-muted);
  font-size: 12px;
}

.revenue-toolbar__range > svg {
  color: var(--brand);
}

.revenue-toolbar__range .input {
  width: 138px;
}

.revenue-metrics {
  display: grid;
  min-height: 110px;
  flex: 0 0 110px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.revenue-metric {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  grid-template-rows: auto auto auto;
  align-content: center;
  column-gap: 9px;
  padding: 15px 16px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 18px);
  color: var(--blue);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.revenue-metric > svg {
  grid-row: 1 / 4;
  margin-top: 2px;
}

.revenue-metric span {
  color: var(--ink-muted);
  font-size: 11px;
}

.revenue-metric strong {
  margin-top: 2px;
  color: var(--ink-strong);
  font-size: 22px;
}

.revenue-metric small {
  margin-top: 2px;
  color: var(--ink-muted);
  font-size: 10px;
}

.revenue-metric--primary {
  color: var(--brand);
  border-color: color-mix(in srgb, var(--brand) 22%, var(--line));
  background:
    radial-gradient(circle at 100% 0%, rgba(45, 104, 84, 0.12), transparent 42%),
    color-mix(in srgb, var(--brand-soft) 40%, var(--surface));
}

.revenue-metric--pending {
  color: var(--amber);
}

.revenue-body {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 14px;
}

.chart-panel,
.payment-panel {
  display: grid;
  min-height: 0;
  grid-template-rows: 60px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 18px);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 17px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-soft) 82%, transparent);
}

.panel-header h2 {
  margin-top: 1px;
  color: var(--ink-strong);
  font-size: 14px;
}

.panel-header > span {
  color: var(--ink-muted);
  font-size: 10px;
}

.payment-list {
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
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
  font-size: 12px;
}

.payment-row__label span {
  color: var(--ink-muted);
  font-size: 11px;
}

.payment-row__track {
  height: 7px;
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
  font-size: 12px;
}

@media (max-width: 1180px) {
  .revenue-metrics {
    gap: 9px;
  }

  .revenue-metric {
    padding-inline: 12px;
  }

  .revenue-metric strong {
    font-size: 19px;
  }

  .revenue-body {
    grid-template-columns: minmax(0, 1fr) 230px;
    gap: 10px;
  }
}
</style>
