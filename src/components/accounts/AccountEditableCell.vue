<script setup lang="ts">
import { nextTick, shallowRef, useTemplateRef, watch } from "vue";
import { parseOptionalAccountScore, type AccountEditableField } from "../../utils/accounts";

const props = defineProps<{
  value: string | number | null | undefined;
  field: AccountEditableField;
  label: string;
  disabled: boolean;
}>();
const emit = defineEmits<{ save: [value: string] }>();
const editing = shallowRef(false);
const draft = shallowRef("");
const error = shallowRef("");
const input = useTemplateRef("input");

async function start(): Promise<void> {
  if (props.disabled) return;
  draft.value = props.value?.toString() ?? "";
  error.value = "";
  editing.value = true;
  await nextTick();
  input.value?.focus();
  input.value?.select();
}

function finish(cancel = false): void {
  if (!editing.value) return;
  if (!cancel && !props.disabled && props.field !== "notes") {
    if (!parseOptionalAccountScore(draft.value).ok) {
      error.value = "请输入 0 或更大的有效整数";
      return;
    }
  }
  // 先退出编辑，再失焦，避免 Enter/Esc 引发的 blur 重复保存。
  editing.value = false;
  input.value?.blur();
  error.value = "";
  if (!cancel && !props.disabled && draft.value !== (props.value?.toString() ?? "")) {
    emit("save", draft.value);
  }
}

function keydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === "Escape" || event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    finish(event.key === "Escape");
  }
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) finish(true);
  },
);
</script>

<template>
  <div v-if="editing" class="cell-editor">
    <input
      ref="input"
      v-model="draft"
      class="cell-input"
      type="text"
      :inputmode="field === 'notes' ? 'text' : 'numeric'"
      :aria-label="label"
      :aria-invalid="Boolean(error)"
      :title="error || '回车或失焦保存，Esc 取消'"
      @keydown="keydown"
      @blur="finish()"
      @input="error = ''"
    />
    <span v-if="error" class="cell-error" role="alert">{{ error }}</span>
  </div>
  <button
    v-else
    type="button"
    class="cell-value"
    :disabled="disabled"
    :aria-label="label"
    :title="value?.toString() || '点击编辑'"
    @click="start"
  >
    {{ value ?? "—" }}
  </button>
</template>

<style scoped>
.cell-value,
.cell-input {
  width: 100%;
  min-width: 0;
  padding: 4px 0;
  border: 0;
  border-radius: 4px;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
}

.cell-value {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
}

.cell-value:hover:not(:disabled),
.cell-value:focus-visible {
  background: var(--brand-soft);
}

.cell-input {
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--brand);
}

.cell-error {
  display: block;
  color: var(--danger);
  font-size: 11px;
  white-space: normal;
}
</style>
