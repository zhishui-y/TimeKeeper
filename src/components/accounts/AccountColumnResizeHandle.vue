<script setup lang="ts">
import ColumnResizeHandle from "../common/ColumnResizeHandle.vue";
import {
  MAX_ACCOUNT_TABLE_COLUMN_WIDTH,
  MIN_ACCOUNT_TABLE_COLUMN_WIDTHS,
  type AccountTableColumnKey,
} from "../../utils/accountTableColumns";

defineProps<{
  columnKey: AccountTableColumnKey;
  label: string;
  width: number;
  disabled: boolean;
}>();

const emit = defineEmits<{
  preview: [columnKey: AccountTableColumnKey, width: number];
  commit: [columnKey: AccountTableColumnKey, width: number];
  cancel: [columnKey: AccountTableColumnKey, width: number];
}>();
</script>

<template>
  <ColumnResizeHandle
    :label="label"
    :width="width"
    :min-width="MIN_ACCOUNT_TABLE_COLUMN_WIDTHS[columnKey]"
    :max-width="MAX_ACCOUNT_TABLE_COLUMN_WIDTH"
    :disabled="disabled"
    @preview="emit('preview', columnKey, $event)"
    @commit="emit('commit', columnKey, $event)"
    @cancel="emit('cancel', columnKey, $event)"
  />
</template>
