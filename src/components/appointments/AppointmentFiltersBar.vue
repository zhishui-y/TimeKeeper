<script setup lang="ts">
import { RotateCcw, Search } from "@lucide/vue";
import { reactive, watch } from "vue";
import type { AppointmentFilters } from "../../types/domain";

const props = defineProps<{
  filters: AppointmentFilters;
}>();

const emit = defineEmits<{
  apply: [filters: AppointmentFilters];
  reset: [];
}>();

const draft = reactive<AppointmentFilters>({ ...props.filters });

function hasPartialDateRange(value: AppointmentFilters): boolean {
  return Boolean(value.from) !== Boolean(value.to);
}

function replaceDraft(value: AppointmentFilters, preservePartialDates = false): void {
  const partialDates = preservePartialDates ? { from: draft.from, to: draft.to } : null;
  Object.keys(draft).forEach((key) => delete draft[key as keyof AppointmentFilters]);
  Object.assign(draft, value);
  if (partialDates) Object.assign(draft, partialDates);
}

watch(
  () => props.filters,
  (value) => replaceDraft(value, hasPartialDateRange(draft) && !value.from && !value.to),
  { deep: true },
);

function filtersWithLastValidDateRange(): AppointmentFilters {
  const next = { ...draft };
  const hasValidDraftRange = Boolean(next.from && next.to && next.from <= next.to);
  if (!hasValidDraftRange) {
    delete next.from;
    delete next.to;
    if (props.filters.from && props.filters.to) {
      next.from = props.filters.from;
      next.to = props.filters.to;
    }
  }
  return next;
}

function applyNonDateFilters(): void {
  emit("apply", filtersWithLastValidDateRange());
}

function applyMode(): void {
  if (draft.mode === "entertainment" && draft.progressStatus === "pending_settlement") {
    delete draft.progressStatus;
  }
  applyNonDateFilters();
}

function applyDateRange(): void {
  const from = draft.from ?? "";
  const to = draft.to ?? "";

  if (from && to) {
    emit("apply", { ...draft });
    return;
  }

  if (!from && !to) {
    emit("apply", { ...draft });
    return;
  }

  if (props.filters.from && props.filters.to) {
    delete draft.from;
    delete draft.to;
    emit("apply", { ...draft });
  }
}

function openDatePicker(event: globalThis.PointerEvent): void {
  const input = event.currentTarget as InstanceType<typeof globalThis.HTMLInputElement> | null;
  if (typeof input?.showPicker !== "function") return;
  try {
    input.showPicker();
  } catch {
    // 保留不支持主动打开日期面板的 WebView 默认点击行为。
  }
}

function reset(): void {
  replaceDraft({});
  emit("reset");
}
</script>

<template>
  <div class="filters" role="search">
    <label class="search-field">
      <Search class="search-field__icon" :size="15" />
      <input
        v-model="draft.query"
        class="input"
        placeholder="搜索联系人、内容、账号、YY频道或备注"
        @input="applyNonDateFilters"
      />
    </label>
    <label class="filters__date-field filters__date--from" :class="{ 'is-empty': !draft.from }">
      <span v-if="!draft.from" class="filters__date-placeholder" aria-hidden="true">
        开始日期
      </span>
      <input
        v-model="draft.from"
        class="input filters__date"
        type="date"
        aria-label="开始日期"
        @click="openDatePicker"
        @change="applyDateRange"
      />
    </label>
    <span class="filters__separator">至</span>
    <label class="filters__date-field filters__date--to" :class="{ 'is-empty': !draft.to }">
      <span v-if="!draft.to" class="filters__date-placeholder" aria-hidden="true"> 结束日期 </span>
      <input
        v-model="draft.to"
        class="input filters__date"
        type="date"
        aria-label="结束日期"
        @click="openDatePicker"
        @change="applyDateRange"
      />
    </label>
    <select
      v-model="draft.mode"
      class="select filters__select filters__mode"
      aria-label="预约模式"
      @change="applyMode"
    >
      <option :value="undefined">全部模式</option>
      <option value="business">业务</option>
      <option value="entertainment">娱乐</option>
    </select>
    <select
      v-model="draft.progressStatus"
      class="select filters__select filters__status"
      aria-label="预约进度"
      @change="applyNonDateFilters"
    >
      <option :value="undefined">全部进度</option>
      <option value="scheduled">已预约</option>
      <option value="in_progress">进行中</option>
      <option v-if="draft.mode !== 'entertainment'" value="pending_settlement">待结算</option>
      <option value="completed">完成</option>
      <option value="cancelled">已取消</option>
    </select>
    <button
      class="icon-button filters__reset"
      type="button"
      title="重置筛选"
      aria-label="重置筛选"
      @click="reset"
    >
      <RotateCcw :size="15" />
    </button>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.filters__date-field {
  position: relative;
  display: block;
  width: 132px;
}

.filters__date {
  width: 100%;
  cursor: pointer;
}

.filters__date-placeholder {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 12px;
  color: #8c9690;
  font-size: calc(13px + var(--app-font-size-offset, 0px));
  pointer-events: none;
  transform: translateY(-50%);
}

.filters__date-field.is-empty .filters__date {
  color: transparent;
}

.filters__date-field.is-empty .filters__date::-webkit-datetime-edit {
  color: transparent;
}

.filters__date-field.is-empty .filters__date::-webkit-datetime-edit-year-field,
.filters__date-field.is-empty .filters__date::-webkit-datetime-edit-month-field,
.filters__date-field.is-empty .filters__date::-webkit-datetime-edit-day-field,
.filters__date-field.is-empty .filters__date::-webkit-datetime-edit-text {
  color: transparent;
  background-color: transparent;
  -webkit-text-fill-color: transparent;
}

.filters__date-field.is-empty .filters__date::-webkit-datetime-edit-year-field:focus,
.filters__date-field.is-empty .filters__date::-webkit-datetime-edit-month-field:focus,
.filters__date-field.is-empty .filters__date::-webkit-datetime-edit-day-field:focus {
  color: transparent;
  background-color: transparent;
  -webkit-text-fill-color: transparent;
}

.filters__separator {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.filters__select {
  width: 104px;
}

@media (max-width: 1260px) {
  .filters {
    display: grid;
    flex: 1;
    grid-template-areas: "search from separator to mode status reset";
    grid-template-columns: minmax(150px, 1fr) 112px auto 112px 90px 90px 34px;
    gap: 5px;
  }

  .search-field {
    grid-area: search;
    width: 100%;
  }

  .filters__date-field {
    width: 112px;
  }

  .filters__date--from {
    grid-area: from;
  }

  .filters__separator {
    grid-area: separator;
    align-self: center;
  }

  .filters__date--to {
    grid-area: to;
  }

  .filters__select {
    width: 94px;
  }

  .filters__mode {
    grid-area: mode;
  }

  .filters__status {
    grid-area: status;
  }

  .filters__reset {
    grid-area: reset;
    justify-self: end;
  }
}
</style>
