<script setup lang="ts">
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { use } from "echarts/core";
import type { ECElementEvent } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { computed, shallowRef, useTemplateRef, watch } from "vue";
import VChart from "vue-echarts";
import { useAppAppearance } from "../../composables/useAppAppearance";
import {
  useEChartsLifecycle,
  type ResizableEChartsInstance,
} from "../../composables/useEChartsLifecycle";
import type { ReportGranularity, RevenuePoint } from "../../types/domain";
import { dateKeyWeekday } from "../../utils/chinaDateTime";

use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const props = defineProps<{
  points: readonly RevenuePoint[];
  granularity: ReportGranularity;
  from: string;
  to: string;
  drillable?: boolean;
}>();

const emit = defineEmits<{
  periodSelect: [point: RevenuePoint];
}>();

const appearance = useAppAppearance();

const chartRef = useTemplateRef("chart");
const chartInstance = useTemplateRef<ResizableEChartsInstance>("chartInstance");
const { prefersReducedMotion } = useEChartsLifecycle(chartInstance);
const activePointIndex = shallowRef(0);
const activePoint = computed(() => props.points[activePointIndex.value] ?? null);
const activePointLabel = computed(() => {
  const point = activePoint.value;
  return point
    ? `${point.period}，已结收益 ${(point.settledMinor / 100).toFixed(2)} 元，业务工时 ${point.businessHours.toFixed(1)} 小时`
    : "暂无收益数据";
});

function handleChartClick(event: ECElementEvent): void {
  if (!props.drillable || event.componentType !== "series") return;
  const point = props.points[event.dataIndex];
  if (point) {
    activePointIndex.value = event.dataIndex;
    emit("periodSelect", point);
  }
}

function focusChart(): void {
  if (!props.drillable) return;
  chartRef.value?.focus();
}

function selectKeyboardPoint(): void {
  if (!props.drillable) return;
  const point = activePoint.value;
  if (point) emit("periodSelect", point);
}

function moveKeyboardPoint(key: "ArrowLeft" | "ArrowRight" | "Home" | "End"): void {
  if (!props.drillable || props.points.length === 0) return;
  if (key === "Home") activePointIndex.value = 0;
  else if (key === "End") activePointIndex.value = props.points.length - 1;
  else {
    const offset = key === "ArrowLeft" ? -1 : 1;
    activePointIndex.value = Math.min(
      props.points.length - 1,
      Math.max(0, activePointIndex.value + offset),
    );
  }
}

watch(
  () => props.points.length,
  (length) => {
    activePointIndex.value = Math.min(activePointIndex.value, Math.max(0, length - 1));
  },
);

const spansMultipleYears = computed(() => props.from.slice(0, 4) !== props.to.slice(0, 4));

function formatPeriodLabel(period: string): string {
  const datePeriod = period.slice(0, props.granularity === "month" ? 7 : 10);
  const label = props.granularity === "month" ? datePeriod.slice(5, 7) : datePeriod.slice(5);
  return spansMultipleYears.value ? `${datePeriod.slice(0, 4)}\n${label}` : label;
}

function formatTooltipPeriod(period: string): string {
  if (props.granularity !== "day") return period;
  const weekday = dateKeyWeekday(period);
  return weekday ? `${period} ${weekday}` : period;
}

const option = computed(() => ({
  textStyle: {
    fontFamily: appearance.activeAppearance.value.fontFamily,
    fontSize: appearance.activeAppearance.value.baseFontSize,
  },
  animation: !prefersReducedMotion.value,
  animationDuration: prefersReducedMotion.value ? 0 : 420,
  animationDurationUpdate: prefersReducedMotion.value ? 0 : 300,
  color: ["#24614d", "#759288"],
  grid: {
    top: 46,
    right: 24,
    bottom: spansMultipleYears.value ? 50 : 36,
    left: 58,
    containLabel: false,
  },
  tooltip: {
    trigger: "axis",
    backgroundColor: "#fffdf8",
    borderColor: "#d8ddd5",
    borderWidth: 1,
    textStyle: {
      color: "#314039",
      fontFamily: appearance.activeAppearance.value.fontFamily,
      fontSize: Math.max(12, appearance.activeAppearance.value.baseFontSize - 3),
    },
  },
  legend: {
    top: 5,
    right: 10,
    itemWidth: 10,
    itemHeight: 7,
    textStyle: {
      color: "#66736d",
      fontFamily: appearance.activeAppearance.value.fontFamily,
      fontSize: Math.max(12, appearance.activeAppearance.value.baseFontSize - 3),
    },
  },
  xAxis: {
    type: "category",
    data: props.points.map((point) => formatTooltipPeriod(point.period)),
    axisLine: { lineStyle: { color: "#d8ddd5" } },
    axisTick: { show: false },
    axisLabel: {
      color: "#66736d",
      fontSize: Math.max(12, appearance.activeAppearance.value.baseFontSize - 3),
      hideOverlap: true,
      lineHeight: spansMultipleYears.value ? 14 : 12,
      formatter: formatPeriodLabel,
    },
  },
  yAxis: [
    {
      type: "value",
      axisLabel: {
        color: "#66736d",
        fontSize: Math.max(12, appearance.activeAppearance.value.baseFontSize - 3),
        formatter: (value: number) => `¥${value / 100}`,
      },
      splitLine: { lineStyle: { color: "#e9ede6" } },
    },
    {
      type: "value",
      axisLabel: {
        color: "#66736d",
        fontFamily: appearance.activeAppearance.value.fontFamily,
        fontSize: Math.max(12, appearance.activeAppearance.value.baseFontSize - 3),
      },
      splitLine: { show: false },
    },
  ],
  series: [
    {
      name: "已结收益",
      type: "bar",
      stack: "revenue",
      cursor: props.drillable ? "pointer" : "default",
      barMaxWidth: 28,
      data: props.points.map((point) => point.settledMinor),
      itemStyle: { borderRadius: [3, 3, 0, 0] },
      tooltip: { valueFormatter: (value: number) => `¥${(value / 100).toFixed(0)}` },
    },
    {
      name: "业务工时(小时)",
      type: "line",
      cursor: props.drillable ? "pointer" : "default",
      yAxisIndex: 1,
      smooth: 0.25,
      symbolSize: 5,
      data: props.points.map((point) => Number(point.businessHours.toFixed(1))),
      lineStyle: { width: 2 },
      tooltip: { valueFormatter: (value: number) => `${Number(value).toFixed(1)} 小时` },
    },
  ],
}));
</script>

<template>
  <div
    ref="chart"
    class="revenue-chart"
    :tabindex="drillable ? 0 : -1"
    @pointerdown="focusChart"
    @keydown.enter.prevent="selectKeyboardPoint"
    @keydown.space.prevent="selectKeyboardPoint"
    @keydown.left.prevent="moveKeyboardPoint('ArrowLeft')"
    @keydown.right.prevent="moveKeyboardPoint('ArrowRight')"
    @keydown.home.prevent="moveKeyboardPoint('Home')"
    @keydown.end.prevent="moveKeyboardPoint('End')"
  >
    <VChart
      ref="chartInstance"
      class="revenue-chart__canvas"
      :option="option"
      :init-options="{ renderer: 'canvas' }"
      :autoresize="{ throttle: 120 }"
      @click="handleChartClick"
    />
    <span v-if="activePoint" class="revenue-chart__keyboard-status" aria-hidden="true">
      当前：{{ activePointLabel }}
    </span>
    <span class="sr-only" aria-live="polite">{{ activePointLabel }}</span>
  </div>
</template>

<style scoped>
.revenue-chart {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 240px;
}

.revenue-chart__canvas {
  width: 100%;
  height: 100%;
}

.revenue-chart__keyboard-status {
  position: absolute;
  z-index: 1;
  top: 8px;
  left: 12px;
  max-width: calc(100% - 150px);
  overflow: hidden;
  padding: 5px 8px;
  border: 1px solid var(--brand-border);
  border-radius: 999px;
  color: var(--brand-strong);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  box-shadow: var(--shadow-soft);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-weight: 650;
  line-height: 1.25;
  text-overflow: ellipsis;
  visibility: hidden;
  white-space: nowrap;
  pointer-events: none;
}

.revenue-chart:focus-visible .revenue-chart__keyboard-status {
  visibility: visible;
}

.revenue-chart:focus-visible {
  border-radius: 8px;
  outline: 2px solid var(--focus-ring);
  outline-offset: -3px;
}
</style>
