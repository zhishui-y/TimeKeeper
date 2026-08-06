<script setup lang="ts">
import { Clock3, LoaderCircle } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, shallowRef } from "vue";

const props = defineProps<{
  title: string;
  detail: string;
}>();

const elapsedSeconds = shallowRef(0);
let elapsedTimer: ReturnType<typeof globalThis.setInterval> | undefined;

const elapsedLabel = computed(() =>
  elapsedSeconds.value === 0 ? "刚刚开始" : `已用时 ${elapsedSeconds.value} 秒`,
);

onMounted(() => {
  elapsedTimer = globalThis.setInterval(() => {
    elapsedSeconds.value += 1;
  }, 1000);
});

onBeforeUnmount(() => {
  if (elapsedTimer !== undefined) globalThis.clearInterval(elapsedTimer);
});
</script>

<template>
  <div role="status">
    <div class="operation-progress">
      <div class="operation-progress__summary">
        <span aria-hidden="true">
          <LoaderCircle class="operation-progress__spinner" />
        </span>
        <div class="operation-progress__copy">
          <strong>{{ props.title }}</strong>
          <span>{{ props.detail }}</span>
        </div>
        <span aria-hidden="true">
          <span class="operation-progress__elapsed">
            <Clock3 :size="12" />
            {{ elapsedLabel }}
          </span>
        </span>
      </div>
      <div
        class="operation-progress__track"
        role="progressbar"
        :aria-label="props.title"
        aria-valuetext="正在处理"
      >
        <span />
      </div>
    </div>
  </div>
</template>

<style scoped>
.operation-progress {
  margin-top: 13px;
  padding: 11px 12px 10px;
  border: 1px solid var(--brand-border);
  border-radius: var(--radius);
  background:
    linear-gradient(
      110deg,
      color-mix(in srgb, var(--brand-soft) 58%, transparent),
      transparent 72%
    ),
    var(--surface-soft);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.operation-progress__summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
}

.operation-progress__spinner {
  width: 17px;
  height: 17px;
  color: var(--brand);
  animation: operation-spin 900ms linear infinite;
}

.operation-progress__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.operation-progress__copy strong {
  color: var(--ink-strong);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.operation-progress__copy span {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: calc(10.5px + var(--app-font-size-offset, 0px));
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-progress__elapsed {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-muted);
  font-family: var(--app-font-family), "Bahnschrift", var(--font-sans);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.operation-progress__track {
  height: 4px;
  margin-top: 9px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--brand-border) 64%, var(--surface));
}

.operation-progress__track span {
  display: block;
  width: 38%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--brand), #73a08b 62%, var(--accent));
  box-shadow: 0 0 10px color-mix(in srgb, var(--brand) 28%, transparent);
  animation: operation-sweep 1.15s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}

@keyframes operation-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes operation-sweep {
  from {
    transform: translateX(-115%);
  }

  to {
    transform: translateX(280%);
  }
}

@media (max-width: 1180px) {
  .operation-progress__elapsed {
    display: none;
  }
}
</style>
