<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from "vue";
import { RouterView, useRoute } from "vue-router";
import { api, errorMessage } from "./api/client";
import AppToast from "./components/common/AppToast.vue";
import AppointmentDrawer from "./components/appointments/AppointmentDrawer.vue";
import AppHeader from "./components/layout/AppHeader.vue";
import AppSidebar from "./components/layout/AppSidebar.vue";
import VaultGate from "./components/security/VaultGate.vue";
import { useAccounts } from "./composables/useAccounts";
import { useVault } from "./composables/useVault";
import { useUiStore } from "./stores/ui";
import type { AppointmentInput } from "./types/domain";

const route = useRoute();
const ui = useUiStore();
const { items: accounts } = useAccounts();
const vault = useVault();
const vaultReady = shallowRef(false);
let vaultTimer: ReturnType<typeof globalThis.setInterval> | undefined;

const pageTitle = computed(() => String(route.meta.title ?? "时约管家"));
const pageSubtitle = computed(() => String(route.meta.subtitle ?? ""));

async function saveAppointment(input: AppointmentInput): Promise<void> {
  const isEditing = Boolean(ui.activeAppointment);
  try {
    const result = ui.activeAppointment
      ? await api.updateAppointment(ui.activeAppointment.id, input)
      : await api.createAppointment(input);
    ui.closeAppointmentDrawer();
    ui.markDataChanged();
    if (result.conflicts.length > 0) {
      ui.notify(`已保存；与 ${result.conflicts.length} 条预约存在时间重叠`, "warning");
    } else {
      ui.notify(isEditing ? "预约已更新" : "预约已创建", "success");
    }
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function submitVault(password: string): Promise<void> {
  const result = vault.status.value.initialized
    ? await vault.unlock(password)
    : await vault.initialize(password);
  if (result) ui.notify("密码库已解锁", "success");
}

onMounted(async () => {
  await vault.load();
  vaultReady.value = true;
  vaultTimer = globalThis.setInterval(() => void vault.load(), 30_000);
});

onUnmounted(() => {
  if (vaultTimer !== undefined) globalThis.clearInterval(vaultTimer);
});
</script>

<template>
  <div class="app-shell">
    <AppSidebar :vault-unlocked="vault.status.value.unlocked" />
    <div class="app-main">
      <AppHeader
        :title="pageTitle"
        :subtitle="pageSubtitle"
        @create-appointment="ui.openCreateAppointment()"
      />
      <main class="app-content">
        <RouterView />
      </main>
    </div>

    <AppointmentDrawer
      :open="ui.appointmentDrawerOpen"
      :appointment="ui.activeAppointment"
      :requested-date="ui.requestedDate"
      :requested-start-time="ui.requestedStartTime"
      :accounts="accounts"
      @close="ui.closeAppointmentDrawer"
      @save="saveAppointment"
    />

    <Transition name="toast">
      <AppToast v-if="ui.toast" :toast="ui.toast" @close="ui.dismissToast" />
    </Transition>

    <VaultGate
      v-if="!vaultReady || !vault.status.value.unlocked"
      :status="vault.status.value"
      :loading="vault.loading.value"
      :ready="vaultReady"
      :error="vault.error.value"
      @submit="submitVault"
    />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  width: 100%;
  height: 100%;
  background: #eef1ed;
}

.app-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  background: var(--surface);
}

.app-content {
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 20px 24px 24px;
  background: #fbfcfa;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
