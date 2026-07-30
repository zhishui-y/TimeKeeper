<script setup lang="ts">
import { Plus, Trash2 } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { api, errorMessage } from "../../api/client";
import { useAccounts } from "../../composables/useAccounts";
import { useAppointments } from "../../composables/useAppointments";
import { useUiStore } from "../../stores/ui";
import type { Appointment, AppointmentFilters } from "../../types/domain";
import AppointmentFiltersBar from "./AppointmentFiltersBar.vue";
import AppointmentTable from "./AppointmentTable.vue";

const ui = useUiStore();
const { filters, items, loading, error, load } = useAppointments();
const { items: accounts } = useAccounts();
const selectedIds = ref<string[]>([]);
const selectedCount = computed(() => selectedIds.value.length);

async function applyFilters(next: AppointmentFilters): Promise<void> {
  selectedIds.value = [];
  Object.keys(filters).forEach((key) => delete filters[key as keyof AppointmentFilters]);
  Object.assign(filters, next);
  await load();
}

async function resetFilters(): Promise<void> {
  selectedIds.value = [];
  Object.keys(filters).forEach((key) => delete filters[key as keyof AppointmentFilters]);
  await load();
}

async function duplicate(appointment: Appointment): Promise<void> {
  try {
    const result = await api.duplicateAppointment(appointment.id);
    ui.markDataChanged();
    await load();
    ui.openEditAppointment(result.appointment);
    ui.notify("已复制预约，请确认日期和时间", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function cancel(appointment: Appointment): Promise<void> {
  try {
    await api.setAppointmentServiceStatus(appointment.id, "cancelled");
    ui.markDataChanged();
    await load();
    ui.notify("预约已取消，历史记录仍会保留", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function remove(appointment: Appointment): Promise<void> {
  if (!globalThis.confirm(`确定永久删除 ${appointment.contactName} 的这条预约吗？`)) return;
  try {
    await api.deleteAppointment(appointment.id);
    selectedIds.value = selectedIds.value.filter((id) => id !== appointment.id);
    ui.markDataChanged();
    await load();
    ui.notify("预约已永久删除", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function removeBatch(): Promise<void> {
  if (selectedCount.value === 0) return;
  if (!globalThis.confirm(`确定永久删除选中的 ${selectedCount.value} 条预约吗？`)) return;
  try {
    const deletedCount = await api.deleteAppointments(selectedIds.value);
    selectedIds.value = [];
    ui.markDataChanged();
    await load();
    if (deletedCount > 0) {
      ui.notify(`已永久删除 ${deletedCount} 条预约`, "success");
    } else {
      ui.notify("未找到可删除的预约", "warning");
    }
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

watch(
  () => items.value,
  (currentItems) => {
    const validIds = new Set(currentItems.map((item) => item.id));
    const next = selectedIds.value.filter((id) => validIds.has(id));
    if (next.length !== selectedIds.value.length) {
      selectedIds.value = next;
    }
  },
);

watch(
  () => ui.dataRevision,
  () => {
    selectedIds.value = [];
    void load();
  },
);
</script>

<template>
  <div class="appointments-workspace page-stack">
    <div class="page-toolbar appointments-workspace__toolbar">
      <AppointmentFiltersBar
        :filters="filters"
        :accounts="accounts"
        @apply="applyFilters"
        @reset="resetFilters"
      />
      <button
        class="button button--ghost"
        type="button"
        @click="removeBatch"
        :disabled="selectedCount === 0"
      >
        <Trash2 :size="15" />
        批量删除
      </button>
      <button class="button button--primary" type="button" @click="ui.openCreateAppointment()">
        <Plus :size="15" />
        新建
      </button>
    </div>
    <div class="result-line">
      <span>共 {{ items.length }} 条记录</span>
      <span v-if="selectedCount > 0">{{ selectedCount }} 条已选中</span>
      <span v-else>取消记录默认保留，可筛选后回顾</span>
    </div>
    <div v-if="loading" class="loading-line" />
    <div v-if="error" class="error-banner">{{ error }}</div>
    <AppointmentTable
      :appointments="items"
      v-model:selected-ids="selectedIds"
      @edit="ui.openEditAppointment"
      @duplicate="duplicate"
      @cancel="cancel"
      @delete="remove"
    />
  </div>
</template>

<style scoped>
.appointments-workspace {
  height: 100%;
  gap: 12px;
}

.appointments-workspace__toolbar {
  min-height: 54px;
  flex: 0 0 54px;
  padding: 7px 9px 7px 11px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 14px);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  box-shadow: var(--shadow-xs, 0 3px 14px rgba(31, 49, 42, 0.04));
}

.result-line {
  display: flex;
  min-height: 20px;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  color: var(--ink-muted);
  font-size: 11px;
}

.result-line span:first-child {
  color: var(--ink);
  font-weight: 650;
}

@media (max-width: 1260px) {
  .appointments-workspace__toolbar {
    min-height: 96px;
    flex-basis: 96px;
    align-items: flex-start;
  }

  .appointments-workspace__toolbar > .button {
    margin-top: 1px;
  }
}
</style>
