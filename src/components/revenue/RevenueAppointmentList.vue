<script setup lang="ts">
import { computed, toRaw, type DeepReadonly } from "vue";
import type { Appointment } from "../../types/domain";
import { appointmentProgressStatus } from "../../utils/appointmentProgress";
import { formatChinaDate } from "../../utils/chinaDateTime";
import { formatCurrency, formatTimeRange, modeLabels } from "../../utils/formatters";
import StatusBadge from "../common/StatusBadge.vue";

const props = withDefaults(
  defineProps<{
    appointments: DeepReadonly<Appointment[]>;
    loading: boolean;
    error: string | null;
    title?: string;
    emptyMessage?: string;
    showDate?: boolean;
    actionsDisabled?: boolean;
  }>(),
  {
    title: "当日业务预约",
    emptyMessage: "当天没有符合收益口径的业务预约",
    showDate: false,
    actionsDisabled: false,
  },
);

const emit = defineEmits<{
  appointmentSelect: [appointment: Appointment];
}>();

const visibleAppointments = computed(() =>
  props.appointments.filter(
    (appointment) => appointment.mode === "business" && appointment.serviceStatus !== "cancelled",
  ),
);

function selectAppointment(appointment: DeepReadonly<Appointment>): void {
  if (props.actionsDisabled || props.loading || props.error) return;
  emit("appointmentSelect", toRaw(appointment) as Appointment);
}
</script>

<template>
  <section class="revenue-appointments" :class="{ 'revenue-appointments--dated': showDate }">
    <header>
      <div>
        <span class="section-kicker">SCHEDULE</span>
        <h3>{{ title }}</h3>
      </div>
      <span>{{ visibleAppointments.length }} 场</span>
    </header>

    <div v-if="loading" class="loading-line" />
    <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
    <div v-if="visibleAppointments.length" class="revenue-appointments__list">
      <button
        v-for="appointment in visibleAppointments"
        :key="appointment.id"
        class="revenue-appointment"
        type="button"
        :disabled="actionsDisabled || loading || Boolean(error)"
        :aria-label="`编辑${appointment.contactName}的预约`"
        @click="selectAppointment(appointment)"
      >
        <span class="revenue-appointment__time mono-number">
          <strong v-if="showDate">{{
            formatChinaDate(appointment.serviceDate, { year: true })
          }}</strong>
          <span>{{ formatTimeRange(appointment.startsAt, appointment.endsAt) }}</span>
        </span>
        <span class="revenue-appointment__main">
          <strong>{{ appointment.contactName }}</strong>
          <span>{{ appointment.content || "未填写预约内容" }}</span>
          <small>{{ appointment.account?.accountName || "未使用账号" }}</small>
        </span>
        <span class="revenue-appointment__status">
          <span class="revenue-appointment__mode">{{ modeLabels[appointment.mode] }}</span>
          <StatusBadge :progress-status="appointmentProgressStatus(appointment)" />
        </span>
        <span class="revenue-appointment__billing">
          <strong class="mono-number">{{ formatCurrency(appointment.amountMinor) }}</strong>
        </span>
      </button>
    </div>
    <div v-else-if="!loading && !error" class="revenue-appointments__empty">
      {{ emptyMessage }}
    </div>
  </section>
</template>

<style scoped>
.revenue-appointments {
  margin-top: 16px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 16px);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.revenue-appointments > header {
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-soft) 82%, transparent);
}

.revenue-appointments h3 {
  margin-top: 1px;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: calc(14px + var(--app-font-size-offset, 0px));
}

.revenue-appointments > header > span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.revenue-appointments__list {
  display: flex;
  flex-direction: column;
}

.revenue-appointment {
  display: grid;
  width: 100%;
  min-height: 82px;
  grid-template-columns: 96px minmax(150px, 1fr) 128px 112px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 0;
  border-bottom: 1px solid var(--line);
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 140ms ease;
}

.revenue-appointments--dated .revenue-appointment {
  grid-template-columns: 126px minmax(150px, 1fr) 116px 90px;
}

.revenue-appointment:hover:not(:disabled) {
  background: color-mix(in srgb, var(--brand-soft) 42%, transparent);
}

.revenue-appointment:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid var(--brand);
  outline-offset: -2px;
}

.revenue-appointment:disabled {
  cursor: default;
}

.revenue-appointment:last-child {
  border-bottom: 0;
}

.revenue-appointment__time,
.revenue-appointment__main,
.revenue-appointment__status,
.revenue-appointment__billing {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.revenue-appointment__time {
  color: var(--ink-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 700;
}

.revenue-appointment__main > strong,
.revenue-appointment__main > span,
.revenue-appointment__main > small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.revenue-appointment__main > strong {
  color: var(--ink-strong);
  font-size: calc(13px + var(--app-font-size-offset, 0px));
}

.revenue-appointment__main > span {
  color: var(--ink);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.revenue-appointment__main > small {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.revenue-appointment__status,
.revenue-appointment__billing {
  align-items: flex-start;
}

.revenue-appointment__billing {
  align-items: flex-end;
}

.revenue-appointment__billing > strong {
  color: var(--ink-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.revenue-appointment__mode {
  color: var(--brand-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 700;
}

.revenue-appointments__empty {
  display: grid;
  min-height: 180px;
  place-items: center;
  padding: 18px;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  text-align: center;
}

@media (max-width: 680px) {
  .revenue-appointment,
  .revenue-appointments--dated .revenue-appointment {
    grid-template-columns: 112px minmax(120px, 1fr) 100px;
  }

  .revenue-appointment__billing {
    display: none;
  }
}
</style>
