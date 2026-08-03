<script setup lang="ts">
import { CalendarClock, CircleDollarSign, Clock3, Plus, WalletCards } from "@lucide/vue";
import {
  addDays,
  differenceInMinutes,
  endOfWeek,
  format,
  isSameDay,
  parseISO,
  startOfWeek,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import { computed, onMounted, onUnmounted, shallowRef, watch } from "vue";
import { api, errorMessage } from "../../api/client";
import { useAppointments } from "../../composables/useAppointments";
import { useAppointmentPasswordCopy } from "../../composables/useAppointmentPasswordCopy";
import { useDashboard } from "../../composables/useDashboard";
import { useUiStore } from "../../stores/ui";
import type { Appointment, ServiceStatus } from "../../types/domain";
import { findNextScheduledAppointment, sortAppointmentsByStartTime } from "../../utils/appointment";
import { formatCurrency, formatDateHeading, formatTimeRange } from "../../utils/formatters";
import TodayAppointmentList from "./TodayAppointmentList.vue";
import WeekSchedule from "./WeekSchedule.vue";
import AccountVaultUnlockDialog from "../accounts/AccountVaultUnlockDialog.vue";

const now = shallowRef(new Date());
const todayKey = computed(() => format(now.value, "yyyy-MM-dd"));
const selectedDateKey = shallowRef(todayKey.value);
const weekStart = computed(() => startOfWeek(now.value, { weekStartsOn: 1 }));
const weekEnd = computed(() => endOfWeek(now.value, { weekStartsOn: 1 }));
const currentMonthLabel = computed(() => format(now.value, "yyyy · MM"));
const ui = useUiStore();
const passwordCopy = useAppointmentPasswordCopy();
const {
  filters,
  items,
  loading,
  error,
  load: loadAppointments,
} = useAppointments({
  from: format(weekStart.value, "yyyy-MM-dd"),
  to: format(weekEnd.value, "yyyy-MM-dd"),
});
const dashboard = useDashboard();
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
    : `${format(parseISO(selectedDateKey.value), "M月d日 EEEE", { locale: zhCN })}预约`,
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
    const date = addDays(weekStart.value, index);
    const dateKey = format(date, "yyyy-MM-dd");
    return {
      date: dateKey,
      weekday: format(date, "EEE", { locale: zhCN }),
      dayNumber: format(date, "d"),
      isToday: isSameDay(date, now.value),
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
  const minutes = differenceInMinutes(parseISO(next.startsAt), now.value);
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
  try {
    await api.setAppointmentServiceStatus(appointment.id, status);
    ui.notify(
      status === "completed" ? "已标记完成，待结算金额仍单独保留" : "预约已开始",
      "success",
    );
    ui.markDataChanged();
    await refresh();
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function removeAppointment(appointment: Appointment): Promise<void> {
  if (!globalThis.confirm(`确定永久删除 ${appointment.contactName} 的这条预约吗？`)) return;
  const action = async () => {
    try {
      await api.deleteAppointment(appointment.id);
      ui.markDataChanged();
      ui.notify("预约已永久删除", "success");
    } catch (cause) {
      ui.notify(errorMessage(cause), "danger");
    }
  };
  if (appointment.account?.passwordAvailable) {
    try {
      await passwordCopy.runWhenUnlocked(action);
    } catch (cause) {
      ui.notify(errorMessage(cause), "danger");
    }
  } else {
    await action();
  }
}

function selectDate(serviceDate: string): void {
  selectedDateKey.value = serviceDate;
}

watch(
  () => ui.dataRevision,
  () => void refresh(),
);

watch(todayKey, () => {
  selectedDateKey.value = todayKey.value;
  filters.from = format(weekStart.value, "yyyy-MM-dd");
  filters.to = format(weekEnd.value, "yyyy-MM-dd");
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
            <small>只计已结算订单</small>
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
        <div class="metric metric--pending">
          <Clock3 :size="18" />
          <div>
            <span>待结场次</span>
            <strong class="mono-number">{{ dashboard.summary.value?.pendingCount ?? 0 }}</strong>
            <small>已完成但未结算</small>
          </div>
        </div>
      </div>
      <button
        class="button button--primary today-lead__create"
        type="button"
        @click="ui.openCreateAppointment(todayKey)"
      >
        <Plus :size="16" />
        记一笔预约
      </button>
    </section>

    <WeekSchedule
      class="today-workspace__week"
      :days="weekDays"
      :next-appointment-id="nextTodayAppointmentId"
      :selected-date="selectedDateKey"
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
      @edit="ui.openEditAppointment"
      @settle="ui.openSettleAppointment"
      @change-status="changeStatus"
      @copy-password="passwordCopy.copy($event.id)"
      @delete="removeAppointment"
    />
    <AccountVaultUnlockDialog
      v-if="passwordCopy.ownsUnlockDialog"
      :open="passwordCopy.unlockOpen.value"
      :loading="passwordCopy.unlockLoading.value"
      :error="passwordCopy.unlockError.value"
      @close="passwordCopy.closeUnlock"
      @submit="passwordCopy.unlockAndRetry"
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

.today-lead {
  position: relative;
  display: grid;
  min-height: 0;
  grid-template-columns: minmax(235px, 0.76fr) minmax(0, 2.6fr) auto;
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
  font-size: 22px;
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.today-lead__date p {
  margin-top: 7px;
  color: var(--ink-muted);
  font-size: 13px;
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
  font-size: 12px;
  font-weight: 620;
}

.metric strong {
  overflow: hidden;
  color: var(--ink-strong);
  font-size: 17px;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric small {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: 11px;
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
}

.metric--pending > svg {
  background: var(--amber-soft);
}

.today-lead__create {
  min-height: 40px;
  padding-inline: 14px;
  white-space: nowrap;
}

.today-workspace__week,
.today-workspace__list {
  min-height: 0;
}

@media (max-width: 1350px) {
  .today-lead {
    grid-template-columns: minmax(210px, 0.72fr) minmax(0, 2.5fr) auto;
    gap: 11px;
    padding-inline: 18px 16px;
  }

  .today-lead__date h2 {
    font-size: 19px;
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
    font-size: 16px;
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
    grid-template-columns: 200px minmax(0, 2.45fr) auto;
    gap: 9px;
    padding-inline: 16px 14px;
  }

  .today-lead__date h2 {
    font-size: 18px;
  }

  .today-lead__date p {
    font-size: 12px;
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
    font-size: 11px;
  }

  .metric strong {
    font-size: 15px;
  }

  .today-lead__create {
    min-height: 38px;
    padding-inline: 10px;
    font-size: 12px;
  }
}
</style>
