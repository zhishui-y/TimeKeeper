<script setup lang="ts">
import { computed } from "vue";
import type { RevenueRangeKind, RevenueRangeUnit } from "../../utils/revenue";

interface Props {
  unit: RevenueRangeUnit;
  activeRange: RevenueRangeKind;
  isCurrentPeriod: boolean;
}

interface Emits {
  selectAll: [];
  selectUnit: [unit: RevenueRangeUnit];
  navigate: [offset: -1 | 0 | 1];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const periodLabels = computed(() => {
  const suffix = props.unit === "week" ? "周" : "月";
  return [
    { offset: -1 as const, label: `上一${suffix}` },
    { offset: 0 as const, label: `本${suffix}` },
    { offset: 1 as const, label: `下一${suffix}` },
  ];
});
</script>

<template>
  <div class="range-navigator" aria-label="日期快捷范围">
    <button
      class="range-navigator__button"
      :class="{ 'is-active': activeRange === 'all' }"
      type="button"
      :aria-pressed="activeRange === 'all'"
      @click="emit('selectAll')"
    >
      全部
    </button>
    <div class="range-navigator__units" aria-label="快捷范围单位">
      <button
        v-for="item in [
          ['week', '周'],
          ['month', '月'],
        ] as const"
        :key="item[0]"
        class="range-navigator__unit"
        :class="{ 'is-selected': unit === item[0] }"
        type="button"
        :aria-pressed="unit === item[0]"
        @click="emit('selectUnit', item[0])"
      >
        {{ item[1] }}
      </button>
    </div>
    <div class="range-navigator__periods" :aria-label="`${unit === 'week' ? '周' : '月'}范围导航`">
      <button
        v-for="item in periodLabels"
        :key="item.offset"
        class="range-navigator__button"
        :class="{ 'is-active': item.offset === 0 && isCurrentPeriod }"
        type="button"
        :aria-pressed="item.offset === 0 && isCurrentPeriod"
        @click="emit('navigate', item.offset)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.range-navigator,
.range-navigator__units,
.range-navigator__periods {
  display: inline-flex;
  align-items: center;
}

.range-navigator {
  gap: 5px;
  margin-left: 3px;
}

.range-navigator__units,
.range-navigator__periods {
  gap: 3px;
}

.range-navigator__units {
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-soft) 82%, transparent);
}

.range-navigator__button,
.range-navigator__unit {
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink-muted);
  background: color-mix(in srgb, var(--surface) 78%, transparent);
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    box-shadow 150ms ease,
    color 150ms ease;
}

.range-navigator__button {
  padding: 0 9px;
}

.range-navigator__unit {
  height: 24px;
  padding: 0 8px;
  border-color: transparent;
  background: transparent;
}

.range-navigator__button:hover,
.range-navigator__unit:hover {
  border-color: color-mix(in srgb, var(--brand) 35%, var(--line));
  color: var(--brand-strong);
}

.range-navigator__unit.is-selected {
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.range-navigator__button.is-active {
  border-color: var(--gold-border);
  color: var(--gold-strong);
  background: var(--gold-soft);
  box-shadow: 0 3px 9px rgba(145, 98, 21, 0.09);
}

@media (max-width: 1180px) {
  .range-navigator {
    gap: 3px;
  }

  .range-navigator__button {
    padding-inline: 7px;
  }
}
</style>
