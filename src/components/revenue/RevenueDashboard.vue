<script setup lang="ts">
import { CheckCircle2, Clock3, Coins, Gauge } from "@lucide/vue";
import { computed, defineAsyncComponent, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import { useAppointments } from "../../composables/useAppointments";
import { useRevenue } from "../../composables/useRevenue";
import { useRevenueRange } from "../../composables/useRevenueRange";
import { useUiStore } from "../../stores/ui";
import type { ReportGranularity, RevenuePoint } from "../../types/domain";
import { appointmentFiltersToQuery } from "../../utils/appointmentRouteQuery";
import { formatCurrency } from "../../utils/formatters";
import {
  intersectRevenueRanges,
  revenuePeriodRange,
  type RevenuePeriodRange,
} from "../../utils/revenue";
import RevenueRangeNavigator from "./RevenueRangeNavigator.vue";

const RevenueChart = defineAsyncComponent({
  loader: () => import("./RevenueChart.vue"),
  delay: 180,
  timeout: 20_000,
});
const RevenuePeriodDetail = defineAsyncComponent(() => import("./RevenuePeriodDetail.vue"));

interface SelectedPeriod {
  granularity: ReportGranularity;
  from: string;
  to: string;
}

const router = useRouter();
const ui = useUiStore();
const revenueRange = useRevenueRange();
const { summary, loading, error, load } = useRevenue();
const {
  summary: detailSummary,
  loading: detailLoading,
  error: detailError,
  load: loadDetail,
} = useRevenue();
const {
  filters: detailAppointmentFilters,
  items: detailAppointments,
  loading: detailAppointmentsLoading,
  error: detailAppointmentsError,
  load: loadDetailAppointments,
} = useAppointments({}, { immediate: false });
const selectedPeriod = shallowRef<SelectedPeriod | null>(null);
const detailSummaryForView = computed(() =>
  detailLoading.value || detailError.value ? null : detailSummary.value,
);
const detailAppointmentsForView = computed(() =>
  detailAppointmentsLoading.value || detailAppointmentsError.value ? [] : detailAppointments.value,
);
const pendingNavigationReady = computed(
  () => !loading.value && !revenueRange.customError.value && summary.value !== null,
);

const completionRate = computed(() => {
  if (!summary.value?.appointmentCount) return 0;
  return Math.round((summary.value.completedCount / summary.value.appointmentCount) * 100);
});

const maxPayment = computed(() =>
  Math.max(...(summary.value?.paymentMethods.map((item) => item.amountMinor) ?? [1]), 1),
);

const chartDescription = computed(
  () =>
    `收益与工时趋势，${summary.value?.from ?? revenueRange.displayRange.value?.from ?? ""} 至 ${summary.value?.to ?? revenueRange.displayRange.value?.to ?? ""}，共 ${summary.value?.points.length ?? 0} 个数据点，${revenueRange.granularity.value === "day" ? "可点击图中数据查看当日预约" : "可点击图中数据查看每日明细"}；键盘按回车查看首个有业务数据点`,
);

const summaryRangeLabel = computed(() => {
  const visible = revenueRange.displayRange.value;
  if (!visible) return "正在确认实际范围";
  return `${visible.from} — ${visible.to}`;
});

function reportRange(): RevenuePeriodRange | null {
  if (summary.value) return { from: summary.value.from, to: summary.value.to };
  return revenueRange.displayRange.value;
}

function loadAppointmentsForDay(serviceDate: string): void {
  detailAppointmentFilters.from = serviceDate;
  detailAppointmentFilters.to = serviceDate;
  detailAppointmentFilters.mode = "business";
  void loadDetailAppointments();
}

function showPeriodDetail(point: RevenuePoint): void {
  if (loading.value) return;
  const granularity = revenueRange.granularity.value;
  const periodRange =
    granularity === "day"
      ? { from: point.period, to: point.period }
      : revenuePeriodRange(point.period, granularity);
  const activeReportRange = reportRange();
  const selectedRange =
    periodRange && activeReportRange
      ? intersectRevenueRanges(periodRange, activeReportRange)
      : periodRange;
  if (!selectedRange) return;

  selectedPeriod.value = { granularity, ...selectedRange };
  void loadDetail(selectedRange.from, selectedRange.to, "day");
  if (granularity === "day") {
    loadAppointmentsForDay(selectedRange.from);
  }
}

function showDayAppointments(point: RevenuePoint): void {
  loadAppointmentsForDay(point.period);
}

function openPendingAppointments(): void {
  if (!pendingNavigationReady.value || !summary.value) return;
  void router.push({
    name: "appointments",
    query: appointmentFiltersToQuery({
      from: summary.value.from,
      to: summary.value.to,
      progressStatus: "pending_settlement",
    }),
  });
}

function closePeriodDetail(): void {
  selectedPeriod.value = null;
}

watch(
  () =>
    [
      revenueRange.requestRange.value.from,
      revenueRange.requestRange.value.to,
      revenueRange.granularity.value,
      ui.dataRevision,
    ] as const,
  ([from, to, granularity]) => {
    void load(from, to, granularity);
  },
  { immediate: true },
);

watch(summary, (nextSummary) => {
  if (revenueRange.rangeKind.value !== "all" || !nextSummary) return;
  revenueRange.resolveAllRange({ from: nextSummary.from, to: nextSummary.to });
});

watch(
  () =>
    [
      revenueRange.requestRange.value.from,
      revenueRange.requestRange.value.to,
      revenueRange.granularity.value,
    ] as const,
  closePeriodDetail,
);
</script>

<template>
  <div class="revenue-dashboard page-stack">
    <div class="page-toolbar revenue-toolbar">
      <RevenueRangeNavigator
        :range-kind="revenueRange.rangeKind.value"
        :display-range="revenueRange.displayRange.value"
        :is-current-period="revenueRange.isCurrentPeriod.value"
        :custom-from="revenueRange.customDraft.value.from"
        :custom-to="revenueRange.customDraft.value.to"
        :custom-error="revenueRange.customError.value"
        @select-range="revenueRange.selectRange"
        @navigate="revenueRange.navigatePeriod"
        @return-current="revenueRange.returnToCurrentPeriod"
        @update-custom-from="revenueRange.updateCustomDate('from', $event)"
        @update-custom-to="revenueRange.updateCustomDate('to', $event)"
      />
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
      <button
        class="revenue-metric revenue-metric--pending revenue-metric--actionable"
        type="button"
        :disabled="!pendingNavigationReady"
        aria-label="查看当前统计范围内的待结算预约"
        @click="openPendingAppointments"
      >
        <Clock3 :size="18" />
        <span>待结场次</span>
        <strong class="mono-number">{{ summary?.pendingCount ?? 0 }}</strong>
        <small>已完成但未结算 · 查看记录</small>
      </button>
      <div class="revenue-metric">
        <Gauge :size="18" />
        <span>业务工时 / 时薪</span>
        <strong class="mono-number">{{ (summary?.businessHours ?? 0).toFixed(1) }}h</strong>
        <small> 已结收益 ÷ 完工时长 {{ formatCurrency(summary?.averageHourlyMinor) }}/h </small>
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
          <div class="panel-header__title">
            <span class="section-kicker">TREND</span>
            <h2>收益与工时趋势</h2>
            <small class="chart-drill-hint">
              {{
                revenueRange.granularity.value === "day"
                  ? "点击数据点查看当日业务预约"
                  : "点击数据点查看周期每日明细"
              }}
            </small>
          </div>
          <div class="panel-header__controls">
            <div class="trend-grouping" aria-label="趋势分组">
              <span>趋势分组</span>
              <div class="segmented segmented--compact">
                <button
                  v-for="item in [
                    ['day', '日'],
                    ['week', '周'],
                    ['month', '月'],
                  ] as const"
                  :key="item[0]"
                  class="segmented__item"
                  :class="{ 'is-active': revenueRange.granularity.value === item[0] }"
                  type="button"
                  :aria-pressed="revenueRange.granularity.value === item[0]"
                  @click="revenueRange.setGranularity(item[0])"
                >
                  {{ item[1] }}
                </button>
              </div>
            </div>
            <span class="panel-header__range mono-number">{{ summaryRangeLabel }}</span>
          </div>
        </header>
        <RevenueChart
          role="img"
          :aria-label="chartDescription"
          :points="summary?.points ?? []"
          :granularity="revenueRange.granularity.value"
          :from="summary?.from ?? revenueRange.displayRange.value?.from ?? ''"
          :to="summary?.to ?? revenueRange.displayRange.value?.to ?? ''"
          :drillable="!loading"
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
      :summary="detailSummaryForView"
      :loading="detailLoading"
      :error="detailError"
      :appointments="detailAppointmentsForView"
      :appointments-loading="detailAppointmentsLoading"
      :appointments-error="detailAppointmentsError"
      @day-select="showDayAppointments"
      @close="closePeriodDetail"
    />
  </div>
</template>

<style scoped>
.revenue-dashboard {
  position: relative;
  height: 100%;
  gap: 14px;
}

.revenue-dashboard > .loading-line {
  position: absolute;
  z-index: 4;
  top: 0;
  right: 4px;
  left: 0;
}

.revenue-toolbar {
  min-height: 46px;
  justify-content: flex-start;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 14px);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  box-shadow: var(--shadow-xs, 0 3px 14px rgba(31, 49, 42, 0.04));
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
  text-align: left;
}

.revenue-metric > svg {
  grid-row: 1 / 4;
  margin-top: 2px;
}

.revenue-metric span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.revenue-metric strong {
  margin-top: 2px;
  color: var(--ink-strong);
  font-size: calc(22px + var(--app-font-size-offset, 0px));
}

.revenue-metric small {
  margin-top: 2px;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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

.revenue-metric--actionable {
  font: inherit;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    transform 150ms ease;
}

.revenue-metric--actionable:hover:not(:disabled) {
  border-color: var(--amber-border);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--amber) 14%, transparent);
  transform: translateY(-2px);
}

.revenue-metric--actionable:active:not(:disabled) {
  transform: translateY(0);
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
  grid-template-rows: 68px minmax(0, 1fr);
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
  font-size: calc(14px + var(--app-font-size-offset, 0px));
}

.panel-header__title {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.chart-drill-hint {
  overflow: hidden;
  color: var(--gold-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-header__controls {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.trend-grouping {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}

.trend-grouping > span,
.panel-header__range {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  white-space: nowrap;
}

.segmented--compact {
  height: 30px;
  padding: 2px;
  border-radius: 9px;
}

.segmented--compact .segmented__item {
  width: 30px;
  height: 24px;
  padding: 0;
  border-radius: 7px;
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.payment-row__label span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

@media (max-width: 1180px) {
  .revenue-dashboard {
    gap: 10px;
  }

  .revenue-toolbar {
    min-height: 44px;
  }

  .revenue-metrics {
    gap: 9px;
  }

  .revenue-metric {
    padding-inline: 12px;
  }

  .revenue-metric strong {
    font-size: calc(19px + var(--app-font-size-offset, 0px));
  }

  .revenue-body {
    grid-template-columns: minmax(0, 1fr) 230px;
    gap: 10px;
  }

  .panel-header__range {
    display: none;
  }

  .panel-header {
    padding-inline: 13px;
  }

  .trend-grouping > span {
    display: none;
  }
}
</style>
