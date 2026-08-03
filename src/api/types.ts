import type {
  AccountProfile,
  AccountProfileInput,
  AccountRoleDataRefreshResult,
  AccountTableColumnWidths,
  AccountUsageWeekSyncResult,
  AppSettings,
  Appointment,
  AppointmentFilters,
  AppointmentInput,
  AppointmentMutationResult,
  AppointmentTableColumnWidths,
  BackupResult,
  ContactPreset,
  DashboardSummary,
  ExcelImportPreview,
  ExcelImportResult,
  ExcelImportSelection,
  ReportGranularity,
  RevenueSummary,
  ServiceStatus,
  VaultStatus,
  VaultUnlockResult,
} from "../types/domain";

export interface ApiClient {
  listAppointments(filters?: AppointmentFilters): Promise<Appointment[]>;
  getAppointment(id: string): Promise<Appointment>;
  createAppointment(input: AppointmentInput): Promise<AppointmentMutationResult>;
  updateAppointment(id: string, input: AppointmentInput): Promise<AppointmentMutationResult>;
  duplicateAppointment(id: string, serviceDate?: string): Promise<AppointmentMutationResult>;
  deleteAppointment(id: string): Promise<void>;
  deleteAppointments(ids: string[]): Promise<number>;
  syncAppointmentServiceStatuses(): Promise<number>;
  setAppointmentServiceStatus(id: string, status: ServiceStatus): Promise<Appointment>;
  settleAppointment(id: string, amountMinor: number, paymentMethod?: string): Promise<Appointment>;
  listContactPresets(query?: string, limit?: number): Promise<ContactPreset[]>;
  copyAppointmentAccountName(id: string): Promise<void>;
  copyAppointmentVoiceChannel(id: string): Promise<void>;
  copyAppointmentAccountPassword(id: string): Promise<void>;

  listAccountProfiles(query?: string, needsReview?: boolean): Promise<AccountProfile[]>;
  getAccountProfile(id: string): Promise<AccountProfile>;
  createAccountProfile(input: AccountProfileInput): Promise<AccountProfile>;
  updateAccountProfile(id: string, input: AccountProfileInput): Promise<AccountProfile>;
  updateAccountProfileUsage(id: string, usageInfo?: string | null): Promise<AccountProfile>;
  clearAccountProfileUsage(): Promise<number>;
  syncAccountProfileUsageWeek(): Promise<AccountUsageWeekSyncResult>;
  deleteAccountProfile(id: string): Promise<void>;
  deleteAccountProfiles(ids: string[]): Promise<number>;
  reorderAccountProfiles(ids: string[]): Promise<void>;
  copyAccountName(id: string): Promise<void>;
  copyAccountCharacterName(id: string): Promise<void>;
  refreshAccountProfileRoleData(ids: string[]): Promise<AccountRoleDataRefreshResult>;

  vaultStatus(): Promise<VaultStatus>;
  initializeVault(password: string): Promise<VaultStatus>;
  unlockVault(password: string): Promise<VaultUnlockResult>;
  changeVaultPassword(currentPassword: string, newPassword: string): Promise<VaultStatus>;
  lockVault(): Promise<VaultStatus>;
  revealAccountPassword(id: string): Promise<string>;
  copyAccountPassword(id: string): Promise<void>;

  getDashboardSummary(date: string): Promise<DashboardSummary>;
  getRevenueSummary(
    from: string,
    to: string,
    granularity: ReportGranularity,
  ): Promise<RevenueSummary>;
  previewExcelImport(path: string, baseYear: number): Promise<ExcelImportPreview>;
  commitExcelImport(
    previewToken: string,
    selection: ExcelImportSelection,
  ): Promise<ExcelImportResult>;
  createBackup(destination?: string): Promise<BackupResult>;
  restoreBackup(path: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
  updateAccountTableColumnWidths(
    widths: AccountTableColumnWidths,
  ): Promise<AccountTableColumnWidths>;
  updateAppointmentTableColumnWidths(
    widths: AppointmentTableColumnWidths,
  ): Promise<AppointmentTableColumnWidths>;

  selectExcelFile(): Promise<string | null>;
  selectBackupDestination(): Promise<string | null>;
  selectBackupFile(): Promise<string | null>;
  requestNotificationPermission(): Promise<AppNotificationPermission>;
}

export type AppNotificationPermission = "default" | "denied" | "granted";
