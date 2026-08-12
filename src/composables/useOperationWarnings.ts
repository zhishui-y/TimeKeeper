import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onMounted, onUnmounted } from "vue";
import { isTauri } from "../api/client";
import { useUiStore } from "../stores/ui";

interface OperationWarningPayload {
  operation: string;
  message: string;
}

const OPERATION_WARNING_EVENT = "operation-warning";

export function useOperationWarnings(): void {
  const ui = useUiStore();
  let mounted = false;
  let unlisten: UnlistenFn | undefined;

  onMounted(() => {
    mounted = true;
    if (!isTauri) return;
    void listen<OperationWarningPayload>(OPERATION_WARNING_EVENT, ({ payload }) => {
      if (!payload?.message) return;
      ui.notifyAfterCurrent(payload.message, "warning");
    })
      .then((stopListening) => {
        if (mounted) unlisten = stopListening;
        else stopListening();
      })
      .catch(() => {
        // 保存结果仍由 command 返回；事件只负责补充展示非致命后台警告。
      });
  });

  onUnmounted(() => {
    mounted = false;
    unlisten?.();
  });
}
