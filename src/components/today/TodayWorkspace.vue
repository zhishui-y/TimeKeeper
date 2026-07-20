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
import { useDashboard } from "../../composables/useDashboard";
import { useUiStore } from "../../stores/ui";
import type { Appointment, ServiceStatus } from "../../types/domain";
import { formatCurrency, formatDateHeading, formatTimeRange } from "../../utils/formatters";
import TodayAppointmentList from "./TodayAppointmentList.vue";
import WeekSchedule from "./WeekSchedule.vue";

const today = new Date();
const todayKey = format(today, "yyyy-MM-dd");
const weekStart = startOfWeek(today, { weekStartsOn: 1 });
const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
const ui = useUiStore();
const {
  items,
  loading,
  error,
  load: loadAppointments,
} = useAppointments({
  from: format(weekStart, "yyyy-MM-dd"),
  to: format(weekEnd, "yyyy-MM-dd"),
});
const dashboard = useDashboard();
const now = shallowRef(new Date());
let clockTimer: ReturnType<typeof globalThis.setInterval> | undefined;

const todayAppointments = computed(() =>
  items.value.filter((item) => item.serviceDate === todayKey && item.serviceStatus !== "cancelled"),
);

const weekDays = computed(() =>
  Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const dateKey = format(date, "yyyy-MM-dd");
    return {
      date: dateKey,
      weekday: format(date, "EEE", { locale: zhCN }),
      dayNumber: format(date, "d"),
      isToday: isSameDay(date, today),
      appointments: items.value.filter((item) => item.serviceDate === dateKey),
    };
  }),
);

const nextCountdown = computed(() => {
  const next = dashboard.summary.value?.nextAppointment;
  if (!next?.startsAt) return "暂无待开始预约";
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
  await Promise.all([loadAppointments(), dashboard.load(todayKey)]);
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

watch(
  () => ui.dataRevision,
  () => void refresh(),
);

onMounted(() => {
  void dashboard.load(todayKey);
  clockTimer = globalThis.setInterval(() => {
    now.value = new Date();
  }, 30_000);
});

onUnmounted(() => globalThis.clearInterval(clockTimer));
</script>

<template>
  <div class="today-workspace page-stack">
    <div v-if="loading || dashboard.loading.value" class="loading-line" />
    <div v-if="error || dashboard.error.value" class="error-banner">
      {{ error || dashboard.error.value }}
    </div>

    <section class="today-lead">
      <div class="today-lead__date">
        <span class="section-kicker">{{ format(today, "yyyy · MM") }}</span>
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
            <span>待结金额</span>
            <strong class="mono-number">{{
              formatCurrency(dashboard.summary.value?.pendingMinor)
            }}</strong>
            <small>不计入已结收益</small>
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
      @edit="ui.openEditAppointment"
      @create="ui.openCreateAppointment"
    />

    <TodayAppointmentList
      class="today-workspace__list"
      :appointments="todayAppointments"
      @edit="ui.openEditAppointment"
      @change-status="changeStatus"
    />
  </div>
</template>

<style scoped>
.today-workspace {
  position: relative;
  height: 100%;
  display: grid;
  grid-template-rows: 136px minmax(185px, 0.9fr) minmax(190px, 1.1fr);
  gap: 12px;
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
  display: grid;
  min-height: 136px;
  grid-template-columns: minmax(190px, 0.72fr) minmax(570px, 2.5fr) auto;
  align-items: center;
  gap: 18px;
  padding: 18px 18px 18px 20px;
  border: 1px solid var(--line);
  border-left: 4px solid var(--brand);
  border-radius: var(--radius);
  background: #f8faf7;
}

.today-lead__date h2 {
  margin-top: 5px;
  color: var(--ink-strong);
  font-family: "STSong", "SimSun", serif;
  font-size: 21px;
  font-weight: 700;
  white-space: nowrap;
}

.today-lead__date p {
  margin-top: 6px;
  color: var(--ink-muted);
  font-size: 12px;
}

.metric-grid {
  display: grid;
  height: 86px;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.metric {
  display: grid;
  min-width: 0;
  grid-template-columns: 20px minmax(0, 1fr);
  align-content: center;
  gap: 9px;
  padding: 12px;
  border-right: 1px solid var(--line);
  color: var(--brand);
}

.metric:last-child {
  border-right: 0;
}

.metric > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.metric span {
  color: var(--ink-muted);
  font-size: 12px;
}

.metric strong {
  overflow: hidden;
  color: var(--ink-strong);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric small {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric--next {
  color: var(--blue);
}

.metric--pending {
  color: var(--amber);
}

.today-lead__create {
  white-space: nowrap;
}

.today-workspace__week,
.today-workspace__list {
  min-height: 0;
}

@media (max-width: 1350px) {
  .today-lead {
    grid-template-columns: minmax(230px, 0.8fr) minmax(500px, 2.5fr);
  }

  .today-lead__date h2 {
    font-size: 18px;
  }

  .today-lead__create {
    display: none;
  }

  .metric {
    padding: 9px;
  }
}

@media (max-height: 760px) {
  .today-workspace {
    grid-template-rows: 136px minmax(200px, 1fr) minmax(160px, 1fr);
  }
}
</style>
