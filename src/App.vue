<script setup lang="ts">
import { onMounted, shallowRef } from "vue";
import { useAppAppearance } from "./composables/useAppAppearance";
import AppBrandIcon from "./components/common/AppBrandIcon.vue";
import AuthenticatedAppShell from "./components/layout/AuthenticatedAppShell.vue";
import AppAccessGate from "./components/security/AppAccessGate.vue";
import { useAppAccessStore } from "./stores/appAccess";

const access = useAppAccessStore();
const appearance = useAppAppearance();
const startupReady = shallowRef(false);

onMounted(async () => {
  await Promise.all([access.bootstrap(), appearance.load()]);
  startupReady.value = true;
});
</script>

<template>
  <div v-if="!startupReady" class="app-startup" role="status" aria-live="polite">
    <AppBrandIcon class="app-startup__seal" />
    <strong>正在打开时约管家</strong>
    <span>正在应用本机外观并检查入口状态…</span>
  </div>
  <AuthenticatedAppShell v-else-if="access.ready && access.unlocked && access.recoveryQuestion" />
  <AppAccessGate v-else />
</template>

<style scoped>
.app-startup {
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 1100px;
  min-height: 700px;
  place-content: center;
  justify-items: center;
  gap: 12px;
  color: var(--ink);
  background:
    radial-gradient(circle at 18% 20%, rgba(255, 253, 248, 0.94), transparent 34%),
    linear-gradient(145deg, var(--canvas), var(--canvas-deep));
}

.app-startup__seal {
  width: 54px;
  height: 54px;
  filter: drop-shadow(0 10px 18px rgba(35, 48, 40, 0.16));
}

.app-startup strong {
  color: var(--ink-strong);
  font-family: var(--font-serif);
  font-size: calc(21px + var(--app-font-size-offset, 0px));
}

.app-startup span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}
</style>
