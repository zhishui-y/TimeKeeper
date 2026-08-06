<script setup lang="ts">
import { Info } from "@lucide/vue";
import { format } from "date-fns";
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useAppointments } from "../../composables/useAppointments";
import { useUiStore } from "../../stores/ui";
import { findNextScheduledAppointment } from "../../utils/appointment";
import CalendarBoard from "./CalendarBoard.vue";

const ui = useUiStore();
const { filters, items, loading, error, load } = useAppointments({}, { immediate: false });
const now = shallowRef(new Date());
let clockTimer: ReturnType<typeof globalThis.setInterval> | undefined;

const nextAppointmentId = computed(
  () =>
    findNextScheduledAppointment(
      items.value.filter(
        (appointment) => appointment.serviceDate === format(now.value, "yyyy-MM-dd"),
      ),
      now.value,
    )?.id ?? null,
);

watch(
  () => ui.dataRevision,
  () => {
    if (filters.from && filters.to) void load();
  },
);

function loadRange(from: string, to: string): void {
  if (filters.from === from && filters.to === to && items.value.length > 0) return;
  filters.from = from;
  filters.to = to;
  void load();
}

onMounted(() => {
  clockTimer = globalThis.setInterval(() => {
    now.value = new Date();
  }, 30_000);
});

onBeforeUnmount(() => {
  if (clockTimer !== undefined) globalThis.clearInterval(clockTimer);
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
        <span class="legend-item--pending-settlement">
          <i class="legend-dot" />
          待结算
        </span>
        <span class="legend-item--next">
          <i class="legend-dot" />
          下一时段
        </span>
        <span class="legend-item--completed">
          <i class="legend-dot" />
          已完成
        </span>
        <span class="legend-item--cancelled">
          <i class="legend-dot" />
          已取消
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
    </div>
    <div v-if="loading" class="loading-line" />
    <div v-if="error" class="error-banner">{{ error }}</div>
    <CalendarBoard
      class="calendar-workspace__board"
      :appointments="items"
      :next-appointment-id="nextAppointmentId"
      @edit="ui.openEditAppointment"
      @create="(date, startTime) => ui.openCreateAppointment(date, startTime)"
      @range-change="loadRange"
    />
  </div>
</template>

<style scoped>
.calendar-workspace {
  position: relative;
  height: 100%;
  min-height: 0;
  gap: 12px;
}

.calendar-workspace > .loading-line {
  position: absolute;
  z-index: 4;
  top: 0;
  right: 4px;
  left: 0;
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
  border-color: var(--accent-border);
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.calendar-legend .legend-item--next {
  border-color: var(--gold-border);
  color: var(--gold-strong);
  background: var(--gold-soft);
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

.calendar-legend .legend-item--pending-settlement {
  border-color: var(--amber-border);
  color: #815414;
  background: var(--amber-soft);
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

.calendar-workspace__board {
  min-height: 0;
  flex: 1;
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
    font-size: calc(12px + var(--app-font-size-offset, 0px));
  }

  .calendar-legend .legend-item--mode {
    display: none;
  }
}
</style>
