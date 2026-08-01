<script setup lang="ts">
import type { DeepReadonly } from "vue";
import type { Appointment } from "../../types/domain";
import { formatCurrency, formatTimeRange, modeLabels } from "../../utils/formatters";
import StatusBadge from "../common/StatusBadge.vue";

defineProps<{
  appointments: DeepReadonly<Appointment[]>;
  loading: boolean;
  error: string | null;
}>();
</script>

<template>
  <section class="day-appointments">
    <header>
      <div>
        <span class="section-kicker">SCHEDULE</span>
        <h3>当日预约情况</h3>
      </div>
      <span>{{ appointments.length }} 场</span>
    </header>

    <div v-if="loading" class="loading-line" />
    <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
    <div v-if="appointments.length" class="day-appointments__list">
      <article v-for="appointment in appointments" :key="appointment.id" class="day-appointment">
        <time class="day-appointment__time mono-number">
          {{ formatTimeRange(appointment.startsAt, appointment.endsAt) }}
        </time>
        <div class="day-appointment__main">
          <strong>{{ appointment.contactName }}</strong>
          <span>{{ appointment.content || "未填写预约内容" }}</span>
          <small>{{ appointment.accountSnapshot?.accountName || "未关联账号" }}</small>
        </div>
        <div class="day-appointment__status">
          <span class="day-appointment__mode" :class="`is-${appointment.mode}`">
            {{ modeLabels[appointment.mode] }}
          </span>
          <StatusBadge :service-status="appointment.serviceStatus" />
        </div>
        <div class="day-appointment__billing">
          <strong v-if="appointment.mode === 'business'" class="mono-number">
            {{ formatCurrency(appointment.amountMinor) }}
          </strong>
          <span v-else>无需结算</span>
          <StatusBadge
            v-if="appointment.mode === 'business'"
            :settlement-status="appointment.settlementStatus"
          />
        </div>
      </article>
    </div>
    <div v-else-if="!loading && !error" class="day-appointments__empty">当天没有预约</div>
  </section>
</template>

<style scoped>
.day-appointments {
  margin-top: 16px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 16px);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.day-appointments > header {
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-soft) 82%, transparent);
}

.day-appointments h3 {
  margin-top: 1px;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: 14px;
}

.day-appointments > header > span {
  color: var(--ink-muted);
  font-size: 10px;
}

.day-appointments__list {
  display: flex;
  flex-direction: column;
}

.day-appointment {
  display: grid;
  min-height: 82px;
  grid-template-columns: 96px minmax(150px, 1fr) 128px 112px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}

.day-appointment:last-child {
  border-bottom: 0;
}

.day-appointment__time {
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 700;
}

.day-appointment__main,
.day-appointment__status,
.day-appointment__billing {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.day-appointment__main strong,
.day-appointment__main span,
.day-appointment__main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.day-appointment__main strong {
  color: var(--ink-strong);
  font-size: 13px;
}

.day-appointment__main span {
  color: var(--ink);
  font-size: 11px;
}

.day-appointment__main small {
  color: var(--ink-muted);
  font-size: 10px;
}

.day-appointment__status,
.day-appointment__billing {
  align-items: flex-start;
}

.day-appointment__billing {
  align-items: flex-end;
}

.day-appointment__billing > strong {
  color: var(--ink-strong);
  font-size: 12px;
}

.day-appointment__billing > span {
  color: var(--ink-muted);
  font-size: 10px;
}

.day-appointment__mode {
  color: var(--brand-strong);
  font-size: 10px;
  font-weight: 700;
}

.day-appointment__mode.is-entertainment {
  color: var(--blue);
}

.day-appointments__empty {
  display: grid;
  min-height: 180px;
  place-items: center;
  color: var(--ink-muted);
  font-size: 12px;
}

@media (max-width: 680px) {
  .day-appointment {
    grid-template-columns: 88px minmax(120px, 1fr) 110px;
  }

  .day-appointment__billing {
    display: none;
  }
}
</style>
