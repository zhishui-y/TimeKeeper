<script setup lang="ts">
import { CalendarDays, Coins, ListChecks, UsersRound, X } from "@lucide/vue";
import { computed, type DeepReadonly, useTemplateRef } from "vue";
import { useModalFocus } from "../../composables/useModalFocus";
import type { Appointment } from "../../types/domain";
import { formatChinaDate } from "../../utils/chinaDateTime";
import { formatCurrency } from "../../utils/formatters";
import type { CompactRevenueBreakdownItem } from "../../utils/revenueBreakdown";
import RevenueAppointmentList from "./RevenueAppointmentList.vue";

const props = defineProps<{
  item: DeepReadonly<CompactRevenueBreakdownItem>;
  from: string;
  to: string;
  appointments: DeepReadonly<Appointment[]>;
  loading: boolean;
  error: string | null;
  stale?: boolean;
  actionsDisabled?: boolean;
  resolvedContactNames?: readonly string[] | null;
  restoreFocusElement?: HTMLElement | null;
}>();

const emit = defineEmits<{
  close: [];
  appointmentSelect: [appointment: Appointment];
}>();

const panelRef = useTemplateRef<HTMLElement>("panel");
const title = computed(() =>
  props.item.name === "其他" ? "其他（合并）预约明细" : `${props.item.name}预约明细`,
);
const rangeLabel = computed(() =>
  props.from === props.to
    ? formatChinaDate(props.from, { year: true })
    : `${formatChinaDate(props.from, { year: true })} — ${formatChinaDate(props.to, { year: true })}`,
);

useModalFocus({
  open: () => true,
  container: panelRef,
  close: () => emit("close"),
  restoreFocus: () => props.restoreFocusElement ?? null,
});
</script>

<template>
  <Teleport to="body">
    <div class="contact-detail-layer">
      <button
        class="contact-detail-backdrop"
        type="button"
        aria-label="关闭收款对象预约明细"
        @click="emit('close')"
      />
      <aside
        ref="panel"
        class="contact-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-detail-title"
        tabindex="-1"
      >
        <header class="contact-detail__header">
          <div>
            <span class="section-kicker">CONTACT APPOINTMENTS</span>
            <h2 id="contact-detail-title">{{ title }}</h2>
            <p><CalendarDays :size="14" />{{ rangeLabel }}</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="emit('close')">
            <X :size="18" />
          </button>
        </header>

        <div class="contact-detail__body">
          <div v-if="stale" class="contact-detail__stale" role="status">
            当前列表来自上一收款对象，新对象明细加载失败或尚未完成，预约操作已暂停。
            <span v-if="resolvedContactNames?.length">
              上一对象：{{ resolvedContactNames.join("、") }}
            </span>
          </div>

          <section class="contact-detail__summary" aria-label="收款对象收益汇总">
            <div>
              <Coins :size="17" />
              <span>已结收益</span>
              <strong class="mono-number">{{ formatCurrency(item.amountMinor) }}</strong>
            </div>
            <div>
              <ListChecks :size="17" />
              <span>预约笔数</span>
              <strong class="mono-number">{{ item.appointmentCount }} 笔</strong>
            </div>
            <div v-if="item.name === '其他'">
              <UsersRound :size="17" />
              <span>合并对象</span>
              <strong class="mono-number">{{ item.memberNames.length }} 个</strong>
            </div>
          </section>

          <RevenueAppointmentList
            :appointments="appointments"
            :loading="loading"
            :error="error"
            title="计入收益的业务预约"
            empty-message="该对象在当前范围内没有计入收益的预约"
            show-date
            :actions-disabled="actionsDisabled"
            @appointment-select="emit('appointmentSelect', $event)"
          />
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.contact-detail-layer {
  position: fixed;
  z-index: 70;
  inset: 0;
}

.contact-detail-backdrop {
  position: absolute;
  border: 0;
  background: rgba(23, 35, 30, 0.5);
  backdrop-filter: blur(3px);
  cursor: pointer;
  inset: 0;
}

.contact-detail {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  display: grid;
  width: min(720px, calc(100vw - 24px));
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--amber) 30%, var(--line));
  border-radius: var(--radius-xl, 22px);
  background: var(--surface-soft);
  box-shadow: var(--shadow-dialog);
}

.contact-detail__header {
  display: flex;
  min-height: 102px;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(120deg, var(--amber-soft), var(--surface) 72%);
}

.contact-detail__header h2 {
  margin-top: 3px;
  color: var(--ink-strong);
  font-family: var(--font-serif, "Noto Serif SC", serif);
  font-size: calc(21px + var(--app-font-size-offset, 0px));
}

.contact-detail__header p {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.contact-detail__body {
  min-height: 0;
  padding: 18px 24px 24px;
  overflow-y: auto;
}

.contact-detail__stale {
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid var(--amber-border);
  border-radius: var(--radius-sm, 8px);
  color: #815414;
  background: var(--amber-soft);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.contact-detail__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.contact-detail__summary > div {
  display: grid;
  min-height: 64px;
  grid-template-columns: 22px minmax(0, 1fr);
  align-content: center;
  gap: 2px 8px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md, 12px);
  color: var(--brand);
  background: var(--surface);
}

.contact-detail__summary svg {
  grid-row: 1 / 3;
}

.contact-detail__summary span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.contact-detail__summary strong {
  color: var(--ink-strong);
  font-size: calc(16px + var(--app-font-size-offset, 0px));
}

@media (max-width: 760px) {
  .contact-detail__header,
  .contact-detail__body {
    padding-inline: 16px;
  }

  .contact-detail__summary {
    grid-template-columns: 1fr;
  }
}
</style>
