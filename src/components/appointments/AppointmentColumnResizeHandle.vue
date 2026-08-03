<script setup lang="ts">
import { shallowRef } from "vue";
import {
  MAX_APPOINTMENT_TABLE_COLUMN_WIDTH,
  MIN_APPOINTMENT_TABLE_COLUMN_WIDTHS,
  clampAppointmentTableColumnWidth,
  type AppointmentTableColumnKey,
} from "../../utils/appointmentTableColumns";

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
  columnKey: AppointmentTableColumnKey;
  label: string;
  width: number;
  disabled: boolean;
}>();

const emit = defineEmits<{
  preview: [columnKey: AppointmentTableColumnKey, width: number];
  commit: [columnKey: AppointmentTableColumnKey, width: number];
  cancel: [columnKey: AppointmentTableColumnKey, width: number];
}>();

const activeResize = shallowRef<{
  pointerId: number;
  startX: number;
  startWidth: number;
  draftWidth: number;
} | null>(null);

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
  const width = clampAppointmentTableColumnWidth(
    props.columnKey,
    active.startWidth + event.clientX - active.startX,
  );
  active.draftWidth = width;
  emit("preview", props.columnKey, width);
}

function finishResize(rawEvent: unknown): void {
  const event = rawEvent as PointerLikeEvent;
  const active = activeResize.value;
  if (!active || active.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget?.releasePointerCapture?.(event.pointerId);
  activeResize.value = null;
  emit("commit", props.columnKey, active.draftWidth);
}

function cancelResize(rawEvent?: unknown): void {
  const active = activeResize.value;
  if (!active) return;
  const event = rawEvent as PointerLikeEvent | KeyboardLikeEvent | undefined;
  event?.preventDefault();
  event?.stopPropagation();
  activeResize.value = null;
  emit("cancel", props.columnKey, active.startWidth);
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
  const width = clampAppointmentTableColumnWidth(
    props.columnKey,
    props.width + direction * (event.shiftKey ? 24 : 8),
  );
  emit("preview", props.columnKey, width);
  emit("commit", props.columnKey, width);
}
</script>

<template>
  <button
    class="column-resizer"
    type="button"
    :disabled="disabled"
    :title="`拖动调整${label}列宽；方向键每次调整8像素`"
    :aria-label="`调整${label}列宽`"
    :aria-valuemin="MIN_APPOINTMENT_TABLE_COLUMN_WIDTHS[columnKey]"
    :aria-valuemax="MAX_APPOINTMENT_TABLE_COLUMN_WIDTH"
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
