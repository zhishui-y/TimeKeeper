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
  right: 24px;
  bottom: 22px;
  display: grid;
  width: min(420px, calc(100vw - 48px));
  min-height: 46px;
  grid-template-columns: 18px 1fr 28px;
  align-items: center;
  gap: 9px;
  padding: 8px 9px 8px 13px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  color: var(--ink);
  background: #fff;
  box-shadow: var(--shadow);
  font-size: 12px;
  animation: toast-in 180ms ease-out;
}

.toast--success {
  border-color: #b7d3c3;
  color: var(--brand-strong);
}

.toast--warning {
  border-color: #e3c999;
  color: #835313;
}

.toast--danger {
  border-color: #e2b7ae;
  color: #943c2c;
}

.toast__close {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 4px;
  color: currentColor;
  background: transparent;
  cursor: pointer;
  opacity: 0.7;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
