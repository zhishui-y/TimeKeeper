<script setup lang="ts">
import { CalendarClock, CircleDollarSign, Clock3, WalletCards } from "@lucide/vue";
import { computed, onMounted, onUnmounted, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import { api, errorMessage } from "../../api/client";
import { useAppointments } from "../../composables/useAppointments";
import { useDashboard } from "../../composables/useDashboard";
import { useUiStore } from "../../stores/ui";
import { useOperationStore } from "../../stores/operations";
import type { Appointment, ServiceStatus } from "../../types/domain";
import { appointmentFiltersToQuery } from "../../utils/appointmentRouteQuery";
import { findNextScheduledAppointment, sortAppointmentsByStartTime } from "../../utils/appointment";
import {
  addDateKeyDays,
  chinaDateKey,
  civilDifferenceInMinutes,
  dateKeyWeekday,
  endOfChinaWeek,
  formatChinaDate,
  parseDateKey,
  startOfChinaWeek,
} from "../../utils/chinaDateTime";
import { formatCurrency, formatDateHeading, formatTimeRange } from "../../utils/formatters";
import TodayAppointmentList from "./TodayAppointmentList.vue";
import WeekSchedule from "./WeekSchedule.vue";

const now = shallowRef(new Date());
const router = useRouter();
const todayKey = computed(() => chinaDateKey(now.value));
const selectedDateKey = shallowRef(todayKey.value);
const weekStartKey = computed(() => startOfChinaWeek(todayKey.value));
const weekEndKey = computed(() => endOfChinaWeek(todayKey.value));
const currentMonthLabel = computed(() => {
  const parts = parseDateKey(todayKey.value);
  return parts ? `${parts.year} · ${String(parts.month).padStart(2, "0")}` : todayKey.value;
});
const ui = useUiStore();
const operations = useOperationStore();
const {
  filters,
  items,
  loading,
  error,
  stale,
  actionsDisabled,
  resolvedKey,
  load: loadAppointments,
} = useAppointments({
  from: weekStartKey.value,
  to: weekEndKey.value,
});
const dashboard = useDashboard();
const resultActionsDisabled = computed(
  () => actionsDisabled.value || dashboard.actionsDisabled.value || operations.busy,
);
const staleDataLabel = computed(() => {
  const appointmentRange = resolvedKey.value;
  const dashboardDate = dashboard.resolvedKey.value;
  if (appointmentRange?.from && appointmentRange.to) {
    return `${appointmentRange.from} 至 ${appointmentRange.to}${dashboardDate ? `、汇总日 ${dashboardDate}` : ""}`;
  }
  return dashboardDate ? `汇总日 ${dashboardDate}` : "上一请求";
});
let clockTimer: ReturnType<typeof globalThis.setInterval> | undefined;

const todayAppointments = computed(() =>
  sortAppointmentsByStartTime(
    items.value.filter(
      (item) => item.serviceDate === todayKey.value && item.serviceStatus !== "cancelled",
    ),
  ),
);

const selectedAppointments = computed(() =>
  sortAppointmentsByStartTime(
    items.value.filter(
      (item) => item.serviceDate === selectedDateKey.value && item.serviceStatus !== "cancelled",
    ),
  ),
);

const selectedDateIsToday = computed(() => selectedDateKey.value === todayKey.value);
const selectedListKicker = computed(() => (selectedDateIsToday.value ? "今日安排" : "当日安排"));
const selectedListHeading = computed(() =>
  selectedDateIsToday.value
    ? "今日预约"
    : `${formatChinaDate(selectedDateKey.value, { weekday: true })}预约`,
);
const nextTodayAppointmentId = computed(
  () => findNextScheduledAppointment(todayAppointments.value, now.value)?.id ?? null,
);
const nextSelectedAppointmentId = computed(() => {
  if (!selectedDateIsToday.value) return null;
  return nextTodayAppointmentId.value;
});

const weekDays = computed(() =>
  Array.from({ length: 7 }, (_, index) => {
    const dateKey = addDateKeyDays(weekStartKey.value, index);
    const parts = parseDateKey(dateKey);
    return {
      date: dateKey,
      weekday: dateKeyWeekday(dateKey, true),
      dayNumber: parts ? String(parts.day) : "",
      isToday: dateKey === todayKey.value,
      appointments: sortAppointmentsByStartTime(
        items.value.filter((item) => item.serviceDate === dateKey),
      ),
    };
  }),
);

const nextCountdown = computed(() => {
  const next = dashboard.summary.value?.nextAppointment;
  if (!next) return "暂无待开始预约";
  if (next.serviceStatus === "in_progress") return "进行中";
  if (!next.startsAt) return "待定时段";
  const minutes = civilDifferenceInMinutes(next.startsAt, now.value);
  if (minutes <= 0) return "即将开始";
  if (minutes < 60) return `${minutes}分钟后`;
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes ? `${hours}时${remainingMinutes}分后` : `${hours}小时后`;
  }
  return `${Math.floor(minutes / 1440)}天后`;
});

async function refresh(): Promise<void> {
  await Promise.all([loadAppointments(), dashboard.load(todayKey.value)]);
}

async function changeStatus(appointment: Appointment, status: ServiceStatus): Promise<void> {
  if (resultActionsDisabled.value) return;
  try {
    await api.setAppointmentServiceStatus(appointment.id, status);
    ui.notify(
      status === "completed"
        ? appointment.mode === "business"
          ? "服务已完成，预约进入待结算"
          : "预约已完成"
        : "预约已开始",
      "success",
    );
    ui.markDataChanged();
    await refresh();
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function copyAccount(appointment: Appointment): Promise<void> {
  try {
    await api.copyAppointmentAccountName(appointment.id);
    ui.notify("账号已复制", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function copyVoiceChannel(appointment: Appointment): Promise<void> {
  try {
    await api.copyAppointmentVoiceChannel(appointment.id);
    ui.notify("YY频道号已复制", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function removeAppointment(appointment: Appointment): Promise<void> {
  if (resultActionsDisabled.value) return;
  if (!globalThis.confirm(`确定永久删除 ${appointment.contactName} 的这条预约吗？`)) return;
  try {
    await api.deleteAppointment(appointment.id);
    ui.markDataChanged();
    ui.notify("预约已永久删除", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function copyPassword(appointment: Appointment): Promise<void> {
  try {
    await api.copyAppointmentAccountPassword(appointment.id);
    ui.notify("账号密码已复制，30秒后自动清空剪贴板", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

function selectDate(serviceDate: string): void {
  selectedDateKey.value = serviceDate;
}

function openPendingAppointments(): void {
  void router.push({
    name: "appointments",
    query: appointmentFiltersToQuery({ progressStatus: "pending_settlement" }),
  });
}

watch(
  () => ui.dataRevision,
  () => void refresh(),
);

watch(todayKey, () => {
  selectedDateKey.value = todayKey.value;
  filters.from = weekStartKey.value;
  filters.to = weekEndKey.value;
  void refresh();
});

onMounted(() => {
  void dashboard.load(todayKey.value);
  clockTimer = globalThis.setInterval(() => {
    now.value = new Date();
  }, 30_000);
});

onUnmounted(() => {
  if (clockTimer !== undefined) globalThis.clearInterval(clockTimer);
});
</script>

<template>
  <div class="today-workspace page-stack">
    <div v-if="loading || dashboard.loading.value" class="loading-line" />
    <div v-if="error || dashboard.error.value" class="error-banner">
      {{ error || dashboard.error.value }}
    </div>
    <div v-if="stale || dashboard.stale.value" class="stale-banner" role="status">
      当前保留的是 {{ staleDataLabel }} 的旧数据；刷新失败或尚未完成，编辑、删除和结算操作已暂停。
    </div>

    <section class="today-lead">
      <div class="today-lead__date">
        <span class="section-kicker">{{ currentMonthLabel }}</span>
        <h2>{{ formatDateHeading(todayKey) }}</h2>
        <p>先看下一场，再安排今天。</p>
      </div>
      <div class="metric-grid">
        <div class="metric metric--next">
          <CalendarClock :size="18" />
          <div>
            <span>下一场</span>
            <strong>{{ nextCountdown }}</strong>
            <small v-if="dashboard.summary.value?.nextAppointment">
              {{ dashboard.summary.value.nextAppointment.contactName }} ·
              {{
                formatTimeRange(
                  dashboard.summary.value.nextAppointment.startsAt,
                  dashboard.summary.value.nextAppointment.endsAt,
                )
              }}
            </small>
          </div>
        </div>
        <div class="metric">
          <CircleDollarSign :size="18" />
          <div>
            <span>今日已结</span>
            <strong class="mono-number">{{
              formatCurrency(dashboard.summary.value?.todaySettledMinor)
            }}</strong>
            <small>只计已完成业务预约</small>
          </div>
        </div>
        <div class="metric">
          <WalletCards :size="18" />
          <div>
            <span>本周已结</span>
            <strong class="mono-number">{{
              formatCurrency(dashboard.summary.value?.weekSettledMinor)
            }}</strong>
            <small>周一至周日</small>
          </div>
        </div>
        <button
          class="metric metric--pending"
          type="button"
          :disabled="dashboard.actionsDisabled.value"
          aria-label="查看待结算预约"
          @click="openPendingAppointments"
        >
          <Clock3 :size="18" />
          <div>
            <span>待结场次</span>
            <strong class="mono-number">{{ dashboard.summary.value?.pendingCount ?? 0 }}</strong>
            <small>已完成但未结算</small>
          </div>
        </button>
      </div>
    </section>

    <WeekSchedule
      class="today-workspace__week"
      :days="weekDays"
      :next-appointment-id="nextTodayAppointmentId"
      :selected-date="selectedDateKey"
      :interactions-disabled="resultActionsDisabled"
      @edit="ui.openEditAppointment"
      @create="ui.openCreateAppointment"
      @select-date="selectDate"
    />

    <TodayAppointmentList
      class="today-workspace__list"
      :appointments="selectedAppointments"
      :next-appointment-id="nextSelectedAppointmentId"
      :kicker="selectedListKicker"
      :heading="selectedListHeading"
      :interactions-disabled="resultActionsDisabled"
      @edit="ui.openEditAppointment"
      @settle="ui.openSettleAppointment"
      @change-status="changeStatus"
      @copy-account="copyAccount"
      @copy-password="copyPassword"
      @copy-voice-channel="copyVoiceChannel"
      @delete="removeAppointment"
    />
  </div>
</template>

<style scoped>
.today-workspace {
  position: relative;
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: 146px minmax(204px, 0.95fr) minmax(194px, 1.05fr);
  gap: 14px;
}

.today-workspace > .loading-line {
  position: absolute;
  z-index: 3;
  top: 0;
  right: 0;
  left: 0;
}

.today-workspace > .error-banner {
  position: absolute;
  z-index: 4;
  top: 8px;
  right: 8px;
}

.stale-banner {
  position: absolute;
  z-index: 4;
  top: 8px;
  left: 8px;
  max-width: min(640px, calc(100% - 16px));
  padding: 8px 12px;
  border: 1px solid var(--amber-border);
  border-radius: var(--radius-sm, 8px);
  color: #815414;
  background: var(--amber-soft);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.today-lead {
  position: relative;
  display: grid;
  min-height: 0;
  grid-template-columns: minmax(235px, 0.76fr) minmax(0, 2.6fr);
  align-items: center;
  gap: 14px;
  padding: 18px 18px 18px 22px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, var(--radius));
  background:
    radial-gradient(
      circle at 4% 20%,
      color-mix(in srgb, var(--brand-soft) 78%, transparent),
      transparent 34%
    ),
    linear-gradient(110deg, var(--surface-soft), var(--surface) 60%);
  box-shadow: var(--shadow-sm, var(--shadow-soft));
}

.today-lead::before {
  position: absolute;
  top: 16px;
  bottom: 16px;
  left: 0;
  width: 4px;
  border-radius: 0 999px 999px 0;
  background: linear-gradient(180deg, var(--accent), var(--brand));
  content: "";
}

.today-lead__date {
  min-width: 0;
}

.today-lead__date h2 {
  margin-top: 6px;
  overflow: hidden;
  color: var(--ink-strong);
  font-family: var(--font-serif, "STSong", "SimSun", serif);
  font-size: calc(22px + var(--app-font-size-offset, 0px));
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.today-lead__date p {
  margin-top: 7px;
  color: var(--ink-muted);
  font-size: calc(13px + var(--app-font-size-offset, 0px));
  line-height: 1.45;
}

.metric-grid {
  display: grid;
  min-width: 0;
  height: 96px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}

.metric {
  display: grid;
  min-width: 0;
  grid-template-columns: 30px minmax(0, 1fr);
  align-content: center;
  gap: 8px;
  padding: 11px 10px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm, 9px);
  color: var(--brand);
  background: color-mix(in srgb, var(--surface) 94%, var(--brand-soft));
  box-shadow: var(--shadow-control, none);
}

.metric > svg {
  width: 30px;
  height: 30px;
  padding: 6px;
  border-radius: 9px;
  background: var(--brand-soft);
}

.metric > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.metric span {
  color: var(--ink);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 620;
}

.metric strong {
  overflow: hidden;
  color: var(--ink-strong);
  font-size: calc(17px + var(--app-font-size-offset, 0px));
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric small {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric--next {
  color: var(--blue);
}

.metric--next > svg {
  background: var(--blue-soft);
}

.metric--pending {
  color: var(--amber);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease,
    transform 140ms ease;
}

.metric--pending > svg {
  background: var(--amber-soft);
}

.metric--pending:hover {
  border-color: var(--amber-border);
  box-shadow: 0 5px 14px color-mix(in srgb, var(--amber) 12%, transparent);
  transform: translateY(-1px);
}

.today-workspace__week,
.today-workspace__list {
  min-height: 0;
}

@media (max-width: 1350px) {
  .today-lead {
    grid-template-columns: minmax(210px, 0.72fr) minmax(0, 2.5fr);
    gap: 11px;
    padding-inline: 18px 16px;
  }

  .today-lead__date h2 {
    font-size: calc(19px + var(--app-font-size-offset, 0px));
  }

  .metric {
    grid-template-columns: 27px minmax(0, 1fr);
    gap: 7px;
    padding-inline: 8px;
  }

  .metric > svg {
    width: 27px;
    height: 27px;
    padding: 5px;
  }

  .metric strong {
    font-size: calc(16px + var(--app-font-size-offset, 0px));
  }
}

@media (max-height: 760px) {
  .today-workspace {
    grid-template-rows: 138px minmax(194px, 0.95fr) minmax(166px, 1.05fr);
    gap: 12px;
  }

  .today-lead {
    padding-block: 14px;
  }

  .metric-grid {
    height: 90px;
  }

  .today-lead__date p {
    margin-top: 5px;
  }
}

@media (max-width: 1180px) {
  .today-lead {
    grid-template-columns: 200px minmax(0, 2.45fr);
    gap: 9px;
    padding-inline: 16px 14px;
  }

  .today-lead__date h2 {
    font-size: calc(18px + var(--app-font-size-offset, 0px));
  }

  .today-lead__date p {
    font-size: calc(12px + var(--app-font-size-offset, 0px));
  }

  .metric-grid {
    gap: 5px;
  }

  .metric {
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 6px;
    padding-inline: 7px;
  }

  .metric > svg {
    width: 24px;
    height: 24px;
    padding: 4px;
    border-radius: 7px;
  }

  .metric span,
  .metric small {
    font-size: calc(12px + var(--app-font-size-offset, 0px));
  }

  .metric strong {
    font-size: calc(15px + var(--app-font-size-offset, 0px));
  }
}
</style>
