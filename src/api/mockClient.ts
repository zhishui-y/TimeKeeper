import { differenceInMinutes, endOfWeek, format, parseISO, startOfWeek } from "date-fns";
import type {
  AccountProfile,
  AccountRoleDataRefreshResult,
  AccountTableColumnWidths,
  AccountUsageWeekSyncResult,
  AppSettings,
  Appointment,
  AppointmentConflict,
  AppointmentFilters,
  AppointmentInput,
  AppointmentMutationResult,
  AppointmentTableColumnWidths,
  ContactPreset,
  ReportGranularity,
  RevenuePoint,
  ServiceStatus,
  VaultStatus,
} from "../types/domain";
import {
  ACCOUNT_TABLE_COLUMN_KEYS,
  DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS,
  MAX_ACCOUNT_TABLE_COLUMN_WIDTH,
  MIN_ACCOUNT_TABLE_COLUMN_WIDTHS,
} from "../utils/accountTableColumns";
import {
  APPOINTMENT_TABLE_COLUMN_KEYS,
  DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS,
  MAX_APPOINTMENT_TABLE_COLUMN_WIDTH,
  MIN_APPOINTMENT_TABLE_COLUMN_WIDTHS,
} from "../utils/appointmentTableColumns";
import {
  DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL,
  validateAccountRoleDataServerUrl,
} from "../utils/accountRoleData";
import { MIN_MASTER_PASSWORD_CHARACTERS, isMasterPasswordLongEnough } from "../utils/security";
import { combineDateTime } from "../utils/appointment";
import { appointmentProgressStatus } from "../utils/appointmentProgress";
import {
  demoAccounts,
  demoAppointmentPasswords,
  demoAppointments,
  demoPasswords,
} from "./mockData";
import type { ApiClient } from "./types";

let appointments = structuredClone(demoAppointments);
let accounts = structuredClone(demoAccounts).sort((a, b) => {
  return (
    Number(b.needsReview) - Number(a.needsReview) ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.accountName.localeCompare(b.accountName)
  );
});
const passwords = new Map(demoPasswords);
const appointmentPasswords = new Map(demoAppointmentPasswords);
let vault: VaultStatus = { initialized: true, unlocked: true, autoLockMinutes: 15 };
let vaultPassword: string | null = null;
const ACCOUNT_TABLE_WIDTHS_STORAGE_KEY = "timekeeper.demo.accountTableColumnWidths";
const APPOINTMENT_TABLE_WIDTHS_STORAGE_KEY = "timekeeper.demo.appointmentTableColumnWidths";

function accountTableColumnWidthsAreValid(widths: AccountTableColumnWidths): boolean {
  return ACCOUNT_TABLE_COLUMN_KEYS.every((key) => {
    const width = widths[key];
    return (
      Number.isInteger(width) &&
      width >= MIN_ACCOUNT_TABLE_COLUMN_WIDTHS[key] &&
      width <= MAX_ACCOUNT_TABLE_COLUMN_WIDTH
    );
  });
}

function loadStoredAccountTableColumnWidths(): AccountTableColumnWidths {
  try {
    const stored = globalThis.localStorage?.getItem(ACCOUNT_TABLE_WIDTHS_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS };
    const widths = JSON.parse(stored) as AccountTableColumnWidths;
    return accountTableColumnWidthsAreValid(widths)
      ? widths
      : { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS };
  } catch {
    return { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS };
  }
}

function storeAccountTableColumnWidths(widths: AccountTableColumnWidths): void {
  globalThis.localStorage?.setItem(ACCOUNT_TABLE_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
}

function appointmentTableColumnWidthsAreValid(widths: AppointmentTableColumnWidths): boolean {
  return APPOINTMENT_TABLE_COLUMN_KEYS.every((key) => {
    const width = widths[key];
    return (
      Number.isInteger(width) &&
      width >= MIN_APPOINTMENT_TABLE_COLUMN_WIDTHS[key] &&
      width <= MAX_APPOINTMENT_TABLE_COLUMN_WIDTH
    );
  });
}

function loadStoredAppointmentTableColumnWidths(): AppointmentTableColumnWidths {
  try {
    const stored = globalThis.localStorage?.getItem(APPOINTMENT_TABLE_WIDTHS_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS };
    const parsed = JSON.parse(stored) as Partial<AppointmentTableColumnWidths> & {
      paymentMethod?: number;
    };
    const widths = {
      ...parsed,
      voice: parsed.voice ?? DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS.voice,
      notes: parsed.notes ?? parsed.paymentMethod,
    } as AppointmentTableColumnWidths;
    delete (widths as AppointmentTableColumnWidths & { paymentMethod?: number }).paymentMethod;
    if (!appointmentTableColumnWidthsAreValid(widths)) {
      return { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS };
    }
    storeAppointmentTableColumnWidths(widths);
    return widths;
  } catch {
    return { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS };
  }
}

function storeAppointmentTableColumnWidths(widths: AppointmentTableColumnWidths): void {
  globalThis.localStorage?.setItem(APPOINTMENT_TABLE_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
}

let settings: AppSettings = {
  defaultReminderMinutes: 30,
  autoLockMinutes: 15,
  backupRetention: 30,
  lastAutomaticBackupDate: format(new Date(), "yyyy-MM-dd"),
  accountTableColumnWidths: loadStoredAccountTableColumnWidths(),
  appointmentTableColumnWidths: loadStoredAppointmentTableColumnWidths(),
  lastAccountUsageWeekStart: null,
  accountRoleDataServerUrl: DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL,
};
let accountRoleDataRefreshBusy = false;

interface MockBackupSnapshot {
  appointments: Appointment[];
  accounts: AccountProfile[];
  passwords: Array<[string, string]>;
  appointmentPasswords: Array<[string, string]>;
  settings: AppSettings;
  vault: Omit<VaultStatus, "unlocked">;
  vaultPassword: string | null;
}

let backupSnapshot: MockBackupSnapshot | null = null;
let lastBackupPath: string | null = null;

function makeId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${random}`;
}

function currentChinaWeekStart(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const monday = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function currentChinaDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function refreshMockAccountRoleData(ids: string[]): AccountRoleDataRefreshResult {
  const normalizedIds = [...new Set(ids.map((id) => id.trim()))];
  if (!normalizedIds.length) throw new Error("请至少选择一个账号更新角色数据");
  if (normalizedIds.some((id) => !id)) throw new Error("角色数据更新包含空白账号 ID");

  const items: AccountRoleDataRefreshResult["items"] = normalizedIds.map((id, index) => {
    const profile = accounts.find((account) => account.id === id);
    if (!profile) return { accountId: id, status: "failed", message: "账号档案不存在" };
    if (!profile.server?.trim() || !profile.characterName?.trim()) {
      return { accountId: id, status: "skipped", message: "缺少服务器或角色名" };
    }
    if (profile.characterName.includes("未补充")) {
      return { accountId: id, status: "noRecord", message: "服务器未返回角色战绩" };
    }

    const nextScore = (profile.currentScore ?? 1800) + index + 1;
    profile.gearScore = String(200_000 + nextScore);
    profile.currentScore = nextScore;
    profile.highestScore = Math.max(profile.highestScore ?? 0, nextScore + 100);
    profile.scoreUpdatedAt = currentChinaDate();
    profile.updatedAt = new Date().toISOString();
    return { accountId: id, status: "updated" };
  });

  return {
    requestedCount: items.length,
    updatedCount: items.filter((item) => item.status === "updated").length,
    noRecordCount: items.filter((item) => item.status === "noRecord").length,
    skippedCount: items.filter((item) => item.status === "skipped").length,
    failedCount: items.filter((item) => item.status === "failed").length,
    items,
  };
}

function syncMockAccountUsageWeek(): AccountUsageWeekSyncResult {
  const weekStart = currentChinaWeekStart();
  const previous = settings.lastAccountUsageWeekStart;
  if (!previous) {
    settings.lastAccountUsageWeekStart = weekStart;
    return { weekStart, clearedCount: 0 };
  }
  if (previous >= weekStart) return { weekStart, clearedCount: 0 };

  let clearedCount = 0;
  const timestamp = new Date().toISOString();
  for (const account of accounts) {
    if (account.usageInfo == null) continue;
    account.usageInfo = null;
    account.updatedAt = timestamp;
    clearedCount += 1;
  }
  settings.lastAccountUsageWeekStart = weekStart;
  return { weekStart, clearedCount };
}

function toAppointment(input: AppointmentInput, existing?: Appointment): Appointment {
  const timestamp = new Date().toISOString();
  if (input.amountMinor !== null && input.amountMinor !== undefined && input.amountMinor < 0) {
    throw new Error("金额不能为负数");
  }
  if (
    input.mode === "business" &&
    input.settlementStatus === "settled" &&
    (input.amountMinor === null || input.amountMinor === undefined)
  ) {
    throw new Error("已完成预约必须填写金额");
  }
  const { startsAt, endsAt } = combineDateTime(input.serviceDate, input.startTime, input.endTime);
  const entertainment = input.mode === "entertainment";
  if (input.voicePlatform === "yy" && input.voiceChannel && !/^\d+$/.test(input.voiceChannel)) {
    throw new Error("YY频道号只能填写数字");
  }
  const id = existing?.id ?? makeId("appointment");
  const account = resolveAppointmentAccount(id, input, existing);
  return {
    id,
    serviceDate: input.serviceDate,
    startsAt,
    endsAt,
    contactName: input.contactName.trim(),
    content: input.content?.trim() || null,
    mode: input.mode,
    serviceStatus:
      !entertainment && input.settlementStatus === "settled" && input.serviceStatus !== "cancelled"
        ? "completed"
        : input.serviceStatus,
    settlementStatus: entertainment ? "not_applicable" : input.settlementStatus,
    account,
    rateNote: entertainment ? null : input.rateNote?.trim() || null,
    paymentMethod: entertainment ? null : input.paymentMethod?.trim() || null,
    amountMinor: entertainment ? null : (input.amountMinor ?? null),
    reminderMinutes: input.reminderMinutes ?? null,
    voicePlatform: input.voicePlatform ?? null,
    voiceChannel: input.voicePlatform === "yy" ? input.voiceChannel?.trim() || null : null,
    notes: input.notes?.trim() || null,
    importFingerprint: existing?.importFingerprint ?? null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function accountDetailsFromProfile(profile: AccountProfile): NonNullable<Appointment["account"]> {
  return {
    accountName: profile.accountName,
    server: profile.server,
    specialization: profile.specialization,
    gearScore: profile.gearScore,
    passwordAvailable: true,
  };
}

function resolveAppointmentAccount(
  appointmentId: string,
  input: AppointmentInput,
  existing?: Appointment,
): Appointment["account"] {
  if (!input.account) {
    if (existing?.account?.passwordAvailable) requireVault();
    appointmentPasswords.delete(appointmentId);
    return null;
  }

  if (input.account.kind === "profile") {
    requireVault();
    const profile = getAccountOrThrow(input.account.profileId);
    appointmentPasswords.set(appointmentId, getPasswordOrThrow(profile.id));
    return accountDetailsFromProfile(profile);
  }

  const details = input.account.details;
  const account = {
    accountName: details.accountName.trim(),
    server: details.server?.trim() || null,
    specialization: details.specialization?.trim() || null,
    gearScore: details.gearScore?.trim() || null,
    passwordAvailable: false,
  };
  const credential = input.account.credential;
  if (credential.kind === "keep") {
    account.passwordAvailable =
      Boolean(existing?.account?.passwordAvailable) && appointmentPasswords.has(appointmentId);
  } else if (credential.kind === "replace") {
    requireVault();
    if (!credential.password) throw new Error("临时账号必须填写密码");
    appointmentPasswords.set(appointmentId, credential.password);
    account.passwordAvailable = true;
  } else {
    requireVault();
    const password = appointmentPasswords.get(credential.sourceAppointmentId);
    if (password === undefined) throw new Error("上次预约的账号密码不可用");
    appointmentPasswords.set(appointmentId, password);
    account.passwordAvailable = true;
  }
  return account;
}

function findConflicts(candidate: Appointment): AppointmentConflict[] {
  if (!candidate.startsAt || !candidate.endsAt || candidate.serviceStatus === "cancelled")
    return [];
  const start = new Date(candidate.startsAt).getTime();
  const end = new Date(candidate.endsAt).getTime();
  return appointments
    .filter((item) => {
      if (
        item.id === candidate.id ||
        item.serviceStatus === "cancelled" ||
        !item.startsAt ||
        !item.endsAt
      ) {
        return false;
      }
      return start < new Date(item.endsAt).getTime() && end > new Date(item.startsAt).getTime();
    })
    .map((item) => ({
      id: item.id,
      contactName: item.contactName,
      startsAt: item.startsAt as string,
      endsAt: item.endsAt,
    }));
}

function filteredAppointments(filters: AppointmentFilters = {}): Appointment[] {
  const query = filters.query?.trim().toLocaleLowerCase();
  return appointments
    .filter((item) => !filters.from || item.serviceDate >= filters.from)
    .filter((item) => !filters.to || item.serviceDate <= filters.to)
    .filter((item) => !filters.mode || item.mode === filters.mode)
    .filter(
      (item) =>
        !filters.progressStatus || appointmentProgressStatus(item) === filters.progressStatus,
    )
    .filter((item) => !filters.serviceStatus || item.serviceStatus === filters.serviceStatus)
    .filter(
      (item) => !filters.settlementStatus || item.settlementStatus === filters.settlementStatus,
    )
    .filter((item) => {
      if (!query) return true;
      return [
        item.contactName,
        item.content,
        item.notes,
        item.account?.accountName,
        item.account?.server,
        item.account?.specialization,
        item.account?.gearScore,
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    })
    .sort((a, b) => {
      const left = a.startsAt ?? `${a.serviceDate}T23:59:59`;
      const right = b.startsAt ?? `${b.serviceDate}T23:59:59`;
      return left.localeCompare(right);
    });
}

function createPoint(period: string): RevenuePoint {
  return {
    period,
    settledMinor: 0,
    unsettledMinor: 0,
    businessHours: 0,
    appointmentCount: 0,
  };
}

function periodFor(serviceDate: string, granularity: ReportGranularity): string {
  const date = parseISO(serviceDate);
  if (granularity === "month") return format(date, "yyyy-MM");
  if (granularity === "week") return format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
  return serviceDate;
}

function appointmentHours(item: Appointment): number {
  if (
    !item.startsAt ||
    !item.endsAt ||
    item.mode !== "business" ||
    item.serviceStatus !== "completed"
  ) {
    return 0;
  }
  return Math.max(differenceInMinutes(parseISO(item.endsAt), parseISO(item.startsAt)) / 60, 0);
}

function requireVault(): void {
  if (!vault.unlocked) throw new Error("密码库已锁定，请先解锁");
}

function getPasswordOrThrow(id: string): string {
  const password = passwords.get(id);
  if (password === undefined) throw new Error("该账号尚未保存密码");
  return password;
}

function getAppointmentOrThrow(id: string): Appointment {
  const item = appointments.find((appointment) => appointment.id === id);
  if (!item) throw new Error("预约不存在或已被删除");
  return item;
}

function scheduleClipboardClear(expectedText: string): void {
  globalThis.setTimeout(async () => {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.readText) return;
    try {
      if ((await clipboard.readText()) === expectedText) await clipboard.writeText("");
    } catch {
      // 浏览器演示模式无法再次读取剪贴板时保持现状，避免误清除用户后来复制的内容。
    }
  }, 30_000);
}

function deleteAppointmentsByIds(ids: readonly string[]): number {
  const targets = new Set(ids.map((id) => id.trim()).filter(Boolean));
  if (appointments.some((item) => targets.has(item.id) && item.account?.passwordAvailable)) {
    requireVault();
  }
  const before = appointments.length;
  appointments = appointments.filter((item) => !targets.has(item.id));
  targets.forEach((id) => appointmentPasswords.delete(id));
  return before - appointments.length;
}

function syncAppointmentServiceStatuses(now: Date): number {
  const nowTime = now.getTime();
  let changedCount = 0;
  appointments = appointments.map((appointment) => {
    if (
      (appointment.serviceStatus !== "scheduled" && appointment.serviceStatus !== "in_progress") ||
      !appointment.startsAt ||
      parseISO(appointment.startsAt).getTime() > nowTime
    ) {
      return appointment;
    }

    const nextStatus =
      appointment.endsAt && parseISO(appointment.endsAt).getTime() <= nowTime
        ? "completed"
        : appointment.serviceStatus === "scheduled"
          ? "in_progress"
          : appointment.serviceStatus;
    if (nextStatus === appointment.serviceStatus) return appointment;

    changedCount += 1;
    return { ...appointment, serviceStatus: nextStatus, updatedAt: now.toISOString() };
  });
  return changedCount;
}

function getAccountOrThrow(id: string): AccountProfile {
  const item = accounts.find((account) => account.id === id);
  if (!item) throw new Error("账号档案不存在或已被删除");
  return item;
}

function deleteAccountProfilesByIds(ids: readonly string[]): number {
  const targets = new Set(ids.map((id) => id.trim()).filter(Boolean));
  const existingIds = new Set(
    accounts.filter((account) => targets.has(account.id)).map((account) => account.id),
  );
  accounts = accounts.filter((account) => !existingIds.has(account.id));
  existingIds.forEach((id) => passwords.delete(id));
  return existingIds.size;
}

export const mockApi: ApiClient = {
  async listAppointments(filters = {}) {
    return structuredClone(filteredAppointments(filters));
  },
  async getAppointment(id) {
    return structuredClone(getAppointmentOrThrow(id));
  },
  async createAppointment(input) {
    const created = toAppointment(input);
    const result: AppointmentMutationResult = {
      appointment: created,
      conflicts: findConflicts(created),
    };
    appointments.push(created);
    return structuredClone(result);
  },
  async updateAppointment(id, input) {
    const index = appointments.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("预约不存在或已被删除");
    const updated = toAppointment(input, appointments[index]);
    const result = { appointment: updated, conflicts: findConflicts(updated) };
    appointments[index] = updated;
    return structuredClone(result);
  },
  async duplicateAppointment(id, serviceDate) {
    const source = getAppointmentOrThrow(id);
    const startTime = source.startsAt ? format(parseISO(source.startsAt), "HH:mm") : null;
    const endTime = source.endsAt ? format(parseISO(source.endsAt), "HH:mm") : null;
    return this.createAppointment({
      serviceDate: serviceDate ?? source.serviceDate,
      startTime,
      endTime,
      contactName: source.contactName,
      content: source.content,
      mode: source.mode,
      serviceStatus: "scheduled",
      settlementStatus: source.mode === "business" ? "unsettled" : "not_applicable",
      account: source.account
        ? {
            kind: "embedded",
            details: {
              accountName: source.account.accountName,
              server: source.account.server,
              specialization: source.account.specialization,
              gearScore: source.account.gearScore,
            },
            credential: source.account.passwordAvailable
              ? { kind: "copyFromAppointment", sourceAppointmentId: source.id }
              : { kind: "keep" },
          }
        : null,
      rateNote: source.rateNote,
      paymentMethod: null,
      amountMinor: source.amountMinor,
      reminderMinutes: source.reminderMinutes,
      voicePlatform: source.voicePlatform,
      voiceChannel: source.voiceChannel,
      notes: source.notes,
    });
  },
  async listContactPresets(query, limit = 10) {
    const normalized = query?.trim().toLocaleLowerCase();
    const seen = new Set<string>();
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const sorted = appointments
      .filter((item) => item.serviceStatus !== "cancelled")
      .filter((item) => !normalized || item.contactName.toLocaleLowerCase().includes(normalized))
      .sort((left, right) => {
        const dateOrder = right.serviceDate.localeCompare(left.serviceDate);
        if (dateOrder !== 0) return dateOrder;
        const timeOrder = (right.startsAt ?? "").localeCompare(left.startsAt ?? "");
        return timeOrder || right.createdAt.localeCompare(left.createdAt);
      });
    const result: ContactPreset[] = [];
    for (const item of sorted) {
      const key = item.contactName.trim().toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        sourceAppointmentId: item.id,
        contactName: item.contactName,
        startTime: item.startsAt ? format(parseISO(item.startsAt), "HH:mm") : null,
        endTime: item.endsAt ? format(parseISO(item.endsAt), "HH:mm") : null,
        content: item.content,
        mode: item.mode,
        account: item.account,
        rateNote: item.rateNote,
        paymentMethod: item.paymentMethod,
        amountMinor: item.amountMinor,
        reminderMinutes: item.reminderMinutes,
        notes: item.notes,
        voicePlatform: item.voicePlatform,
        voiceChannel: item.voiceChannel,
      });
      if (result.length >= safeLimit) break;
    }
    return structuredClone(result);
  },
  async copyAppointmentAccountPassword(id) {
    requireVault();
    const appointment = getAppointmentOrThrow(id);
    if (!appointment.account?.passwordAvailable) throw new Error("该预约没有可复制的账号密码");
    const password = appointmentPasswords.get(id);
    if (password === undefined) throw new Error("该预约尚未保存账号密码");
    if (!globalThis.navigator?.clipboard) throw new Error("当前环境无法访问剪贴板");
    await globalThis.navigator.clipboard.writeText(password);
    scheduleClipboardClear(password);
  },
  async copyAppointmentAccountName(id) {
    const accountName = getAppointmentOrThrow(id).account?.accountName.trim();
    if (!accountName) throw new Error("该预约未使用账号");
    if (!globalThis.navigator?.clipboard) throw new Error("当前环境无法访问剪贴板");
    await globalThis.navigator.clipboard.writeText(accountName);
  },
  async copyAppointmentVoiceChannel(id) {
    const appointment = getAppointmentOrThrow(id);
    if (appointment.voicePlatform !== "yy") throw new Error("该预约未选择YY语音");
    const channel = appointment.voiceChannel?.trim();
    if (!channel) throw new Error("该预约未填写YY频道号");
    if (!/^\d+$/.test(channel)) throw new Error("YY频道号只能包含数字");
    if (!globalThis.navigator?.clipboard) throw new Error("当前环境无法访问剪贴板");
    await globalThis.navigator.clipboard.writeText(channel);
  },
  async deleteAppointments(ids) {
    return deleteAppointmentsByIds(ids);
  },
  async deleteAppointment(id) {
    deleteAppointmentsByIds([id]);
  },
  async syncAppointmentServiceStatuses() {
    return syncAppointmentServiceStatuses(new Date());
  },
  async setAppointmentServiceStatus(id, status: ServiceStatus) {
    const item = getAppointmentOrThrow(id);
    item.serviceStatus = status;
    item.updatedAt = new Date().toISOString();
    return structuredClone(item);
  },
  async settleAppointment(id, amountMinor, paymentMethod) {
    const item = getAppointmentOrThrow(id);
    if (item.mode !== "business") throw new Error("娱乐预约不参与结算");
    if (amountMinor < 0) throw new Error("结算金额不能为负数");
    item.amountMinor = amountMinor;
    item.paymentMethod = paymentMethod ?? item.paymentMethod;
    item.settlementStatus = "settled";
    item.serviceStatus = "completed";
    item.updatedAt = new Date().toISOString();
    return structuredClone(item);
  },

  async listAccountProfiles(query, needsReview) {
    const normalized = query?.trim().toLocaleLowerCase();
    return structuredClone(
      accounts
        .filter((item) => needsReview === undefined || item.needsReview === needsReview)
        .filter((item) => {
          if (!normalized) return true;
          return [item.accountName, item.contactName, item.server, item.characterName].some(
            (value) => value?.toLocaleLowerCase().includes(normalized),
          );
        }),
    );
  },
  async getAccountProfile(id) {
    return structuredClone(getAccountOrThrow(id));
  },
  async createAccountProfile(input) {
    requireVault();
    const timestamp = new Date().toISOString();
    const profile: AccountProfile = {
      id: makeId("account"),
      contactName: input.contactName?.trim() || null,
      server: input.server?.trim() || null,
      characterName: input.characterName?.trim() || null,
      specialization: input.specialization?.trim() || null,
      gearScore: input.gearScore?.trim() || null,
      accountName: input.accountName.trim(),
      currentScore: input.currentScore ?? null,
      highestScore: input.highestScore ?? null,
      scoreUpdatedAt: input.scoreUpdatedAt ?? null,
      usageInfo: null,
      notes: input.notes?.trim() || null,
      needsReview: input.needsReview ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (!input.password) throw new Error("新建账号必须填写密码");
    passwords.set(profile.id, input.password);
    accounts.push(profile);
    return structuredClone(profile);
  },
  async updateAccountProfile(id, input) {
    requireVault();
    const existing = getAccountOrThrow(id);
    Object.assign(existing, {
      contactName: input.contactName?.trim() || null,
      server: input.server?.trim() || null,
      characterName: input.characterName?.trim() || null,
      specialization: input.specialization?.trim() || null,
      gearScore: input.gearScore?.trim() || null,
      accountName: input.accountName.trim(),
      currentScore: input.currentScore ?? null,
      highestScore: input.highestScore ?? null,
      scoreUpdatedAt: input.scoreUpdatedAt ?? null,
      notes: input.notes?.trim() || null,
      needsReview: input.needsReview ?? false,
      updatedAt: new Date().toISOString(),
    });
    if (input.password) passwords.set(id, input.password);
    return structuredClone(existing);
  },
  async updateAccountProfileUsage(id, usageInfo) {
    syncMockAccountUsageWeek();
    const existing = getAccountOrThrow(id);
    existing.usageInfo = usageInfo?.trim() || null;
    existing.updatedAt = new Date().toISOString();
    return structuredClone(existing);
  },
  async clearAccountProfileUsage() {
    let clearedCount = 0;
    const timestamp = new Date().toISOString();
    for (const account of accounts) {
      if (account.usageInfo == null) continue;
      account.usageInfo = null;
      account.updatedAt = timestamp;
      clearedCount += 1;
    }
    return clearedCount;
  },
  async syncAccountProfileUsageWeek() {
    return syncMockAccountUsageWeek();
  },
  async deleteAccountProfile(id) {
    getAccountOrThrow(id);
    deleteAccountProfilesByIds([id]);
  },
  async deleteAccountProfiles(ids) {
    return deleteAccountProfilesByIds(ids);
  },
  async reorderAccountProfiles(ids) {
    const normalized = ids.map((id) => id.trim());
    if (normalized.some((id) => !id)) throw new Error("账号排序包含空白 ID");
    if (new Set(normalized).size !== normalized.length) throw new Error("账号排序包含重复 ID");
    if (
      normalized.length !== accounts.length ||
      normalized.some((id) => !accounts.some((account) => account.id === id))
    ) {
      throw new Error("账号排序必须包含当前全部账号档案");
    }
    const byId = new Map(accounts.map((account) => [account.id, account]));
    accounts = normalized.map((id) => byId.get(id)!);
  },
  async copyAccountName(id) {
    const profile = getAccountOrThrow(id);
    if (!globalThis.navigator?.clipboard) throw new Error("当前环境无法访问剪贴板");
    await globalThis.navigator.clipboard.writeText(profile.accountName);
  },
  async copyAccountCharacterName(id) {
    const profile = getAccountOrThrow(id);
    const characterName = profile.characterName?.trim();
    if (!characterName) throw new Error("角色名未填写");
    if (!globalThis.navigator?.clipboard) throw new Error("当前环境无法访问剪贴板");
    await globalThis.navigator.clipboard.writeText(characterName);
  },
  async refreshAccountProfileRoleData(ids) {
    if (accountRoleDataRefreshBusy) throw new Error("已有角色数据更新任务正在进行");
    const validationError = validateAccountRoleDataServerUrl(settings.accountRoleDataServerUrl);
    if (validationError) throw new Error(validationError);
    accountRoleDataRefreshBusy = true;
    try {
      return structuredClone(refreshMockAccountRoleData(ids));
    } finally {
      accountRoleDataRefreshBusy = false;
    }
  },

  async vaultStatus() {
    return structuredClone(vault);
  },
  async initializeVault(password) {
    if (!isMasterPasswordLongEnough(password)) {
      throw new Error(`主密码至少需要${MIN_MASTER_PASSWORD_CHARACTERS}个字符`);
    }
    vaultPassword = password;
    vault = { initialized: true, unlocked: true, autoLockMinutes: settings.autoLockMinutes };
    return structuredClone(vault);
  },
  async unlockVault(password) {
    if (!password) throw new Error("主密码不能为空");
    if (vaultPassword !== null && password !== vaultPassword) {
      throw new Error("主密码错误或保险库已经损坏");
    }
    vaultPassword ??= password;
    vault = { ...vault, unlocked: true };
    return structuredClone(vault);
  },
  async changeVaultPassword(currentPassword, newPassword) {
    requireVault();
    if (!currentPassword) throw new Error("主密码不能为空");
    if (!isMasterPasswordLongEnough(newPassword)) {
      throw new Error(`主密码至少需要${MIN_MASTER_PASSWORD_CHARACTERS}个字符`);
    }
    if (newPassword === currentPassword) throw new Error("新主密码不能与当前主密码相同");
    if (vaultPassword !== null && currentPassword !== vaultPassword) {
      throw new Error("当前主密码不正确");
    }
    vaultPassword = newPassword;
    return structuredClone(vault);
  },
  async lockVault() {
    vault = { ...vault, unlocked: false };
    return structuredClone(vault);
  },
  async revealAccountPassword(id) {
    requireVault();
    return getPasswordOrThrow(id);
  },
  async copyAccountPassword(id) {
    requireVault();
    const password = getPasswordOrThrow(id);
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(password);
      scheduleClipboardClear(password);
    }
  },

  async getDashboardSummary(date) {
    const target = parseISO(date);
    const weekFrom = format(startOfWeek(target, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const weekTo = format(endOfWeek(target, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const settled = (items: Appointment[]) =>
      items
        .filter((item) => item.serviceStatus !== "cancelled" && item.settlementStatus === "settled")
        .reduce((sum, item) => sum + (item.amountMinor ?? 0), 0);
    const now = new Date();
    const applyTimeCutoff = date === format(now, "yyyy-MM-dd");
    const upcoming = appointments
      .filter((item) => item.serviceDate >= date)
      .filter((item) => item.serviceStatus === "scheduled" || item.serviceStatus === "in_progress")
      .filter(
        (item) =>
          item.serviceStatus === "in_progress" ||
          !applyTimeCutoff ||
          item.serviceDate > date ||
          !item.startsAt ||
          new Date(item.startsAt) >= now,
      )
      .sort((a, b) => {
        if (a.serviceStatus !== b.serviceStatus) {
          if (a.serviceStatus === "in_progress") return -1;
          if (b.serviceStatus === "in_progress") return 1;
        }
        const dateOrder = a.serviceDate.localeCompare(b.serviceDate);
        if (dateOrder !== 0) return dateOrder;
        if (!a.startsAt) return b.startsAt ? 1 : 0;
        if (!b.startsAt) return -1;
        return a.startsAt.localeCompare(b.startsAt);
      })[0];
    return {
      todaySettledMinor: settled(appointments.filter((item) => item.serviceDate === date)),
      weekSettledMinor: settled(
        appointments.filter((item) => item.serviceDate >= weekFrom && item.serviceDate <= weekTo),
      ),
      pendingCount: appointments.filter(
        (item) =>
          item.mode === "business" &&
          item.serviceStatus === "completed" &&
          item.settlementStatus === "unsettled",
      ).length,
      nextAppointment: upcoming ? structuredClone(upcoming) : null,
    };
  },
  async getRevenueSummary(from, to, granularity) {
    if ((!from && to) || (from && !to)) {
      throw new Error("开始日期和结束日期必须同时填写，或同时留空查看全部记录");
    }
    const reportable = appointments.filter(
      (item) => item.mode === "business" && item.serviceStatus !== "cancelled",
    );
    const today = format(new Date(), "yyyy-MM-dd");
    const incomeDates = reportable
      .filter(
        (item) =>
          item.settlementStatus === "settled" &&
          (item.amountMinor ?? 0) > 0 &&
          item.serviceDate <= today,
      )
      .map((item) => item.serviceDate)
      .sort();
    const resolvedFrom = from || incomeDates[0] || today;
    const resolvedTo = to || today;
    const scoped = reportable.filter(
      (item) => item.serviceDate >= resolvedFrom && item.serviceDate <= resolvedTo,
    );
    const pointsMap = new Map<string, RevenuePoint>();
    const paymentMap = new Map<string, number>();
    for (const item of scoped) {
      const key = periodFor(item.serviceDate, granularity);
      const point = pointsMap.get(key) ?? createPoint(key);
      point.appointmentCount += 1;
      point.businessHours += appointmentHours(item);
      if (item.settlementStatus === "settled") {
        point.settledMinor += item.amountMinor ?? 0;
        const method = item.paymentMethod || "其他";
        paymentMap.set(method, (paymentMap.get(method) ?? 0) + (item.amountMinor ?? 0));
      } else if (item.settlementStatus === "unsettled") {
        point.unsettledMinor += item.amountMinor ?? 0;
      }
      pointsMap.set(key, point);
    }
    const points = [...pointsMap.values()].sort((a, b) => a.period.localeCompare(b.period));
    const settledMinor = points.reduce((sum, point) => sum + point.settledMinor, 0);
    const unsettledMinor = points.reduce((sum, point) => sum + point.unsettledMinor, 0);
    const businessHours = points.reduce((sum, point) => sum + point.businessHours, 0);
    return {
      from: resolvedFrom,
      to: resolvedTo,
      settledMinor,
      unsettledMinor,
      businessHours,
      averageHourlyMinor: businessHours > 0 ? Math.round(settledMinor / businessHours) : 0,
      appointmentCount: scoped.length,
      completedCount: scoped.filter((item) => item.serviceStatus === "completed").length,
      paymentMethods: [...paymentMap.entries()]
        .map(([name, amountMinor]) => ({ name, amountMinor }))
        .sort((a, b) => b.amountMinor - a.amountMinor),
      points,
    };
  },
  async previewExcelImport(path, baseYear) {
    return {
      sourcePath: path,
      baseYear,
      appointmentCount: 357,
      profileCount: 22,
      unmatchedProfileCount: 0,
      crossMidnightCount: 50,
      passwordConflictCount: 1,
      skippedCount: 0,
      warningCount: 2,
      warnings: [
        "1个同名账号存在多个历史密码，账号档案和各预约将分别保留各自密码",
        "50条跨午夜记录已按次日结束处理",
      ],
      previewToken: makeId("preview"),
    };
  },
  async commitExcelImport(_previewToken, selection) {
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
    const path =
      destination ?? "C:\\Users\\14620\\Documents\\TimeKeeper\\backups\\timekeeper-demo.tkbackup";
    backupSnapshot = {
      appointments: structuredClone(appointments),
      accounts: structuredClone(accounts),
      passwords: structuredClone([...passwords.entries()]),
      appointmentPasswords: structuredClone([...appointmentPasswords.entries()]),
      settings: structuredClone(settings),
      vault: {
        initialized: vault.initialized,
        autoLockMinutes: vault.autoLockMinutes,
      },
      vaultPassword,
    };
    lastBackupPath = path;
    return {
      path,
      createdAt: new Date().toISOString(),
      sizeBytes: 842_136,
    };
  },
  async restoreBackup(path) {
    if (!backupSnapshot || path !== lastBackupPath) {
      throw new Error("未找到可恢复的演示备份，请先创建备份");
    }
    storeAccountTableColumnWidths(backupSnapshot.settings.accountTableColumnWidths);
    storeAppointmentTableColumnWidths(backupSnapshot.settings.appointmentTableColumnWidths);
    appointments = structuredClone(backupSnapshot.appointments);
    accounts = structuredClone(backupSnapshot.accounts);
    passwords.clear();
    for (const [id, password] of backupSnapshot.passwords) passwords.set(id, password);
    appointmentPasswords.clear();
    for (const [id, password] of backupSnapshot.appointmentPasswords) {
      appointmentPasswords.set(id, password);
    }
    settings = structuredClone(backupSnapshot.settings);
    vault = { ...structuredClone(backupSnapshot.vault), unlocked: false };
    vaultPassword = backupSnapshot.vaultPassword;
  },
  async getSettings() {
    return structuredClone(settings);
  },
  async updateSettings(nextSettings) {
    if (!accountTableColumnWidthsAreValid(nextSettings.accountTableColumnWidths)) {
      throw new Error("账号表格列宽超出允许范围");
    }
    if (!appointmentTableColumnWidthsAreValid(nextSettings.appointmentTableColumnWidths)) {
      throw new Error("预约表格列宽超出允许范围");
    }
    const serverUrlError = validateAccountRoleDataServerUrl(nextSettings.accountRoleDataServerUrl);
    if (serverUrlError) throw new Error(serverUrlError);
    storeAccountTableColumnWidths(nextSettings.accountTableColumnWidths);
    storeAppointmentTableColumnWidths(nextSettings.appointmentTableColumnWidths);
    settings = {
      ...nextSettings,
      accountTableColumnWidths: { ...nextSettings.accountTableColumnWidths },
      appointmentTableColumnWidths: { ...nextSettings.appointmentTableColumnWidths },
      accountRoleDataServerUrl: nextSettings.accountRoleDataServerUrl.trim(),
      lastAccountUsageWeekStart: settings.lastAccountUsageWeekStart,
    };
    vault = { ...vault, autoLockMinutes: settings.autoLockMinutes };
    return structuredClone(settings);
  },
  async updateAccountTableColumnWidths(widths) {
    if (!accountTableColumnWidthsAreValid(widths)) {
      throw new Error("账号表格列宽超出允许范围");
    }
    settings.accountTableColumnWidths = structuredClone(widths);
    storeAccountTableColumnWidths(widths);
    return structuredClone(settings.accountTableColumnWidths);
  },
  async updateAppointmentTableColumnWidths(widths) {
    if (!appointmentTableColumnWidthsAreValid(widths)) {
      throw new Error("预约表格列宽超出允许范围");
    }
    settings.appointmentTableColumnWidths = structuredClone(widths);
    storeAppointmentTableColumnWidths(widths);
    return structuredClone(settings.appointmentTableColumnWidths);
  },
  async selectExcelFile() {
    return "C:\\Users\\14620\\Desktop\\account.xlsm";
  },
  async selectBackupDestination() {
    return "C:\\Users\\14620\\Documents\\TimeKeeper\\TimeKeeper-demo.tkbackup";
  },
  async selectBackupFile() {
    return (
      lastBackupPath ??
      "C:\\Users\\14620\\Documents\\TimeKeeper\\backups\\timekeeper-latest.tkbackup"
    );
  },
  async requestNotificationPermission() {
    return "granted";
  },
};
