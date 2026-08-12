import { useAppAccessStore } from "../stores/appAccess";
import { useOperationStore } from "../stores/operations";
import { useUiStore } from "../stores/ui";

export function useLockApplication() {
  const access = useAppAccessStore();
  const operations = useOperationStore();
  const ui = useUiStore();

  async function lockApplication(): Promise<boolean> {
    if (operations.busy) {
      ui.notify("请等待当前后台任务完成后再锁定", "warning");
      return false;
    }
    const status = await access.lock();
    if (!status) {
      ui.notify(access.error || "锁定失败，请稍后重试", "danger");
      return false;
    }
    ui.closeAppointmentDrawer();
    operations.clearExcelPreview();
    ui.notify("时约管家已锁定", "success");
    return true;
  }

  return { lockApplication };
}
