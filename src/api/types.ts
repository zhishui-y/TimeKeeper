import type {
  AccountProfile,
  AccountProfileInput,
  AppSettings,
  Appointment,
  AppointmentFilters,
  AppointmentInput,
  AppointmentMutationResult,
  BackupResult,
  DashboardSummary,
  ExcelImportPreview,
  ExcelImportResult,
  ReportGranularity,
  RevenueSummary,
  ServiceStatus,
  VaultStatus,
} from "../types/domain";

export interface ApiClient {
  listAppointments(filters?: AppointmentFilters): Promise<Appointment[]>;
  getAppointment(id: string): Promise<Appointment>;
  createAppointment(input: AppointmentInput): Promise<AppointmentMutationResult>;
  updateAppointment(id: string, input: AppointmentInput): Promise<AppointmentMutationResult>;
  duplicateAppointment(id: string, serviceDate?: string): Promise<AppointmentMutationResult>;
  deleteAppointment(id: string): Promise<void>;
  deleteAppointments(ids: string[]): Promise<number>;
  setAppointmentServiceStatus(id: string, status: ServiceStatus): Promise<Appointment>;
  settleAppointment(id: string, amountMinor: number, paymentMethod?: string): Promise<Appointment>;

  listAccountProfiles(query?: string, needsReview?: boolean): Promise<AccountProfile[]>;
  getAccountProfile(id: string): Promise<AccountProfile>;
  createAccountProfile(input: AccountProfileInput): Promise<AccountProfile>;
  updateAccountProfile(id: string, input: AccountProfileInput): Promise<AccountProfile>;
  deleteAccountProfile(id: string): Promise<void>;
  deleteAccountProfiles(ids: string[]): Promise<number>;
  reorderAccountProfiles(ids: string[]): Promise<void>;
  copyAccountName(id: string): Promise<void>;

  vaultStatus(): Promise<VaultStatus>;
  initializeVault(password: string): Promise<VaultStatus>;
  unlockVault(password: string): Promise<VaultStatus>;
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
  commitExcelImport(previewToken: string): Promise<ExcelImportResult>;
  createBackup(destination?: string): Promise<BackupResult>;
  restoreBackup(path: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;

  selectExcelFile(): Promise<string | null>;
  selectBackupDestination(): Promise<string | null>;
  selectBackupFile(): Promise<string | null>;
  requestNotificationPermission(): Promise<AppNotificationPermission>;
}

export type AppNotificationPermission = "default" | "denied" | "granted";
