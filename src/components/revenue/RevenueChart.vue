<script setup lang="ts">
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { use } from "echarts/core";
import type { ECElementEvent } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from "vue";
import VChart from "vue-echarts";
import { useAppAppearance } from "../../composables/useAppAppearance";
import type { ReportGranularity, RevenuePoint } from "../../types/domain";

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
const chartInstance = useTemplateRef<{ resize?: () => void }>("chartInstance");

const reducedMotionQuery =
  typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
const prefersReducedMotion = shallowRef(reducedMotionQuery?.matches ?? false);

function updateReducedMotion(): void {
  prefersReducedMotion.value = reducedMotionQuery?.matches ?? false;
}

function handleChartClick(event: ECElementEvent): void {
  if (!props.drillable || event.componentType !== "series") return;
  const point = props.points[event.dataIndex];
  if (point) emit("periodSelect", point);
}

function focusChart(): void {
  if (!props.drillable) return;
  chartRef.value?.focus();
}

function selectKeyboardPoint(): void {
  if (!props.drillable) return;
  const point = props.points.find((item) => item.appointmentCount > 0) ?? props.points[0];
  if (point) emit("periodSelect", point);
}

function refreshChartSize(): void {
  globalThis.requestAnimationFrame(() => chartInstance.value?.resize?.());
}

onMounted(() => reducedMotionQuery?.addEventListener("change", updateReducedMotion));
onMounted(() => globalThis.addEventListener("timekeeper-appearance-changed", refreshChartSize));
onBeforeUnmount(() => {
  reducedMotionQuery?.removeEventListener("change", updateReducedMotion);
  globalThis.removeEventListener("timekeeper-appearance-changed", refreshChartSize);
});

const spansMultipleYears = computed(() => props.from.slice(0, 4) !== props.to.slice(0, 4));

function formatPeriodLabel(period: string): string {
  const label = props.granularity === "month" ? period.slice(5, 7) : period.slice(5);
  return spansMultipleYears.value ? `${period.slice(0, 4)}\n${label}` : label;
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
    data: props.points.map((point) => point.period),
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
      name: "小时",
      nameTextStyle: {
        color: "#66736d",
        fontFamily: appearance.activeAppearance.value.fontFamily,
        fontSize: Math.max(12, appearance.activeAppearance.value.baseFontSize - 3),
      },
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
      name: "业务工时",
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
  >
    <VChart
      ref="chartInstance"
      class="revenue-chart__canvas"
      :option="option"
      :init-options="{ renderer: 'canvas' }"
      :autoresize="{ throttle: 120 }"
      @click="handleChartClick"
    />
  </div>
</template>

<style scoped>
.revenue-chart {
  width: 100%;
  height: 100%;
  min-height: 240px;
}

.revenue-chart__canvas {
  width: 100%;
  height: 100%;
}

.revenue-chart:focus-visible {
  border-radius: 8px;
  outline: 2px solid var(--focus-ring);
  outline-offset: -3px;
}
</style>
