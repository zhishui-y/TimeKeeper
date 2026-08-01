import { onMounted, onUnmounted } from "vue";
import { api, errorMessage } from "../api/client";
import { useUiStore } from "../stores/ui";

interface AppointmentStatusAutomationOptions {
  intervalMs?: number;
}

export function useAppointmentStatusAutomation({
  intervalMs = 30_000,
}: AppointmentStatusAutomationOptions = {}) {
  const ui = useUiStore();
  let timer: ReturnType<typeof globalThis.setInterval> | undefined;
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
    void sync();
    timer = globalThis.setInterval(() => void sync(), intervalMs);
  });

  onUnmounted(() => {
    if (timer !== undefined) globalThis.clearInterval(timer);
  });

  return { sync };
}
