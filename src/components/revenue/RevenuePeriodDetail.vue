<script setup lang="ts">
import { ArrowLeft, CalendarDays, ChevronRight, Clock3, Coins, X } from "@lucide/vue";
import { computed, nextTick, shallowRef, useTemplateRef, type DeepReadonly } from "vue";
import { useModalFocus } from "../../composables/useModalFocus";
import type {
  Appointment,
  ReportGranularity,
  RevenuePoint,
  RevenueSummary,
} from "../../types/domain";
import { formatCurrency } from "../../utils/formatters";
import { dateKeyWeekday, formatChinaDate } from "../../utils/chinaDateTime";
import RevenueDayAppointments from "./RevenueDayAppointments.vue";

const props = defineProps<{
  granularity: ReportGranularity;
  from: string;
  to: string;
  summary: DeepReadonly<RevenueSummary> | null;
  loading: boolean;
  error: string | null;
  stale?: boolean;
  actionsDisabled?: boolean;
  appointments: DeepReadonly<Appointment[]>;
  appointmentsLoading: boolean;
  appointmentsError: string | null;
  appointmentsStale?: boolean;
  appointmentsActionsDisabled?: boolean;
  appointmentsResolvedDate?: string | null;
}>();

const emit = defineEmits<{
  close: [];
  daySelect: [point: RevenuePoint];
  dayBack: [];
}>();

const panelRef = useTemplateRef("panel");
const backButtonRef = useTemplateRef("backButton");
const selectedDay = shallowRef<RevenuePoint | null>(null);
const isDayView = computed(() => props.granularity === "day" || selectedDay.value !== null);
const visibleSummary = computed(() => selectedDay.value ?? props.summary);
const relevantDayCount = computed(
  () => props.summary?.points.filter((point) => point.appointmentCount > 0).length ?? 0,
);
const title = computed(() => {
  if (isDayView.value) return "当日预约明细";
  return props.granularity === "week" ? "周收入明细" : "月收入明细";
});
const dateRangeLabel = computed(() => {
  if (selectedDay.value) return formatDate(selectedDay.value.period);
  return props.from === props.to
    ? formatDate(props.from)
    : `${formatDate(props.from)} — ${formatDate(props.to)}`;
});

function formatDate(date: string): string {
  return formatChinaDate(date, { year: true });
}

function formatPointDate(date: string): string {
  return `${formatChinaDate(date, { year: false })} ${dateKeyWeekday(date, true)}`;
}

async function selectDay(point: RevenuePoint): Promise<void> {
  if (point.appointmentCount <= 0 || props.actionsDisabled) return;
  selectedDay.value = point;
  emit("daySelect", point);
  await nextTick();
  backButtonRef.value?.focus();
}

async function backToPeriod(): Promise<void> {
  const period = selectedDay.value?.period;
  selectedDay.value = null;
  emit("dayBack");
  await nextTick();
  if (period) {
    const dayButton = panelRef.value?.querySelector(`[data-period="${period}"]`);
    if (dayButton instanceof globalThis.HTMLElement) dayButton.focus();
  }
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
          <div class="period-detail__heading">
            <button
              v-if="selectedDay"
              ref="backButton"
              class="period-detail__back"
              type="button"
              :aria-label="`返回${granularity === 'week' ? '周' : '月'}收入明细`"
              @click="backToPeriod"
            >
              <ArrowLeft :size="16" />
            </button>
            <div>
              <span class="section-kicker">{{
                isDayView ? "APPOINTMENTS" : "DAILY BREAKDOWN"
              }}</span>
              <h2 id="period-detail-title">{{ title }}</h2>
              <p><CalendarDays :size="14" />{{ dateRangeLabel }}</p>
            </div>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="emit('close')">
            <X :size="18" />
          </button>
        </header>

        <div class="period-detail__body">
          <div v-if="loading" class="loading-line" />
          <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
          <div v-if="stale" class="detail-stale" role="status">
            正在保留 {{ from }} — {{ to }} 的旧汇总，相关下钻操作已暂停。
          </div>
          <div v-if="appointmentsStale" class="detail-stale" role="status">
            当前预约列表来自
            {{ appointmentsResolvedDate || "上一日期" }}，新日期加载失败或尚未完成。
          </div>

          <section class="detail-summary" aria-label="选中时间段汇总">
            <div>
              <Coins :size="17" />
              <span>已结收益</span>
              <strong class="mono-number">{{
                formatCurrency(visibleSummary?.settledMinor)
              }}</strong>
            </div>
            <div>
              <Clock3 :size="17" />
              <span>待结场次</span>
              <strong class="mono-number">{{ visibleSummary?.pendingCount ?? 0 }}场</strong>
            </div>
            <div>
              <Clock3 :size="17" />
              <span>业务工时</span>
              <strong class="mono-number"
                >{{ (visibleSummary?.businessHours ?? 0).toFixed(1) }}h</strong
              >
            </div>
            <div>
              <CalendarDays :size="17" />
              <span>业务预约</span>
              <strong class="mono-number">{{ visibleSummary?.appointmentCount ?? 0 }}场</strong>
            </div>
          </section>

          <RevenueDayAppointments
            v-if="isDayView"
            :appointments="appointments"
            :loading="appointmentsLoading"
            :error="appointmentsError"
            :inert="appointmentsActionsDisabled"
          />

          <section v-else class="daily-detail">
            <header>
              <div>
                <span class="section-kicker">BY DAY</span>
                <h3>每日明细</h3>
              </div>
              <span>{{ relevantDayCount }} 个有业务日期</span>
            </header>

            <div v-if="summary?.points.length" class="daily-table-wrap">
              <div class="daily-table" aria-label="每日收入明细">
                <div class="daily-table__head" aria-hidden="true">
                  <span>日期</span>
                  <span>已结收益</span>
                  <span>待结场次</span>
                  <span>业务工时</span>
                  <span>预约</span>
                  <span />
                </div>
                <button
                  v-for="point in summary.points"
                  :key="point.period"
                  class="daily-table__row"
                  type="button"
                  :data-period="point.period"
                  :disabled="actionsDisabled || point.appointmentCount === 0"
                  :aria-label="`查看${formatPointDate(point.period)}业务预约`"
                  @click="selectDay(point)"
                >
                  <strong>{{ formatPointDate(point.period) }}</strong>
                  <span class="mono-number daily-table__settled">
                    {{ formatCurrency(point.settledMinor) }}
                  </span>
                  <span class="mono-number">{{ point.pendingCount }}场</span>
                  <span class="mono-number">{{ point.businessHours.toFixed(1) }}h</span>
                  <span class="mono-number">{{ point.appointmentCount }}场</span>
                  <ChevronRight :size="15" />
                </button>
              </div>
            </div>
            <div v-else-if="!loading && !error" class="daily-empty">该时间段暂无业务记录</div>
          </section>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.detail-stale {
  padding: 8px 10px;
  border: 1px solid var(--amber-border);
  border-radius: var(--radius-sm, 8px);
  color: #815414;
  background: var(--amber-soft);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

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

.period-detail__heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.period-detail__back {
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--gold) 28%, var(--line));
  border-radius: 10px;
  color: var(--gold-strong);
  background: color-mix(in srgb, var(--gold-soft) 56%, var(--surface));
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    transform 150ms ease;
}

.period-detail__back:hover {
  border-color: var(--gold-border);
  background: var(--gold-soft);
  transform: translateX(-1px);
}

.period-detail__header h2 {
  margin-top: 2px;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: calc(20px + var(--app-font-size-offset, 0px));
  letter-spacing: 0.02em;
}

.period-detail__header p {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
  color: var(--gold-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.detail-summary strong {
  overflow: hidden;
  color: var(--ink-strong);
  font-size: calc(14px + var(--app-font-size-offset, 0px));
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
  font-size: calc(14px + var(--app-font-size-offset, 0px));
}

.daily-detail > header > span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.daily-table-wrap {
  overflow-x: auto;
}

.daily-table {
  min-width: 590px;
  width: 100%;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.daily-table__head,
.daily-table__row {
  display: grid;
  grid-template-columns: minmax(118px, 1.25fr) repeat(4, minmax(76px, 0.8fr)) 24px;
  align-items: center;
  gap: 8px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--line);
  text-align: right;
}

.daily-table__head {
  color: var(--ink-muted);
  background: color-mix(in srgb, var(--surface-soft) 54%, transparent);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 600;
}

.daily-table__head > span:first-child,
.daily-table__row > strong {
  text-align: left;
}

.daily-table__row {
  width: 100%;
  border-top: 0;
  border-right: 0;
  border-left: 0;
  color: var(--ink-muted);
  background: transparent;
  cursor: pointer;
  transition:
    color 150ms ease,
    background-color 150ms ease;
}

.daily-table__row > strong {
  color: var(--ink-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 650;
}

.daily-table__row > span {
  white-space: nowrap;
}

.daily-table__row > svg {
  justify-self: end;
  color: var(--gold-strong);
}

.daily-table__row:last-child {
  border-bottom: 0;
}

.daily-table__row:hover:not(:disabled) {
  background: color-mix(in srgb, var(--gold-soft) 30%, transparent);
}

.daily-table__row:disabled {
  color: var(--ink-faint);
  background: color-mix(in srgb, var(--neutral-soft) 45%, transparent);
  cursor: default;
  opacity: 0.68;
}

.daily-table__row:disabled > svg {
  visibility: hidden;
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
