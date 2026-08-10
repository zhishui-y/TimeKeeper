<script setup lang="ts">
import { computed, defineAsyncComponent, shallowRef } from "vue";
import type { RevenueBreakdownItem } from "../../types/domain";
import { compactRevenueBreakdownItems } from "../../utils/revenueBreakdown";

const RevenueBreakdownChart = defineAsyncComponent({
  loader: () => import("./RevenueCharts").then((module) => module.RevenueBreakdownChart),
  delay: 120,
  timeout: 20_000,
});

type BreakdownDimension = "paymentMethods" | "contacts";
type BreakdownChartType = "bar" | "pie";

const props = defineProps<{
  from: string;
  to: string;
  paymentMethods: readonly RevenueBreakdownItem[];
  contacts: readonly RevenueBreakdownItem[];
}>();

const dimension = shallowRef<BreakdownDimension>("paymentMethods");
const chartType = shallowRef<BreakdownChartType>("bar");
const sourceItems = computed(() =>
  dimension.value === "paymentMethods" ? props.paymentMethods : props.contacts,
);
const activeItems = computed(() => compactRevenueBreakdownItems(sourceItems.value));
const dimensionLabel = computed(() =>
  dimension.value === "paymentMethods" ? "收款渠道" : "收款对象",
);
const kicker = computed(() => (dimension.value === "paymentMethods" ? "CHANNELS" : "CONTACTS"));
const chartAriaLabel = computed(
  () =>
    `${dimensionLabel.value}，${props.from} 至 ${props.to}，${activeItems.value.length} 项，${chartType.value === "bar" ? "横向柱状图" : "饼图"}`,
);
</script>

<template>
  <aside class="breakdown-panel">
    <header class="breakdown-panel__header">
      <div class="breakdown-panel__heading">
        <div>
          <span class="section-kicker">{{ kicker }}</span>
          <h2>{{ dimensionLabel }}</h2>
        </div>
        <div class="segmented breakdown-panel__chart-toggle" aria-label="图表类型">
          <button
            v-for="item in [
              ['bar', '柱状'],
              ['pie', '饼图'],
            ] as const"
            :key="item[0]"
            class="segmented__item"
            :class="{ 'is-active': chartType === item[0] }"
            type="button"
            :aria-pressed="chartType === item[0]"
            @click="chartType = item[0]"
          >
            {{ item[1] }}
          </button>
        </div>
      </div>
      <div class="segmented breakdown-panel__dimension-toggle" aria-label="收款分析维度">
        <button
          v-for="item in [
            ['paymentMethods', '收款渠道'],
            ['contacts', '收款对象'],
          ] as const"
          :key="item[0]"
          class="segmented__item"
          :class="{ 'is-active': dimension === item[0] }"
          type="button"
          :aria-pressed="dimension === item[0]"
          @click="dimension = item[0]"
        >
          {{ item[1] }}
        </button>
      </div>
    </header>

    <div v-if="!activeItems.length" class="breakdown-panel__empty">当前范围暂无已结收入</div>
    <RevenueBreakdownChart
      v-else
      :aria-label="chartAriaLabel"
      :items="activeItems"
      :chart-type="chartType"
      :dimension-label="dimensionLabel"
    />
  </aside>
</template>

<style scoped>
.breakdown-panel {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 18px);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.breakdown-panel__header {
  display: grid;
  gap: 9px;
  padding: 11px 12px 10px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-soft) 82%, transparent);
}

.breakdown-panel__heading {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.breakdown-panel__heading h2 {
  margin-top: 1px;
  color: var(--ink-strong);
  font-size: calc(14px + var(--app-font-size-offset, 0px));
}

.breakdown-panel__chart-toggle,
.breakdown-panel__dimension-toggle {
  height: 30px;
  padding: 2px;
  border-radius: 9px;
}

.breakdown-panel__chart-toggle .segmented__item {
  height: 24px;
  padding: 0 7px;
  border-radius: 7px;
  font-size: calc(11px + var(--app-font-size-offset, 0px));
}

.breakdown-panel__dimension-toggle {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.breakdown-panel__dimension-toggle .segmented__item {
  height: 24px;
  padding: 0 4px;
  border-radius: 7px;
}

.breakdown-panel__empty {
  display: grid;
  place-items: center;
  padding: 18px;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  text-align: center;
}

@media (max-width: 1180px) {
  .breakdown-panel__header {
    padding-inline: 9px;
  }

  .breakdown-panel__chart-toggle .segmented__item {
    padding-inline: 5px;
  }
}
</style>
