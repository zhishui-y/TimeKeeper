<script setup lang="ts">
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { computed, onBeforeUnmount, onMounted, shallowRef } from "vue";
import VChart from "vue-echarts";
import type { RevenuePoint } from "../../types/domain";

use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

const props = defineProps<{
  points: readonly RevenuePoint[];
}>();

const chart = shallowRef<InstanceType<typeof VChart> | null>(null);

function resizeChart(): void {
  chart.value?.resize();
}

onMounted(() => globalThis.addEventListener("resize", resizeChart));
onBeforeUnmount(() => globalThis.removeEventListener("resize", resizeChart));

const option = computed(() => ({
  animationDuration: 420,
  color: ["#28634f", "#d3a04e", "#80938b"],
  grid: { top: 42, right: 22, bottom: 32, left: 54, containLabel: false },
  tooltip: {
    trigger: "axis",
    backgroundColor: "#ffffff",
    borderColor: "#dce1dc",
    borderWidth: 1,
    textStyle: { color: "#35413d", fontSize: 11 },
  },
  legend: {
    top: 5,
    right: 10,
    itemWidth: 10,
    itemHeight: 7,
    textStyle: { color: "#75807c", fontSize: 10 },
  },
  xAxis: {
    type: "category",
    data: props.points.map((point) => point.period.slice(5)),
    axisLine: { lineStyle: { color: "#dce1dc" } },
    axisTick: { show: false },
    axisLabel: { color: "#7b8581", fontSize: 10 },
  },
  yAxis: [
    {
      type: "value",
      axisLabel: {
        color: "#8b9591",
        fontSize: 9,
        formatter: (value: number) => `¥${value / 100}`,
      },
      splitLine: { lineStyle: { color: "#edf0ec" } },
    },
    {
      type: "value",
      name: "小时",
      nameTextStyle: { color: "#9aa39f", fontSize: 9 },
      axisLabel: { color: "#8b9591", fontSize: 9 },
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
  <VChart ref="chart" class="revenue-chart" :option="option" :init-options="{ renderer: 'svg' }" />
</template>

<style scoped>
.revenue-chart {
  width: 100%;
  height: 100%;
  min-height: 240px;
}
</style>
