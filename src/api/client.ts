import { invoke } from "@tauri-apps/api/core";
import type {
  AccountProfile,
  AccountRoleDataRefreshResult,
  AccountTableColumnWidths,
  AccountUsageWeekSyncResult,
  AppSettings,
  Appointment,
  AppointmentMutationResult,
  AppointmentTableColumnWidths,
  BackupResult,
  ContactPreset,
  DashboardSummary,
  ExcelImportPreview,
  ExcelImportResult,
  ExcelImportSelection,
  RevenueSummary,
  VaultStatus,
  VaultUnlockResult,
} from "../types/domain";
import type { ApiClient } from "./types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const nativeApi: ApiClient = {
  listAppointments: (filters = {}) => invoke<Appointment[]>("list_appointments", { filters }),
  getAppointment: (id) => invoke<Appointment>("get_appointment", { id }),
  createAppointment: (input) => invoke<AppointmentMutationResult>("create_appointment", { input }),
  updateAppointment: (id, input) =>
    invoke<AppointmentMutationResult>("update_appointment", { id, input }),
  duplicateAppointment: (id, serviceDate) =>
    invoke<AppointmentMutationResult>("duplicate_appointment", { id, serviceDate }),
  deleteAppointment: (id) => invoke<void>("delete_appointment", { id }),
  deleteAppointments: (ids) => invoke<number>("delete_appointments", { ids }),
  syncAppointmentServiceStatuses: () => invoke<number>("sync_appointment_service_statuses"),
  setAppointmentServiceStatus: (id, status) =>
    invoke<Appointment>("set_appointment_service_status", { id, status }),
  settleAppointment: (id, amountMinor, paymentMethod) =>
    invoke<Appointment>("settle_appointment", { id, amountMinor, paymentMethod }),
  listContactPresets: (query, limit) =>
    invoke<ContactPreset[]>("list_contact_presets", { query, limit }),
  copyAppointmentAccountName: (id) => invoke<void>("copy_appointment_account_name", { id }),
  copyAppointmentAccountPassword: (id) => invoke<void>("copy_appointment_account_password", { id }),

  listAccountProfiles: (query, needsReview) =>
    invoke<AccountProfile[]>("list_account_profiles", { query, needsReview }),
  getAccountProfile: (id) => invoke<AccountProfile>("get_account_profile", { id }),
  createAccountProfile: (input) => invoke<AccountProfile>("create_account_profile", { input }),
  updateAccountProfile: (id, input) =>
    invoke<AccountProfile>("update_account_profile", { id, input }),
  updateAccountProfileUsage: (id, usageInfo) =>
    invoke<AccountProfile>("update_account_profile_usage", { id, usageInfo }),
  clearAccountProfileUsage: () => invoke<number>("clear_account_profile_usage"),
  syncAccountProfileUsageWeek: () =>
    invoke<AccountUsageWeekSyncResult>("sync_account_profile_usage_week"),
  deleteAccountProfile: (id) => invoke<void>("delete_account_profile", { id }),
  deleteAccountProfiles: (ids) => invoke<number>("delete_account_profiles", { ids }),
  reorderAccountProfiles: (ids) => invoke<void>("reorder_account_profiles", { ids }),
  copyAccountName: (id) => invoke<void>("copy_account_name", { id }),
  copyAccountCharacterName: (id) => invoke<void>("copy_account_character_name", { id }),
  refreshAccountProfileRoleData: (ids) =>
    invoke<AccountRoleDataRefreshResult>("refresh_account_profile_role_data", { ids }),

  vaultStatus: () => invoke<VaultStatus>("vault_status"),
  initializeVault: (password) => invoke<VaultStatus>("initialize_vault", { password }),
  unlockVault: (password) => invoke<VaultUnlockResult>("unlock_vault", { password }),
  changeVaultPassword: (currentPassword, newPassword) =>
    invoke<VaultStatus>("change_vault_password", { currentPassword, newPassword }),
  lockVault: () => invoke<VaultStatus>("lock_vault"),
  revealAccountPassword: (id) => invoke<string>("reveal_account_password", { id }),
  copyAccountPassword: (id) => invoke<void>("copy_account_password", { id }),

  getDashboardSummary: (date) => invoke<DashboardSummary>("get_dashboard_summary", { date }),
  getRevenueSummary: (from, to, granularity) =>
    invoke<RevenueSummary>("get_revenue_summary", { from, to, granularity }),
  previewExcelImport: (path, baseYear) =>
    invoke<ExcelImportPreview>("preview_excel_import", { path, baseYear }),
  commitExcelImport: (previewToken, selection: ExcelImportSelection) =>
    invoke<ExcelImportResult>("commit_excel_import", { previewToken, selection }),
  createBackup: (destination) => invoke<BackupResult>("create_backup", { destination }),
  restoreBackup: (path) => invoke<void>("restore_backup", { path }),
  getSettings: () => invoke<AppSettings>("get_settings"),
  updateSettings: (settings) => invoke<AppSettings>("update_settings", { settings }),
  updateAccountTableColumnWidths: (widths) =>
    invoke<AccountTableColumnWidths>("update_account_table_column_widths", { widths }),
  updateAppointmentTableColumnWidths: (widths) =>
    invoke<AppointmentTableColumnWidths>("update_appointment_table_column_widths", { widths }),

  async selectExcelFile() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Excel 账本", extensions: ["xlsm", "xlsx", "xls"] }],
    });
    return typeof selected === "string" ? selected : null;
  },
  async selectBackupDestination() {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const selected = await save({
      defaultPath: `TimeKeeper-${date}.tkbackup`,
      filters: [{ name: "时约管家备份", extensions: ["tkbackup"] }],
    });
    return typeof selected === "string" ? selected : null;
  },
  async selectBackupFile() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "时约管家备份", extensions: ["tkbackup", "zip"] }],
    });
    return typeof selected === "string" ? selected : null;
  },
  async requestNotificationPermission() {
    const { isPermissionGranted, requestPermission } =
      await import("@tauri-apps/plugin-notification");
    if (await isPermissionGranted()) return "granted";
    return requestPermission();
  },
};

let mockApiPromise: Promise<ApiClient> | undefined;

function loadMockApi(): Promise<ApiClient> {
  if (!mockApiPromise) {
    mockApiPromise = import("./mockClient").then(
      ({ mockApi }) => mockApi,
      (cause) => {
        mockApiPromise = undefined;
        throw cause;
      },
    );
  }
  return mockApiPromise;
}

function createLazyApiClient<T extends object>(shape: T, loader: () => Promise<T>): T {
  const methodCache = new Map<PropertyKey, (...args: unknown[]) => Promise<unknown>>();

  return new Proxy(shape, {
    get(target, property, receiver) {
      const targetValue = Reflect.get(target, property, receiver) as unknown;
      if (typeof targetValue !== "function") return targetValue;

      let lazyMethod = methodCache.get(property);
      if (!lazyMethod) {
        lazyMethod = (...args: unknown[]) =>
          loader().then((client) => {
            const implementation = Reflect.get(client, property) as unknown;
            if (typeof implementation !== "function") {
              throw new TypeError(`API method ${String(property)} is not available`);
            }
            return Reflect.apply(implementation, client, args) as unknown;
          });
        methodCache.set(property, lazyMethod);
      }
      return lazyMethod;
    },
  });
}

const lazyMockApi = createLazyApiClient(nativeApi, loadMockApi);

export const api: ApiClient = isTauri ? nativeApi : lazyMockApi;

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "操作未完成，请稍后重试";
}
