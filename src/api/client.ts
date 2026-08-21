import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AccountProfile,
  AccountRoleDataRefreshProgress,
  AccountRoleDataRefreshResult,
  AccountTableColumnWidths,
  AppAccessStatus,
  AppSettings,
  AppearanceSettings,
  Appointment,
  AppointmentDeleteResult,
  AppointmentMutationResult,
  AppointmentPage,
  AppointmentSelectionSnapshot,
  AppointmentTableColumnWidths,
  BackupResult,
  ContactPreset,
  DashboardSummary,
  EmbeddedAccountPreset,
  ExcelImportPreview,
  ExcelImportResult,
  ExcelImportSelection,
  RevenueSummary,
  LegacyCredentialMigrationResult,
} from "../types/domain";
import type { ApiClient } from "./types";
import { chinaDateKey } from "../utils/chinaDateTime";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const nativeApi: ApiClient = {
  listAppointments: (filters) => invoke<Appointment[]>("list_appointments", { filters }),
  listAppointmentPage: (filters = {}, page = 1, pageSize = 100) =>
    invoke<AppointmentPage>("list_appointment_page", { filters, page, pageSize }),
  createAppointmentSelection: (filters = {}) =>
    invoke<AppointmentSelectionSnapshot>("create_appointment_selection", { filters }),
  getAppointment: (id) => invoke<Appointment>("get_appointment", { id }),
  createAppointment: (input) => invoke<AppointmentMutationResult>("create_appointment", { input }),
  updateAppointment: (id, input) =>
    invoke<AppointmentMutationResult>("update_appointment", { id, input }),
  duplicateAppointment: (id, serviceDate) =>
    invoke<AppointmentMutationResult>("duplicate_appointment", { id, serviceDate }),
  deleteAppointment: (id) => invoke<void>("delete_appointment", { id }),
  deleteAppointments: (selection) =>
    invoke<AppointmentDeleteResult>("delete_appointments", { selection }),
  syncAppointmentServiceStatuses: () => invoke<number>("sync_appointment_service_statuses"),
  setAppointmentServiceStatus: (id, status) =>
    invoke<Appointment>("set_appointment_service_status", { id, status }),
  settleAppointment: (id, amountMinor, paymentMethod) =>
    invoke<Appointment>("settle_appointment", { id, amountMinor, paymentMethod }),
  listContactPresets: (query, limit) =>
    invoke<ContactPreset[]>("list_contact_presets", { query, limit }),
  listRecentEmbeddedAccountPresets: (limit) =>
    invoke<EmbeddedAccountPreset[]>("list_recent_embedded_account_presets", { limit }),
  copyAppointmentAccountName: (id) => invoke<void>("copy_appointment_account_name", { id }),
  copyAppointmentVoiceChannel: (id) => invoke<void>("copy_appointment_voice_channel", { id }),
  copyAppointmentAccountPassword: (id) => invoke<void>("copy_appointment_account_password", { id }),

  listAccountProfiles: (query, needsReview) =>
    invoke<AccountProfile[]>("list_account_profiles", { query, needsReview }),
  getAccountProfile: (id) => invoke<AccountProfile>("get_account_profile", { id }),
  createAccountProfile: (input) => invoke<AccountProfile>("create_account_profile", { input }),
  updateAccountProfile: (id, input) =>
    invoke<AccountProfile>("update_account_profile", { id, input }),
  deleteAccountProfile: (id) => invoke<void>("delete_account_profile", { id }),
  deleteAccountProfiles: (ids) => invoke<number>("delete_account_profiles", { ids }),
  reorderAccountProfiles: (ids) => invoke<void>("reorder_account_profiles", { ids }),
  copyAccountName: (id) => invoke<void>("copy_account_name", { id }),
  copyAccountCharacterName: (id) => invoke<void>("copy_account_character_name", { id }),
  refreshAccountProfileRoleData: (ids, onProgress) => {
    const channel = new Channel<AccountRoleDataRefreshProgress>(onProgress ?? (() => undefined));
    return invoke<AccountRoleDataRefreshResult>("refresh_account_profile_role_data", {
      ids,
      onProgress: channel,
    });
  },

  appAccessStatus: () => invoke<AppAccessStatus>("app_access_status"),
  initializeAppAccess: (password, recovery) =>
    invoke<AppAccessStatus>("initialize_app_access", { password, recovery }),
  unlockAppAccess: (password) => invoke<AppAccessStatus>("unlock_app_access", { password }),
  lockAppAccess: () => invoke<AppAccessStatus>("lock_app_access"),
  changeAppAccessPassword: (currentPassword, newPassword) =>
    invoke<AppAccessStatus>("change_app_access_password", { currentPassword, newPassword }),
  resetAppAccessPassword: (newPassword, confirmationText, recoveryProof) =>
    invoke<AppAccessStatus>("reset_app_access_password", {
      newPassword,
      confirmationText,
      recoveryProof,
    }),
  setAppAccessRecovery: (currentPassword, recovery) =>
    invoke<AppAccessStatus>("set_app_access_recovery", { currentPassword, recovery }),
  migrateLegacyCredentials: (password, recovery) =>
    invoke<LegacyCredentialMigrationResult>("migrate_legacy_credentials", { password, recovery }),
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
  getAppAppearance: () => invoke<AppearanceSettings>("get_app_appearance"),
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
    const date = chinaDateKey().replace(/-/g, "");
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
