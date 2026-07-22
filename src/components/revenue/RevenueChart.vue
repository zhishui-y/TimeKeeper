<script setup lang="ts">
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { computed, onBeforeUnmount, onMounted, shallowRef } from "vue";
import VChart from "vue-echarts";
import type { RevenuePoint } from "../../types/domain";

use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const props = defineProps<{
  points: readonly RevenuePoint[];
}>();

const reducedMotionQuery =
  typeof globalThis.matchMedia === "function"
    ? globalThis.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
const prefersReducedMotion = shallowRef(reducedMotionQuery?.matches ?? false);

function updateReducedMotion(): void {
  prefersReducedMotion.value = reducedMotionQuery?.matches ?? false;
}

onMounted(() => reducedMotionQuery?.addEventListener("change", updateReducedMotion));
onBeforeUnmount(() => reducedMotionQuery?.removeEventListener("change", updateReducedMotion));

const option = computed(() => ({
  animation: !prefersReducedMotion.value,
  animationDuration: prefersReducedMotion.value ? 0 : 420,
  animationDurationUpdate: prefersReducedMotion.value ? 0 : 300,
  color: ["#24614d", "#c98834", "#759288"],
  grid: { top: 46, right: 24, bottom: 36, left: 58, containLabel: false },
  tooltip: {
    trigger: "axis",
    backgroundColor: "#fffdf8",
    borderColor: "#d8ddd5",
    borderWidth: 1,
    textStyle: { color: "#314039", fontSize: 12 },
  },
  legend: {
    top: 5,
    right: 10,
    itemWidth: 10,
    itemHeight: 7,
    textStyle: { color: "#66736d", fontSize: 11 },
  },
  xAxis: {
    type: "category",
    data: props.points.map((point) => point.period.slice(5)),
    axisLine: { lineStyle: { color: "#d8ddd5" } },
    axisTick: { show: false },
    axisLabel: { color: "#66736d", fontSize: 11 },
  },
  yAxis: [
    {
      type: "value",
      axisLabel: {
        color: "#66736d",
        fontSize: 10,
        formatter: (value: number) => `¥${value / 100}`,
      },
      splitLine: { lineStyle: { color: "#e9ede6" } },
    },
    {
      type: "value",
      name: "小时",
      nameTextStyle: { color: "#66736d", fontSize: 10 },
      axisLabel: { color: "#66736d", fontSize: 10 },
      splitLine: { show: false },
    },
  ],
  series: [
    {
      name: "已结收益",
      type: "bar",
      barMaxWidth: 28,
      data: props.points.map((point) => point.settledMinor),
      itemStyle: { borderRadius: [3, 3, 0, 0] },
      tooltip: { valueFormatter: (value: number) => `¥${(value / 100).toFixed(0)}` },
    },
    {
      name: "待结金额",
      type: "bar",
      barMaxWidth: 28,
      data: props.points.map((point) => point.unsettledMinor),
      itemStyle: { borderRadius: [3, 3, 0, 0] },
      tooltip: { valueFormatter: (value: number) => `¥${(value / 100).toFixed(0)}` },
    },
    {
      name: "业务工时",
      type: "line",
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
  <VChart
    class="revenue-chart"
    :option="option"
    :init-options="{ renderer: 'canvas' }"
    :autoresize="{ throttle: 120 }"
  />
</template>

<style scoped>
.revenue-chart {
  width: 100%;
  height: 100%;
  min-height: 240px;
}
</style>
