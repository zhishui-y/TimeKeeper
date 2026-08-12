<script setup lang="ts">
import ColumnResizeHandle from "../common/ColumnResizeHandle.vue";
import {
  MAX_APPOINTMENT_TABLE_COLUMN_WIDTH,
  MIN_APPOINTMENT_TABLE_COLUMN_WIDTHS,
  type AppointmentTableColumnKey,
} from "../../utils/appointmentTableColumns";

defineProps<{
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
</script>

<template>
  <ColumnResizeHandle
    :label="label"
    :width="width"
    :min-width="MIN_APPOINTMENT_TABLE_COLUMN_WIDTHS[columnKey]"
    :max-width="MAX_APPOINTMENT_TABLE_COLUMN_WIDTH"
    :disabled="disabled"
    @preview="emit('preview', columnKey, $event)"
    @commit="emit('commit', columnKey, $event)"
    @cancel="emit('cancel', columnKey, $event)"
  />
</template>
