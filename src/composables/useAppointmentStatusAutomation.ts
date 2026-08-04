import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onMounted, onUnmounted } from "vue";
import { api, errorMessage, isTauri } from "../api/client";
import { useUiStore } from "../stores/ui";

const STATUS_SYNCED_EVENT = "appointment-statuses-synced";

interface AppointmentStatusAutomationOptions {
  intervalMs?: number;
}

export function useAppointmentStatusAutomation({
  intervalMs = 30_000,
}: AppointmentStatusAutomationOptions = {}) {
  const ui = useUiStore();
  let timer: ReturnType<typeof globalThis.setInterval> | undefined;
  let unlisten: UnlistenFn | undefined;
  let mounted = false;
  let syncing = false;
  let errorReported = false;

  async function sync(): Promise<void> {
    if (syncing) return;
    syncing = true;
    try {
      const changedCount = await api.syncAppointmentServiceStatuses();
      errorReported = false;
      if (changedCount > 0) ui.markDataChanged();
    } catch (cause) {
      if (!errorReported) {
        ui.notify(`自动更新预约状态失败：${errorMessage(cause)}`, "danger");
        errorReported = true;
      }
    } finally {
      syncing = false;
    }
  }

  onMounted(() => {
    mounted = true;
    if (isTauri) {
      void listen<number>(STATUS_SYNCED_EVENT, ({ payload }) => {
        if (payload > 0) ui.markDataChanged();
      })
        .then((stopListening) => {
          if (mounted) unlisten = stopListening;
          else stopListening();
        })
        .catch(() => {
          // Native event delivery is an optimization; periodic command syncing remains authoritative.
        });
    }
    void sync();
    timer = globalThis.setInterval(() => void sync(), intervalMs);
  });

  onUnmounted(() => {
    mounted = false;
    unlisten?.();
    if (timer !== undefined) globalThis.clearInterval(timer);
  });

  return { sync };
}
