<script setup lang="ts">
import { CalendarDays, FileChartColumn, RefreshCw, X } from "@lucide/vue";
import { computed, type DeepReadonly, useTemplateRef } from "vue";
import { useModalFocus } from "../../../composables/useModalFocus";
import type { RevenueAnalyticsReport } from "../../../types/domain";
import { formatChinaDate } from "../../../utils/chinaDateTime";
import RevenueReportContribution from "./RevenueReportContribution.vue";
import RevenueReportHourlyHeatmap from "./RevenueReportHourlyHeatmap.vue";
import RevenueReportOverview from "./RevenueReportOverview.vue";
import RevenueReportWeekdayChart from "./RevenueReportWeekdayChart.vue";
import RevenueReportWeeklyMatrix from "./RevenueReportWeeklyMatrix.vue";

const props = defineProps<{
  report: DeepReadonly<RevenueAnalyticsReport> | null;
  loading: boolean;
  error: string | null;
  stale?: boolean;
  restoreFocusElement?: HTMLElement | null;
}>();

const emit = defineEmits<{
  close: [];
  retry: [];
}>();

const panelRef = useTemplateRef<HTMLElement>("panel");
const visibleReport = computed(() => (props.stale ? null : props.report));
const rangeLabel = computed(() => {
  const report = visibleReport.value;
  if (!report) return "正在生成当前范围报表";
  return report.from === report.to
    ? formatChinaDate(report.from, { year: true })
    : `${formatChinaDate(report.from, { year: true })} — ${formatChinaDate(report.to, { year: true })}`;
});

useModalFocus({
  open: () => true,
  container: panelRef,
  close: () => emit("close"),
  restoreFocus: () => props.restoreFocusElement ?? null,
});
</script>

<template>
  <Teleport to="body">
    <div class="analytics-report-layer">
      <button
        class="analytics-report-backdrop"
        type="button"
        aria-label="关闭经营数据报表"
        @click="emit('close')"
      />
      <section
        ref="panel"
        class="analytics-report"
        role="dialog"
        aria-modal="true"
        aria-labelledby="analytics-report-title"
        tabindex="-1"
      >
        <header class="analytics-report__header">
          <div class="analytics-report__title">
            <span class="analytics-report__icon">
              <FileChartColumn :size="21" aria-hidden="true" />
            </span>
            <div>
              <span class="section-kicker">BUSINESS REPORT</span>
              <h2 id="analytics-report-title">经营数据报表</h2>
              <p><CalendarDays :size="14" aria-hidden="true" />{{ rangeLabel }}</p>
            </div>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="emit('close')">
            <X :size="18" />
          </button>
        </header>

        <div class="analytics-report__body">
          <div v-if="loading" class="loading-line" />
          <div v-if="error" class="analytics-report__error error-banner" role="alert">
            <span>{{ error }}</span>
            <button type="button" @click="emit('retry')">
              <RefreshCw :size="14" aria-hidden="true" />重新生成
            </button>
          </div>
          <div v-if="stale" class="analytics-report__stale" role="status">
            当前缓存属于上一统计范围，正在等待本次报表生成完成，旧数据不会用于当前分析。
          </div>

          <template v-if="visibleReport">
            <RevenueReportOverview :report="visibleReport" />
            <p v-if="visibleReport.overview.appointmentCount === 0" class="analytics-report__empty">
              当前统计范围暂无未取消的业务预约；以下星期与小时结构保留为零值，便于确认统计范围。
            </p>
            <RevenueReportWeeklyMatrix :weeks="visibleReport.weeks" />
            <div class="analytics-report__distribution">
              <RevenueReportWeekdayChart :weekdays="visibleReport.weekdays" />
              <RevenueReportHourlyHeatmap :hours="visibleReport.hours" />
            </div>
            <RevenueReportContribution :report="visibleReport" />
            <footer class="analytics-report__methodology">
              <strong>统计口径</strong>
              <span>
                仅含未取消业务预约；收益仅含已结金额；完成工时要求预约已完成且起止时间完整；周与星期按服务日期归属，小时热力按真实起止时间分摊；顾客按预约联系人名称归并。
              </span>
            </footer>
          </template>

          <div v-else-if="loading && !error" class="analytics-report__loading" role="status">
            <FileChartColumn :size="28" aria-hidden="true" />
            <strong>正在生成经营数据报表</strong>
            <span>正在汇总周、星期、小时与顾客贡献数据…</span>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.analytics-report-layer {
  position: fixed;
  z-index: 80;
  inset: 0;
}

.analytics-report-backdrop {
  position: absolute;
  border: 0;
  background: rgba(18, 30, 25, 0.56);
  backdrop-filter: blur(4px);
  cursor: pointer;
  inset: 0;
}

.analytics-report {
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 50%;
  display: grid;
  width: min(1240px, calc(100vw - 24px));
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--brand) 30%, var(--line));
  border-radius: var(--radius-xl, 22px);
  background: var(--canvas, #f7f5ef);
  box-shadow: var(--shadow-dialog);
  transform: translateX(-50%);
}

.analytics-report__header {
  display: flex;
  min-height: 94px;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 22px;
  border-bottom: 1px solid var(--line);
  background:
    radial-gradient(
      circle at 8% 0%,
      color-mix(in srgb, var(--brand-soft) 88%, transparent),
      transparent 58%
    ),
    var(--surface);
}

.analytics-report__title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.analytics-report__icon {
  display: inline-flex;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  color: white;
  background: linear-gradient(145deg, var(--brand), var(--brand-strong));
  box-shadow: 0 8px 22px color-mix(in srgb, var(--brand) 24%, transparent);
}

.analytics-report__header h2 {
  margin-top: 2px;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: calc(22px + var(--app-font-size-offset, 0px));
}

.analytics-report__header p {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  color: var(--brand-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 650;
}

.analytics-report__body {
  position: relative;
  display: grid;
  min-height: 0;
  align-content: start;
  grid-auto-rows: max-content;
  gap: 16px;
  padding: 18px 20px 24px;
  overflow-y: auto;
}

.analytics-report__body > .loading-line {
  position: sticky;
  z-index: 5;
  top: -18px;
  margin: -18px -20px 0;
}

.analytics-report__error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.analytics-report__error button {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid currentColor;
  border-radius: 8px;
  color: inherit;
  background: transparent;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.analytics-report__stale,
.analytics-report__empty {
  padding: 10px 12px;
  border: 1px solid var(--amber-border);
  border-radius: var(--radius-sm, 9px);
  color: #815414;
  background: var(--amber-soft);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.analytics-report__distribution {
  display: grid;
  grid-template-columns: minmax(330px, 0.8fr) minmax(0, 1.7fr);
  gap: 16px;
}

.analytics-report__methodology {
  display: flex;
  gap: 10px;
  padding: 11px 14px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-sm, 9px);
  color: var(--ink-muted);
  background: color-mix(in srgb, var(--surface-soft) 72%, transparent);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  line-height: 1.5;
}

.analytics-report__methodology strong {
  flex: 0 0 auto;
  color: var(--ink-strong);
}

.analytics-report__loading {
  display: grid;
  min-height: 340px;
  place-content: center;
  justify-items: center;
  gap: 8px;
  color: var(--brand);
  text-align: center;
}

.analytics-report__loading strong {
  color: var(--ink-strong);
  font-size: calc(16px + var(--app-font-size-offset, 0px));
}

.analytics-report__loading span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

@media (max-width: 1100px) {
  .analytics-report__distribution {
    grid-template-columns: 1fr;
  }
}
</style>
