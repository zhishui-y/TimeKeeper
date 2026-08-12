<script setup lang="ts">
import { Bell, Plus } from "@lucide/vue";

defineProps<{
  title: string;
  subtitle: string;
  dataOperationsDisabled?: boolean;
}>();

const emit = defineEmits<{
  createAppointment: [];
  openNotificationSettings: [];
}>();
</script>

<template>
  <header class="header">
    <div class="header__title">
      <h1>{{ title }}</h1>
      <p>{{ subtitle }}</p>
    </div>
    <div class="header__actions">
      <button
        class="icon-button"
        type="button"
        title="通知设置"
        aria-label="通知设置"
        @click="emit('openNotificationSettings')"
      >
        <Bell :size="17" />
      </button>
      <button
        class="button button--primary"
        type="button"
        :disabled="dataOperationsDisabled"
        @click="emit('createAppointment')"
      >
        <Plus :size="16" :stroke-width="2.2" />
        新建预约
      </button>
    </div>
  </header>
</template>

<style scoped>
.header {
  position: relative;
  z-index: 10;
  display: flex;
  height: 88px;
  flex: 0 0 88px;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  border-bottom: 1px solid rgba(73, 91, 81, 0.14);
  background: rgba(255, 253, 248, 0.9);
  box-shadow: 0 8px 28px rgba(35, 48, 40, 0.035);
  backdrop-filter: blur(16px);
}

.header::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 1px;
  background: linear-gradient(90deg, rgba(181, 82, 62, 0.18), transparent 28%);
  content: "";
  pointer-events: none;
}

.header__title {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  padding-left: 15px;
}

.header__title::before {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 0;
  width: 3px;
  border-radius: 999px;
  background: var(--accent);
  content: "";
}

.header__title h1 {
  overflow: hidden;
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-size: calc(22px + var(--app-font-size-offset, 0px));
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0.035em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header__title p {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
}

.header__actions .icon-button {
  border-color: var(--line);
  color: var(--ink-muted);
  background: rgba(255, 253, 248, 0.78);
  box-shadow: var(--shadow-control);
}

.header__actions .icon-button:hover:not(:disabled) {
  border-color: #d2b5aa;
  color: var(--accent);
  background: var(--accent-soft);
}

@media (max-width: 1180px) {
  .header {
    height: 82px;
    flex-basis: 82px;
    padding: 0 20px;
  }

  .header__title h1 {
    font-size: calc(20px + var(--app-font-size-offset, 0px));
  }

  .header__actions {
    gap: 8px;
  }
}
</style>
