<script setup lang="ts">
import { Ban, Pencil, Trash2, CopyPlus } from "@lucide/vue";
import type { Appointment } from "../../types/domain";
import {
  formatCompactDate,
  formatCurrency,
  formatTimeRange,
  modeLabels,
} from "../../utils/formatters";
import { useTemplateRef } from "vue";
import { computed, watch } from "vue";
import StatusBadge from "../common/StatusBadge.vue";

const props = defineProps<{
  appointments: readonly Appointment[];
}>();
const selectedIds = defineModel<string[]>("selectedIds", { required: true });

const emit = defineEmits<{
  edit: [appointment: Appointment];
  duplicate: [appointment: Appointment];
  cancel: [appointment: Appointment];
  delete: [appointment: Appointment];
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

watch(indeterminate, (value) => {
  if (allSelectRef.value) {
    allSelectRef.value.indeterminate = value;
  }
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
  if (isChecked(event)) {
    next.add(appointmentId);
  } else {
    next.delete(appointmentId);
  }
  selectedIds.value = [...next];
}
</script>

<template>
  <div class="data-surface appointment-table">
    <div v-if="appointments.length" class="table-scroll">
      <table class="data-table">
        <colgroup>
          <col style="width: 44px" />
          <col style="width: 60px" />
          <col style="width: 88px" />
          <col style="width: 72px" />
          <col style="width: 122px" />
          <col style="width: 56px" />
          <col style="width: 74px" />
          <col style="width: 74px" />
          <col style="width: 68px" />
          <col style="width: 58px" />
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
            <th>日期</th>
            <th>时间</th>
            <th>联系人</th>
            <th>内容 / 账号</th>
            <th>模式</th>
            <th>进度</th>
            <th>结算</th>
            <th>金额</th>
            <th>收款</th>
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
              <div class="cell-stack">
                <strong class="truncate">{{ appointment.content || "未填写内容" }}</strong>
                <span class="truncate">{{
                  appointment.accountSnapshot?.accountName || "未关联账号"
                }}</span>
              </div>
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
                  v-if="appointment.serviceStatus !== 'cancelled'"
                  class="icon-button"
                  type="button"
                  title="取消预约"
                  aria-label="取消预约"
                  @click="emit('cancel', appointment)"
                >
                  <Ban :size="14" />
                </button>
                <button
                  class="icon-button action-danger"
                  type="button"
                  title="永久删除"
                  aria-label="永久删除"
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

.cell-title,
.cell-stack strong {
  display: block;
  color: var(--ink-strong);
  font-size: 12px;
  font-weight: 700;
}

.cell-stack {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.cell-stack span {
  color: var(--ink-muted);
  font-size: 10px;
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

.appointment-table tbody tr {
  transition:
    background-color 140ms ease,
    box-shadow 140ms ease;
}

.appointment-table tbody tr:hover {
  box-shadow: inset 3px 0 0 color-mix(in srgb, var(--brand) 72%, transparent);
}
</style>
