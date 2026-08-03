<script setup lang="ts">
import { ClipboardCopy, Copy, CopyPlus, Pencil, Trash2 } from "@lucide/vue";
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
import StatusBadge from "../common/StatusBadge.vue";
import AppointmentColumnResizeHandle from "./AppointmentColumnResizeHandle.vue";

const props = defineProps<{
  appointments: readonly Appointment[];
  columnWidths: AppointmentTableColumnWidths;
  savingColumnWidths: boolean;
}>();
const selectedIds = defineModel<string[]>("selectedIds", { required: true });

const emit = defineEmits<{
  edit: [appointment: Appointment];
  duplicate: [appointment: Appointment];
  delete: [appointment: Appointment];
  copyAccount: [appointment: Appointment];
  copyPassword: [appointment: Appointment];
  previewColumnWidth: [columnKey: AppointmentTableColumnKey, width: number];
  commitColumnWidth: [columnKey: AppointmentTableColumnKey, width: number];
  cancelColumnResize: [columnKey: AppointmentTableColumnKey, width: number];
}>();

const allSelectRef = useTemplateRef("all-select");
const selectedIdSet = computed(() => new Set(selectedIds.value));
const selectedCount = computed(() => selectedIds.value.length);
const allChecked = computed(
  () =>
    props.appointments.length > 0 &&
    props.appointments.every((appointment) => selectedIdSet.value.has(appointment.id)),
);
const indeterminate = computed(() => selectedCount.value > 0 && !allChecked.value);
const tableMinimumWidth = computed(() => appointmentTableTotalWidth(props.columnWidths));

watch(indeterminate, (value) => {
  if (allSelectRef.value) allSelectRef.value.indeterminate = value;
});

function isChecked(event: unknown): boolean {
  const target = (event as { target?: { checked?: boolean } } | null)?.target;
  return target?.checked ?? false;
}

function toggleAll(event: unknown): void {
  selectedIds.value = isChecked(event)
    ? props.appointments.map((appointment) => appointment.id)
    : [];
}

function toggleOne(appointmentId: string, event: unknown): void {
  const next = new Set(selectedIds.value);
  if (isChecked(event)) next.add(appointmentId);
  else next.delete(appointmentId);
  selectedIds.value = [...next];
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
          <col :style="{ width: `${columnWidths.mode}px` }" />
          <col :style="{ width: `${columnWidths.serviceStatus}px` }" />
          <col :style="{ width: `${columnWidths.settlementStatus}px` }" />
          <col :style="{ width: `${columnWidths.amount}px` }" />
          <col :style="{ width: `${columnWidths.paymentMethod}px` }" />
          <col style="width: 112px" />
        </colgroup>
        <thead>
          <tr>
            <th>
              <input
                id="all-select"
                ref="all-select"
                type="checkbox"
                :checked="allChecked"
                aria-label="全选当前页面预约"
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
              结算
              <AppointmentColumnResizeHandle
                column-key="settlementStatus"
                label="结算"
                :width="columnWidths.settlementStatus"
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
              收款
              <AppointmentColumnResizeHandle
                column-key="paymentMethod"
                label="收款"
                :width="columnWidths.paymentMethod"
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
              <div v-if="appointment.account" class="account-cell">
                <div class="account-cell__line">
                  <span class="truncate">{{ appointment.account.specialization || "—" }}</span>
                  <span aria-hidden="true">·</span>
                  <span class="truncate">{{ appointment.account.gearScore || "—" }}</span>
                  <span aria-hidden="true">·</span>
                  <button
                    class="account-cell__copy"
                    type="button"
                    :title="`复制账号 ${appointment.account.accountName}`"
                    :aria-label="`复制账号 ${appointment.account.accountName}`"
                    @click="emit('copyAccount', appointment)"
                  >
                    <Copy :size="13" />
                  </button>
                </div>
                <div class="account-cell__line account-cell__line--muted">
                  <span class="truncate">{{ appointment.account.server || "—" }}</span>
                  <span aria-hidden="true">·</span>
                  <button
                    class="account-cell__copy"
                    type="button"
                    :disabled="!appointment.account.passwordAvailable"
                    :title="appointment.account.passwordAvailable ? '复制密码' : '该预约未保存密码'"
                    :aria-label="`复制密码 ${appointment.contactName}`"
                    @click="emit('copyPassword', appointment)"
                  >
                    <ClipboardCopy :size="13" />
                  </button>
                </div>
              </div>
              <span v-else class="muted">未使用账号</span>
            </td>
            <td>
              <span class="mode-mark" :class="`mode-mark--${appointment.mode}`">
                {{ modeLabels[appointment.mode] }}
              </span>
            </td>
            <td><StatusBadge :service-status="appointment.serviceStatus" /></td>
            <td><StatusBadge :settlement-status="appointment.settlementStatus" /></td>
            <td class="mono-number amount-cell">
              {{ appointment.mode === "business" ? formatCurrency(appointment.amountMinor) : "—" }}
            </td>
            <td class="muted">{{ appointment.paymentMethod || "—" }}</td>
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
}

.cell-title,
.content-cell {
  display: block;
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 700;
}

.account-cell {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.account-cell__line {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  color: var(--ink-strong);
  font-size: 11px;
  font-weight: 650;
}

.account-cell__line .truncate {
  min-width: 0;
}

.account-cell__line--muted {
  color: var(--ink-muted);
  font-size: 10px;
  font-weight: 500;
}

.account-cell__copy {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 5px;
  color: var(--brand-strong);
  background: transparent;
  cursor: copy;
}

.account-cell__copy:hover:not(:disabled),
.account-cell__copy:focus-visible {
  background: var(--brand-soft);
  outline: none;
}

.account-cell__copy:disabled {
  cursor: not-allowed;
  opacity: 0.32;
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
