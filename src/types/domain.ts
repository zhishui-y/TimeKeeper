export type AppointmentMode = "entertainment" | "business";
export type ServiceStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type SettlementStatus = "not_applicable" | "unsettled" | "settled";
export type AppointmentProgressStatus =
  "scheduled" | "in_progress" | "pending_settlement" | "completed" | "cancelled";
export type ReportGranularity = "day" | "week" | "month";
export type VoicePlatform = "yy" | "qq";
export type AppointmentAccountSource = "profile" | "embedded";

export interface AppointmentAccountDetails {
  accountName: string;
  server?: string | null;
  specialization?: string | null;
  gearScore?: string | null;
}

export interface AppointmentAccount extends AppointmentAccountDetails {
  source: AppointmentAccountSource;
  characterName?: string | null;
  password: string | null;
}

export type AppointmentAccountCredential =
  | { kind: "none" }
  | { kind: "keep" }
  | { kind: "replace"; password: string }
  | { kind: "copyFromAppointment"; sourceAppointmentId: string };

export type AppointmentAccountInput =
  | { kind: "profile"; profileId: string }
  | {
      kind: "embedded";
      details: AppointmentAccountDetails;
      credential: AppointmentAccountCredential;
    }
  | {
      kind: "snapshot";
      source: AppointmentAccountSource;
      characterName?: string | null;
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

export interface AppointmentDraftSeed {
  sourceAppointmentId: string;
  input: AppointmentInput;
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
  serviceDate: string;
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

export interface EmbeddedAccountPreset extends AppointmentAccountDetails {
  sourceAppointmentId: string;
  hasPassword: boolean;
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
  weeklyWins?: number | null;
  notes?: string | null;
  needsReview: boolean;
  importFingerprint?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AccountProfileCredentialInput =
  { kind: "keep" } | { kind: "replace"; password: string } | { kind: "remove" };

export interface AccountProfileInput {
  contactName?: string | null;
  server?: string | null;
  characterName?: string | null;
  specialization?: string | null;
  gearScore?: string | null;
  accountName: string;
  credential: AccountProfileCredentialInput;
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

export interface RevenueBreakdownItem {
  name: string;
  amountMinor: number;
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
  paymentMethods: RevenueBreakdownItem[];
  contacts: RevenueBreakdownItem[];
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
  recoveryQuestion: string | null;
  dataRepairIssueCount: number;
  dataRepairIssues: DataRepairIssue[];
}

export interface DataRepairIssue {
  id: string;
  entityKind: "account_profile" | "appointment";
  entityId: string;
  displayName: string;
  fieldName: "current_score" | "highest_score" | "weekly_wins" | "amount_minor";
  originalValue: string;
}

export interface AppAccessRecoverySetup {
  question: string;
  answer: string;
}

export type AppAccessRecoveryProof =
  | { kind: "answer"; answer: string }
  | { kind: "legacyEnrollment"; recovery: AppAccessRecoverySetup };

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
  weeklyWins: number;
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

export interface AccountRoleDataRefreshPatch {
  accountId: string;
  gearScore: string;
  currentScore: number;
  highestScore: number | null;
  scoreUpdatedAt: string;
  weeklyWins: number | null;
  updatedAt: string;
}

export interface AccountRoleDataRefreshProgress {
  completedCount: number;
  requestedCount: number;
  item: AccountRoleDataRefreshItem;
  patch?: AccountRoleDataRefreshPatch | null;
}

export interface AppearanceSettings {
  fontFamily: string;
  baseFontSize: number;
}

export interface AppSettings extends AppearanceSettings {
  defaultReminderMinutes: number;
  backupRetention: number;
  lastAutomaticBackupDate?: string | null;
  accountTableColumnWidths: AccountTableColumnWidths;
  appointmentTableColumnWidths: AppointmentTableColumnWidths;
  accountRoleDataServerUrl: string;
  accountRoleDataApiKey: string;
}

export interface BackupResult {
  path: string;
  createdAt: string;
  sizeBytes: number;
}

export type AppOperationKind =
  "excelPreview" | "excelCommit" | "backupExport" | "backupRestore" | "accountRoleRefresh";

export type AppOperationStatus = "running" | "completed" | "failed";

export interface AppOperationState {
  id: number;
  kind: AppOperationKind;
  status: AppOperationStatus;
  title: string;
  detail: string;
  startedAt: string;
  completedAt?: string | null;
  completedCount?: number | null;
  totalCount?: number | null;
  error?: string | null;
}
