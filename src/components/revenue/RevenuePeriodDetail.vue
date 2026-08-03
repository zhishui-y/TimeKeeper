<script setup lang="ts">
import { CalendarDays, Clock3, Coins, X } from "@lucide/vue";
import { format, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import { computed, useTemplateRef, type DeepReadonly } from "vue";
import { useModalFocus } from "../../composables/useModalFocus";
import type { Appointment, ReportGranularity, RevenueSummary } from "../../types/domain";
import { formatCurrency } from "../../utils/formatters";
import RevenueDayAppointments from "./RevenueDayAppointments.vue";

const props = defineProps<{
  granularity: ReportGranularity;
  from: string;
  to: string;
  summary: DeepReadonly<RevenueSummary> | null;
  loading: boolean;
  error: string | null;
  appointments: DeepReadonly<Appointment[]>;
  appointmentsLoading: boolean;
  appointmentsError: string | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const panelRef = useTemplateRef("panel");
const title = computed(() => {
  if (props.granularity === "day") return "当日预约明细";
  return props.granularity === "week" ? "周收入明细" : "月收入明细";
});
const dateRangeLabel = computed(() =>
  props.from === props.to
    ? formatDate(props.from)
    : `${formatDate(props.from)} — ${formatDate(props.to)}`,
);

function formatDate(date: string): string {
  return format(parseISO(date), "yyyy年M月d日");
}

function formatPointDate(date: string): string {
  return format(parseISO(date), "M月d日 EEE", { locale: zhCN });
}

useModalFocus({
  open: () => true,
  container: panelRef,
  close: () => emit("close"),
});
</script>

<template>
  <Teleport to="body">
    <div class="period-detail-layer">
      <button
        class="period-detail-backdrop"
        type="button"
        aria-label="关闭收入明细"
        @click="emit('close')"
      />
      <aside
        ref="panel"
        class="period-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="period-detail-title"
        tabindex="-1"
      >
        <header class="period-detail__header">
          <div>
            <span class="section-kicker">{{
              granularity === "day" ? "APPOINTMENTS" : "DAILY BREAKDOWN"
            }}</span>
            <h2 id="period-detail-title">{{ title }}</h2>
            <p><CalendarDays :size="14" />{{ dateRangeLabel }}</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="emit('close')">
            <X :size="18" />
          </button>
        </header>

        <div class="period-detail__body">
          <div v-if="loading" class="loading-line" />
          <div v-if="error" class="error-banner" role="alert">{{ error }}</div>

          <section class="detail-summary" aria-label="选中时间段汇总">
            <div>
              <Coins :size="17" />
              <span>已结收益</span>
              <strong class="mono-number">{{ formatCurrency(summary?.settledMinor) }}</strong>
            </div>
            <div>
              <Clock3 :size="17" />
              <span>待结场次</span>
              <strong class="mono-number">{{ summary?.pendingCount ?? 0 }}场</strong>
            </div>
            <div>
              <Clock3 :size="17" />
              <span>业务工时</span>
              <strong class="mono-number">{{ (summary?.businessHours ?? 0).toFixed(1) }}h</strong>
            </div>
            <div>
              <CalendarDays :size="17" />
              <span>业务预约</span>
              <strong class="mono-number">{{ summary?.appointmentCount ?? 0 }}场</strong>
            </div>
          </section>

          <RevenueDayAppointments
            v-if="granularity === 'day'"
            :appointments="appointments"
            :loading="appointmentsLoading"
            :error="appointmentsError"
          />

          <section v-else class="daily-detail">
            <header>
              <div>
                <span class="section-kicker">BY DAY</span>
                <h3>每日明细</h3>
              </div>
              <span>{{ summary?.points.length ?? 0 }} 个有记录日期</span>
            </header>

            <div v-if="summary?.points.length" class="daily-table-wrap">
              <table class="daily-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>已结收益</th>
                    <th>待结场次</th>
                    <th>业务工时</th>
                    <th>预约</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="point in summary.points" :key="point.period">
                    <th scope="row">{{ formatPointDate(point.period) }}</th>
                    <td class="mono-number daily-table__settled">
                      {{ formatCurrency(point.settledMinor) }}
                    </td>
                    <td class="mono-number">{{ point.pendingCount }}场</td>
                    <td class="mono-number">{{ point.businessHours.toFixed(1) }}h</td>
                    <td class="mono-number">{{ point.appointmentCount }}场</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else-if="!loading && !error" class="daily-empty">该时间段暂无业务记录</div>
          </section>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.period-detail-layer {
  position: fixed;
  z-index: 70;
  inset: 0;
}

.period-detail-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  border: 0;
  background: rgba(20, 31, 27, 0.42);
  backdrop-filter: blur(4px);
  cursor: default;
}

.period-detail {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  display: grid;
  width: min(720px, calc(100vw - 32px));
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--gold) 32%, var(--line));
  border-radius: var(--radius-lg, 18px);
  background: var(--canvas, #f7f5ef);
  box-shadow: -24px 16px 64px rgba(18, 34, 28, 0.24);
}

.period-detail__header {
  display: flex;
  min-height: 92px;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid var(--line);
  background:
    radial-gradient(
      circle at 10% 0%,
      color-mix(in srgb, var(--gold-soft) 70%, transparent),
      transparent 62%
    ),
    color-mix(in srgb, var(--surface) 95%, transparent);
}

.period-detail__header h2 {
  margin-top: 2px;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: 20px;
  letter-spacing: 0.02em;
}

.period-detail__header p {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
  color: var(--gold-strong);
  font-size: 11px;
  font-weight: 650;
}

.period-detail__body {
  min-height: 0;
  overflow-y: auto;
  padding: 18px 24px 26px;
}

.detail-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 9px;
}

.detail-summary > div {
  display: grid;
  min-width: 0;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 3px 7px;
  padding: 13px;
  border: 1px solid var(--line);
  border-radius: var(--radius, 12px);
  color: var(--brand);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.detail-summary svg {
  grid-row: 1 / 3;
}

.detail-summary span {
  color: var(--ink-muted);
  font-size: 10px;
}

.detail-summary strong {
  overflow: hidden;
  color: var(--ink-strong);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.daily-detail {
  margin-top: 16px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 16px);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.daily-detail > header {
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-soft) 82%, transparent);
}

.daily-detail h3 {
  margin-top: 1px;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: 14px;
}

.daily-detail > header > span {
  color: var(--ink-muted);
  font-size: 10px;
}

.daily-table-wrap {
  overflow-x: auto;
}

.daily-table {
  width: 100%;
  border-collapse: collapse;
  color: var(--ink-muted);
  font-size: 11px;
  text-align: right;
}

.daily-table th,
.daily-table td {
  padding: 12px 15px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}

.daily-table thead th {
  color: var(--ink-muted);
  background: color-mix(in srgb, var(--surface-soft) 54%, transparent);
  font-size: 10px;
  font-weight: 600;
}

.daily-table th:first-child {
  text-align: left;
}

.daily-table tbody th {
  color: var(--ink-strong);
  font-weight: 650;
}

.daily-table tbody tr:last-child > * {
  border-bottom: 0;
}

.daily-table tbody tr:hover {
  background: color-mix(in srgb, var(--gold-soft) 30%, transparent);
}

.daily-table__settled {
  color: var(--brand-strong);
  font-weight: 700;
}

.daily-empty {
  display: grid;
  min-height: 180px;
  place-items: center;
  color: var(--ink-muted);
  font-size: 12px;
}

@media (max-width: 680px) {
  .period-detail__header,
  .period-detail__body {
    padding-inline: 16px;
  }

  .detail-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-height: 740px) {
  .period-detail {
    top: 8px;
    right: 8px;
    bottom: 8px;
  }

  .period-detail__header {
    min-height: 78px;
    padding-block: 12px;
  }

  .period-detail__body {
    padding-top: 14px;
  }
}
</style>
