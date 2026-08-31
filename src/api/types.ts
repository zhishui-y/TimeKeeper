import type {
  AccountProfile,
  AccountProfileInput,
  AccountRoleDataRefreshProgress,
  AccountRoleDataRefreshResult,
  AccountTableColumnWidths,
  AppAccessRecoveryProof,
  AppAccessRecoverySetup,
  AppAccessStatus,
  AppearanceSettings,
  AppSettings,
  Appointment,
  AppointmentDeleteResult,
  AppointmentDeleteSelection,
  AppointmentFilters,
  AppointmentInput,
  AppointmentMutationResult,
  AppointmentPage,
  AppointmentRangeFilters,
  AppointmentSelectionSnapshot,
  AppointmentTableColumnWidths,
  BackupResult,
  ContactPreset,
  DashboardSummary,
  EmbeddedAccountPreset,
  ExcelImportPreview,
  ExcelImportResult,
  ExcelImportSelection,
  ReportGranularity,
  RevenueAnalyticsReport,
  RevenueSummary,
  ServiceStatus,
  LegacyCredentialMigrationResult,
} from "../types/domain";

export interface ApiClient {
  listAppointments(filters: AppointmentRangeFilters): Promise<Appointment[]>;
  listAppointmentPage(
    filters?: AppointmentFilters,
    page?: number,
    pageSize?: number,
  ): Promise<AppointmentPage>;
  createAppointmentSelection(filters?: AppointmentFilters): Promise<AppointmentSelectionSnapshot>;
  getAppointment(id: string): Promise<Appointment>;
  createAppointment(input: AppointmentInput): Promise<AppointmentMutationResult>;
  updateAppointment(id: string, input: AppointmentInput): Promise<AppointmentMutationResult>;
  duplicateAppointment(id: string, serviceDate?: string): Promise<AppointmentMutationResult>;
  deleteAppointment(id: string): Promise<void>;
  deleteAppointments(selection: AppointmentDeleteSelection): Promise<AppointmentDeleteResult>;
  syncAppointmentServiceStatuses(): Promise<number>;
  setAppointmentServiceStatus(id: string, status: ServiceStatus): Promise<Appointment>;
  settleAppointment(id: string, amountMinor: number, paymentMethod?: string): Promise<Appointment>;
  listContactPresets(query?: string, limit?: number): Promise<ContactPreset[]>;
  listRecentEmbeddedAccountPresets(limit?: number): Promise<EmbeddedAccountPreset[]>;
  copyAppointmentAccountName(id: string): Promise<void>;
  copyAppointmentVoiceChannel(id: string): Promise<void>;
  copyAppointmentAccountPassword(id: string): Promise<void>;

  listAccountProfiles(query?: string, needsReview?: boolean): Promise<AccountProfile[]>;
  getAccountProfile(id: string): Promise<AccountProfile>;
  createAccountProfile(input: AccountProfileInput): Promise<AccountProfile>;
  updateAccountProfile(id: string, input: AccountProfileInput): Promise<AccountProfile>;
  deleteAccountProfile(id: string): Promise<void>;
  deleteAccountProfiles(ids: string[]): Promise<number>;
  reorderAccountProfiles(ids: string[]): Promise<void>;
  copyAccountName(id: string): Promise<void>;
  copyAccountCharacterName(id: string): Promise<void>;
  refreshAccountProfileRoleData(
    ids: string[],
    onProgress?: (progress: AccountRoleDataRefreshProgress) => void,
  ): Promise<AccountRoleDataRefreshResult>;

  appAccessStatus(): Promise<AppAccessStatus>;
  initializeAppAccess(password: string, recovery: AppAccessRecoverySetup): Promise<AppAccessStatus>;
  unlockAppAccess(password: string): Promise<AppAccessStatus>;
  lockAppAccess(): Promise<AppAccessStatus>;
  changeAppAccessPassword(currentPassword: string, newPassword: string): Promise<AppAccessStatus>;
  resetAppAccessPassword(
    newPassword: string,
    confirmationText: string,
    recoveryProof: AppAccessRecoveryProof,
  ): Promise<AppAccessStatus>;
  setAppAccessRecovery(
    currentPassword: string,
    recovery: AppAccessRecoverySetup,
  ): Promise<AppAccessStatus>;
  migrateLegacyCredentials(
    password: string,
    recovery?: AppAccessRecoverySetup,
  ): Promise<LegacyCredentialMigrationResult>;
  copyAccountPassword(id: string): Promise<void>;

  getDashboardSummary(date: string): Promise<DashboardSummary>;
  getRevenueSummary(
    from: string,
    to: string,
    granularity: ReportGranularity,
  ): Promise<RevenueSummary>;
  getRevenueAnalyticsReport(from: string, to: string): Promise<RevenueAnalyticsReport>;
  listRevenueContactAppointments(
    from: string,
    to: string,
    contactNames: readonly string[],
  ): Promise<Appointment[]>;
  previewExcelImport(path: string, baseYear: number): Promise<ExcelImportPreview>;
  commitExcelImport(
    previewToken: string,
    selection: ExcelImportSelection,
  ): Promise<ExcelImportResult>;
  createBackup(destination?: string): Promise<BackupResult>;
  restoreBackup(path: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  getAppAppearance(): Promise<AppearanceSettings>;
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
