import type { ApiClient } from "../types";
import type { MockStore } from "./store";
import { storeAccountTableColumnWidths, storeAppointmentTableColumnWidths } from "./tableWidths";

type MockImportBackupApi = Pick<
  ApiClient,
  | "previewExcelImport"
  | "commitExcelImport"
  | "createBackup"
  | "restoreBackup"
  | "selectExcelFile"
  | "selectBackupDestination"
  | "selectBackupFile"
>;

async function waitForDevelopmentOperationProbe(): Promise<void> {
  if (!import.meta.env.DEV || typeof globalThis.localStorage === "undefined") return;
  const delay = Number(globalThis.localStorage.getItem("timekeeper-operation-delay-ms"));
  if (!Number.isFinite(delay) || delay <= 0) return;
  await new Promise((resolve) => globalThis.setTimeout(resolve, Math.min(delay, 5_000)));
}

export function createMockImportBackupApi(
  store: MockStore,
  makeId: (prefix: string) => string,
): MockImportBackupApi {
  return {
    async previewExcelImport(path, baseYear) {
      if (!Number.isInteger(baseYear) || baseYear < 2_000 || baseYear > 2_100) {
        throw new Error("短日期基准年份必须是2000到2100之间的整数");
      }
      const previewToken = makeId("preview");
      store.excelPreviewToken = previewToken;
      store.excelPreviewTokenExpiresAt = Date.now() + 30 * 60_000;
      return {
        sourcePath: path,
        baseYear,
        appointmentCount: 357,
        profileCount: 22,
        unmatchedProfileCount: 0,
        crossMidnightCount: 50,
        yyChannelCount: 64,
        passwordConflictCount: 1,
        skippedCount: 0,
        warningCount: 2,
        warnings: [
          "1个同名账号存在多个历史密码，账号档案和各预约将分别保留各自密码",
          "50条跨午夜记录已按次日结束处理",
        ],
        previewToken,
      };
    },
    async commitExcelImport(previewToken, selection) {
      if (!store.excelPreviewToken || previewToken !== store.excelPreviewToken) {
        throw new Error("导入预览已失效，请重新生成");
      }
      if (!store.excelPreviewTokenExpiresAt || store.excelPreviewTokenExpiresAt <= Date.now()) {
        store.excelPreviewToken = null;
        store.excelPreviewTokenExpiresAt = null;
        throw new Error("导入预览已失效，请重新生成");
      }
      // Consume the token before validation so a failed commit cannot be replayed.
      store.excelPreviewToken = null;
      store.excelPreviewTokenExpiresAt = null;
      if (!selection.appointments && !selection.accounts) {
        throw new Error("请至少选择导入预约或账号");
      }
      return {
        importedAppointments: selection.appointments ? 357 : 0,
        importedProfiles: selection.accounts ? 22 : 0,
        skippedDuplicates: 0,
        skippedAppointmentDuplicates: 0,
        skippedProfileDuplicates: 0,
        warnings: [],
      };
    },
    async createBackup(destination) {
      await waitForDevelopmentOperationProbe();
      const path =
        destination ?? "C:\\Users\\Demo\\Documents\\TimeKeeper\\backups\\timekeeper-demo.tkbackup";
      store.backupSnapshot = {
        appointments: structuredClone(store.appointments),
        accounts: structuredClone(store.accounts),
        settings: structuredClone(store.settings),
        appAccess: {
          initialized: store.appAccess.initialized,
          legacyMigrationPendingCount: store.appAccess.legacyMigrationPendingCount,
          recoveryQuestion: store.appAccess.recoveryQuestion,
          dataRepairIssueCount: store.appAccess.dataRepairIssueCount,
          dataRepairIssues: structuredClone(store.appAccess.dataRepairIssues),
        },
        appAccessPassword: store.appAccessPassword,
        appAccessRecoveryAnswer: store.appAccessRecoveryAnswer,
      };
      store.lastBackupPath = path;
      return { path, createdAt: new Date().toISOString(), sizeBytes: 842_136 };
    },
    async restoreBackup(path) {
      const snapshot = store.backupSnapshot;
      if (!snapshot || path !== store.lastBackupPath) {
        throw new Error("未找到可恢复的演示备份，请先创建备份");
      }
      storeAccountTableColumnWidths(snapshot.settings.accountTableColumnWidths);
      storeAppointmentTableColumnWidths(snapshot.settings.appointmentTableColumnWidths);
      store.appointments = structuredClone(snapshot.appointments);
      store.accounts = structuredClone(snapshot.accounts);
      store.settings = structuredClone(snapshot.settings);
      store.appAccess = { ...structuredClone(snapshot.appAccess), unlocked: false };
      store.appAccessPassword = snapshot.appAccessPassword;
      store.appAccessRecoveryAnswer = snapshot.appAccessRecoveryAnswer;
      store.excelPreviewToken = null;
      store.excelPreviewTokenExpiresAt = null;
    },
    async selectExcelFile() {
      return "C:\\Users\\Demo\\Desktop\\account.xlsm";
    },
    async selectBackupDestination() {
      return "C:\\Users\\Demo\\Documents\\TimeKeeper\\TimeKeeper-demo.tkbackup";
    },
    async selectBackupFile() {
      return (
        store.lastBackupPath ??
        "C:\\Users\\Demo\\Documents\\TimeKeeper\\backups\\timekeeper-latest.tkbackup"
      );
    },
  };
}
