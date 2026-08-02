<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, shallowRef, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { api, errorMessage } from "./api/client";
import AppToast from "./components/common/AppToast.vue";
import AppHeader from "./components/layout/AppHeader.vue";
import AppSidebar from "./components/layout/AppSidebar.vue";
import VaultGate from "./components/security/VaultGate.vue";
import { useAccounts } from "./composables/useAccounts";
import { useAppointmentStatusAutomation } from "./composables/useAppointmentStatusAutomation";
import { useVault } from "./composables/useVault";
import { useUiStore } from "./stores/ui";
import type { AppointmentInput } from "./types/domain";

const AppointmentDrawer = defineAsyncComponent(
  () => import("./components/appointments/AppointmentDrawer.vue"),
);

const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const {
  items: accounts,
  loading: accountsLoading,
  error: accountsError,
  load: loadAccounts,
} = useAccounts({ immediate: false });
const vault = useVault();
useAppointmentStatusAutomation();
const vaultReady = shallowRef(false);
const savingAppointment = shallowRef(false);
const appointmentDrawerLoaded = shallowRef(false);
const loadedAccountRevision = shallowRef<number | null>(null);
let vaultTimer: ReturnType<typeof globalThis.setInterval> | undefined;

const pageTitle = computed(() => String(route.meta.title ?? "时约管家"));
const pageSubtitle = computed(() => String(route.meta.subtitle ?? ""));

async function saveAppointment(input: AppointmentInput): Promise<void> {
  if (savingAppointment.value) return;
  savingAppointment.value = true;
  const isEditing = Boolean(ui.activeAppointment);
  const isSettling =
    ui.activeAppointment?.mode === "business" &&
    ui.activeAppointment.settlementStatus === "unsettled" &&
    input.settlementStatus === "settled";
  try {
    const result = ui.activeAppointment
      ? await api.updateAppointment(ui.activeAppointment.id, input)
      : await api.createAppointment(input);
    ui.closeAppointmentDrawer();
    ui.markDataChanged();
    if (result.conflicts.length > 0) {
      ui.notify(
        isSettling
          ? `已结算；该预约仍与 ${result.conflicts.length} 条预约存在时间重叠`
          : `已保存；与 ${result.conflicts.length} 条预约存在时间重叠`,
        "warning",
      );
    } else {
      ui.notify(isSettling ? "预约已结算" : isEditing ? "预约已更新" : "预约已创建", "success");
    }
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    savingAppointment.value = false;
  }
}

async function submitVault(password: string): Promise<void> {
  const result = vault.status.value.initialized
    ? await vault.unlock(password)
    : await vault.initialize(password);
  if (result) ui.notify("密码库已解锁", "success");
}

async function loadAppointmentDefaults(): Promise<void> {
  try {
    const settings = await api.getSettings();
    ui.setAppointmentDefaultReminderMinutes(settings.defaultReminderMinutes);
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function ensureAppointmentAccounts(): Promise<void> {
  const revision = ui.accountRevision;
  if (loadedAccountRevision.value === revision) return;
  await loadAccounts();
  if (!accountsError.value) loadedAccountRevision.value = revision;
}

function preventBrowserContextMenu(event: { preventDefault(): void }): void {
  event.preventDefault();
}

watch([() => ui.appointmentDrawerOpen, () => ui.accountRevision], ([open]) => {
  if (open) {
    appointmentDrawerLoaded.value = true;
    void ensureAppointmentAccounts();
  }
});

onMounted(async () => {
  globalThis.document.addEventListener("contextmenu", preventBrowserContextMenu);
  await Promise.all([vault.load(), loadAppointmentDefaults()]);
  vaultReady.value = true;
  vaultTimer = globalThis.setInterval(() => void vault.load(), 30_000);
});

onUnmounted(() => {
  globalThis.document.removeEventListener("contextmenu", preventBrowserContextMenu);
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
        @open-notification-settings="router.push({ name: 'settings' })"
      />
      <main class="app-content">
        <RouterView v-slot="{ Component, route: viewRoute }">
          <Transition name="page" mode="out-in">
            <component :is="Component" :key="viewRoute.name" />
          </Transition>
        </RouterView>
      </main>
    </div>

    <AppointmentDrawer
      v-if="appointmentDrawerLoaded"
      :open="ui.appointmentDrawerOpen"
      :appointment="ui.activeAppointment"
      :initial-focus="ui.appointmentDrawerInitialFocus"
      :requested-date="ui.requestedDate"
      :requested-start-time="ui.requestedStartTime"
      :accounts="accounts"
      :accounts-loading="accountsLoading"
      :default-reminder-minutes="ui.appointmentDefaultReminderMinutes"
      :saving="savingAppointment"
      @close="ui.closeAppointmentDrawer"
      @save="saveAppointment"
    />

    <Transition name="toast">
      <AppToast v-if="ui.toast" :toast="ui.toast" @close="ui.dismissToast" />
    </Transition>

    <VaultGate
      v-if="!vaultReady || !vault.status.value.initialized"
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
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  isolation: isolate;
  background: var(--canvas-deep);
}

.app-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  background: var(--canvas);
}

.app-content {
  position: relative;
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 22px 26px 26px;
  background:
    radial-gradient(circle at 92% 0%, rgba(181, 82, 62, 0.045), transparent 27%),
    radial-gradient(circle at 5% 100%, rgba(45, 104, 84, 0.055), transparent 32%),
    linear-gradient(145deg, #f5f4ed 0%, #efefe7 100%);
}

.page-enter-active,
.page-leave-active {
  transition:
    opacity 170ms ease,
    transform 170ms cubic-bezier(0.22, 1, 0.36, 1);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
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

@media (max-width: 1180px) {
  .app-content {
    padding: 18px 20px 20px;
  }
}

@media (max-height: 760px) {
  .app-content {
    padding-top: 16px;
    padding-bottom: 18px;
  }
}
</style>
