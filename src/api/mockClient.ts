import type {
  AccountProfile,
  AccountRoleDataRefreshProgress,
  AccountRoleDataRefreshResult,
  AppAccessRecoveryProof,
  Appointment,
  AppointmentConflict,
  AppointmentFilters,
  AppointmentInput,
  AppointmentMutationResult,
  ContactPreset,
  ReportGranularity,
  RevenuePoint,
  ServiceStatus,
} from "../types/domain";
import { validateAccountRoleDataServerUrl } from "../utils/accountRoleData";
import { parseOptionalAccountScore } from "../utils/accounts";
import { MIN_MASTER_PASSWORD_CHARACTERS, isMasterPasswordLongEnough } from "../utils/security";
import { combineDateTime } from "../utils/appointment";
import { appointmentProgressStatus } from "../utils/appointmentProgress";
import {
  chinaCivilNowValue,
  chinaDateKey,
  civilDateTimeValue,
  civilDurationInMinutes,
  civilTime,
  endOfChinaWeek,
  startOfChinaWeek,
} from "../utils/chinaDateTime";
import { isSafeAmountMinor } from "../utils/money";
import type { ApiClient } from "./types";
import { createMockImportBackupApi } from "./mock/importBackup";
import { createMockSettingsApi } from "./mock/settings";
import { mockStore } from "./mock/store";

function normalizeRecoveryAnswer(value: string): string {
  return value.trim().split(/\s+/u).filter(Boolean).join(" ").toLocaleLowerCase();
}

function revenueContactName(value: string): string {
  const trimmed = value.trim();
  const prefix = /^qq\s*\|\s*/iu.exec(trimmed)?.[0];
  if (!prefix) return trimmed;
  return trimmed.slice(prefix.length).trim() || trimmed;
}

function makeId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${random}`;
}

function currentChinaDate(): string {
  return chinaDateKey();
}

function checkedSafeIntegerAdd(total: number, value: number, message: string): number {
  const result = total + value;
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(value) ||
    total < 0 ||
    value < 0 ||
    !Number.isSafeInteger(result)
  ) {
    throw new Error(message);
  }
  return result;
}

function refreshMockAccountRoleData(
  ids: string[],
  onProgress?: (progress: AccountRoleDataRefreshProgress) => void,
): AccountRoleDataRefreshResult {
  const normalizedIds = [...new Set(ids.map((id) => id.trim()))];
  if (!normalizedIds.length) throw new Error("请至少选择一个账号更新角色数据");
  if (normalizedIds.some((id) => !id)) throw new Error("角色数据更新包含空白账号 ID");
  if (normalizedIds.length > 1_000) throw new Error("单次最多更新 1000 个账号的角色数据");

  const items: AccountRoleDataRefreshResult["items"] = normalizedIds.map((id, index) => {
    const profile = mockStore.accounts.find((account) => account.id === id);
    let item: AccountRoleDataRefreshResult["items"][number];
    let patch: AccountRoleDataRefreshProgress["patch"];
    if (!profile) {
      item = { accountId: id, status: "failed", message: "账号档案不存在" };
    } else if (!profile.server?.trim() || !profile.characterName?.trim()) {
      item = { accountId: id, status: "skipped", message: "缺少服务器或角色名" };
    } else if (profile.characterName.includes("未补充")) {
      item = { accountId: id, status: "noRecord", message: "服务器未返回角色战绩" };
    } else {
      try {
        const nextScore = checkedSafeIntegerAdd(
          profile.currentScore ?? 1800,
          index + 1,
          "角色数据分数超出 JavaScript 安全整数范围",
        );
        const nextHighestScore = Math.max(
          profile.highestScore ?? 0,
          checkedSafeIntegerAdd(nextScore, 100, "角色数据分数超出 JavaScript 安全整数范围"),
        );
        const nextGearScore = (BigInt(nextScore) + 200_000n).toString();
        const nextScoreUpdatedAt = currentChinaDate();
        const nextWeeklyWins = index + 1;
        const nextUpdatedAt = new Date().toISOString();

        Object.assign(profile, {
          gearScore: nextGearScore,
          currentScore: nextScore,
          highestScore: nextHighestScore,
          scoreUpdatedAt: nextScoreUpdatedAt,
          weeklyWins: nextWeeklyWins,
          updatedAt: nextUpdatedAt,
        });
        item = { accountId: id, status: "updated" };
        patch = {
          accountId: id,
          gearScore: nextGearScore,
          currentScore: nextScore,
          highestScore: nextHighestScore,
          scoreUpdatedAt: nextScoreUpdatedAt,
          weeklyWins: nextWeeklyWins,
          updatedAt: nextUpdatedAt,
        };
      } catch (cause) {
        item = {
          accountId: id,
          status: "failed",
          message: cause instanceof Error ? cause.message : "角色数据分数无效",
        };
      }
    }
    onProgress?.(
      structuredClone({
        completedCount: index + 1,
        requestedCount: normalizedIds.length,
        item,
        patch,
      }),
    );
    return item;
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

function toAppointment(input: AppointmentInput, existing?: Appointment): Appointment {
  const timestamp = new Date().toISOString();
  if (
    input.amountMinor !== null &&
    input.amountMinor !== undefined &&
    !isSafeAmountMinor(input.amountMinor)
  ) {
    throw new Error("金额必须是安全范围内的非负整数分");
  }
  if (
    input.mode === "business" &&
    input.settlementStatus === "settled" &&
    (input.amountMinor === null || input.amountMinor === undefined)
  ) {
    throw new Error("已结算预约必须填写金额");
  }
  if (
    input.reminderMinutes !== null &&
    input.reminderMinutes !== undefined &&
    (!Number.isInteger(input.reminderMinutes) ||
      input.reminderMinutes < 0 ||
      input.reminderMinutes > 1440)
  ) {
    throw new Error("提醒时间必须是0到1440之间的整数");
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
    serviceStatus: input.serviceStatus,
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
    source: "profile",
    characterName: profile.characterName,
    accountName: profile.accountName,
    server: profile.server,
    specialization: profile.specialization,
    gearScore: profile.gearScore,
    password: profile.password,
  };
}

function resolveAppointmentAccount(
  _appointmentId: string,
  input: AppointmentInput,
  existing?: Appointment,
): Appointment["account"] {
  if (!input.account) {
    return null;
  }

  if (input.account.kind === "profile") {
    const profile = getAccountOrThrow(input.account.profileId);
    return accountDetailsFromProfile(profile);
  }

  const details = input.account.details;
  const account = {
    source: input.account.kind === "snapshot" ? input.account.source : ("embedded" as const),
    characterName:
      input.account.kind === "snapshot" && input.account.source === "profile"
        ? (input.account.characterName ?? null)
        : null,
    accountName: details.accountName.trim(),
    server: details.server?.trim() || null,
    specialization: details.specialization?.trim() || null,
    gearScore: details.gearScore?.trim() || null,
    password: null as string | null,
  };
  const credential = input.account.credential;
  if (credential.kind === "none") {
    if (input.account.kind === "embedded") {
      throw new Error("一次性账号不能使用无密码凭据状态");
    }
    account.password = null;
  } else if (credential.kind === "keep") {
    account.password = existing?.account?.password ?? null;
  } else if (credential.kind === "replace") {
    if (!credential.password) throw new Error("临时账号必须填写密码");
    account.password = credential.password;
  } else {
    const password = getAppointmentOrThrow(credential.sourceAppointmentId).account?.password;
    if (!password) throw new Error("上次预约的账号密码不可用");
    account.password = password;
  }
  return account;
}

function findConflicts(candidate: Appointment): AppointmentConflict[] {
  if (!candidate.startsAt || !candidate.endsAt || candidate.serviceStatus === "cancelled")
    return [];
  const start = civilDateTimeValue(candidate.startsAt);
  const end = civilDateTimeValue(candidate.endsAt);
  return mockStore.appointments
    .filter((item) => {
      if (
        item.id === candidate.id ||
        item.serviceStatus === "cancelled" ||
        !item.startsAt ||
        !item.endsAt
      ) {
        return false;
      }
      return start < civilDateTimeValue(item.endsAt) && end > civilDateTimeValue(item.startsAt);
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
  return mockStore.appointments
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
        item.voiceChannel,
        item.account?.accountName,
        item.account?.server,
        item.account?.characterName,
        item.account?.specialization,
        item.account?.gearScore,
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    })
    .sort((a, b) => {
      const dateOrder = b.serviceDate.localeCompare(a.serviceDate);
      if (dateOrder !== 0) return dateOrder;
      const startOrder = (b.startsAt ?? "").localeCompare(a.startsAt ?? "");
      if (startOrder !== 0) return startOrder;
      const createdOrder = b.createdAt.localeCompare(a.createdAt);
      return createdOrder || b.id.localeCompare(a.id);
    });
}

function createPoint(period: string): RevenuePoint {
  return {
    period,
    settledMinor: 0,
    unsettledMinor: 0,
    pendingCount: 0,
    businessHours: 0,
    appointmentCount: 0,
  };
}

function periodFor(serviceDate: string, granularity: ReportGranularity): string {
  if (granularity === "month") return serviceDate.slice(0, 7);
  if (granularity === "week") return startOfChinaWeek(serviceDate);
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
  return Math.max(civilDurationInMinutes(item.startsAt, item.endsAt) / 60, 0);
}

function getPasswordOrThrow(id: string): string {
  const password = getAccountOrThrow(id).password;
  if (!password) throw new Error("该账号尚未保存密码");
  return password;
}

function getAppointmentOrThrow(id: string): Appointment {
  const item = mockStore.appointments.find((appointment) => appointment.id === id);
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
  const before = mockStore.appointments.length;
  mockStore.appointments = mockStore.appointments.filter((item) => !targets.has(item.id));
  return before - mockStore.appointments.length;
}

function syncAppointmentServiceStatuses(now: Date): number {
  const nowTime = chinaCivilNowValue(now);
  let changedCount = 0;
  mockStore.appointments = mockStore.appointments.map((appointment) => {
    if (
      (appointment.serviceStatus !== "scheduled" && appointment.serviceStatus !== "in_progress") ||
      !appointment.startsAt ||
      civilDateTimeValue(appointment.startsAt) > nowTime
    ) {
      return appointment;
    }

    const nextStatus =
      appointment.endsAt && civilDateTimeValue(appointment.endsAt) <= nowTime
        ? "completed"
        : appointment.serviceStatus === "scheduled"
          ? "in_progress"
          : appointment.serviceStatus;
    if (nextStatus === appointment.serviceStatus) {
      return appointment;
    }

    changedCount += 1;
    return {
      ...appointment,
      serviceStatus: nextStatus,
      updatedAt: now.toISOString(),
    };
  });
  return changedCount;
}

function getAccountOrThrow(id: string): AccountProfile {
  const item = mockStore.accounts.find((account) => account.id === id);
  if (!item) throw new Error("账号档案不存在或已被删除");
  return item;
}

function validatedAccountScore(
  value: number | null | undefined,
  label: "当前分" | "最高分",
): number | null {
  const result = parseOptionalAccountScore(value);
  if (!result.ok) throw new Error(`${label}必须是 0 或更大的有效整数`);
  return result.value;
}

function deleteAccountProfilesByIds(ids: readonly string[]): number {
  const targets = new Set(ids.map((id) => id.trim()).filter(Boolean));
  const existingIds = new Set(
    mockStore.accounts.filter((account) => targets.has(account.id)).map((account) => account.id),
  );
  mockStore.accounts = mockStore.accounts.filter((account) => !existingIds.has(account.id));
  return existingIds.size;
}

export const mockApi: ApiClient = {
  async listAppointments(filters) {
    if (!filters.from || !filters.to) {
      throw new Error("预约范围查询必须同时提供开始日期和结束日期");
    }
    if (filters.from > filters.to) throw new Error("开始日期不能晚于结束日期");
    return structuredClone(filteredAppointments(filters));
  },
  async listAppointmentPage(filters = {}, requestedPage = 1, requestedPageSize = 100) {
    const pageSize = Math.min(Math.max(Math.trunc(requestedPageSize), 1), 200);
    const filtered = filteredAppointments(filters);
    const totalCount = filtered.length;
    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);
    const page = Math.min(Math.max(Math.trunc(requestedPage), 1), Math.max(totalPages, 1));
    const offset = (page - 1) * pageSize;
    return structuredClone({
      items: filtered.slice(offset, offset + pageSize),
      totalCount,
      page,
      pageSize,
      totalPages,
    });
  },
  async createAppointmentSelection(filters = {}) {
    const now = Date.now();
    for (const [existingToken, snapshot] of mockStore.appointmentSelections) {
      if (snapshot.expiresAt <= now) mockStore.appointmentSelections.delete(existingToken);
    }
    while (mockStore.appointmentSelections.size >= 8) {
      const oldestToken = mockStore.appointmentSelections.keys().next().value as string | undefined;
      if (!oldestToken) break;
      mockStore.appointmentSelections.delete(oldestToken);
    }
    const token = makeId("selection");
    const ids = filteredAppointments(filters).map((item) => item.id);
    const expiresAt = now + 10 * 60_000;
    mockStore.appointmentSelections.set(token, { ids, expiresAt });
    return { token, totalCount: ids.length, expiresAt: new Date(expiresAt).toISOString() };
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
    mockStore.appointments.push(created);
    return structuredClone(result);
  },
  async updateAppointment(id, input) {
    const index = mockStore.appointments.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("预约不存在或已被删除");
    const updated = toAppointment(input, mockStore.appointments[index]);
    const result = { appointment: updated, conflicts: findConflicts(updated) };
    mockStore.appointments[index] = updated;
    return structuredClone(result);
  },
  async duplicateAppointment(id, serviceDate) {
    const source = getAppointmentOrThrow(id);
    const startTime = civilTime(source.startsAt);
    const endTime = civilTime(source.endsAt);
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
            kind: "snapshot",
            source: source.account.source,
            characterName: source.account.characterName,
            details: {
              accountName: source.account.accountName,
              server: source.account.server,
              specialization: source.account.specialization,
              gearScore: source.account.gearScore,
            },
            credential: source.account.password
              ? { kind: "copyFromAppointment", sourceAppointmentId: source.id }
              : { kind: "none" },
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
    const sorted = mockStore.appointments
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
        startTime: civilTime(item.startsAt),
        endTime: civilTime(item.endsAt),
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
    const appointment = getAppointmentOrThrow(id);
    const password = appointment.account?.password;
    if (!password) throw new Error("该预约没有可复制的账号密码");
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
  async deleteAppointments(selection) {
    let ids: string[];
    let token: string | null = null;
    if (selection.kind === "explicit") {
      ids = [...new Set(selection.ids.map((id) => id.trim()).filter(Boolean))];
    } else {
      const snapshot = mockStore.appointmentSelections.get(selection.token);
      if (!snapshot || snapshot.expiresAt <= Date.now()) {
        mockStore.appointmentSelections.delete(selection.token);
        throw new Error("全选结果已过期，请重新选择");
      }
      token = selection.token;
      const excluded = new Set(selection.excludedIds);
      ids = snapshot.ids.filter((id) => !excluded.has(id));
    }
    const matchedCount = ids.length;
    const deletedCount = deleteAppointmentsByIds(ids);
    if (token) mockStore.appointmentSelections.delete(token);
    return { matchedCount, deletedCount };
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
    if (!isSafeAmountMinor(amountMinor)) throw new Error("结算金额必须是安全范围内的非负整数分");
    item.amountMinor = amountMinor;
    item.paymentMethod = paymentMethod ?? item.paymentMethod;
    item.settlementStatus = "settled";
    item.updatedAt = new Date().toISOString();
    return structuredClone(item);
  },

  async listAccountProfiles(query, needsReview) {
    const normalized = query?.trim().toLocaleLowerCase();
    return structuredClone(
      mockStore.accounts
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
    const timestamp = new Date().toISOString();
    const credential = input.credential;
    if (!credential || credential.kind !== "replace" || !credential.password) {
      throw new Error("新建账号必须填写密码");
    }
    const currentScore = validatedAccountScore(input.currentScore, "当前分");
    const highestScore = validatedAccountScore(input.highestScore, "最高分");
    const profile: AccountProfile = {
      id: makeId("account"),
      contactName: input.contactName?.trim() || null,
      server: input.server?.trim() || null,
      characterName: input.characterName?.trim() || null,
      specialization: input.specialization?.trim() || null,
      gearScore: input.gearScore?.trim() || null,
      accountName: input.accountName.trim(),
      password: credential.password,
      currentScore,
      highestScore,
      scoreUpdatedAt: input.scoreUpdatedAt ?? null,
      weeklyWins: null,
      notes: input.notes?.trim() || null,
      needsReview: input.needsReview ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    mockStore.accounts.push(profile);
    return structuredClone(profile);
  },
  async updateAccountProfile(id, input) {
    const existing = getAccountOrThrow(id);
    const credential = input.credential;
    if (!credential) throw new Error("账号密码操作无效");
    let password = existing.password;
    if (credential.kind === "replace") {
      if (!credential.password) throw new Error("新密码不能为空");
      password = credential.password;
    } else if (credential.kind === "remove") {
      password = null;
    } else if (credential.kind !== "keep") {
      throw new Error("账号密码操作无效");
    }
    const currentScore = validatedAccountScore(input.currentScore, "当前分");
    const highestScore = validatedAccountScore(input.highestScore, "最高分");
    Object.assign(existing, {
      contactName: input.contactName?.trim() || null,
      server: input.server?.trim() || null,
      characterName: input.characterName?.trim() || null,
      specialization: input.specialization?.trim() || null,
      gearScore: input.gearScore?.trim() || null,
      accountName: input.accountName.trim(),
      password,
      currentScore,
      highestScore,
      scoreUpdatedAt: input.scoreUpdatedAt ?? null,
      notes: input.notes?.trim() || null,
      needsReview: input.needsReview ?? false,
      updatedAt: new Date().toISOString(),
    });
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
      normalized.length !== mockStore.accounts.length ||
      normalized.some((id) => !mockStore.accounts.some((account) => account.id === id))
    ) {
      throw new Error("账号排序必须包含当前全部账号档案");
    }
    const byId = new Map(mockStore.accounts.map((account) => [account.id, account]));
    mockStore.accounts = normalized.map((id) => byId.get(id)!);
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
  async refreshAccountProfileRoleData(ids, onProgress) {
    if (mockStore.accountRoleDataRefreshBusy) throw new Error("已有角色数据更新任务正在进行");
    const validationError = validateAccountRoleDataServerUrl(
      mockStore.settings.accountRoleDataServerUrl,
    );
    if (validationError) throw new Error(validationError);
    if (!mockStore.settings.accountRoleDataApiKey.trim()) {
      throw new Error("请先配置角色数据 API 密钥");
    }
    mockStore.accountRoleDataRefreshBusy = true;
    try {
      return structuredClone(refreshMockAccountRoleData(ids, onProgress));
    } finally {
      mockStore.accountRoleDataRefreshBusy = false;
    }
  },

  async appAccessStatus() {
    return structuredClone(mockStore.appAccess);
  },
  async initializeAppAccess(password, recovery) {
    if (!isMasterPasswordLongEnough(password)) {
      throw new Error(`入口密码至少需要${MIN_MASTER_PASSWORD_CHARACTERS}个字符`);
    }
    if (!recovery.question.trim() || recovery.answer.trim().length < 2) {
      throw new Error("请完整填写恢复问题和答案");
    }
    mockStore.appAccessPassword = password;
    mockStore.appAccessRecoveryAnswer = normalizeRecoveryAnswer(recovery.answer);
    mockStore.appAccess = {
      ...mockStore.appAccess,
      initialized: true,
      unlocked: true,
      recoveryQuestion: recovery.question.trim(),
    };
    return structuredClone(mockStore.appAccess);
  },
  async unlockAppAccess(password) {
    if (!password) throw new Error("入口密码不能为空");
    if (mockStore.appAccessPassword !== null && password !== mockStore.appAccessPassword) {
      throw new Error("入口密码错误");
    }
    mockStore.appAccessPassword ??= password;
    mockStore.appAccess = { ...mockStore.appAccess, unlocked: true };
    return structuredClone(mockStore.appAccess);
  },
  async changeAppAccessPassword(currentPassword, newPassword) {
    if (!mockStore.appAccess.unlocked) throw new Error("应用尚未解锁");
    if (!currentPassword) throw new Error("入口密码不能为空");
    if (!isMasterPasswordLongEnough(newPassword)) {
      throw new Error(`入口密码至少需要${MIN_MASTER_PASSWORD_CHARACTERS}个字符`);
    }
    if (newPassword === currentPassword) throw new Error("新入口密码不能与当前密码相同");
    if (mockStore.appAccessPassword !== null && currentPassword !== mockStore.appAccessPassword) {
      throw new Error("当前入口密码不正确");
    }
    mockStore.appAccessPassword = newPassword;
    return structuredClone(mockStore.appAccess);
  },
  async resetAppAccessPassword(
    newPassword,
    confirmationText,
    recoveryProof: AppAccessRecoveryProof,
  ) {
    if (confirmationText !== "重置") throw new Error("请输入“重置”确认操作");
    if (!isMasterPasswordLongEnough(newPassword)) {
      throw new Error(`入口密码至少需要${MIN_MASTER_PASSWORD_CHARACTERS}个字符`);
    }
    if (mockStore.appAccess.recoveryQuestion) {
      if (
        recoveryProof.kind !== "answer" ||
        normalizeRecoveryAnswer(recoveryProof.answer) !== mockStore.appAccessRecoveryAnswer
      ) {
        throw new Error("恢复答案错误");
      }
    } else {
      if (recoveryProof.kind !== "legacyEnrollment") {
        throw new Error("旧用户需要先设置恢复问题");
      }
      mockStore.appAccessRecoveryAnswer = normalizeRecoveryAnswer(recoveryProof.recovery.answer);
      mockStore.appAccess = {
        ...mockStore.appAccess,
        recoveryQuestion: recoveryProof.recovery.question.trim(),
      };
    }
    mockStore.appAccessPassword = newPassword;
    mockStore.appAccess = { ...mockStore.appAccess, initialized: true, unlocked: true };
    return structuredClone(mockStore.appAccess);
  },
  async lockAppAccess() {
    mockStore.appAccess = { ...mockStore.appAccess, unlocked: false };
    mockStore.excelPreviewToken = null;
    mockStore.excelPreviewTokenExpiresAt = null;
    return structuredClone(mockStore.appAccess);
  },
  async setAppAccessRecovery(currentPassword, recovery) {
    if (!mockStore.appAccess.unlocked) throw new Error("应用尚未解锁");
    if (mockStore.appAccessPassword !== currentPassword) {
      throw new Error("当前入口密码不正确");
    }
    mockStore.appAccessRecoveryAnswer = normalizeRecoveryAnswer(recovery.answer);
    mockStore.appAccess = { ...mockStore.appAccess, recoveryQuestion: recovery.question.trim() };
    return structuredClone(mockStore.appAccess);
  },
  async migrateLegacyCredentials(password, recovery) {
    if (!password) throw new Error("原主密码不能为空");
    const pendingCount = mockStore.appAccess.legacyMigrationPendingCount;
    if (pendingCount === 0) {
      return { migratedCount: 0, missingCount: 0, pendingCount: 0 };
    }
    if (mockStore.appAccess.initialized && !mockStore.appAccess.unlocked) {
      throw new Error("应用已锁定，请先输入入口密码");
    }
    if (!mockStore.appAccess.initialized) {
      if (!recovery) throw new Error("首次迁移入口密码时必须设置恢复问题");
      const question = recovery.question.trim();
      const answer = normalizeRecoveryAnswer(recovery.answer);
      if (
        question.length < 2 ||
        question.length > 100 ||
        answer.length < 2 ||
        answer.length > 100
      ) {
        throw new Error("请完整填写2到100个字符的恢复问题和答案");
      }
      mockStore.appAccessPassword = password;
      mockStore.appAccessRecoveryAnswer = normalizeRecoveryAnswer(recovery.answer);
      mockStore.appAccess = {
        ...mockStore.appAccess,
        initialized: true,
        unlocked: true,
        recoveryQuestion: question,
      };
    }
    mockStore.appAccess = { ...mockStore.appAccess, legacyMigrationPendingCount: 0 };
    return { migratedCount: pendingCount, missingCount: 0, pendingCount: 0 };
  },
  async copyAccountPassword(id) {
    const password = getPasswordOrThrow(id);
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(password);
      scheduleClipboardClear(password);
    }
  },

  async getDashboardSummary(date) {
    const weekFrom = startOfChinaWeek(date);
    const weekTo = endOfChinaWeek(date);
    const settled = (items: Appointment[]) =>
      items
        .filter((item) => item.serviceStatus !== "cancelled" && item.settlementStatus === "settled")
        .reduce(
          (sum, item) =>
            checkedSafeIntegerAdd(sum, item.amountMinor ?? 0, "报表金额合计超出安全整数范围"),
          0,
        );
    const now = new Date();
    const applyTimeCutoff = date === chinaDateKey(now);
    const nowCivil = chinaCivilNowValue(now);
    const upcoming = mockStore.appointments
      .filter((item) => item.serviceDate >= date)
      .filter((item) => item.serviceStatus === "scheduled" || item.serviceStatus === "in_progress")
      .filter(
        (item) =>
          item.serviceStatus === "in_progress" ||
          !applyTimeCutoff ||
          item.serviceDate > date ||
          !item.startsAt ||
          civilDateTimeValue(item.startsAt) >= nowCivil,
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
      todaySettledMinor: settled(
        mockStore.appointments.filter((item) => item.serviceDate === date),
      ),
      weekSettledMinor: settled(
        mockStore.appointments.filter(
          (item) => item.serviceDate >= weekFrom && item.serviceDate <= weekTo,
        ),
      ),
      pendingCount: mockStore.appointments.filter(
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
    const reportable = mockStore.appointments.filter(
      (item) => item.mode === "business" && item.serviceStatus !== "cancelled",
    );
    const today = chinaDateKey();
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
    const paymentMap = new Map<string, { amountMinor: number; appointmentCount: number }>();
    const contactMap = new Map<string, { amountMinor: number; appointmentCount: number }>();
    for (const item of scoped) {
      const key = periodFor(item.serviceDate, granularity);
      const point = pointsMap.get(key) ?? createPoint(key);
      point.appointmentCount += 1;
      point.businessHours += appointmentHours(item);
      if (item.settlementStatus === "settled") {
        const amountMinor = item.amountMinor ?? 0;
        point.settledMinor = checkedSafeIntegerAdd(
          point.settledMinor,
          amountMinor,
          "报表金额合计超出安全整数范围",
        );
        const method = item.paymentMethod?.trim() || "未填写";
        const payment = paymentMap.get(method) ?? { amountMinor: 0, appointmentCount: 0 };
        payment.amountMinor = checkedSafeIntegerAdd(
          payment.amountMinor,
          amountMinor,
          "报表金额合计超出安全整数范围",
        );
        payment.appointmentCount += 1;
        paymentMap.set(method, payment);
        const contactName = revenueContactName(item.contactName);
        const contact = contactMap.get(contactName) ?? {
          amountMinor: 0,
          appointmentCount: 0,
        };
        contact.amountMinor = checkedSafeIntegerAdd(
          contact.amountMinor,
          amountMinor,
          "报表金额合计超出安全整数范围",
        );
        contact.appointmentCount += 1;
        contactMap.set(contactName, contact);
      } else if (item.settlementStatus === "unsettled") {
        point.unsettledMinor = checkedSafeIntegerAdd(
          point.unsettledMinor,
          item.amountMinor ?? 0,
          "报表金额合计超出安全整数范围",
        );
        if (item.serviceStatus === "completed") point.pendingCount += 1;
      }
      pointsMap.set(key, point);
    }
    const points = [...pointsMap.values()].sort((a, b) => a.period.localeCompare(b.period));
    const settledMinor = points.reduce(
      (sum, point) =>
        checkedSafeIntegerAdd(sum, point.settledMinor, "报表金额合计超出安全整数范围"),
      0,
    );
    const unsettledMinor = points.reduce(
      (sum, point) =>
        checkedSafeIntegerAdd(sum, point.unsettledMinor, "报表金额合计超出安全整数范围"),
      0,
    );
    const pendingCount = points.reduce((sum, point) => sum + point.pendingCount, 0);
    const businessHours = points.reduce((sum, point) => sum + point.businessHours, 0);
    return {
      from: resolvedFrom,
      to: resolvedTo,
      settledMinor,
      unsettledMinor,
      pendingCount,
      businessHours,
      averageHourlyMinor:
        businessHours > 0
          ? checkedSafeIntegerAdd(
              0,
              Math.round(settledMinor / businessHours),
              "报表平均时薪超出安全整数范围",
            )
          : 0,
      appointmentCount: scoped.length,
      completedCount: scoped.filter((item) => item.serviceStatus === "completed").length,
      paymentMethods: [...paymentMap.entries()]
        .map(([name, value]) => ({ name, ...value }))
        .sort(
          (a, b) =>
            b.amountMinor - a.amountMinor || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
        ),
      contacts: [...contactMap.entries()]
        .map(([name, value]) => ({ name, ...value }))
        .sort(
          (a, b) =>
            b.amountMinor - a.amountMinor || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
        ),
      points,
    };
  },
  ...createMockSettingsApi(mockStore),
  ...createMockImportBackupApi(mockStore, makeId),
};
