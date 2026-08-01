import { differenceInMinutes, endOfWeek, format, parseISO, startOfWeek } from "date-fns";
import type {
  AccountProfile,
  AppSettings,
  Appointment,
  AppointmentConflict,
  AppointmentFilters,
  AppointmentInput,
  AppointmentMutationResult,
  ReportGranularity,
  RevenuePoint,
  ServiceStatus,
  VaultStatus,
} from "../types/domain";
import { MIN_MASTER_PASSWORD_CHARACTERS, isMasterPasswordLongEnough } from "../utils/security";
import { combineDateTime } from "../utils/appointment";
import { demoAccounts, demoAppointments, demoPasswords } from "./mockData";
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
let vault: VaultStatus = { initialized: true, unlocked: true, autoLockMinutes: 15 };
let vaultPassword: string | null = null;
let settings: AppSettings = {
  defaultReminderMinutes: 30,
  autoLockMinutes: 15,
  backupRetention: 30,
  lastAutomaticBackupDate: format(new Date(), "yyyy-MM-dd"),
};

interface MockBackupSnapshot {
  appointments: Appointment[];
  accounts: AccountProfile[];
  passwords: Array<[string, string]>;
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

function accountSnapshot(accountProfileId?: string | null): Appointment["accountSnapshot"] {
  const account = accounts.find((item) => item.id === accountProfileId);
  if (!account) return null;
  return {
    accountName: account.accountName,
    contactName: account.contactName,
    server: account.server,
    characterName: account.characterName,
    specialization: account.specialization,
    gearScore: account.gearScore,
  };
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
    throw new Error("已结算预约必须填写金额");
  }
  const { startsAt, endsAt } = combineDateTime(input.serviceDate, input.startTime, input.endTime);
  const entertainment = input.mode === "entertainment";
  const nextAccountProfileId = input.accountProfileId || null;
  const nextAccountSnapshot = nextAccountProfileId
    ? existing?.accountProfileId === nextAccountProfileId && existing.accountSnapshot
      ? existing.accountSnapshot
      : accountSnapshot(nextAccountProfileId)
    : (existing?.accountSnapshot ?? null);
  return {
    id: existing?.id ?? makeId("appointment"),
    serviceDate: input.serviceDate,
    startsAt,
    endsAt,
    contactName: input.contactName.trim(),
    content: input.content?.trim() || null,
    mode: input.mode,
    serviceStatus: input.serviceStatus,
    settlementStatus: entertainment ? "not_applicable" : input.settlementStatus,
    accountProfileId: nextAccountProfileId,
    accountSnapshot: nextAccountSnapshot,
    rateNote: entertainment ? null : input.rateNote?.trim() || null,
    paymentMethod: entertainment ? null : input.paymentMethod?.trim() || null,
    amountMinor: entertainment ? null : (input.amountMinor ?? null),
    reminderMinutes:
      input.reminderMinutes === undefined ? settings.defaultReminderMinutes : input.reminderMinutes,
    notes: input.notes?.trim() || null,
    importFingerprint: existing?.importFingerprint ?? null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
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
    .filter((item) => !filters.serviceStatus || item.serviceStatus === filters.serviceStatus)
    .filter(
      (item) => !filters.settlementStatus || item.settlementStatus === filters.settlementStatus,
    )
    .filter(
      (item) => !filters.accountProfileId || item.accountProfileId === filters.accountProfileId,
    )
    .filter((item) => {
      if (!query) return true;
      return [item.contactName, item.content, item.notes, item.accountSnapshot?.accountName].some(
        (value) => value?.toLocaleLowerCase().includes(query),
      );
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

function deleteAppointmentsByIds(ids: readonly string[]): number {
  const targets = new Set(ids.map((id) => id.trim()).filter(Boolean));
  const before = appointments.length;
  appointments = appointments.filter((item) => !targets.has(item.id));
  return before - appointments.length;
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
  appointments = appointments.map((appointment) =>
    appointment.accountProfileId && existingIds.has(appointment.accountProfileId)
      ? { ...appointment, accountProfileId: null }
      : appointment,
  );
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
      accountProfileId: source.accountProfileId,
      rateNote: source.rateNote,
      paymentMethod: null,
      amountMinor: source.amountMinor,
      reminderMinutes: source.reminderMinutes,
      notes: source.notes,
    });
  },
  async deleteAppointments(ids) {
    return deleteAppointmentsByIds(ids);
  },
  async deleteAppointment(id) {
    deleteAppointmentsByIds([id]);
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
      window.setTimeout(
        () => void navigator.clipboard.writeText("").catch(() => undefined),
        30_000,
      );
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
      unmatchedProfileCount: 15,
      crossMidnightCount: 50,
      passwordConflictCount: 1,
      skippedCount: 0,
      warningCount: 3,
      warnings: [
        "15个流水账号未匹配到完整档案，将标记为待完善",
        "1个账号存在多个历史密码，将以账号档案表为准",
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
      importedProfiles: selection.accounts ? 37 : 0,
      skippedDuplicates: 0,
      skippedAppointmentDuplicates: 0,
      skippedProfileDuplicates: 0,
      warnings: ["15个账号档案已标记为待完善"],
    };
  },
  async createBackup(destination) {
    const path =
      destination ?? "C:\\Users\\14620\\Documents\\TimeKeeper\\backups\\timekeeper-demo.tkbackup";
    backupSnapshot = {
      appointments: structuredClone(appointments),
      accounts: structuredClone(accounts),
      passwords: structuredClone([...passwords.entries()]),
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
    appointments = structuredClone(backupSnapshot.appointments);
    accounts = structuredClone(backupSnapshot.accounts);
    passwords.clear();
    for (const [id, password] of backupSnapshot.passwords) passwords.set(id, password);
    settings = structuredClone(backupSnapshot.settings);
    vault = { ...structuredClone(backupSnapshot.vault), unlocked: false };
    vaultPassword = backupSnapshot.vaultPassword;
  },
  async getSettings() {
    return structuredClone(settings);
  },
  async updateSettings(nextSettings) {
    settings = structuredClone(nextSettings);
    vault = { ...vault, autoLockMinutes: settings.autoLockMinutes };
    return structuredClone(settings);
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
