export type AppointmentMode = "entertainment" | "business";
export type ServiceStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type SettlementStatus = "not_applicable" | "unsettled" | "settled";
export type ReportGranularity = "day" | "week" | "month";

export interface AccountSnapshot {
  accountName: string;
  contactName?: string | null;
  server?: string | null;
  characterName?: string | null;
  specialization?: string | null;
  gearScore?: string | null;
}

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
  accountProfileId?: string | null;
  accountSnapshot?: AccountSnapshot | null;
  rateNote?: string | null;
  paymentMethod?: string | null;
  amountMinor?: number | null;
  reminderMinutes?: number | null;
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
  accountProfileId?: string | null;
  rateNote?: string | null;
  paymentMethod?: string | null;
  amountMinor?: number | null;
  reminderMinutes?: number | null;
  notes?: string | null;
}

export interface AppointmentFilters {
  from?: string;
  to?: string;
  query?: string;
  mode?: AppointmentMode;
  serviceStatus?: ServiceStatus;
  settlementStatus?: SettlementStatus;
  accountProfileId?: string;
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
  currentScore?: number | null;
  highestScore?: number | null;
  scoreUpdatedAt?: string | null;
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
  businessHours: number;
  appointmentCount: number;
}

export interface RevenueSummary {
  from: string;
  to: string;
  settledMinor: number;
  unsettledMinor: number;
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

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
  autoLockMinutes: number;
}

export interface AppSettings {
  defaultReminderMinutes: number;
  autoLockMinutes: number;
  backupRetention: number;
  lastAutomaticBackupDate?: string | null;
}

export interface BackupResult {
  path: string;
  createdAt: string;
  sizeBytes: number;
}
