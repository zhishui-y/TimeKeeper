<script setup lang="ts">
import { Ban, CopyPlus, Pencil, Trash2 } from "@lucide/vue";
import type { Appointment } from "../../types/domain";
import {
  formatCompactDate,
  formatCurrency,
  formatTimeRange,
  modeLabels,
} from "../../utils/formatters";
import StatusBadge from "../common/StatusBadge.vue";

defineProps<{
  appointments: readonly Appointment[];
}>();

const emit = defineEmits<{
  edit: [appointment: Appointment];
  duplicate: [appointment: Appointment];
  cancel: [appointment: Appointment];
  delete: [appointment: Appointment];
}>();
</script>

<template>
  <div class="data-surface appointment-table">
    <div v-if="appointments.length" class="table-scroll">
      <table class="data-table">
        <colgroup>
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
  font-size: 11px;
}

.cell-stack {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.cell-stack span {
  color: var(--ink-muted);
  font-size: 9px;
}

.mode-mark {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--brand-strong);
  font-size: 10px;
  font-weight: 700;
}

.mode-mark::before {
  width: 6px;
  height: 6px;
  border-radius: 2px;
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
  width: 27px;
  height: 27px;
  flex-basis: 27px;
}

.row-actions .action-danger:hover {
  color: var(--accent);
  background: var(--accent-soft);
}
</style>
