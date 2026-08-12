import { defineStore } from "pinia";
import { computed, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type {
  AccountRoleDataRefreshProgress,
  AccountRoleDataRefreshResult,
  AppOperationKind,
  AppOperationState,
  BackupResult,
  ExcelImportPreview,
  ExcelImportResult,
  ExcelImportSelection,
} from "../types/domain";

interface OperationCopy {
  title: string;
  detail: string;
}

const OPERATION_COPY: Record<AppOperationKind, OperationCopy> = {
  excelPreview: {
    title: "正在生成导入预览",
    detail: "正在读取并解析 Excel 工作表，可以切换页面，但请保持应用开启。",
  },
  excelCommit: {
    title: "正在导入 Excel 账本",
    detail: "正在事务内写入并检查重复数据，可以切换页面，但请勿关闭应用。",
  },
  backupExport: {
    title: "正在导出完整备份",
    detail: "正在创建数据库、设置与兼容凭据的完整副本。",
  },
  backupRestore: {
    title: "正在校验并恢复备份",
    detail: "正在校验备份并保存当前版本；成功后原生应用将重启。",
  },
  accountRoleRefresh: {
    title: "正在更新角色数据",
    detail: "正在批量读取账号并以最多 3 路网络并发更新角色数据。",
  },
};

export const useOperationStore = defineStore("operations", () => {
  const current = shallowRef<AppOperationState | null>(null);
  const excelPreview = shallowRef<ExcelImportPreview | null>(null);
  const excelResult = shallowRef<ExcelImportResult | null>(null);
  const lastBackup = shallowRef<BackupResult | null>(null);
  const roleRefreshResult = shallowRef<AccountRoleDataRefreshResult | null>(null);
  const roleRefreshTargetIds = shallowRef<ReadonlySet<string>>(new Set());
  const roleRefreshError = shallowRef<string | null>(null);
  const lastCompleted = shallowRef<AppOperationState | null>(null);
  let sequence = 0;

  const busy = computed(() => current.value?.status === "running");

  function begin(kind: AppOperationKind, totalCount?: number): number {
    if (busy.value) throw new Error(`“${current.value?.title ?? "后台任务"}”尚未完成，请稍候`);
    const id = ++sequence;
    const copy = OPERATION_COPY[kind];
    current.value = {
      id,
      kind,
      status: "running",
      title: copy.title,
      detail: copy.detail,
      startedAt: new Date().toISOString(),
      completedCount: totalCount === undefined ? null : 0,
      totalCount: totalCount ?? null,
      error: null,
    };
    return id;
  }

  function updateProgress(id: number, completedCount: number, totalCount: number): void {
    if (current.value?.id !== id || current.value.status !== "running") return;
    current.value = { ...current.value, completedCount, totalCount };
  }

  function finish(id: number): void {
    if (current.value?.id !== id) return;
    const result: AppOperationState = {
      ...current.value,
      status: "completed",
      completedAt: new Date().toISOString(),
      completedCount: current.value.totalCount ?? current.value.completedCount,
    };
    lastCompleted.value = result;
    current.value = null;
  }

  function fail(id: number, cause: unknown): never {
    const message = errorMessage(cause);
    if (current.value?.id === id) {
      lastCompleted.value = {
        ...current.value,
        status: "failed",
        error: message,
        completedAt: new Date().toISOString(),
      };
      current.value = null;
    }
    throw cause;
  }

  async function previewExcel(path: string, baseYear: number): Promise<ExcelImportPreview> {
    const id = begin("excelPreview");
    excelPreview.value = null;
    excelResult.value = null;
    try {
      const result = await api.previewExcelImport(path, baseYear);
      excelPreview.value = result;
      finish(id);
      return result;
    } catch (cause) {
      return fail(id, cause);
    }
  }

  function clearExcelPreview(): void {
    excelPreview.value = null;
  }

  async function commitExcel(selection: ExcelImportSelection): Promise<ExcelImportResult> {
    const token = excelPreview.value?.previewToken;
    if (!token) throw new Error("导入预览已失效，请重新生成");
    const id = begin("excelCommit");
    // Native commit consumes the single-slot token before it acquires database locks.
    excelPreview.value = null;
    try {
      const result = await api.commitExcelImport(token, selection);
      excelResult.value = result;
      finish(id);
      return result;
    } catch (cause) {
      return fail(id, cause);
    }
  }

  async function exportBackup(destination: string): Promise<BackupResult> {
    const id = begin("backupExport");
    try {
      const result = await api.createBackup(destination);
      lastBackup.value = result;
      finish(id);
      return result;
    } catch (cause) {
      return fail(id, cause);
    }
  }

  async function restoreBackup(path: string): Promise<void> {
    const id = begin("backupRestore");
    try {
      await api.restoreBackup(path);
      finish(id);
    } catch (cause) {
      fail(id, cause);
    }
  }

  async function refreshRoleData(
    ids: string[],
    onProgress?: (progress: AccountRoleDataRefreshProgress) => void,
  ): Promise<AccountRoleDataRefreshResult> {
    if (ids.length > 1000) throw new Error("单次最多更新 1000 个账号");
    const id = begin("accountRoleRefresh", ids.length);
    roleRefreshResult.value = null;
    roleRefreshError.value = null;
    roleRefreshTargetIds.value = new Set(ids);
    try {
      const result = await api.refreshAccountProfileRoleData(ids, (progress) => {
        updateProgress(id, progress.completedCount, progress.requestedCount);
        const pendingIds = new Set(roleRefreshTargetIds.value);
        pendingIds.delete(progress.item.accountId);
        roleRefreshTargetIds.value = pendingIds;
        onProgress?.(progress);
      });
      roleRefreshResult.value = result;
      finish(id);
      return result;
    } catch (cause) {
      roleRefreshError.value = errorMessage(cause);
      return fail(id, cause);
    } finally {
      roleRefreshTargetIds.value = new Set();
    }
  }

  return {
    current,
    busy,
    lastCompleted,
    excelPreview,
    excelResult,
    lastBackup,
    roleRefreshResult,
    roleRefreshTargetIds,
    roleRefreshError,
    previewExcel,
    commitExcel,
    clearExcelPreview,
    exportBackup,
    restoreBackup,
    refreshRoleData,
  };
});
