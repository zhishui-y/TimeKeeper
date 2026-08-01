<script setup lang="ts">
import { CheckCircle2, CircleDollarSign, Pencil, Play, Trash2 } from "@lucide/vue";
import type { Appointment, ServiceStatus } from "../../types/domain";
import { formatCurrency, formatTimeRange } from "../../utils/formatters";
import StatusBadge from "../common/StatusBadge.vue";

defineProps<{
  appointments: readonly Appointment[];
  nextAppointmentId?: string | null;
  kicker: string;
  heading: string;
}>();

const emit = defineEmits<{
  edit: [appointment: Appointment];
  settle: [appointment: Appointment];
  changeStatus: [appointment: Appointment, status: ServiceStatus];
  delete: [appointment: Appointment];
}>();
</script>

<template>
  <section class="today-list">
    <header class="today-list__header">
      <div>
        <span class="section-kicker">{{ kicker }}</span>
        <h2>{{ heading }}</h2>
      </div>
      <span>{{ appointments.length }} 场</span>
    </header>
    <div v-if="appointments.length" class="today-list__body">
      <article
        v-for="appointment in appointments"
        :key="appointment.id"
        class="appointment-row"
        :class="{ 'appointment-row--next': appointment.id === nextAppointmentId }"
      >
        <time class="appointment-row__time mono-number">
          {{ formatTimeRange(appointment.startsAt, appointment.endsAt) }}
        </time>
        <span class="appointment-row__marker" :class="`is-${appointment.mode}`" />
        <div class="appointment-row__main">
          <div class="appointment-row__title">
            <strong>{{ appointment.contactName }}</strong>
            <span v-if="appointment.id === nextAppointmentId" class="appointment-row__next">
              下一时段
            </span>
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
            @click="emit('settle', appointment)"
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
          <button
            class="icon-button appointment-row__delete"
            type="button"
            title="删除"
            aria-label="删除预约"
            @click="emit('delete', appointment)"
          >
            <Trash2 :size="15" />
          </button>
        </div>
      </article>
    </div>
    <div v-else class="today-list__empty">当日没有预约</div>
  </section>
</template>

<style scoped>
.today-list {
  display: grid;
  min-height: 0;
  grid-template-rows: 54px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, var(--radius));
  background: var(--surface);
  box-shadow: var(--shadow-sm, var(--shadow-soft));
}

.today-list__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(90deg, var(--surface-soft), var(--surface));
}

.today-list__header h2 {
  margin-top: 2px;
  color: var(--ink-strong);
  font-size: 16px;
  line-height: 1.2;
}

.today-list__header > span {
  padding: 4px 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink);
  background: var(--surface);
  font-size: 12px;
  font-weight: 650;
}

.today-list__body {
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}

.appointment-row {
  display: grid;
  min-height: 72px;
  grid-template-columns: 96px 4px minmax(140px, 1fr) 96px 104px;
  align-items: center;
  gap: 12px;
  padding: 9px 11px 9px 18px;
  border-bottom: 1px solid var(--line);
  transition: background-color 140ms ease;
}

.appointment-row:last-child {
  border-bottom: 0;
}

.appointment-row:hover {
  background: var(--surface-soft);
}

.appointment-row--next {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--gold-soft) 84%, var(--surface)),
    color-mix(in srgb, var(--surface) 97%, var(--gold-soft)) 58%
  );
  box-shadow: inset 4px 0 0 var(--gold);
}

.appointment-row--next:hover {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--gold-soft) 94%, var(--surface)),
    color-mix(in srgb, var(--surface) 94%, var(--gold-soft)) 62%
  );
}

.appointment-row--next .appointment-row__time {
  color: var(--gold-strong);
}

.appointment-row__time {
  color: var(--ink-strong);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.appointment-row__marker {
  width: 3px;
  height: 38px;
  border-radius: 999px;
  background: var(--brand);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-soft) 72%, transparent);
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
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.appointment-row__next {
  flex: 0 0 auto;
  padding: 2px 7px;
  border: 1px solid var(--gold-border);
  border-radius: 999px;
  color: var(--gold-strong);
  background: color-mix(in srgb, var(--gold-soft) 92%, var(--surface));
  font-size: 10px;
  font-weight: 750;
  line-height: 1.25;
}

.appointment-row__main p {
  margin-top: 4px;
  overflow: hidden;
  color: var(--ink-muted);
  font-size: 12px;
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
  font-size: 13px;
}

.appointment-row__amount > span {
  color: var(--blue);
  font-size: 12px;
  font-weight: 650;
}

.appointment-row__actions {
  display: flex;
  gap: 2px;
  justify-content: flex-end;
}

.appointment-row__delete {
  color: var(--danger);
}

.appointment-row__delete:hover {
  border-color: color-mix(in srgb, var(--danger) 38%, var(--line));
  background: color-mix(in srgb, var(--danger) 8%, var(--surface));
}

.today-list__empty {
  display: grid;
  min-height: 0;
  place-items: center;
  color: var(--ink-muted);
  background: radial-gradient(circle at center, var(--brand-soft), transparent 66%);
  font-size: 13px;
}

@media (max-width: 1180px) {
  .today-list__header {
    padding-inline: 15px;
  }

  .appointment-row {
    min-height: 68px;
    grid-template-columns: 90px 4px minmax(120px, 1fr) 88px 96px;
    gap: 9px;
    padding-inline: 15px 9px;
  }
}

@media (max-height: 760px) {
  .appointment-row {
    min-height: 66px;
    padding-block: 7px;
  }
}
</style>
