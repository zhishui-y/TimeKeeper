<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, shallowRef, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { api, errorMessage } from "../../api/client";
import { useAccounts } from "../../composables/useAccounts";
import { useAppointmentStatusAutomation } from "../../composables/useAppointmentStatusAutomation";
import { useOperationWarnings } from "../../composables/useOperationWarnings";
import { useLockApplication } from "../../composables/useLockApplication";
import { useAppAccessStore } from "../../stores/appAccess";
import { useOperationStore } from "../../stores/operations";
import { useUiStore } from "../../stores/ui";
import type { AppointmentInput } from "../../types/domain";
import AppToast from "../common/AppToast.vue";
import AppHeader from "./AppHeader.vue";
import AppSidebar from "./AppSidebar.vue";

const LazyAppointmentDrawer = defineAsyncComponent(
  () => import("../appointments/AppointmentDrawer.vue"),
);

const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const access = useAppAccessStore();
const operations = useOperationStore();
const {
  items: accounts,
  loading: accountsLoading,
  error: accountsError,
  load: loadAccounts,
} = useAccounts({ immediate: false });
useAppointmentStatusAutomation();
useOperationWarnings();
const { lockApplication } = useLockApplication();

const savingAppointment = shallowRef(false);
const deletingAppointment = shallowRef(false);
const appointmentDrawerLoaded = shallowRef(false);
const loadedAccountRevision = shallowRef<number | null>(null);
const pageTitle = computed(() => String(route.meta.title ?? "时约管家"));
const pageSubtitle = computed(() => String(route.meta.subtitle ?? ""));

async function saveAppointment(input: AppointmentInput): Promise<void> {
  if (savingAppointment.value || operations.busy) {
    if (operations.busy) ui.notify("请等待当前后台任务完成后再保存预约", "warning");
    return;
  }
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
    await access.refreshStatus();
    if (result.conflicts.length > 0) {
      ui.notify(
        isSettling
          ? `已完成；该预约仍与 ${result.conflicts.length} 条预约存在时间重叠`
          : `已保存；与 ${result.conflicts.length} 条预约存在时间重叠`,
        "warning",
      );
    } else {
      ui.notify(isSettling ? "预约已完成" : isEditing ? "预约已更新" : "预约已创建", "success");
    }
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    savingAppointment.value = false;
  }
}

async function removeActiveAppointment(): Promise<void> {
  const appointment = ui.activeAppointment;
  if (!appointment || savingAppointment.value || deletingAppointment.value || operations.busy)
    return;
  if (!globalThis.confirm(`确定永久删除 ${appointment.contactName} 的这条预约吗？`)) return;

  deletingAppointment.value = true;
  try {
    await api.deleteAppointment(appointment.id);
    ui.closeAppointmentDrawer();
    ui.markDataChanged();
    ui.notify("预约已永久删除", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    deletingAppointment.value = false;
  }
}

async function copyAppointmentPassword(appointmentId: string): Promise<void> {
  try {
    await api.copyAppointmentAccountPassword(appointmentId);
    ui.notify("账号密码已复制，30秒后自动清空剪贴板", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
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

function openCreateAppointment(): void {
  if (operations.busy) {
    ui.notify("请等待当前后台任务完成后再新建预约", "warning");
    return;
  }
  ui.openCreateAppointment();
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

onMounted(() => {
  globalThis.document.addEventListener("contextmenu", preventBrowserContextMenu);
  void loadAppointmentDefaults();
});

onUnmounted(() => {
  globalThis.document.removeEventListener("contextmenu", preventBrowserContextMenu);
});
</script>

<template>
  <div class="app-shell" :aria-busy="savingAppointment || deletingAppointment">
    <AppSidebar @lock="lockApplication" />
    <div class="app-main">
      <AppHeader
        :title="pageTitle"
        :subtitle="pageSubtitle"
        :data-operations-disabled="operations.busy"
        @create-appointment="openCreateAppointment"
        @open-notification-settings="router.push({ name: 'settings' })"
      />
      <button
        v-if="access.dataRepairIssueCount > 0"
        class="app-repair-banner"
        type="button"
        @click="router.push({ name: 'settings', hash: '#data-repair-issues' })"
      >
        检测到 {{ access.dataRepairIssueCount }} 项旧数据超出安全范围，请前往入口安全设置修复
      </button>
      <main class="app-content">
        <RouterView v-slot="{ Component, route: viewRoute }">
          <component :is="Component" :key="viewRoute.name" />
        </RouterView>
      </main>
    </div>

    <div v-if="savingAppointment || deletingAppointment" class="app-shell__busy" role="status">
      <span class="app-shell__busy-dot" aria-hidden="true" />
      {{ deletingAppointment ? "正在删除预约" : "正在保存预约" }}
    </div>

    <div v-if="operations.current" class="app-shell__operation" role="status" aria-live="polite">
      <span class="app-shell__busy-dot" aria-hidden="true" />
      <span>
        <strong>{{ operations.current.title }}</strong>
        <small>{{ operations.current.detail }}</small>
      </span>
      <span v-if="operations.current.totalCount" class="mono-number">
        {{ operations.current.completedCount ?? 0 }}/{{ operations.current.totalCount }}
      </span>
    </div>

    <LazyAppointmentDrawer
      v-if="appointmentDrawerLoaded"
      :open="ui.appointmentDrawerOpen"
      :appointment="ui.activeAppointment"
      :draft-seed="ui.appointmentDraftSeed"
      :initial-focus="ui.appointmentDrawerInitialFocus"
      :requested-date="ui.requestedDate"
      :requested-start-time="ui.requestedStartTime"
      :accounts="accounts"
      :accounts-loading="accountsLoading"
      :default-reminder-minutes="ui.appointmentDefaultReminderMinutes"
      :saving="savingAppointment || operations.busy"
      :deleting="deletingAppointment || operations.busy"
      @close="ui.closeAppointmentDrawer"
      @copy-password="copyAppointmentPassword"
      @delete="removeActiveAppointment"
      @duplicate="ui.openDuplicateAppointment"
      @save="saveAppointment"
    />

    <Transition name="toast">
      <AppToast v-if="ui.toast" :toast="ui.toast" @close="ui.dismissToast" />
    </Transition>
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
  scrollbar-gutter: stable;
  padding: 22px 26px 26px;
  background:
    radial-gradient(circle at 92% 0%, rgba(181, 82, 62, 0.045), transparent 27%),
    radial-gradient(circle at 5% 100%, rgba(45, 104, 84, 0.055), transparent 32%),
    linear-gradient(145deg, #f5f4ed 0%, #efefe7 100%);
}

.app-repair-banner {
  margin: 10px 26px 0;
  padding: 9px 12px;
  border: 1px solid var(--amber-border);
  border-radius: var(--radius-sm, 8px);
  color: #815414;
  background: var(--amber-soft);
  text-align: left;
  cursor: pointer;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}

.app-shell__busy {
  position: fixed;
  z-index: 80;
  top: 92px;
  right: 28px;
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--brand-border);
  border-radius: 999px;
  color: var(--brand-strong);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  box-shadow: var(--shadow-soft);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.app-shell__operation {
  position: fixed;
  z-index: 81;
  right: 28px;
  bottom: 24px;
  display: flex;
  max-width: 520px;
  align-items: center;
  gap: 10px;
  padding: 10px 13px;
  border: 1px solid var(--brand-border);
  border-radius: var(--radius, 12px);
  color: var(--brand-strong);
  background: color-mix(in srgb, var(--surface) 96%, transparent);
  box-shadow: var(--shadow-soft);
}

.app-shell__operation > span:nth-child(2) {
  display: grid;
  gap: 2px;
}

.app-shell__operation strong {
  font-size: calc(13px + var(--app-font-size-offset, 0px));
}

.app-shell__operation small {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.app-shell__busy-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: busy-pulse 1.1s ease-in-out infinite alternate;
}

@keyframes busy-pulse {
  to {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-shell__busy-dot,
  .toast-enter-active,
  .toast-leave-active {
    animation: none;
    transition: none;
  }
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
