<script setup lang="ts">
import { ChevronLeft, ChevronRight } from "@lucide/vue";
import { computed } from "vue";
import type { RevenuePeriodRange, RevenueRangeKind } from "../../utils/revenue";

interface Props {
  rangeKind: RevenueRangeKind;
  displayRange: RevenuePeriodRange | null;
  isCurrentPeriod: boolean;
  customFrom: string;
  customTo: string;
  customError: string | null;
}

interface Emits {
  selectRange: [kind: RevenueRangeKind];
  navigate: [offset: -1 | 1];
  returnCurrent: [];
  updateCustomFrom: [value: string];
  updateCustomTo: [value: string];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const rangeOptions = [
  ["week", "周"],
  ["month", "月"],
  ["all", "全部"],
  ["custom", "自定义"],
] as const;

const naturalRangeUnit = computed(() => (props.rangeKind === "month" ? "月" : "周"));
const displayRangeLabel = computed(() => {
  if (!props.displayRange) return "加载后显示实际范围";
  return `${props.displayRange.from} — ${props.displayRange.to}`;
});
</script>

<template>
  <div class="range-navigator" aria-label="统计范围">
    <span class="range-navigator__label">统计范围</span>
    <div class="range-navigator__kinds" aria-label="统计范围类型">
      <button
        v-for="item in rangeOptions"
        :key="item[0]"
        class="range-navigator__kind"
        :class="{ 'is-active': rangeKind === item[0] }"
        type="button"
        :aria-pressed="rangeKind === item[0]"
        @click="emit('selectRange', item[0])"
      >
        {{ item[1] }}
      </button>
    </div>

    <div
      v-if="rangeKind === 'week' || rangeKind === 'month'"
      class="range-navigator__natural"
      :aria-label="`${naturalRangeUnit}范围导航`"
    >
      <button
        class="range-navigator__arrow"
        type="button"
        :aria-label="`上一${naturalRangeUnit}`"
        @click="emit('navigate', -1)"
      >
        <ChevronLeft :size="15" aria-hidden="true" />
      </button>
      <span class="range-navigator__actual mono-number">{{ displayRangeLabel }}</span>
      <button
        class="range-navigator__arrow"
        type="button"
        :aria-label="`下一${naturalRangeUnit}`"
        @click="emit('navigate', 1)"
      >
        <ChevronRight :size="15" aria-hidden="true" />
      </button>
      <button
        v-if="!isCurrentPeriod"
        class="range-navigator__return"
        type="button"
        @click="emit('returnCurrent')"
      >
        回到本{{ naturalRangeUnit }}
      </button>
    </div>

    <div v-else-if="rangeKind === 'all'" class="range-navigator__all">
      <span>实际范围</span>
      <strong class="mono-number">{{ displayRangeLabel }}</strong>
    </div>

    <div v-else class="range-navigator__custom">
      <div class="range-navigator__custom-fields">
        <input
          class="input range-navigator__date"
          type="date"
          aria-label="统计开始日期"
          :aria-invalid="Boolean(customError)"
          :aria-describedby="customError ? 'revenue-custom-range-error' : undefined"
          :value="customFrom"
          @input="emit('updateCustomFrom', ($event.target as HTMLInputElement).value)"
        />
        <span>至</span>
        <input
          class="input range-navigator__date"
          type="date"
          aria-label="统计结束日期"
          :aria-invalid="Boolean(customError)"
          :aria-describedby="customError ? 'revenue-custom-range-error' : undefined"
          :value="customTo"
          @input="emit('updateCustomTo', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <span
        v-if="customError"
        id="revenue-custom-range-error"
        class="range-navigator__error"
        role="alert"
      >
        {{ customError }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.range-navigator {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.range-navigator__label {
  flex: 0 0 auto;
  color: var(--ink-strong);
  font-weight: 700;
}

.range-navigator__kinds {
  display: inline-flex;
  height: 34px;
  flex: 0 0 auto;
  align-items: center;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-soft) 82%, transparent);
}

.range-navigator__kind {
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  color: var(--ink-muted);
  background: transparent;
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 650;
  cursor: pointer;
  transition:
    background-color 150ms ease,
    box-shadow 150ms ease,
    color 150ms ease;
}

.range-navigator__kind:hover {
  color: var(--brand-strong);
}

.range-navigator__kind.is-active {
  color: var(--ink-strong);
  background: var(--surface);
  box-shadow: var(--shadow-control);
}

.range-navigator__natural,
.range-navigator__all,
.range-navigator__custom-fields {
  display: flex;
  min-width: 0;
  align-items: center;
}

.range-navigator__natural {
  gap: 5px;
}

.range-navigator__arrow {
  display: inline-flex;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink-muted);
  background: var(--surface);
  cursor: pointer;
}

.range-navigator__arrow:hover,
.range-navigator__return:hover {
  border-color: color-mix(in srgb, var(--brand) 35%, var(--line));
  color: var(--brand-strong);
}

.range-navigator__actual {
  min-width: 154px;
  color: var(--ink-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  text-align: center;
  white-space: nowrap;
}

.range-navigator__return {
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--brand-border);
  border-radius: 8px;
  color: var(--brand-strong);
  background: var(--brand-soft);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 650;
  cursor: pointer;
  white-space: nowrap;
}

.range-navigator__all {
  gap: 7px;
  white-space: nowrap;
}

.range-navigator__all > span {
  color: var(--ink-muted);
}

.range-navigator__all > strong {
  color: var(--ink-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.range-navigator__custom {
  position: relative;
  min-width: 0;
  padding-bottom: 16px;
  margin-bottom: -16px;
}

.range-navigator__custom-fields {
  gap: 6px;
}

.range-navigator__date {
  width: 137px;
  height: 32px;
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.range-navigator__date[aria-invalid="true"] {
  border-color: color-mix(in srgb, var(--danger) 65%, var(--line));
}

.range-navigator__error {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  color: var(--danger);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1180px) {
  .range-navigator {
    gap: 6px;
  }

  .range-navigator__kind {
    padding-inline: 8px;
  }

  .range-navigator__actual {
    min-width: 145px;
  }

  .range-navigator__date {
    width: 128px;
  }
}
</style>
