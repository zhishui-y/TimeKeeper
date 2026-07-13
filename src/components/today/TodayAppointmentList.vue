<script setup lang="ts">
import { CheckCircle2, CircleDollarSign, Pencil, Play } from "@lucide/vue";
import type { Appointment, ServiceStatus } from "../../types/domain";
import { formatCurrency, formatTimeRange } from "../../utils/formatters";
import StatusBadge from "../common/StatusBadge.vue";

defineProps<{
  appointments: readonly Appointment[];
}>();

const emit = defineEmits<{
  edit: [appointment: Appointment];
  changeStatus: [appointment: Appointment, status: ServiceStatus];
}>();
</script>

<template>
  <section class="today-list">
    <header class="today-list__header">
      <div>
        <span class="section-kicker">TODAY</span>
        <h2>今日预约</h2>
      </div>
      <span>{{ appointments.length }} 场</span>
    </header>
    <div v-if="appointments.length" class="today-list__body">
      <article v-for="appointment in appointments" :key="appointment.id" class="appointment-row">
        <time class="appointment-row__time mono-number">
          {{ formatTimeRange(appointment.startsAt, appointment.endsAt) }}
        </time>
        <span class="appointment-row__marker" :class="`is-${appointment.mode}`" />
        <div class="appointment-row__main">
          <div class="appointment-row__title">
            <strong>{{ appointment.contactName }}</strong>
            <StatusBadge :service-status="appointment.serviceStatus" />
          </div>
          <p>{{ appointment.content || "未填写预约内容" }}</p>
        </div>
        <div class="appointment-row__amount">
          <strong v-if="appointment.mode === 'business'" class="mono-number">
            {{ formatCurrency(appointment.amountMinor) }}
          </strong>
          <span v-else>娱乐</span>
          <StatusBadge
            v-if="appointment.mode === 'business'"
            :settlement-status="appointment.settlementStatus"
          />
        </div>
        <div class="appointment-row__actions">
          <button
            v-if="appointment.serviceStatus === 'scheduled'"
            class="icon-button"
            type="button"
            title="开始"
            aria-label="开始预约"
            @click="emit('changeStatus', appointment, 'in_progress')"
          >
            <Play :size="15" />
          </button>
          <button
            v-if="appointment.serviceStatus === 'in_progress'"
            class="icon-button"
            type="button"
            title="完成"
            aria-label="完成预约"
            @click="emit('changeStatus', appointment, 'completed')"
          >
            <CheckCircle2 :size="15" />
          </button>
          <button
            v-if="
              appointment.serviceStatus === 'completed' &&
              appointment.settlementStatus === 'unsettled'
            "
            class="icon-button"
            type="button"
            title="去结算"
            aria-label="编辑结算"
            @click="emit('edit', appointment)"
          >
            <CircleDollarSign :size="15" />
          </button>
          <button
            class="icon-button"
            type="button"
            title="编辑"
            aria-label="编辑预约"
            @click="emit('edit', appointment)"
          >
            <Pencil :size="15" />
          </button>
        </div>
      </article>
    </div>
    <div v-else class="today-list__empty">今天没有预约</div>
  </section>
</template>

<style scoped>
.today-list {
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.today-list__header {
  display: flex;
  height: 54px;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
}

.today-list__header h2 {
  margin-top: 1px;
  color: var(--ink-strong);
  font-size: 14px;
}

.today-list__header > span {
  color: var(--ink-muted);
  font-size: 10px;
}

.today-list__body {
  max-height: 100%;
  overflow-y: auto;
}

.appointment-row {
  display: grid;
  min-height: 64px;
  grid-template-columns: 90px 4px minmax(140px, 1fr) 90px 66px;
  align-items: center;
  gap: 11px;
  padding: 8px 10px 8px 16px;
  border-bottom: 1px solid #edf0ec;
}

.appointment-row:last-child {
  border-bottom: 0;
}

.appointment-row:hover {
  background: #fafbf9;
}

.appointment-row__time {
  color: var(--ink-strong);
  font-size: 11px;
  font-weight: 650;
}

.appointment-row__marker {
  width: 3px;
  height: 34px;
  border-radius: 2px;
  background: var(--brand);
}

.appointment-row__marker.is-entertainment {
  background: var(--blue);
}

.appointment-row__main {
  min-width: 0;
}

.appointment-row__title {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.appointment-row__title strong {
  overflow: hidden;
  color: var(--ink-strong);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.appointment-row__main p {
  margin-top: 4px;
  overflow: hidden;
  color: var(--ink-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.appointment-row__amount {
  display: flex;
  align-items: flex-end;
  flex-direction: column;
  gap: 4px;
}

.appointment-row__amount strong {
  color: var(--ink-strong);
  font-size: 11px;
}

.appointment-row__amount > span {
  color: var(--blue);
  font-size: 10px;
}

.appointment-row__actions {
  display: flex;
  justify-content: flex-end;
}

.today-list__empty {
  display: grid;
  min-height: 130px;
  place-items: center;
  color: var(--ink-muted);
  font-size: 12px;
}
</style>
