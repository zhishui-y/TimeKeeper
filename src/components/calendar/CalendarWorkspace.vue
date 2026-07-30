<script setup lang="ts">
import { Info, RotateCcw } from "@lucide/vue";
import { onBeforeUnmount, shallowRef, watch } from "vue";
import { api, errorMessage } from "../../api/client";
import { useAppointments } from "../../composables/useAppointments";
import { useUiStore } from "../../stores/ui";
import type { Appointment, AppointmentInput } from "../../types/domain";
import { appointmentToInput, rescheduledInput } from "../../utils/appointment";
import CalendarBoard from "./CalendarBoard.vue";

interface ReschedulePayload {
  appointment: Appointment;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  revert: () => void;
}

interface UndoState {
  id: string;
  input: AppointmentInput;
}

const ui = useUiStore();
const { items, loading, error, load } = useAppointments();
const undoState = shallowRef<UndoState | null>(null);
let undoTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

async function reschedule(payload: ReschedulePayload): Promise<void> {
  const previous = appointmentToInput(payload.appointment);
  try {
    const result = await api.updateAppointment(
      payload.appointment.id,
      rescheduledInput(payload.appointment, payload.startsAt, payload.endsAt, payload.allDay),
    );
    undoState.value = { id: payload.appointment.id, input: previous };
    globalThis.clearTimeout(undoTimer);
    undoTimer = globalThis.setTimeout(() => (undoState.value = null), 7000);
    ui.markDataChanged();
    await load();
    if (result.conflicts.length) {
      ui.notify(`时间已调整，但与 ${result.conflicts.length} 条预约重叠`, "warning");
    } else {
      ui.notify("预约时间已调整", "success");
    }
  } catch (cause) {
    payload.revert();
    ui.notify(errorMessage(cause), "danger");
  }
}

async function undo(): Promise<void> {
  if (!undoState.value) return;
  try {
    await api.updateAppointment(undoState.value.id, undoState.value.input);
    undoState.value = null;
    ui.markDataChanged();
    await load();
    ui.notify("已撤销时间调整", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

watch(
  () => ui.dataRevision,
  () => void load(),
);

onBeforeUnmount(() => {
  if (undoTimer !== undefined) globalThis.clearTimeout(undoTimer);
});
</script>

<template>
  <div class="calendar-workspace page-stack">
    <div class="page-toolbar">
      <div class="calendar-legend" aria-label="日历颜色说明">
        <span class="legend-item--scheduled">
          <i class="legend-dot" />
          已预约
        </span>
        <span class="legend-item--in-progress">
          <i class="legend-dot" />
          进行中
        </span>
        <span class="legend-item--completed">
          <i class="legend-dot" />
          已完成
        </span>
        <span class="legend-item--cancelled">
          <i class="legend-dot" />
          已取消
        </span>
        <span class="legend-item--unsettled">
          <i class="legend-settlement-symbol">¥</i>
          待结算
        </span>
        <span class="legend-item--settled">
          <i class="legend-settlement-symbol">¥</i>
          已结算
        </span>
        <span
          class="legend-item--mode"
          title="预约卡片左侧：绿色为业务，蓝色为娱乐"
          aria-label="左侧色条：绿色代表业务，蓝色代表娱乐"
        >
          <i class="legend-bar legend-bar--business" />
          <i class="legend-bar legend-bar--entertainment" />
          业务/娱乐色条
        </span>
        <span class="legend-item--notice">
          <Info :size="13" />
          冲突只提醒，不阻止保存
        </span>
      </div>
      <button class="button button--compact" type="button" @click="ui.openCreateAppointment()">
        新建预约
      </button>
    </div>
    <div v-if="loading" class="loading-line" />
    <div v-if="error" class="error-banner">{{ error }}</div>
    <CalendarBoard
      class="calendar-workspace__board"
      :appointments="items"
      @edit="ui.openEditAppointment"
      @create="(date, startTime) => ui.openCreateAppointment(date, startTime)"
      @reschedule="reschedule"
    />
    <Transition name="undo">
      <button v-if="undoState" class="undo-bar" type="button" @click="undo">
        <RotateCcw :size="15" />
        撤销刚才的时间调整
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.calendar-workspace {
  position: relative;
  height: 100%;
  min-height: 0;
  gap: 12px;
}

.calendar-workspace > .page-toolbar {
  min-height: 42px;
}

.calendar-legend {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  color: var(--ink-muted);
  font-size: 12px;
}

.calendar-legend span {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  box-shadow: var(--shadow-control, none);
  white-space: nowrap;
}

.calendar-legend .legend-item--scheduled {
  border-color: var(--blue-border);
  color: #365d70;
  background: var(--blue-soft);
}

.calendar-legend .legend-item--in-progress {
  border-color: var(--amber-border);
  color: #815414;
  background: var(--amber-soft);
}

.calendar-legend .legend-item--completed {
  border-color: var(--brand-border);
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.calendar-legend .legend-item--cancelled {
  color: var(--ink-muted);
  background: var(--neutral-soft);
}

.calendar-legend .legend-item--unsettled {
  border-color: var(--amber-border);
  border-style: dashed;
  color: #815414;
  background: var(--surface);
}

.calendar-legend .legend-item--settled {
  border-color: var(--brand-border);
  border-style: dashed;
  color: var(--brand-strong);
  background: var(--surface);
}

.calendar-legend .legend-item--mode,
.calendar-legend .legend-item--notice {
  color: var(--ink);
  background: var(--surface-soft);
}

.legend-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 3px;
  background: currentColor;
}

.legend-bar {
  width: 3px;
  height: 13px;
  flex: 0 0 3px;
  border-radius: 999px;
}

.legend-bar--business {
  background: var(--brand);
}

.legend-bar--entertainment {
  margin-left: -3px;
  background: var(--blue);
}

.legend-settlement-symbol {
  font-family: "Bahnschrift", var(--font-sans);
  font-size: 11px;
  font-style: normal;
  font-weight: 750;
}

.calendar-workspace__board {
  min-height: 0;
  flex: 1;
}

.undo-bar {
  position: absolute;
  right: 18px;
  bottom: 18px;
  display: inline-flex;
  height: 38px;
  align-items: center;
  gap: 7px;
  padding: 0 13px;
  border: 1px solid var(--brand-border, var(--line-strong));
  border-radius: var(--radius-sm, var(--radius));
  color: var(--brand-strong);
  background: var(--surface);
  box-shadow: var(--shadow);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.undo-enter-active,
.undo-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}

.undo-enter-from,
.undo-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

@media (max-width: 1180px) {
  .calendar-workspace {
    gap: 10px;
  }

  .calendar-legend {
    gap: 6px;
  }

  .calendar-legend span {
    padding-inline: 7px;
    font-size: 11px;
  }

  .calendar-legend .legend-item--mode {
    display: none;
  }
}
</style>
