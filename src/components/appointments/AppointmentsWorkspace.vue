<script setup lang="ts">
import { Plus, Trash2 } from "@lucide/vue";
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { api, errorMessage } from "../../api/client";
import { useAppointments } from "../../composables/useAppointments";
import { useAppointmentPasswordCopy } from "../../composables/useAppointmentPasswordCopy";
import { useUiStore } from "../../stores/ui";
import type {
  Appointment,
  AppointmentFilters,
  AppointmentTableColumnWidths,
} from "../../types/domain";
import {
  appointmentTableColumnWidthsEqual,
  clampAppointmentTableColumnWidth,
  cloneAppointmentTableColumnWidths,
  DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS,
  type AppointmentTableColumnKey,
} from "../../utils/appointmentTableColumns";
import AppointmentFiltersBar from "./AppointmentFiltersBar.vue";
import AppointmentDeleteDialog from "./AppointmentDeleteDialog.vue";
import AppointmentTable from "./AppointmentTable.vue";
import AccountVaultUnlockDialog from "../accounts/AccountVaultUnlockDialog.vue";

const ui = useUiStore();
const { filters, items, loading, error, load } = useAppointments();
const passwordCopy = useAppointmentPasswordCopy();
const selectedIds = ref<string[]>([]);
const selectedCount = computed(() => selectedIds.value.length);
const columnWidths = shallowRef<AppointmentTableColumnWidths>(
  cloneAppointmentTableColumnWidths(DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS),
);
const persistedColumnWidths = shallowRef<AppointmentTableColumnWidths>(
  cloneAppointmentTableColumnWidths(DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS),
);
const savingColumnWidths = shallowRef(false);
const deleteTarget = shallowRef<Appointment | null>(null);
const deleteOperationPending = shallowRef(false);

async function loadColumnWidths(): Promise<void> {
  try {
    const settings = await api.getSettings();
    const widths = cloneAppointmentTableColumnWidths(settings.appointmentTableColumnWidths);
    columnWidths.value = widths;
    persistedColumnWidths.value = cloneAppointmentTableColumnWidths(widths);
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

function previewColumnWidth(columnKey: AppointmentTableColumnKey, width: number): void {
  columnWidths.value = {
    ...columnWidths.value,
    [columnKey]: clampAppointmentTableColumnWidth(columnKey, width),
  };
}

function cancelColumnResize(columnKey: AppointmentTableColumnKey, width: number): void {
  previewColumnWidth(columnKey, width);
}

async function persistColumnWidths(nextWidths: AppointmentTableColumnWidths): Promise<void> {
  if (savingColumnWidths.value) return;
  const normalized = cloneAppointmentTableColumnWidths(nextWidths);
  if (appointmentTableColumnWidthsEqual(normalized, persistedColumnWidths.value)) return;

  const previous = cloneAppointmentTableColumnWidths(persistedColumnWidths.value);
  savingColumnWidths.value = true;
  try {
    const saved = await api.updateAppointmentTableColumnWidths(normalized);
    columnWidths.value = cloneAppointmentTableColumnWidths(saved);
    persistedColumnWidths.value = cloneAppointmentTableColumnWidths(saved);
  } catch (cause) {
    columnWidths.value = previous;
    ui.notify(errorMessage(cause), "danger");
  } finally {
    savingColumnWidths.value = false;
  }
}

function commitColumnWidth(columnKey: AppointmentTableColumnKey, width: number): void {
  const next = {
    ...columnWidths.value,
    [columnKey]: clampAppointmentTableColumnWidth(columnKey, width),
  };
  columnWidths.value = next;
  void persistColumnWidths(next);
}

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
  const action = async () => {
    const result = await api.duplicateAppointment(appointment.id);
    ui.markDataChanged();
    await load();
    ui.openEditAppointment(result.appointment);
    ui.notify("已复制预约，请确认日期和时间", "success");
  };
  try {
    if (appointment.account?.passwordAvailable) {
      await passwordCopy.runWhenUnlocked(action);
    } else {
      await passwordCopy.runWithUnlockRetry(action);
    }
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function copyAccount(appointment: Appointment): Promise<void> {
  try {
    await api.copyAppointmentAccountName(appointment.id);
    ui.notify("账号已复制", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

function requestDelete(appointment: Appointment): void {
  if (deleteOperationPending.value) return;
  deleteTarget.value = appointment;
}

function closeDeleteDialog(): void {
  if (!deleteOperationPending.value) deleteTarget.value = null;
}

async function cancelFromDialog(): Promise<void> {
  const appointment = deleteTarget.value;
  if (!appointment || appointment.serviceStatus === "cancelled" || deleteOperationPending.value) {
    return;
  }
  deleteOperationPending.value = true;
  try {
    await api.setAppointmentServiceStatus(appointment.id, "cancelled");
    ui.markDataChanged();
    await load();
    ui.notify("预约已取消，历史记录仍会保留", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    deleteOperationPending.value = false;
    deleteTarget.value = null;
  }
}

async function removeFromDialog(): Promise<void> {
  const appointment = deleteTarget.value;
  if (!appointment || deleteOperationPending.value) return;
  deleteTarget.value = null;
  deleteOperationPending.value = true;
  const action = async () => {
    try {
      await api.deleteAppointment(appointment.id);
      selectedIds.value = selectedIds.value.filter((id) => id !== appointment.id);
      ui.markDataChanged();
      await load();
      ui.notify("预约已永久删除", "success");
    } catch (cause) {
      ui.notify(errorMessage(cause), "danger");
    }
  };
  try {
    if (appointment.account?.passwordAvailable) {
      await passwordCopy.runWhenUnlocked(action);
    } else {
      await action();
    }
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    deleteOperationPending.value = false;
  }
}

async function removeBatch(): Promise<void> {
  if (selectedCount.value === 0) return;
  if (!globalThis.confirm(`确定永久删除选中的 ${selectedCount.value} 条预约吗？`)) return;
  const ids = [...selectedIds.value];
  const action = async () => {
    try {
      const deletedCount = await api.deleteAppointments(ids);
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
  };
  const needsVault = items.value.some(
    (item) => ids.includes(item.id) && item.account?.passwordAvailable,
  );
  if (needsVault) {
    try {
      await passwordCopy.runWhenUnlocked(action);
    } catch (cause) {
      ui.notify(errorMessage(cause), "danger");
    }
  } else {
    await action();
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

onMounted(loadColumnWidths);
</script>

<template>
  <div class="appointments-workspace page-stack">
    <div class="page-toolbar appointments-workspace__toolbar">
      <AppointmentFiltersBar :filters="filters" @apply="applyFilters" @reset="resetFilters" />
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
      :column-widths="columnWidths"
      :saving-column-widths="savingColumnWidths"
      v-model:selected-ids="selectedIds"
      @edit="ui.openEditAppointment"
      @duplicate="duplicate"
      @copy-account="copyAccount"
      @copy-password="passwordCopy.copy($event.id)"
      @delete="requestDelete"
      @preview-column-width="previewColumnWidth"
      @commit-column-width="commitColumnWidth"
      @cancel-column-resize="cancelColumnResize"
    />
    <AppointmentDeleteDialog
      :open="deleteTarget !== null"
      :appointment="deleteTarget"
      :busy="deleteOperationPending"
      @close="closeDeleteDialog"
      @cancel-appointment="cancelFromDialog"
      @permanent-delete="removeFromDialog"
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
