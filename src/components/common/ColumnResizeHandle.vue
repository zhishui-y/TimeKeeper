<script setup lang="ts">
import { shallowRef } from "vue";
import { useAnimationFrameBatch } from "../../composables/useAnimationFrameBatch";

interface PointerLikeEvent {
  clientX: number;
  pointerId: number;
  currentTarget?: {
    setPointerCapture?(pointerId: number): void;
    releasePointerCapture?(pointerId: number): void;
  } | null;
  preventDefault(): void;
  stopPropagation(): void;
}

interface KeyboardLikeEvent {
  key: string;
  shiftKey?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

const props = defineProps<{
  label: string;
  width: number;
  minWidth: number;
  maxWidth: number;
  disabled: boolean;
}>();

const emit = defineEmits<{
  preview: [width: number];
  commit: [width: number];
  cancel: [width: number];
}>();

const activeResize = shallowRef<{
  pointerId: number;
  startX: number;
  startWidth: number;
  draftWidth: number;
} | null>(null);
const previewBatch = useAnimationFrameBatch<number>((width) => emit("preview", width));

function clampWidth(width: number): number {
  return Math.min(props.maxWidth, Math.max(props.minWidth, Math.round(width)));
}

function startResize(rawEvent: unknown): void {
  const event = rawEvent as PointerLikeEvent;
  if (props.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget?.setPointerCapture?.(event.pointerId);
  activeResize.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: props.width,
    draftWidth: props.width,
  };
}

function previewResize(rawEvent: unknown): void {
  const event = rawEvent as PointerLikeEvent;
  const active = activeResize.value;
  if (!active || active.pointerId !== event.pointerId) return;
  event.preventDefault();
  const width = clampWidth(active.startWidth + event.clientX - active.startX);
  active.draftWidth = width;
  previewBatch.schedule(width);
}

function finishResize(rawEvent: unknown): void {
  const event = rawEvent as PointerLikeEvent;
  const active = activeResize.value;
  if (!active || active.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget?.releasePointerCapture?.(event.pointerId);
  previewBatch.flush();
  activeResize.value = null;
  emit("commit", active.draftWidth);
}

function cancelResize(rawEvent?: unknown): void {
  const active = activeResize.value;
  if (!active) return;
  const event = rawEvent as PointerLikeEvent | KeyboardLikeEvent | undefined;
  event?.preventDefault();
  event?.stopPropagation();
  previewBatch.cancel();
  activeResize.value = null;
  emit("cancel", active.startWidth);
}

function handleKeydown(rawEvent: unknown): void {
  const event = rawEvent as KeyboardLikeEvent;
  if (event.key === "Escape") {
    cancelResize(event);
    return;
  }
  if (props.disabled || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
  event.preventDefault();
  event.stopPropagation();
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  const width = clampWidth(props.width + direction * (event.shiftKey ? 24 : 8));
  emit("preview", width);
  emit("commit", width);
}
</script>

<template>
  <button
    class="column-resizer"
    type="button"
    :disabled="disabled"
    :title="`拖动调整${label}列宽；方向键每次调整8像素`"
    :aria-label="`调整${label}列宽`"
    :aria-valuemin="minWidth"
    :aria-valuemax="maxWidth"
    :aria-valuenow="width"
    @pointerdown="startResize"
    @pointermove="previewResize"
    @pointerup="finishResize"
    @pointercancel="cancelResize"
    @keydown="handleKeydown"
  />
</template>

<style scoped>
.column-resizer {
  position: absolute;
  z-index: 4;
  top: 0;
  right: 0;
  width: 10px;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: col-resize;
  touch-action: none;
}

.column-resizer::after {
  position: absolute;
  top: 8px;
  right: 4px;
  bottom: 8px;
  width: 1px;
  border-radius: 1px;
  background: transparent;
  content: "";
}

.column-resizer:hover::after,
.column-resizer:focus-visible::after {
  background: var(--brand);
}

.column-resizer:focus-visible {
  outline: none;
}

.column-resizer:disabled {
  cursor: wait;
}
</style>
