<script setup lang="ts">
import { CheckCircle2, CircleAlert, Info, X } from "@lucide/vue";
import { computed } from "vue";
import type { ToastMessage } from "../../stores/ui";

const props = defineProps<{
  toast: ToastMessage;
}>();

const emit = defineEmits<{
  close: [];
}>();

const icon = computed(() => {
  if (props.toast.tone === "success") return CheckCircle2;
  if (props.toast.tone === "danger" || props.toast.tone === "warning") return CircleAlert;
  return Info;
});
</script>

<template>
  <div class="toast" :class="`toast--${toast.tone}`" role="status">
    <component :is="icon" :size="17" />
    <span>{{ toast.message }}</span>
    <button class="toast__close" type="button" aria-label="关闭提示" @click="emit('close')">
      <X :size="15" />
    </button>
  </div>
</template>

<style scoped>
.toast {
  position: fixed;
  z-index: 80;
  right: 26px;
  bottom: 24px;
  display: grid;
  width: min(420px, calc(100vw - 52px));
  min-height: 52px;
  grid-template-columns: 20px minmax(0, 1fr) 30px;
  align-items: center;
  gap: 10px;
  padding: 9px 9px 9px 16px;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  color: var(--ink);
  background: rgba(255, 253, 248, 0.96);
  box-shadow: var(--shadow);
  font-size: 12px;
  line-height: 1.5;
  backdrop-filter: blur(14px);
}

.toast::before {
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 0;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--blue);
  content: "";
}

.toast > svg {
  color: var(--blue);
}

.toast--success {
  border-color: var(--brand-border);
}

.toast--success::before {
  background: var(--brand);
}

.toast--success > svg {
  color: var(--brand);
}

.toast--warning {
  border-color: var(--amber-border);
}

.toast--warning::before {
  background: var(--amber);
}

.toast--warning > svg {
  color: var(--amber);
}

.toast--danger {
  border-color: #dfb8ae;
}

.toast--danger::before {
  background: var(--danger);
}

.toast--danger > svg {
  color: var(--danger);
}

.toast__close {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 0;
  border-radius: 9px;
  color: var(--ink-muted);
  background: transparent;
  cursor: pointer;
  transition:
    color 140ms ease,
    background-color 140ms ease;
}

.toast__close:hover {
  color: var(--ink-strong);
  background: var(--surface-soft);
}
</style>
