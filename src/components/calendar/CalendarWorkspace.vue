<script setup lang="ts">
import { Info, RotateCcw } from "@lucide/vue";
import { shallowRef, watch } from "vue";
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
</script>

<template>
  <div class="calendar-workspace page-stack">
    <div class="page-toolbar">
      <div class="calendar-legend">
        <span><i class="legend-dot legend-dot--business" />业务预约</span>
        <span><i class="legend-dot legend-dot--entertainment" />娱乐预约</span>
        <span><Info :size="13" />冲突只提醒，不阻止保存</span>
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
}

.calendar-legend {
  display: flex;
  align-items: center;
  gap: 16px;
  color: var(--ink-muted);
  font-size: 10px;
}

.calendar-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.legend-dot--business {
  background: var(--brand);
}

.legend-dot--entertainment {
  background: var(--blue);
}

.calendar-workspace__board {
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
  border: 1px solid #adc6b9;
  border-radius: var(--radius);
  color: var(--brand-strong);
  background: #fff;
  box-shadow: var(--shadow);
  font-size: 11px;
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
</style>
