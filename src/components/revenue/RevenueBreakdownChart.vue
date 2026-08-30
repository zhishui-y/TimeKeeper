<script setup lang="ts">
import { BarChart as EChartsBarChart, PieChart as EChartsPieChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { use } from "echarts/core";
import type { ECElementEvent } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { computed, shallowRef, useTemplateRef } from "vue";
import VChart from "vue-echarts";
import { useAppAppearance } from "../../composables/useAppAppearance";
import {
  useEChartsLifecycle,
  type ResizableEChartsInstance,
} from "../../composables/useEChartsLifecycle";
import type { RevenueBreakdownItem } from "../../types/domain";
import { formatCurrency } from "../../utils/formatters";

use([EChartsBarChart, EChartsPieChart, GridComponent, TooltipComponent, CanvasRenderer]);

type BreakdownChartType = "bar" | "pie";

interface TooltipParams {
  name: string;
  value?: number;
  data?: { value: number; appointmentCount: number };
}

const props = defineProps<{
  items: readonly RevenueBreakdownItem[];
  chartType: BreakdownChartType;
  dimensionLabel: string;
  selectable?: boolean;
}>();

const emit = defineEmits<{
  itemSelect: [name: string];
}>();

const appearance = useAppAppearance();
const chartInstance = useTemplateRef<ResizableEChartsInstance>("chartInstance");
const chartRoot = useTemplateRef<HTMLElement>("chartRoot");
const activeIndex = shallowRef(0);
const { prefersReducedMotion } = useEChartsLifecycle(chartInstance);
const palette = ["#2d6854", "#4e7184", "#a86f26", "#b5523e", "#759288", "#7b6a9a"];

const totalAmount = computed(() =>
  props.items.reduce((total, item) => total + item.amountMinor, 0),
);
const barItems = computed(() => [...props.items].reverse());
const barHeight = computed(() => Math.max(240, props.items.length * 46 + 28));
const chartDescription = computed(
  () =>
    `${props.dimensionLabel}${props.chartType === "bar" ? "横向柱状图" : "饼图"}，共${props.items.length}项，合计${formatCurrency(totalAmount.value)}`,
);

function selectItem(name: string | undefined): void {
  if (!props.selectable || !name || !props.items.some((item) => item.name === name)) return;
  emit("itemSelect", name);
}

function selectChartItem(event: ECElementEvent): void {
  if (event.componentType !== "series") return;
  const chartItems = props.chartType === "bar" ? barItems.value : props.items;
  selectItem(chartItems[event.dataIndex]?.name);
}

function focusChart(): void {
  if (props.selectable) chartRoot.value?.focus();
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.selectable || props.items.length === 0) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectItem(props.items[activeIndex.value]?.name);
    return;
  }
  const lastIndex = props.items.length - 1;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    activeIndex.value = activeIndex.value >= lastIndex ? 0 : activeIndex.value + 1;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = activeIndex.value <= 0 ? lastIndex : activeIndex.value - 1;
  } else if (event.key === "Home") {
    event.preventDefault();
    activeIndex.value = 0;
  } else if (event.key === "End") {
    event.preventDefault();
    activeIndex.value = lastIndex;
  }
}

function tooltipText(params: TooltipParams | TooltipParams[]): string {
  const item = Array.isArray(params) ? params[0] : params;
  if (!item) return "";
  const amountMinor = item.data?.value ?? item.value ?? 0;
  const appointmentCount = item.data?.appointmentCount ?? 0;
  return `${item.name}\n${formatCurrency(amountMinor)} · ${appointmentCount} 笔`;
}

function percentage(amountMinor: number): string {
  if (totalAmount.value <= 0) return "0%";
  return `${((amountMinor / totalAmount.value) * 100).toFixed(1)}%`;
}

const option = computed(() => {
  const shared = {
    textStyle: {
      fontFamily: appearance.activeAppearance.value.fontFamily,
      fontSize: appearance.activeAppearance.value.baseFontSize,
    },
    animation: !prefersReducedMotion.value,
    animationDuration: prefersReducedMotion.value ? 0 : 360,
    animationDurationUpdate: prefersReducedMotion.value ? 0 : 260,
    color: palette,
    tooltip: {
      trigger: "item",
      renderMode: "richText",
      backgroundColor: "#fffdf8",
      borderColor: "#d8ddd5",
      borderWidth: 1,
      formatter: tooltipText,
      textStyle: {
        color: "#314039",
        fontFamily: appearance.activeAppearance.value.fontFamily,
        fontSize: Math.max(12, appearance.activeAppearance.value.baseFontSize - 3),
      },
    },
  };

  if (props.chartType === "pie") {
    return {
      ...shared,
      series: [
        {
          name: props.dimensionLabel,
          type: "pie",
          radius: ["48%", "72%"],
          center: ["50%", "50%"],
          minAngle: 2,
          avoidLabelOverlap: true,
          label: { show: false },
          emphasis: { scaleSize: 5 },
          data: props.items.map((item) => ({
            name: item.name,
            value: item.amountMinor,
            appointmentCount: item.appointmentCount,
          })),
        },
      ],
    };
  }

  return {
    ...shared,
    grid: { top: 12, right: 66, bottom: 16, left: 8, containLabel: true },
    xAxis: {
      type: "value",
      minInterval: 100,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        show: false,
      },
      splitLine: { lineStyle: { color: "#e9ede6" } },
    },
    yAxis: {
      type: "category",
      data: barItems.value.map((item) => item.name),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        width: 82,
        overflow: "truncate",
        color: "#314039",
        fontSize: Math.max(12, appearance.activeAppearance.value.baseFontSize - 3),
      },
    },
    series: [
      {
        name: props.dimensionLabel,
        type: "bar",
        barMaxWidth: 16,
        data: barItems.value.map((item) => ({
          name: item.name,
          value: item.amountMinor,
          appointmentCount: item.appointmentCount,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
        })),
        label: {
          show: true,
          position: "right",
          color: "#66736d",
          fontSize: Math.max(11, appearance.activeAppearance.value.baseFontSize - 4),
          formatter: (params: { value?: number }) => formatCurrency(params.value ?? 0),
        },
      },
    ],
  };
});
</script>

<template>
  <div
    ref="chartRoot"
    class="breakdown-chart"
    :class="{ 'breakdown-chart--selectable': selectable }"
    :role="selectable ? 'group' : 'img'"
    :tabindex="selectable ? 0 : undefined"
    :aria-label="
      selectable ? `${chartDescription}，可使用方向键选择并按回车查看预约` : chartDescription
    "
    @keydown="handleKeydown"
    @pointerdown="focusChart"
  >
    <div v-if="chartType === 'bar'" class="breakdown-chart__bar-scroll">
      <VChart
        ref="chartInstance"
        class="breakdown-chart__bar"
        :style="{ height: `${barHeight}px` }"
        :option="option"
        :init-options="{ renderer: 'canvas' }"
        :autoresize="{ throttle: 120 }"
        @click="selectChartItem"
      />
    </div>
    <div v-else class="breakdown-chart__pie-layout">
      <VChart
        ref="chartInstance"
        class="breakdown-chart__pie"
        :option="option"
        :init-options="{ renderer: 'canvas' }"
        :autoresize="{ throttle: 120 }"
        @click="selectChartItem"
      />
      <div class="breakdown-chart__legend" :aria-label="`${dimensionLabel}明细`">
        <template v-if="selectable">
          <button
            v-for="(item, index) in items"
            :key="item.name"
            class="breakdown-chart__legend-row"
            type="button"
            :aria-label="`查看${item.name}的收益预约明细`"
            @click="selectItem(item.name)"
          >
            <i :style="{ backgroundColor: palette[index % palette.length] }" />
            <div>
              <strong :title="item.name">{{ item.name }}</strong>
              <small>{{ item.appointmentCount }} 笔 · {{ percentage(item.amountMinor) }}</small>
            </div>
            <span class="mono-number">{{ formatCurrency(item.amountMinor) }}</span>
          </button>
        </template>
        <template v-else>
          <div v-for="(item, index) in items" :key="item.name" class="breakdown-chart__legend-row">
            <i :style="{ backgroundColor: palette[index % palette.length] }" />
            <div>
              <strong :title="item.name">{{ item.name }}</strong>
              <small>{{ item.appointmentCount }} 笔 · {{ percentage(item.amountMinor) }}</small>
            </div>
            <span class="mono-number">{{ formatCurrency(item.amountMinor) }}</span>
          </div>
        </template>
      </div>
    </div>
    <ul class="breakdown-chart__accessible-list">
      <li v-for="item in items" :key="item.name">
        {{ item.name }}，{{ formatCurrency(item.amountMinor) }}，{{ item.appointmentCount }}笔
      </li>
    </ul>
  </div>
</template>

<style scoped>
.breakdown-chart {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.breakdown-chart--selectable:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: -2px;
}

.breakdown-chart__bar-scroll {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}

.breakdown-chart__bar {
  width: 100%;
  min-height: 240px;
}

.breakdown-chart__pie-layout {
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: minmax(180px, 44%) minmax(0, 1fr);
}

.breakdown-chart__pie {
  width: 100%;
  height: 100%;
  min-height: 180px;
}

.breakdown-chart__legend {
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px 12px;
}

.breakdown-chart__legend-row {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  padding: 8px 0;
  border-top: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
}

button.breakdown-chart__legend-row {
  width: 100%;
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

button.breakdown-chart__legend-row:hover,
button.breakdown-chart__legend-row:focus-visible {
  background: color-mix(in srgb, var(--brand-soft) 42%, transparent);
}

.breakdown-chart__legend-row > i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.breakdown-chart__legend-row > div {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.breakdown-chart__legend-row strong {
  overflow: hidden;
  color: var(--ink-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.breakdown-chart__legend-row small,
.breakdown-chart__legend-row span {
  color: var(--ink-muted);
  font-size: calc(11px + var(--app-font-size-offset, 0px));
}

.breakdown-chart__accessible-list {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  padding: 0;
  margin: -1px;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
</style>
