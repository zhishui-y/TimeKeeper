<script setup lang="ts">
import { Bell, Plus } from "@lucide/vue";

defineProps<{
  title: string;
  subtitle: string;
}>();

const emit = defineEmits<{
  createAppointment: [];
}>();
</script>

<template>
  <header class="header">
    <div class="header__title">
      <h1>{{ title }}</h1>
      <p>{{ subtitle }}</p>
    </div>
    <div class="header__actions">
      <button class="icon-button" type="button" title="通知" aria-label="通知">
        <Bell :size="17" />
        <span class="notification-dot" />
      </button>
      <button class="button button--primary" type="button" @click="emit('createAppointment')">
        <Plus :size="16" :stroke-width="2.2" />
        新建预约
      </button>
    </div>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  height: 78px;
  flex: 0 0 78px;
  align-items: center;
  justify-content: space-between;
  padding: 0 26px;
  border-bottom: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.94);
}

.header__title {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.header__title h1 {
  color: var(--ink-strong);
  font-size: 19px;
  font-weight: 760;
  line-height: 1.25;
}

.header__title p {
  color: var(--ink-muted);
  font-size: 12px;
}

.header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header__actions .icon-button {
  position: relative;
  border-color: var(--line);
  background: var(--surface);
}

.notification-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 5px;
  height: 5px;
  border: 1px solid #fff;
  border-radius: 50%;
  background: var(--accent);
}
</style>
