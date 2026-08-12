import { computed } from "vue";
import { api, errorMessage, isTauri } from "../api/client";
import { useAppAccessStore } from "../stores/appAccess";
import { useOperationStore } from "../stores/operations";
import { useUiStore } from "../stores/ui";

interface UseSettingsWorkspaceBackupOptions {
  reloadSettings: () => Promise<void>;
}

export function useSettingsWorkspaceBackup(options: UseSettingsWorkspaceBackupOptions) {
  const ui = useUiStore();
  const access = useAppAccessStore();
  const operations = useOperationStore();
  const backupOperation = computed(() => {
    if (operations.current?.kind === "backupExport") return "export";
    if (operations.current?.kind === "backupRestore") return "restore";
    return null;
  });
  const backupBusy = computed(() => operations.busy);
  const lastBackup = computed(() => operations.lastBackup);
  const backupProgress = computed(() => {
    if (backupOperation.value === "export") {
      return {
        title: "正在导出完整备份",
        detail: "正在快照数据库与设置；如仍有待迁移密码，会一并保留成对的旧密码迁移文件。",
      };
    }
    if (backupOperation.value === "restore") {
      return {
        title: "正在校验并准备恢复",
        detail: "正在验证备份内容并保存当前版本，完成后应用将自动重启。",
      };
    }
    return null;
  });

  async function createBackup(): Promise<void> {
    const destination = await api.selectBackupDestination();
    if (!destination) return;
    try {
      await operations.exportBackup(destination);
      ui.notify("完整备份已创建", "success");
    } catch (cause) {
      ui.notify(errorMessage(cause), "danger");
    }
  }

  async function restoreBackup(): Promise<void> {
    const path = await api.selectBackupFile();
    if (!path) return;
    if (!globalThis.confirm("恢复备份会先保存当前数据，成功后应用将重启。是否继续？")) {
      return;
    }
    try {
      await operations.restoreBackup(path);
      if (!isTauri) {
        ui.markDataChanged();
        await options.reloadSettings();
        await access.bootstrap();
      }
      ui.notify(
        isTauri ? "备份已恢复，正在重启应用" : "演示模式：备份校验与恢复流程已完成",
        "success",
      );
    } catch (cause) {
      ui.notify(errorMessage(cause), "danger");
    }
  }

  return {
    backupOperation,
    backupBusy,
    lastBackup,
    backupProgress,
    createBackup,
    restoreBackup,
  };
}
