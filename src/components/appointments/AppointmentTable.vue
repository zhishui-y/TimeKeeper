<script setup lang="ts">
import { CopyPlus, Pencil, Trash2 } from "@lucide/vue";
import { computed, useTemplateRef, watch } from "vue";
import type { Appointment, AppointmentTableColumnWidths } from "../../types/domain";
import {
  appointmentTableTotalWidth,
  type AppointmentTableColumnKey,
} from "../../utils/appointmentTableColumns";
import {
  formatCompactDate,
  formatCurrency,
  formatTimeRange,
  modeLabels,
} from "../../utils/formatters";
import { appointmentProgressStatus } from "../../utils/appointmentProgress";
import StatusBadge from "../common/StatusBadge.vue";
import AppointmentAccountSummary from "./AppointmentAccountSummary.vue";
import AppointmentColumnResizeHandle from "./AppointmentColumnResizeHandle.vue";
import AppointmentVoiceSummary from "./AppointmentVoiceSummary.vue";

const props = defineProps<{
  appointments: readonly Appointment[];
  columnWidths: AppointmentTableColumnWidths;
  savingColumnWidths: boolean;
  selectedIds: readonly string[];
  allSelected: boolean;
  selectionIndeterminate: boolean;
  selectingAll: boolean;
}>();

const emit = defineEmits<{
  edit: [appointment: Appointment];
  settle: [appointment: Appointment];
  duplicate: [appointment: Appointment];
  delete: [appointment: Appointment];
  copyAccount: [appointment: Appointment];
  copyVoiceChannel: [appointment: Appointment];
  copyPassword: [appointment: Appointment];
  previewColumnWidth: [columnKey: AppointmentTableColumnKey, width: number];
  commitColumnWidth: [columnKey: AppointmentTableColumnKey, width: number];
  cancelColumnResize: [columnKey: AppointmentTableColumnKey, width: number];
  toggleAll: [selected: boolean];
  toggleOne: [appointmentId: string, selected: boolean];
}>();

const allSelectRef = useTemplateRef("all-select");
const selectedIdSet = computed(() => new Set(props.selectedIds));
const tableMinimumWidth = computed(() => appointmentTableTotalWidth(props.columnWidths));

watch(
  () => props.selectionIndeterminate,
  (value) => {
    if (allSelectRef.value) allSelectRef.value.indeterminate = value;
  },
);

function isChecked(event: unknown): boolean {
  const target = (event as { target?: { checked?: boolean } } | null)?.target;
  return target?.checked ?? false;
}

function toggleAll(event: unknown): void {
  emit("toggleAll", isChecked(event));
}

function toggleOne(appointmentId: string, event: unknown): void {
  emit("toggleOne", appointmentId, isChecked(event));
}

function previewColumnWidth(columnKey: AppointmentTableColumnKey, width: number): void {
  emit("previewColumnWidth", columnKey, width);
}

function commitColumnWidth(columnKey: AppointmentTableColumnKey, width: number): void {
  emit("commitColumnWidth", columnKey, width);
}

function cancelColumnResize(columnKey: AppointmentTableColumnKey, width: number): void {
  emit("cancelColumnResize", columnKey, width);
}
</script>

<template>
  <div class="data-surface appointment-table">
    <div v-if="appointments.length" class="table-scroll">
      <table class="data-table" :style="{ minWidth: `${tableMinimumWidth}px` }">
        <colgroup>
          <col style="width: 44px" />
          <col :style="{ width: `${columnWidths.serviceDate}px` }" />
          <col :style="{ width: `${columnWidths.timeRange}px` }" />
          <col :style="{ width: `${columnWidths.contactName}px` }" />
          <col :style="{ width: `${columnWidths.content}px` }" />
          <col :style="{ width: `${columnWidths.account}px` }" />
          <col :style="{ width: `${columnWidths.voice}px` }" />
          <col :style="{ width: `${columnWidths.mode}px` }" />
          <col :style="{ width: `${columnWidths.serviceStatus}px` }" />
          <col :style="{ width: `${columnWidths.amount}px` }" />
          <col :style="{ width: `${columnWidths.notes}px` }" />
          <col style="width: 112px" />
        </colgroup>
        <thead>
          <tr>
            <th>
              <input
                id="all-select"
                ref="all-select"
                type="checkbox"
                :checked="allSelected"
                :disabled="selectingAll || appointments.length === 0"
                aria-label="全选全部筛选结果"
                @change="toggleAll"
                @click.stop
              />
            </th>
            <th class="resizable-header">
              日期
              <AppointmentColumnResizeHandle
                column-key="serviceDate"
                label="日期"
                :width="columnWidths.serviceDate"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              时间
              <AppointmentColumnResizeHandle
                column-key="timeRange"
                label="时间"
                :width="columnWidths.timeRange"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              联系人
              <AppointmentColumnResizeHandle
                column-key="contactName"
                label="联系人"
                :width="columnWidths.contactName"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              内容
              <AppointmentColumnResizeHandle
                column-key="content"
                label="内容"
                :width="columnWidths.content"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              账号
              <AppointmentColumnResizeHandle
                column-key="account"
                label="账号"
                :width="columnWidths.account"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              语音
              <AppointmentColumnResizeHandle
                column-key="voice"
                label="语音"
                :width="columnWidths.voice"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              模式
              <AppointmentColumnResizeHandle
                column-key="mode"
                label="模式"
                :width="columnWidths.mode"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              进度
              <AppointmentColumnResizeHandle
                column-key="serviceStatus"
                label="进度"
                :width="columnWidths.serviceStatus"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              金额
              <AppointmentColumnResizeHandle
                column-key="amount"
                label="金额"
                :width="columnWidths.amount"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th class="resizable-header">
              备注
              <AppointmentColumnResizeHandle
                column-key="notes"
                label="备注"
                :width="columnWidths.notes"
                :disabled="savingColumnWidths"
                @preview="previewColumnWidth"
                @commit="commitColumnWidth"
                @cancel="cancelColumnResize"
              />
            </th>
            <th aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="appointment in appointments" :key="appointment.id">
            <td>
              <input
                type="checkbox"
                :checked="selectedIdSet.has(appointment.id)"
                aria-label="选择该预约"
                @change="toggleOne(appointment.id, $event)"
              />
            </td>
            <td class="mono-number">{{ formatCompactDate(appointment.serviceDate) }}</td>
            <td class="mono-number">
              {{ formatTimeRange(appointment.startsAt, appointment.endsAt) }}
            </td>
            <td>
              <strong class="cell-title truncate">{{ appointment.contactName }}</strong>
            </td>
            <td>
              <strong
                class="content-cell truncate"
                :class="{ muted: !appointment.content }"
                :title="appointment.content || undefined"
              >
                {{ appointment.content || "未填写内容" }}
              </strong>
            </td>
            <td>
              <AppointmentAccountSummary
                :account="appointment.account"
                :contact-name="appointment.contactName"
                @copy-account="emit('copyAccount', appointment)"
                @copy-password="emit('copyPassword', appointment)"
              />
            </td>
            <td>
              <AppointmentVoiceSummary
                :voice-platform="appointment.voicePlatform"
                :voice-channel="appointment.voiceChannel"
                @copy-voice-channel="emit('copyVoiceChannel', appointment)"
              />
            </td>
            <td>
              <span class="mode-mark" :class="`mode-mark--${appointment.mode}`">
                {{ modeLabels[appointment.mode] }}
              </span>
            </td>
            <td>
              <button
                v-if="appointmentProgressStatus(appointment) === 'pending_settlement'"
                class="settlement-status-button"
                type="button"
                title="点击填写结算金额"
                :aria-label="`填写${appointment.contactName} 的结算金额`"
                @click="emit('settle', appointment)"
              >
                <StatusBadge progress-status="pending_settlement" />
              </button>
              <StatusBadge v-else :progress-status="appointmentProgressStatus(appointment)" />
            </td>
            <td class="mono-number amount-cell">
              {{ appointment.mode === "business" ? formatCurrency(appointment.amountMinor) : "—" }}
            </td>
            <td>
              <span class="notes-cell truncate muted" :title="appointment.notes || undefined">
                {{ appointment.notes || "—" }}
              </span>
            </td>
            <td>
              <div class="row-actions">
                <button
                  class="icon-button"
                  type="button"
                  title="编辑"
                  aria-label="编辑"
                  @click="emit('edit', appointment)"
                >
                  <Pencil :size="14" />
                </button>
                <button
                  class="icon-button"
                  type="button"
                  title="复制预约"
                  aria-label="复制预约"
                  @click="emit('duplicate', appointment)"
                >
                  <CopyPlus :size="14" />
                </button>
                <button
                  class="icon-button action-danger"
                  type="button"
                  title="删除"
                  aria-label="删除"
                  @click="emit('delete', appointment)"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="empty-state">没有符合条件的预约</div>
  </div>
</template>

<style scoped>
.appointment-table {
  flex: 1;
}

.resizable-header {
  position: sticky;
  overflow: hidden;
  white-space: nowrap;
}

.cell-title,
.content-cell,
.notes-cell {
  display: block;
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 700;
}

.mode-mark {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--brand-strong);
  font-size: 11px;
  font-weight: 700;
}

.mode-mark::before {
  width: 7px;
  height: 7px;
  border-radius: 3px;
  background: var(--brand);
  content: "";
}

.mode-mark--entertainment {
  color: #44677d;
}

.mode-mark--entertainment::before {
  background: var(--blue);
}

.amount-cell {
  color: var(--ink-strong);
  font-weight: 650;
}

.settlement-status-button {
  display: inline-flex;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.settlement-status-button:hover {
  filter: brightness(0.96);
}

.settlement-status-button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--amber) 72%, transparent);
  outline-offset: 2px;
}

.row-actions {
  display: flex;
  justify-content: flex-end;
}

.row-actions .icon-button {
  width: 29px;
  height: 29px;
  flex-basis: 29px;
}

.row-actions .action-danger:hover {
  color: var(--accent);
  background: var(--accent-soft);
}

.appointment-table th:last-child,
.appointment-table td:last-child {
  position: sticky;
  z-index: 2;
  right: 0;
  background: var(--surface);
  box-shadow: -10px 0 18px rgba(28, 45, 38, 0.05);
}

.appointment-table th:last-child {
  z-index: 3;
  background: var(--surface-soft);
}

.appointment-table tbody tr:hover td:last-child {
  background: var(--surface-soft);
}

.appointment-table tbody tr {
  transition:
    background-color 140ms ease,
    box-shadow 140ms ease;
}

.appointment-table tbody tr:hover {
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--brand) 72%, transparent);
}
</style>
