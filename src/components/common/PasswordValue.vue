<script setup lang="ts">
import { ClipboardCopy, Eye, EyeOff } from "@lucide/vue";
import { computed, shallowRef, watch } from "vue";

const props = withDefaults(
  defineProps<{
    password: string | null;
    label?: string;
    resetKey?: string | number;
    copyable?: boolean;
    compact?: boolean;
  }>(),
  {
    label: "密码",
    resetKey: "",
    copyable: true,
    compact: false,
  },
);

const emit = defineEmits<{
  copy: [];
}>();

const visible = shallowRef(false);
const displayValue = computed(() => {
  if (!props.password) return "未保存";
  return visible.value ? props.password : "••••••";
});

watch(
  () => [props.password, props.resetKey] as const,
  () => {
    visible.value = false;
  },
);
</script>

<template>
  <span class="password-value" :class="{ 'is-compact': compact, 'is-empty': !password }">
    <span class="password-value__text" :title="visible && password ? password : undefined">
      {{ displayValue }}
    </span>
    <button
      class="password-value__action"
      type="button"
      :disabled="!password"
      :title="visible ? `隐藏${label}` : `显示${label}`"
      :aria-label="visible ? `隐藏${label}` : `显示${label}`"
      @click="visible = !visible"
    >
      <EyeOff v-if="visible" :size="compact ? 12 : 13" />
      <Eye v-else :size="compact ? 12 : 13" />
    </button>
    <button
      v-if="copyable"
      class="password-value__action"
      type="button"
      :disabled="!password"
      :title="password ? `复制${label}` : `未保存${label}`"
      :aria-label="`复制${label}`"
      @click="emit('copy')"
    >
      <ClipboardCopy :size="compact ? 12 : 13" />
    </button>
  </span>
</template>

<style scoped>
.password-value {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
  color: var(--ink);
}

.password-value__text {
  min-width: 48px;
  max-width: 150px;
  overflow: hidden;
  font-family: var(--app-font-family), "Bahnschrift", var(--font-sans);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.password-value.is-empty .password-value__text {
  color: var(--ink-muted);
  font-family: var(--font-sans);
  letter-spacing: normal;
}

.password-value__action {
  display: inline-grid;
  width: 23px;
  height: 23px;
  flex: 0 0 23px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--ink-muted);
  background: transparent;
  cursor: pointer;
}

.password-value__action:hover:not(:disabled) {
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.password-value__action:disabled {
  cursor: default;
  opacity: 0.35;
}

.password-value.is-compact {
  gap: 2px;
}

.password-value.is-compact .password-value__text {
  min-width: 43px;
  max-width: 110px;
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.password-value.is-compact .password-value__action {
  width: 20px;
  height: 20px;
  flex-basis: 20px;
}
</style>
