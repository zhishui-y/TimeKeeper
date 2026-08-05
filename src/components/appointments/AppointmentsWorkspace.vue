<script setup lang="ts">
import { Trash2 } from "@lucide/vue";
import { computed, onMounted, shallowRef, watch } from "vue";
import { api, errorMessage } from "../../api/client";
import { useAppointmentPage } from "../../composables/useAppointmentPage";
import { useAppointmentRouteFilters } from "../../composables/useAppointmentRouteFilters";
import { useAppointmentSelection } from "../../composables/useAppointmentSelection";
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
import { duplicateAppointmentDraft } from "../../utils/appointment";
import AppointmentDeleteDialog from "./AppointmentDeleteDialog.vue";
import AppointmentFiltersBar from "./AppointmentFiltersBar.vue";
import AppointmentPagination from "./AppointmentPagination.vue";
import AppointmentTable from "./AppointmentTable.vue";

const ui = useUiStore();
const routeFilters = useAppointmentRouteFilters();
const history = useAppointmentPage(routeFilters.initialFilters, { pageSize: 100 });
const selection = useAppointmentSelection();
const columnWidths = shallowRef<AppointmentTableColumnWidths>(
  cloneAppointmentTableColumnWidths(DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS),
);
const persistedColumnWidths = shallowRef<AppointmentTableColumnWidths>(
  cloneAppointmentTableColumnWidths(DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS),
);
const savingColumnWidths = shallowRef(false);
const deleteTarget = shallowRef<Appointment | null>(null);
const deleteOperationPending = shallowRef(false);
const batchDeletePending = shallowRef(false);

const currentPageSelectedIds = computed(() =>
  history.items.value.filter((item) => selection.isSelected(item.id)).map((item) => item.id),
);
const allSelected = computed(
  () => history.totalCount.value > 0 && selection.selectedCount.value === history.totalCount.value,
);
const selectionIndeterminate = computed(
  () => selection.selectedCount.value > 0 && !allSelected.value,
);
const operationBusy = computed(
  () => deleteOperationPending.value || batchDeletePending.value || selection.selectingAll.value,
);

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
  const validationError = await routeFilters.replaceFilters(next);
  if (validationError) ui.notify(validationError, "warning");
}

async function resetFilters(): Promise<void> {
  await routeFilters.resetFilters();
}

async function changePage(page: number): Promise<void> {
  await history.goToPage(page);
}

async function toggleAll(selected: boolean): Promise<void> {
  if (!selected) {
    selection.clear();
    return;
  }
  const succeeded = await selection.selectAll(history.filters);
  if (!succeeded && selection.error.value) ui.notify(selection.error.value, "danger");
}

function duplicate(appointment: Appointment): void {
  ui.openDuplicateAppointment(duplicateAppointmentDraft(appointment));
  ui.notify("已复制到今日的新建预约，请确认后保存", "success");
}

async function copyAccount(appointment: Appointment): Promise<void> {
  try {
    await api.copyAppointmentAccountName(appointment.id);
    ui.notify("账号已复制", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function copyPassword(appointment: Appointment): Promise<void> {
  try {
    await api.copyAppointmentAccountPassword(appointment.id);
    ui.notify("账号密码已复制，30秒后自动清空剪贴板", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function copyVoiceChannel(appointment: Appointment): Promise<void> {
  try {
    await api.copyAppointmentVoiceChannel(appointment.id);
    ui.notify("YY频道号已复制", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

function requestDelete(appointment: Appointment): void {
  if (operationBusy.value) return;
  deleteTarget.value = appointment;
}

function closeDeleteDialog(): void {
  if (!deleteOperationPending.value) deleteTarget.value = null;
}

async function cancelFromDialog(): Promise<void> {
  const appointment = deleteTarget.value;
  if (!appointment || appointment.serviceStatus === "cancelled" || operationBusy.value) return;
  deleteOperationPending.value = true;
  try {
    await api.setAppointmentServiceStatus(appointment.id, "cancelled");
    deleteTarget.value = null;
    ui.markDataChanged();
    ui.notify("预约已取消，历史记录仍会保留", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    deleteOperationPending.value = false;
  }
}

async function removeFromDialog(): Promise<void> {
  const appointment = deleteTarget.value;
  if (!appointment || operationBusy.value) return;
  deleteOperationPending.value = true;
  try {
    await api.deleteAppointment(appointment.id);
    selection.removeId(appointment.id);
    deleteTarget.value = null;
    ui.markDataChanged();
    ui.notify("预约已永久删除", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    deleteOperationPending.value = false;
  }
}

async function removeBatch(): Promise<void> {
  if (selection.selectedCount.value === 0 || operationBusy.value) return;
  if (!globalThis.confirm(`确定永久删除选中的 ${selection.selectedCount.value} 条预约吗？`)) {
    return;
  }
  const deleteSelection = selection.deleteSelection();
  if (!deleteSelection) return;

  batchDeletePending.value = true;
  try {
    const result = await api.deleteAppointments(deleteSelection);
    selection.clear();
    ui.markDataChanged();
    ui.notify(
      result.deletedCount > 0
        ? `已永久删除 ${result.deletedCount} 条预约`
        : `匹配 ${result.matchedCount} 条，但没有可删除的预约`,
      result.deletedCount > 0 ? "success" : "warning",
    );
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    batchDeletePending.value = false;
  }
}

watch(routeFilters.filters, (filters) => {
  selection.clear();
  void history.applyFilters(filters);
});

watch(
  () => ui.dataRevision,
  () => {
    selection.clear();
    void history.reloadAfterDeletion();
  },
);

onMounted(loadColumnWidths);
</script>

<template>
  <div class="appointments-workspace page-stack">
    <div class="page-toolbar appointments-workspace__toolbar">
      <AppointmentFiltersBar
        :filters="history.filters"
        @apply="applyFilters"
        @reset="resetFilters"
      />
      <button
        class="button button--ghost"
        type="button"
        :disabled="selection.selectedCount.value === 0 || operationBusy"
        :aria-busy="batchDeletePending"
        @click="removeBatch"
      >
        <Trash2 :size="15" />
        {{ batchDeletePending ? "正在删除…" : "批量删除" }}
      </button>
    </div>
    <div class="result-line">
      <span>共 {{ history.totalCount.value }} 条记录</span>
      <span v-if="selection.selectedCount.value > 0">
        {{ selection.selectedCount.value }} 条已选中
        <template v-if="selection.snapshot.value">（全部筛选结果）</template>
      </span>
      <span v-else>取消记录默认保留，可筛选后回顾</span>
    </div>
    <div v-if="history.error.value" class="error-banner">{{ history.error.value }}</div>
    <div class="appointments-workspace__table-region">
      <div
        v-show="history.loading.value"
        class="loading-line appointments-workspace__loading"
        aria-hidden="true"
      />
      <AppointmentTable
        :appointments="history.items.value"
        :column-widths="columnWidths"
        :saving-column-widths="savingColumnWidths"
        :selected-ids="currentPageSelectedIds"
        :all-selected="allSelected"
        :selection-indeterminate="selectionIndeterminate"
        :selecting-all="selection.selectingAll.value"
        @toggle-all="toggleAll"
        @toggle-one="selection.toggleOne"
        @edit="ui.openEditAppointment"
        @settle="ui.openSettleAppointment"
        @duplicate="duplicate"
        @copy-account="copyAccount"
        @copy-voice-channel="copyVoiceChannel"
        @copy-password="copyPassword"
        @delete="requestDelete"
        @preview-column-width="previewColumnWidth"
        @commit-column-width="commitColumnWidth"
        @cancel-column-resize="cancelColumnResize"
      />
    </div>
    <AppointmentPagination
      :page="history.page.value"
      :page-size="history.pageSize.value"
      :total-pages="history.totalPages.value"
      :total-count="history.totalCount.value"
      :loading="history.loading.value"
      @change-page="changePage"
    />
    <AppointmentDeleteDialog
      :open="deleteTarget !== null"
      :appointment="deleteTarget"
      :busy="deleteOperationPending"
      @close="closeDeleteDialog"
      @cancel-appointment="cancelFromDialog"
      @permanent-delete="removeFromDialog"
    />
  </div>
</template>

<style scoped>
.appointments-workspace {
  height: 100%;
  gap: 10px;
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

.appointments-workspace__table-region {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
}

.appointments-workspace__loading {
  position: absolute;
  z-index: 4;
  top: 0;
  right: 0;
  left: 0;
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
