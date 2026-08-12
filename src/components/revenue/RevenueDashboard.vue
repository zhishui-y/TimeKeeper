<script setup lang="ts">
import { CheckCircle2, Clock3, Coins, Gauge } from "@lucide/vue";
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
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
import RevenueBreakdownPanel from "./RevenueBreakdownPanel.vue";
import RevenueRangeNavigator from "./RevenueRangeNavigator.vue";

const RevenueChart = defineAsyncComponent({
  loader: () => import("./RevenueCharts").then((module) => module.RevenueChart),
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
const { summary, loading, error, stale, actionsDisabled, resolvedRange, load } = useRevenue();
const {
  summary: detailSummary,
  loading: detailLoading,
  error: detailError,
  stale: detailStale,
  actionsDisabled: detailActionsDisabled,
  resolvedRange: detailResolvedRange,
  load: loadDetail,
} = useRevenue();
const {
  filters: detailAppointmentFilters,
  items: detailAppointments,
  loading: detailAppointmentsLoading,
  error: detailAppointmentsError,
  stale: detailAppointmentsStale,
  actionsDisabled: detailAppointmentsActionsDisabled,
  resolvedKey: detailAppointmentsResolvedKey,
  load: loadDetailAppointments,
} = useAppointments({}, { immediate: false });
const selectedPeriod = shallowRef<SelectedPeriod | null>(null);
let periodClock: ReturnType<typeof globalThis.setInterval> | undefined;
const detailSummaryForView = computed(() => detailSummary.value);
const detailAppointmentsForView = computed(() => detailAppointments.value);
const detailVisiblePeriod = computed(() => {
  const selected = selectedPeriod.value;
  if (!selected) return null;
  const resolved = detailResolvedRange.value;
  return resolved ? { ...selected, from: resolved.from, to: resolved.to } : selected;
});
const pendingNavigationReady = computed(
  () => !actionsDisabled.value && !revenueRange.customError.value && summary.value !== null,
);

const completionRate = computed(() => {
  if (!summary.value?.appointmentCount) return 0;
  return Math.round((summary.value.completedCount / summary.value.appointmentCount) * 100);
});

const chartDescription = computed(
  () =>
    `收益与工时趋势，${summary.value?.from ?? revenueRange.displayRange.value?.from ?? ""} 至 ${summary.value?.to ?? revenueRange.displayRange.value?.to ?? ""}，共 ${summary.value?.points.length ?? 0} 个数据点，${revenueRange.granularity.value === "day" ? "可点击图中数据查看当日预约" : "可点击图中数据查看每日明细"}；键盘按回车查看首个有业务数据点`,
);

const summaryRangeLabel = computed(() => {
  const visible = resolvedRange.value ?? revenueRange.displayRange.value;
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
  if (actionsDisabled.value) return;
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
  if (detailActionsDisabled.value) return;
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

onMounted(() => {
  periodClock = globalThis.setInterval(() => revenueRange.refreshCurrentPeriod(new Date()), 30_000);
});

onBeforeUnmount(() => {
  if (periodClock !== undefined) globalThis.clearInterval(periodClock);
});

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
    <div v-if="stale" class="stale-banner" role="status">
      当前保留的是 {{ summary?.from }} —
      {{ summary?.to }} 的旧数据；新范围加载失败或尚未完成，相关操作已暂停。
    </div>

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
          :drillable="!actionsDisabled"
          @period-select="showPeriodDetail"
        />
        <details class="chart-data-table">
          <summary>查看数据表</summary>
          <div class="chart-data-table__scroll">
            <table>
              <caption class="sr-only">
                收益与工时趋势数据
              </caption>
              <thead>
                <tr>
                  <th scope="col">周期</th>
                  <th scope="col">已结收益</th>
                  <th scope="col">业务工时</th>
                  <th scope="col">预约</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="point in summary?.points ?? []" :key="point.period">
                  <th scope="row">
                    <button
                      type="button"
                      :disabled="actionsDisabled || point.appointmentCount === 0"
                      :aria-label="`查看 ${point.period} 明细`"
                      @click="showPeriodDetail(point)"
                    >
                      {{ point.period }}
                    </button>
                  </th>
                  <td class="mono-number">{{ formatCurrency(point.settledMinor) }}</td>
                  <td class="mono-number">{{ point.businessHours.toFixed(1) }}h</td>
                  <td class="mono-number">{{ point.appointmentCount }}场</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </div>
      <RevenueBreakdownPanel
        :from="summary?.from ?? revenueRange.displayRange.value?.from ?? ''"
        :to="summary?.to ?? revenueRange.displayRange.value?.to ?? ''"
        :payment-methods="summary?.paymentMethods ?? []"
        :contacts="summary?.contacts ?? []"
      />
    </section>

    <RevenuePeriodDetail
      v-if="selectedPeriod && detailVisiblePeriod"
      :granularity="detailVisiblePeriod.granularity"
      :from="detailVisiblePeriod.from"
      :to="detailVisiblePeriod.to"
      :summary="detailSummaryForView"
      :loading="detailLoading"
      :error="detailError"
      :stale="detailStale"
      :actions-disabled="detailActionsDisabled"
      :appointments="detailAppointmentsForView"
      :appointments-loading="detailAppointmentsLoading"
      :appointments-error="detailAppointmentsError"
      :appointments-stale="detailAppointmentsStale"
      :appointments-actions-disabled="detailAppointmentsActionsDisabled"
      :appointments-resolved-date="detailAppointmentsResolvedKey?.from ?? null"
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

.stale-banner {
  padding: 8px 11px;
  border: 1px solid var(--amber-border);
  border-radius: var(--radius-sm, 9px);
  color: var(--ink);
  background: var(--amber-soft);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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

.chart-panel {
  position: relative;
  display: grid;
  min-height: 0;
  grid-template-rows: 68px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 18px);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.chart-data-table {
  position: absolute;
  z-index: 2;
  right: 12px;
  bottom: 10px;
  max-width: min(560px, calc(100% - 24px));
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm, 8px);
  background: color-mix(in srgb, var(--surface) 96%, transparent);
  box-shadow: var(--shadow-control, none);
}

.chart-data-table summary {
  padding: 6px 10px;
  color: var(--ink);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 700;
  cursor: pointer;
}

.chart-data-table__scroll {
  max-height: 260px;
  overflow: auto;
  border-top: 1px solid var(--line);
}

.chart-data-table table {
  border-collapse: collapse;
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.chart-data-table th,
.chart-data-table td {
  padding: 6px 9px;
  border-bottom: 1px solid var(--line);
  text-align: right;
  white-space: nowrap;
}

.chart-data-table th:first-child {
  text-align: left;
}

.chart-data-table button {
  border: 0;
  color: var(--brand-strong);
  background: transparent;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.chart-data-table button:disabled {
  color: var(--ink-muted);
  cursor: default;
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
