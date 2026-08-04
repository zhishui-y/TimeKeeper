export type AppointmentMode = "entertainment" | "business";
export type ServiceStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type SettlementStatus = "not_applicable" | "unsettled" | "settled";
export type AppointmentProgressStatus =
  "scheduled" | "in_progress" | "pending_settlement" | "completed" | "cancelled";
export type ReportGranularity = "day" | "week" | "month";
export type VoicePlatform = "yy" | "qq";

export interface AppointmentAccountDetails {
  accountName: string;
  server?: string | null;
  specialization?: string | null;
  gearScore?: string | null;
}

export interface AppointmentAccount extends AppointmentAccountDetails {
  password: string | null;
}

export type AppointmentAccountCredential =
  | { kind: "keep" }
  | { kind: "replace"; password: string }
  | { kind: "copyFromAppointment"; sourceAppointmentId: string };

export type AppointmentAccountInput =
  | { kind: "profile"; profileId: string }
  | {
      kind: "embedded";
      details: AppointmentAccountDetails;
      credential: AppointmentAccountCredential;
    };

export interface Appointment {
  id: string;
  serviceDate: string;
  startsAt?: string | null;
  endsAt?: string | null;
  contactName: string;
  content?: string | null;
  mode: AppointmentMode;
  serviceStatus: ServiceStatus;
  settlementStatus: SettlementStatus;
  account?: AppointmentAccount | null;
  rateNote?: string | null;
  paymentMethod?: string | null;
  amountMinor?: number | null;
  reminderMinutes?: number | null;
  voicePlatform?: VoicePlatform | null;
  voiceChannel?: string | null;
  notes?: string | null;
  importFingerprint?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentInput {
  serviceDate: string;
  startTime?: string | null;
  endTime?: string | null;
  contactName: string;
  content?: string | null;
  mode: AppointmentMode;
  serviceStatus: ServiceStatus;
  settlementStatus: SettlementStatus;
  account?: AppointmentAccountInput | null;
  rateNote?: string | null;
  paymentMethod?: string | null;
  amountMinor?: number | null;
  reminderMinutes?: number | null;
  voicePlatform?: VoicePlatform | null;
  voiceChannel?: string | null;
  notes?: string | null;
}

export interface AppointmentFilters {
  from?: string;
  to?: string;
  query?: string;
  mode?: AppointmentMode;
  progressStatus?: AppointmentProgressStatus;
  serviceStatus?: ServiceStatus;
  settlementStatus?: SettlementStatus;
}

export interface AppointmentRangeFilters extends AppointmentFilters {
  from: string;
  to: string;
}

export interface ContactPreset {
  sourceAppointmentId: string;
  contactName: string;
  startTime?: string | null;
  endTime?: string | null;
  content?: string | null;
  mode: AppointmentMode;
  account?: AppointmentAccount | null;
  rateNote?: string | null;
  paymentMethod?: string | null;
  amountMinor?: number | null;
  reminderMinutes?: number | null;
  notes?: string | null;
  voicePlatform?: VoicePlatform | null;
  voiceChannel?: string | null;
}

export interface AppointmentConflict {
  id: string;
  contactName: string;
  startsAt: string;
  endsAt?: string | null;
}

export interface AppointmentMutationResult {
  appointment: Appointment;
  conflicts: AppointmentConflict[];
}

export interface AccountProfile {
  id: string;
  contactName?: string | null;
  server?: string | null;
  characterName?: string | null;
  specialization?: string | null;
  gearScore?: string | null;
  accountName: string;
  password: string | null;
  currentScore?: number | null;
  highestScore?: number | null;
  scoreUpdatedAt?: string | null;
  usageInfo?: string | null;
  notes?: string | null;
  needsReview: boolean;
  importFingerprint?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountProfileInput {
  contactName?: string | null;
  server?: string | null;
  characterName?: string | null;
  specialization?: string | null;
  gearScore?: string | null;
  accountName: string;
  password?: string | null;
  currentScore?: number | null;
  highestScore?: number | null;
  scoreUpdatedAt?: string | null;
  notes?: string | null;
  needsReview?: boolean;
}

export interface RevenuePoint {
  period: string;
  settledMinor: number;
  unsettledMinor: number;
  pendingCount: number;
  businessHours: number;
  appointmentCount: number;
}

export interface RevenueSummary {
  from: string;
  to: string;
  settledMinor: number;
  unsettledMinor: number;
  pendingCount: number;
  businessHours: number;
  averageHourlyMinor: number;
  appointmentCount: number;
  completedCount: number;
  paymentMethods: Array<{ name: string; amountMinor: number }>;
  points: RevenuePoint[];
}

export interface DashboardSummary {
  todaySettledMinor: number;
  weekSettledMinor: number;
  pendingCount: number;
  nextAppointment?: Appointment | null;
}

export interface ExcelImportPreview {
  sourcePath: string;
  baseYear: number;
  appointmentCount: number;
  profileCount: number;
  unmatchedProfileCount: number;
  crossMidnightCount: number;
  yyChannelCount: number;
  passwordConflictCount: number;
  skippedCount: number;
  warningCount: number;
  warnings: string[];
  previewToken: string;
}

export interface ExcelImportResult {
  importedAppointments: number;
  importedProfiles: number;
  skippedDuplicates: number;
  skippedAppointmentDuplicates: number;
  skippedProfileDuplicates: number;
  warnings: string[];
}

export interface ExcelImportSelection {
  appointments: boolean;
  accounts: boolean;
}

export interface AppAccessStatus {
  initialized: boolean;
  unlocked: boolean;
  legacyMigrationPendingCount: number;
}

export interface LegacyCredentialMigrationResult {
  migratedCount: number;
  missingCount: number;
  pendingCount: number;
}

export interface AppointmentPage {
  items: Appointment[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AppointmentSelectionSnapshot {
  token: string;
  totalCount: number;
  expiresAt: string;
}

export type AppointmentDeleteSelection =
  { kind: "explicit"; ids: string[] } | { kind: "token"; token: string; excludedIds: string[] };

export interface AppointmentDeleteResult {
  matchedCount: number;
  deletedCount: number;
}

export interface AccountTableColumnWidths {
  contactName: number;
  server: number;
  characterName: number;
  specialization: number;
  gearScore: number;
  accountName: number;
  password: number;
  currentScore: number;
  highestScore: number;
  scoreUpdatedAt: number;
  weekly: number;
  notes: number;
}

export interface AppointmentTableColumnWidths {
  serviceDate: number;
  timeRange: number;
  contactName: number;
  content: number;
  account: number;
  voice: number;
  mode: number;
  serviceStatus: number;
  amount: number;
  notes: number;
}

export interface AccountUsageWeekSyncResult {
  weekStart: string;
  clearedCount: number;
}

export type AccountRoleDataRefreshStatus = "updated" | "noRecord" | "skipped" | "failed";

export interface AccountRoleDataRefreshItem {
  accountId: string;
  status: AccountRoleDataRefreshStatus;
  message?: string | null;
}

export interface AccountRoleDataRefreshResult {
  requestedCount: number;
  updatedCount: number;
  noRecordCount: number;
  skippedCount: number;
  failedCount: number;
  items: readonly AccountRoleDataRefreshItem[];
}

export interface AppSettings {
  defaultReminderMinutes: number;
  backupRetention: number;
  lastAutomaticBackupDate?: string | null;
  accountTableColumnWidths: AccountTableColumnWidths;
  appointmentTableColumnWidths: AppointmentTableColumnWidths;
  lastAccountUsageWeekStart?: string | null;
  accountRoleDataServerUrl: string;
}

export interface BackupResult {
  path: string;
  createdAt: string;
  sizeBytes: number;
}
