<script setup lang="ts">
import { CalendarRange, CheckCircle2, Clock3, Coins, Gauge } from "@lucide/vue";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { computed, defineAsyncComponent, reactive, shallowRef, watch } from "vue";
import { useRevenue } from "../../composables/useRevenue";
import { useUiStore } from "../../stores/ui";
import type { ReportGranularity, RevenuePoint } from "../../types/domain";
import { formatCurrency } from "../../utils/formatters";
import {
  revenuePeriodRange,
  revenuePresetRange,
  type RevenueRangePreset,
} from "../../utils/revenue";

const RevenueChart = defineAsyncComponent({
  loader: () => import("./RevenueChart.vue"),
  delay: 180,
  timeout: 20_000,
});
const RevenuePeriodDetail = defineAsyncComponent(() => import("./RevenuePeriodDetail.vue"));

interface SelectedPeriod {
  granularity: Exclude<ReportGranularity, "day">;
  from: string;
  to: string;
}

const today = new Date();
const range = reactive({
  from: format(startOfMonth(today), "yyyy-MM-dd"),
  to: format(endOfMonth(today), "yyyy-MM-dd"),
  granularity: "day" as ReportGranularity,
});
const ui = useUiStore();
const { summary, loading, error, load } = useRevenue();
const {
  summary: detailSummary,
  loading: detailLoading,
  error: detailError,
  load: loadDetail,
} = useRevenue();
const selectedPeriod = shallowRef<SelectedPeriod | null>(null);
const activePreset = shallowRef<RevenueRangePreset | null>("current_month");
const reportQuery = computed(() => ({
  from: activePreset.value === "all" ? "" : range.from,
  to: activePreset.value === "all" ? "" : range.to,
  granularity: range.granularity,
}));

const completionRate = computed(() => {
  if (!summary.value?.appointmentCount) return 0;
  return Math.round((summary.value.completedCount / summary.value.appointmentCount) * 100);
});

const maxPayment = computed(() =>
  Math.max(...(summary.value?.paymentMethods.map((item) => item.amountMinor) ?? [1]), 1),
);

const chartDescription = computed(
  () =>
    `收益与工时趋势，${summary.value?.from ?? range.from} 至 ${summary.value?.to ?? range.to}，共 ${summary.value?.points.length ?? 0} 个数据点${range.granularity === "day" ? "" : "，可点击柱形查看每日明细"}`,
);

const summaryRangeLabel = computed(
  () => `${summary.value?.from ?? range.from} — ${summary.value?.to ?? range.to}`,
);

const rangePresets: ReadonlyArray<{ value: RevenueRangePreset; label: string }> = [
  { value: "all", label: "全部" },
  { value: "previous_month", label: "上月" },
  { value: "current_month", label: "本月" },
];

function selectRangePreset(preset: RevenueRangePreset): void {
  activePreset.value = preset;
  if (preset === "all") return;

  const presetRange = revenuePresetRange(preset);
  range.from = presetRange.from;
  range.to = presetRange.to;
}

function useCustomRange(): void {
  activePreset.value = null;
}

function showPeriodDetail(point: RevenuePoint): void {
  if (range.granularity === "day") return;
  const granularity = range.granularity;
  const selectedRange = revenuePeriodRange(point.period, granularity);
  if (!selectedRange) return;

  selectedPeriod.value = { granularity, ...selectedRange };
  void loadDetail(selectedRange.from, selectedRange.to, "day");
}

function closePeriodDetail(): void {
  selectedPeriod.value = null;
}

watch(
  () => [reportQuery.value, ui.dataRevision] as const,
  ([query]) => {
    if (query.from || query.to) {
      if (query.from && query.to) void load(query.from, query.to, query.granularity);
      return;
    }
    void load("", "", query.granularity);
  },
  { immediate: true },
);

watch(summary, (nextSummary) => {
  if (activePreset.value !== "all" || !nextSummary) return;
  range.from = nextSummary.from;
  range.to = nextSummary.to;
});

watch(() => [range.from, range.to, range.granularity] as const, closePeriodDetail);
</script>

<template>
  <div class="revenue-dashboard page-stack">
    <div class="page-toolbar revenue-toolbar">
      <div class="revenue-toolbar__range">
        <CalendarRange :size="16" />
        <input
          v-model="range.from"
          class="input"
          type="date"
          aria-label="统计开始日期"
          @input="useCustomRange"
        />
        <span>至</span>
        <input
          v-model="range.to"
          class="input"
          type="date"
          aria-label="统计结束日期"
          @input="useCustomRange"
        />
        <div class="range-presets" aria-label="日期快捷范围">
          <button
            v-for="preset in rangePresets"
            :key="preset.value"
            class="range-preset"
            :class="{ 'is-active': activePreset === preset.value }"
            type="button"
            :aria-pressed="activePreset === preset.value"
            @click="selectRangePreset(preset.value)"
          >
            {{ preset.label }}
          </button>
        </div>
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
          <div class="panel-header__meta">
            <span v-if="range.granularity !== 'day'" class="chart-drill-hint">
              点击柱形查看每日明细
            </span>
            <span>{{ summaryRangeLabel }}</span>
          </div>
        </header>
        <RevenueChart
          role="img"
          :aria-label="chartDescription"
          :points="summary?.points ?? []"
          :drillable="range.granularity !== 'day'"
          @period-select="showPeriodDetail"
        />
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

    <RevenuePeriodDetail
      v-if="selectedPeriod"
      :granularity="selectedPeriod.granularity"
      :from="selectedPeriod.from"
      :to="selectedPeriod.to"
      :summary="detailSummary"
      :loading="detailLoading"
      :error="detailError"
      @close="closePeriodDetail"
    />
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

.range-presets {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 3px;
}

.range-preset {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink-muted);
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    box-shadow 150ms ease,
    color 150ms ease;
}

.range-preset:hover {
  border-color: color-mix(in srgb, var(--brand) 35%, var(--line));
  color: var(--brand-strong);
}

.range-preset.is-active {
  border-color: var(--gold-border);
  color: var(--gold-strong);
  background: var(--gold-soft);
  box-shadow: 0 3px 9px rgba(145, 98, 21, 0.09);
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

.panel-header__meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.panel-header__meta > span {
  color: var(--ink-muted);
  font-size: 10px;
}

.panel-header__meta > .chart-drill-hint {
  color: var(--gold-strong);
  font-weight: 650;
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
