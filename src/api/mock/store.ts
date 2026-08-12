import type { AccountProfile, AppAccessStatus, AppSettings, Appointment } from "../../types/domain";
import { DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL } from "../../utils/accountRoleData";
import { chinaDateKey } from "../../utils/chinaDateTime";
import { demoAccounts, demoAppointments } from "../mockData";
import {
  loadStoredAccountTableColumnWidths,
  loadStoredAppointmentTableColumnWidths,
} from "./tableWidths";

export interface MockBackupSnapshot {
  appointments: Appointment[];
  accounts: AccountProfile[];
  settings: AppSettings;
  appAccess: Omit<AppAccessStatus, "unlocked">;
  appAccessPassword: string | null;
  appAccessRecoveryAnswer: string;
}

export interface MockStore {
  appointments: Appointment[];
  accounts: AccountProfile[];
  appAccess: AppAccessStatus;
  appAccessPassword: string | null;
  appAccessRecoveryAnswer: string;
  appointmentSelections: Map<string, { ids: string[]; expiresAt: number }>;
  settings: AppSettings;
  accountRoleDataRefreshBusy: boolean;
  backupSnapshot: MockBackupSnapshot | null;
  lastBackupPath: string | null;
  excelPreviewToken: string | null;
  excelPreviewTokenExpiresAt: number | null;
}

export const mockStore: MockStore = {
  appointments: structuredClone(demoAppointments),
  accounts: structuredClone(demoAccounts).sort((a, b) => {
    return (
      Number(b.needsReview) - Number(a.needsReview) ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.accountName.localeCompare(b.accountName)
    );
  }),
  appAccess: {
    initialized: true,
    unlocked: true,
    legacyMigrationPendingCount: 0,
    recoveryQuestion: "我最常用的陪玩角色是？",
    dataRepairIssueCount: 0,
    dataRepairIssues: [],
  },
  appAccessPassword: "demo",
  appAccessRecoveryAnswer: "demo",
  appointmentSelections: new Map(),
  settings: {
    fontFamily: "Microsoft YaHei UI",
    baseFontSize: 15,
    defaultReminderMinutes: 30,
    backupRetention: 30,
    lastAutomaticBackupDate: chinaDateKey(),
    accountTableColumnWidths: loadStoredAccountTableColumnWidths(),
    appointmentTableColumnWidths: loadStoredAppointmentTableColumnWidths(),
    accountRoleDataServerUrl: DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL,
    accountRoleDataApiKey: "",
  },
  accountRoleDataRefreshBusy: false,
  backupSnapshot: null,
  lastBackupPath: null,
  excelPreviewToken: null,
  excelPreviewTokenExpiresAt: null,
};
