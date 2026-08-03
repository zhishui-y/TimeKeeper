import { format, parseISO } from "date-fns";
import { computed, reactive, readonly, shallowRef, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import type {
  Appointment,
  AppointmentAccountDetails,
  AppointmentInput,
  AppointmentMode,
  AppointmentProgressStatus,
  ContactPreset,
  ServiceStatus,
  SettlementStatus,
  VoicePlatform,
} from "../types/domain";
import {
  appointmentProgressStatus,
  appointmentStatusesFromProgress,
} from "../utils/appointmentProgress";

export type AppointmentAccountDraftKind = "none" | "profile" | "embedded";
export type AppointmentCredentialDraftKind = "keep" | "replace" | "copyFromAppointment";

export interface AppointmentAccountDraft {
  kind: AppointmentAccountDraftKind;
  profileId: string;
  details: AppointmentAccountDetails;
  credentialKind: AppointmentCredentialDraftKind;
  password: string;
  sourceAppointmentId: string;
  hasPassword: boolean;
}

export interface AppointmentDraft {
  serviceDate: string;
  startTime: string;
  endTime: string;
  contactName: string;
  content: string;
  mode: AppointmentMode;
  serviceStatus: ServiceStatus;
  settlementStatus: SettlementStatus;
  account: AppointmentAccountDraft;
  rateNote: string;
  paymentMethod: string;
  amountYuan: string;
  reminderEnabled: boolean;
  reminderMinutes: number;
  voicePlatform: VoicePlatform | "";
  voiceChannel: string;
  notes: string;
}

interface UseAppointmentDraftOptions {
  open: MaybeRefOrGetter<boolean>;
  appointment: MaybeRefOrGetter<Appointment | null>;
  requestedDate: MaybeRefOrGetter<string>;
  requestedStartTime: MaybeRefOrGetter<string | null>;
  defaultReminderMinutes: MaybeRefOrGetter<number>;
  saving: MaybeRefOrGetter<boolean>;
  onSave(input: AppointmentInput): void;
}

function emptyAccountDraft(): AppointmentAccountDraft {
  return {
    kind: "none",
    profileId: "",
    details: { accountName: "", specialization: null, gearScore: null, server: null },
    credentialKind: "replace",
    password: "",
    sourceAppointmentId: "",
    hasPassword: false,
  };
}

function profileAccountDraft(): AppointmentAccountDraft {
  return {
    ...emptyAccountDraft(),
    kind: "profile",
  };
}

function embeddedAccountDraft(
  details: AppointmentAccountDetails,
  options: {
    hasPassword: boolean;
    sourceAppointmentId?: string;
    editing?: boolean;
  },
): AppointmentAccountDraft {
  const canKeep = Boolean(options.editing);
  const canCopy = Boolean(options.sourceAppointmentId && options.hasPassword);
  return {
    kind: "embedded",
    profileId: "",
    details: {
      accountName: details.accountName,
      specialization: details.specialization ?? null,
      gearScore: details.gearScore ?? null,
      server: details.server ?? null,
    },
    credentialKind: canKeep ? "keep" : canCopy ? "copyFromAppointment" : "replace",
    password: "",
    sourceAppointmentId: canCopy ? options.sourceAppointmentId! : "",
    hasPassword: options.hasPassword,
  };
}

function timeOf(value?: string | null): string {
  return value ? format(parseISO(value), "HH:mm") : "";
}

export function useAppointmentDraft(options: UseAppointmentDraftOptions) {
  const draft = reactive<AppointmentDraft>({
    serviceDate: "",
    startTime: "",
    endTime: "",
    contactName: "",
    content: "",
    mode: "business",
    serviceStatus: "scheduled",
    settlementStatus: "unsettled",
    account: profileAccountDraft(),
    rateNote: "",
    paymentMethod: "",
    amountYuan: "",
    reminderEnabled: false,
    reminderMinutes: 30,
    voicePlatform: "yy",
    voiceChannel: "",
    notes: "",
  });
  const errors = shallowRef<string[]>([]);
  const timeModified = shallowRef(false);
  const initialTimeIsFixed = computed(() =>
    Boolean(toValue(options.appointment) || toValue(options.requestedStartTime)),
  );
  const progressStatus = computed<AppointmentProgressStatus>({
    get: () => appointmentProgressStatus(draft),
    set: (value) => {
      Object.assign(
        draft,
        appointmentStatusesFromProgress(draft.mode, value, draft.settlementStatus),
      );
    },
  });

  function clearSecrets(): void {
    draft.account.password = "";
  }

  function reset(): void {
    const appointment = toValue(options.appointment);
    Object.assign(draft, {
      serviceDate: appointment?.serviceDate ?? toValue(options.requestedDate),
      startTime: appointment
        ? timeOf(appointment.startsAt)
        : (toValue(options.requestedStartTime) ?? ""),
      endTime: appointment ? timeOf(appointment.endsAt) : "",
      contactName: appointment?.contactName ?? "",
      content: appointment?.content ?? "",
      mode: appointment?.mode ?? "business",
      serviceStatus: appointment?.serviceStatus ?? "scheduled",
      settlementStatus: appointment?.settlementStatus ?? "unsettled",
      account: appointment
        ? appointment.account
          ? embeddedAccountDraft(appointment.account, {
              hasPassword: Boolean(appointment.account.password),
              editing: true,
            })
          : emptyAccountDraft()
        : profileAccountDraft(),
      rateNote: appointment?.rateNote ?? "",
      paymentMethod: appointment?.paymentMethod ?? "",
      amountYuan:
        appointment?.amountMinor === null || appointment?.amountMinor === undefined
          ? ""
          : String(appointment.amountMinor / 100),
      reminderEnabled: appointment ? appointment.reminderMinutes !== null : false,
      reminderMinutes: appointment?.reminderMinutes ?? toValue(options.defaultReminderMinutes),
      voicePlatform: appointment ? (appointment.voicePlatform ?? "") : "yy",
      voiceChannel: appointment?.voicePlatform === "yy" ? (appointment.voiceChannel ?? "") : "",
      notes: appointment?.notes ?? "",
    });
    timeModified.value = false;
    errors.value = [];
  }

  function selectMode(mode: AppointmentMode): void {
    const previousMode = draft.mode;
    const previousProgressStatus = progressStatus.value;
    draft.mode = mode;
    if (mode === "entertainment") {
      Object.assign(
        draft,
        appointmentStatusesFromProgress(
          mode,
          previousProgressStatus === "pending_settlement" ? "completed" : previousProgressStatus,
          draft.settlementStatus,
        ),
      );
      draft.rateNote = "";
      draft.paymentMethod = "";
      draft.amountYuan = "";
    } else {
      Object.assign(
        draft,
        appointmentStatusesFromProgress(
          mode,
          previousMode === "entertainment" && previousProgressStatus === "completed"
            ? "pending_settlement"
            : previousProgressStatus,
          draft.settlementStatus,
        ),
      );
    }
  }

  function markTimeModified(): void {
    timeModified.value = true;
  }

  function setCurrentTime(field: "startTime" | "endTime"): void {
    draft[field] = format(new Date(), "HH:mm");
    markTimeModified();
  }

  function clearEndTime(): void {
    draft.endTime = "";
    markTimeModified();
  }

  function applyContactPreset(preset: ContactPreset): void {
    const preserveTime = initialTimeIsFixed.value || timeModified.value;
    Object.assign(draft, {
      contactName: preset.contactName,
      content: preset.content ?? "",
      mode: preset.mode,
      serviceStatus: "scheduled",
      settlementStatus: preset.mode === "business" ? "unsettled" : "not_applicable",
      account: preset.account
        ? embeddedAccountDraft(preset.account, {
            hasPassword: Boolean(preset.account.password),
            sourceAppointmentId: preset.sourceAppointmentId,
          })
        : emptyAccountDraft(),
      rateNote: preset.mode === "business" ? (preset.rateNote ?? "") : "",
      paymentMethod: preset.mode === "business" ? (preset.paymentMethod ?? "") : "",
      amountYuan:
        preset.mode === "business" &&
        preset.amountMinor !== null &&
        preset.amountMinor !== undefined
          ? String(preset.amountMinor / 100)
          : "",
      reminderEnabled: preset.reminderMinutes !== null && preset.reminderMinutes !== undefined,
      reminderMinutes: preset.reminderMinutes ?? toValue(options.defaultReminderMinutes),
      voicePlatform: preset.voicePlatform ?? "",
      voiceChannel: preset.voicePlatform === "yy" ? (preset.voiceChannel ?? "") : "",
      notes: preset.notes ?? "",
    });
    if (!preserveTime) {
      draft.startTime = preset.startTime ?? "";
      draft.endTime = preset.endTime ?? "";
    }
    errors.value = [];
  }

  function submit(): void {
    if (toValue(options.saving)) return;
    const nextErrors: string[] = [];
    if (!draft.serviceDate) nextErrors.push("请选择预约日期");
    if (!draft.contactName.trim()) nextErrors.push("请填写联系人");
    if (draft.endTime && !draft.startTime) nextErrors.push("填写结束时间前，需要先填写开始时间");
    if (draft.startTime && draft.endTime && draft.startTime === draft.endTime) {
      nextErrors.push("开始时间和结束时间不能相同");
    }
    const amount = draft.amountYuan ? Number(draft.amountYuan) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      nextErrors.push("账单金额格式不正确");
    }
    if (draft.mode === "business" && draft.settlementStatus === "settled" && amount === null) {
      nextErrors.push("已完成预约必须填写金额");
    }
    if (
      draft.reminderEnabled &&
      (!Number.isInteger(draft.reminderMinutes) ||
        draft.reminderMinutes < 0 ||
        draft.reminderMinutes > 1440)
    ) {
      nextErrors.push("提醒时间必须是0到1440之间的整数");
    }
    if (draft.voicePlatform === "yy" && draft.voiceChannel && !/^\d+$/.test(draft.voiceChannel)) {
      nextErrors.push("YY频道号只能填写数字");
    }
    if (draft.account.kind === "profile" && !draft.account.profileId) {
      nextErrors.push("请选择账号档案");
    }
    if (draft.account.kind === "embedded") {
      if (!draft.account.details.accountName.trim()) nextErrors.push("临时账号必须填写账号");
      if (draft.account.credentialKind === "replace" && !draft.account.password) {
        nextErrors.push("临时账号必须填写密码");
      }
    }
    errors.value = nextErrors;
    if (nextErrors.length > 0) return;

    const account: AppointmentInput["account"] =
      draft.account.kind === "none"
        ? null
        : draft.account.kind === "profile"
          ? { kind: "profile", profileId: draft.account.profileId }
          : {
              kind: "embedded",
              details: {
                accountName: draft.account.details.accountName.trim(),
                specialization: draft.account.details.specialization?.trim() || null,
                gearScore: draft.account.details.gearScore?.trim() || null,
                server: draft.account.details.server?.trim() || null,
              },
              credential:
                draft.account.credentialKind === "keep"
                  ? { kind: "keep" }
                  : draft.account.credentialKind === "copyFromAppointment"
                    ? {
                        kind: "copyFromAppointment",
                        sourceAppointmentId: draft.account.sourceAppointmentId,
                      }
                    : { kind: "replace", password: draft.account.password },
            };
    const statuses = appointmentStatusesFromProgress(
      draft.mode,
      progressStatus.value,
      draft.settlementStatus,
    );

    options.onSave({
      serviceDate: draft.serviceDate,
      startTime: draft.startTime || null,
      endTime: draft.endTime || null,
      contactName: draft.contactName.trim(),
      content: draft.content.trim() || null,
      mode: draft.mode,
      serviceStatus: statuses.serviceStatus,
      settlementStatus: statuses.settlementStatus,
      account,
      rateNote: draft.mode === "business" ? draft.rateNote.trim() || null : null,
      paymentMethod: draft.mode === "business" ? draft.paymentMethod.trim() || null : null,
      amountMinor: draft.mode === "business" && amount !== null ? Math.round(amount * 100) : null,
      reminderMinutes: draft.reminderEnabled ? Number(draft.reminderMinutes) : null,
      voicePlatform: draft.voicePlatform || null,
      voiceChannel: draft.voicePlatform === "yy" ? draft.voiceChannel.trim() || null : null,
      notes: draft.notes.trim() || null,
    });
  }

  watch(
    () =>
      [
        toValue(options.open),
        toValue(options.appointment),
        toValue(options.requestedDate),
        toValue(options.requestedStartTime),
      ] as const,
    ([open]) => {
      if (open) reset();
      else clearSecrets();
    },
    { immediate: true },
  );

  watch(
    () => draft.voicePlatform,
    (platform) => {
      if (platform !== "yy") draft.voiceChannel = "";
    },
  );

  return {
    draft,
    progressStatus,
    errors: readonly(errors),
    applyContactPreset,
    clearEndTime,
    clearSecrets,
    markTimeModified,
    reset,
    selectMode,
    setCurrentTime,
    submit,
  };
}
