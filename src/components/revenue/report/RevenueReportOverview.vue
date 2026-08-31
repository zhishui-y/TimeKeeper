<script setup lang="ts">
import { CheckCircle2, Clock3, Coins, Gauge, Lightbulb } from "@lucide/vue";
import { computed, type DeepReadonly } from "vue";
import type { RevenueAnalyticsReport } from "../../../types/domain";
import { formatCurrency } from "../../../utils/formatters";
import {
  buildRevenueAnalyticsInsights,
  formatBusinessHours,
} from "../../../utils/revenueAnalytics";

const props = defineProps<{
  report: DeepReadonly<RevenueAnalyticsReport>;
}>();

const insights = computed(() => buildRevenueAnalyticsInsights(props.report));
const completionRate = computed(() =>
  props.report.overview.appointmentCount > 0
    ? Math.round(
        (props.report.overview.completedCount / props.report.overview.appointmentCount) * 100,
      )
    : 0,
);
</script>

<template>
  <section class="report-overview" aria-labelledby="report-overview-title">
    <header class="report-section-heading">
      <div>
        <span class="section-kicker">OVERVIEW</span>
        <h3 id="report-overview-title">经营总览</h3>
      </div>
      <span>收益按服务日期归属，工时仅统计已完成预约</span>
    </header>

    <div class="report-overview__metrics">
      <article>
        <Coins :size="18" aria-hidden="true" />
        <span>已结收益</span>
        <strong class="mono-number">{{ formatCurrency(report.overview.settledMinor) }}</strong>
      </article>
      <article>
        <Clock3 :size="18" aria-hidden="true" />
        <span>待结场次 / 金额</span>
        <strong class="mono-number">
          {{ report.overview.pendingCount }} 场 ·
          {{ formatCurrency(report.overview.unsettledMinor) }}
        </strong>
      </article>
      <article>
        <Gauge :size="18" aria-hidden="true" />
        <span>完成工时 / 时薪</span>
        <strong class="mono-number">
          {{ formatBusinessHours(report.overview.businessMinutes) }} ·
          {{ formatCurrency(report.overview.averageHourlyMinor) }}/h
        </strong>
      </article>
      <article>
        <CheckCircle2 :size="18" aria-hidden="true" />
        <span>完成率</span>
        <strong class="mono-number">{{ completionRate }}%</strong>
        <small
          >{{ report.overview.completedCount }} / {{ report.overview.appointmentCount }} 场</small
        >
      </article>
    </div>

    <div class="report-overview__insights">
      <div class="report-overview__insight-title">
        <Lightbulb :size="17" aria-hidden="true" />
        <strong>经营提示</strong>
        <span>由当前报表数据按固定规则生成</span>
      </div>
      <ol>
        <li v-for="insight in insights" :key="insight">{{ insight }}</li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.report-overview {
  display: grid;
  gap: 12px;
}

.report-section-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.report-section-heading h3 {
  margin-top: 2px;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: calc(17px + var(--app-font-size-offset, 0px));
}

.report-section-heading > span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.report-overview__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.report-overview__metrics article {
  display: grid;
  min-width: 0;
  min-height: 84px;
  grid-template-columns: 22px minmax(0, 1fr);
  align-content: center;
  gap: 3px 8px;
  padding: 13px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md, 12px);
  color: var(--brand);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.report-overview__metrics svg {
  grid-row: 1 / 4;
}

.report-overview__metrics span,
.report-overview__metrics small {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.report-overview__metrics strong {
  overflow: hidden;
  color: var(--ink-strong);
  font-size: calc(16px + var(--app-font-size-offset, 0px));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.report-overview__insights {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--gold) 30%, var(--line));
  border-radius: var(--radius-md, 12px);
  background: color-mix(in srgb, var(--gold-soft) 48%, var(--surface));
}

.report-overview__insight-title {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-content: start;
  gap: 2px 7px;
  color: var(--gold-strong);
}

.report-overview__insight-title svg {
  grid-row: 1 / 3;
}

.report-overview__insight-title strong {
  color: var(--ink-strong);
}

.report-overview__insight-title span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.report-overview__insights ol {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px 24px;
  padding-left: 20px;
  color: var(--ink);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  line-height: 1.55;
}

@media (max-width: 980px) {
  .report-overview__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .report-overview__insights {
    grid-template-columns: 1fr;
  }
}
</style>
