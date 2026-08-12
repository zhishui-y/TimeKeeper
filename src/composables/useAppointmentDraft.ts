import { computed, reactive, readonly, shallowRef, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import type {
  Appointment,
  AppointmentAccountCredential,
  AppointmentAccountDetails,
  AppointmentAccountInput,
  AppointmentAccountSource,
  AppointmentDraftSeed,
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
import { chinaTime, civilTime } from "../utils/chinaDateTime";
import { amountMinorInputValue, parseAmountMinor } from "../utils/money";

export type AppointmentAccountDraftKind = "none" | "profile" | "embedded";
export type AppointmentCredentialDraftKind = "none" | "keep" | "replace" | "copyFromAppointment";

export interface AppointmentAccountDraft {
  kind: AppointmentAccountDraftKind;
  profileId: string;
  details: AppointmentAccountDetails;
  credentialKind: AppointmentCredentialDraftKind;
  password: string;
  sourceAppointmentId: string;
  hasPassword: boolean;
  source: AppointmentAccountSource;
  characterName: string | null;
  preservesSnapshot: boolean;
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
  seed?: MaybeRefOrGetter<AppointmentDraftSeed | null>;
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
    source: "embedded",
    characterName: null,
    preservesSnapshot: false,
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
    source?: AppointmentAccountSource;
    characterName?: string | null;
    preservesSnapshot?: boolean;
    credential?: AppointmentAccountCredential;
  },
): AppointmentAccountDraft {
  const canKeep = Boolean(options.editing);
  const canCopy = Boolean(options.sourceAppointmentId && options.hasPassword);
  const credential = options.credential;
  return {
    kind: "embedded",
    profileId: "",
    details: {
      accountName: details.accountName,
      specialization: details.specialization ?? null,
      gearScore: details.gearScore ?? null,
      server: details.server ?? null,
    },
    credentialKind:
      credential?.kind ?? (canKeep ? "keep" : canCopy ? "copyFromAppointment" : "replace"),
    password: credential?.kind === "replace" ? credential.password : "",
    sourceAppointmentId:
      credential?.kind === "copyFromAppointment"
        ? credential.sourceAppointmentId
        : canCopy
          ? options.sourceAppointmentId!
          : "",
    hasPassword: options.hasPassword,
    source: options.source ?? "embedded",
    characterName: options.characterName ?? null,
    preservesSnapshot: options.preservesSnapshot ?? false,
  };
}

function accountDraftFromInput(
  account: AppointmentAccountInput | null | undefined,
): AppointmentAccountDraft {
  if (!account) return emptyAccountDraft();
  if (account.kind === "profile") return { ...profileAccountDraft(), profileId: account.profileId };
  return embeddedAccountDraft(account.details, {
    hasPassword: account.credential.kind !== "none",
    source: account.kind === "snapshot" ? account.source : "embedded",
    characterName: account.kind === "snapshot" ? (account.characterName ?? null) : null,
    preservesSnapshot: account.kind === "snapshot",
    credential: account.credential,
  });
}

function timeOf(value?: string | null): string {
  return civilTime(value) ?? "";
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
    const seed = toValue(options.seed);
    const seedInput = appointment ? null : seed?.input;
    Object.assign(draft, {
      serviceDate:
        appointment?.serviceDate ?? seedInput?.serviceDate ?? toValue(options.requestedDate),
      startTime: appointment
        ? timeOf(appointment.startsAt)
        : (seedInput?.startTime ?? toValue(options.requestedStartTime) ?? ""),
      endTime: appointment ? timeOf(appointment.endsAt) : (seedInput?.endTime ?? ""),
      contactName: appointment?.contactName ?? seedInput?.contactName ?? "",
      content: appointment?.content ?? seedInput?.content ?? "",
      mode: appointment?.mode ?? seedInput?.mode ?? "business",
      serviceStatus: appointment?.serviceStatus ?? seedInput?.serviceStatus ?? "scheduled",
      settlementStatus: appointment?.settlementStatus ?? seedInput?.settlementStatus ?? "unsettled",
      account: appointment
        ? appointment.account
          ? embeddedAccountDraft(appointment.account, {
              hasPassword: Boolean(appointment.account.password),
              editing: true,
              source: appointment.account.source,
              characterName: appointment.account.characterName,
              preservesSnapshot: true,
            })
          : emptyAccountDraft()
        : seedInput
          ? accountDraftFromInput(seedInput.account)
          : profileAccountDraft(),
      rateNote: appointment?.rateNote ?? seedInput?.rateNote ?? "",
      paymentMethod: appointment?.paymentMethod ?? seedInput?.paymentMethod ?? "",
      amountYuan:
        (appointment?.amountMinor ?? seedInput?.amountMinor) === null ||
        (appointment?.amountMinor ?? seedInput?.amountMinor) === undefined
          ? ""
          : amountMinorInputValue((appointment?.amountMinor ?? seedInput?.amountMinor)!),
      reminderEnabled: appointment
        ? appointment.reminderMinutes !== null
        : seedInput
          ? seedInput.reminderMinutes !== null && seedInput.reminderMinutes !== undefined
          : false,
      reminderMinutes:
        appointment?.reminderMinutes ??
        seedInput?.reminderMinutes ??
        toValue(options.defaultReminderMinutes),
      voicePlatform: appointment
        ? (appointment.voicePlatform ?? "")
        : seedInput
          ? (seedInput.voicePlatform ?? "")
          : "yy",
      voiceChannel:
        (appointment?.voicePlatform ?? seedInput?.voicePlatform) === "yy"
          ? (appointment?.voiceChannel ?? seedInput?.voiceChannel ?? "")
          : "",
      notes: appointment?.notes ?? seedInput?.notes ?? "",
    });
    timeModified.value = false;
    errors.value = [];
  }

  function selectMode(mode: AppointmentMode): void {
    draft.mode = mode;
    if (mode === "entertainment") {
      draft.settlementStatus = "not_applicable";
      draft.rateNote = "";
      draft.paymentMethod = "";
      draft.amountYuan = "";
    } else if (draft.settlementStatus === "not_applicable") {
      draft.settlementStatus = "unsettled";
    }
  }

  function markTimeModified(): void {
    timeModified.value = true;
  }

  function setCurrentTime(field: "startTime" | "endTime"): void {
    draft[field] = chinaTime();
    markTimeModified();
  }

  function clearEndTime(): void {
    draft.endTime = "";
    markTimeModified();
  }

  function applyContactPreset(preset: ContactPreset): void {
    const preserveTime = initialTimeIsFixed.value || timeModified.value;
    const editing = Boolean(toValue(options.appointment));
    Object.assign(draft, {
      contactName: preset.contactName,
      content: preset.content ?? "",
      account: preset.account
        ? embeddedAccountDraft(preset.account, {
            hasPassword: Boolean(preset.account.password),
            sourceAppointmentId: preset.sourceAppointmentId,
            source: preset.account.source,
            characterName: preset.account.characterName,
            preservesSnapshot: true,
          })
        : emptyAccountDraft(),
      reminderEnabled: preset.reminderMinutes !== null && preset.reminderMinutes !== undefined,
      reminderMinutes: preset.reminderMinutes ?? toValue(options.defaultReminderMinutes),
      voicePlatform: preset.voicePlatform ?? "",
      voiceChannel: preset.voicePlatform === "yy" ? (preset.voiceChannel ?? "") : "",
      notes: preset.notes ?? "",
      ...(!editing
        ? {
            mode: preset.mode,
            serviceStatus: "scheduled" as const,
            settlementStatus:
              preset.mode === "business" ? ("unsettled" as const) : ("not_applicable" as const),
            rateNote: preset.mode === "business" ? (preset.rateNote ?? "") : "",
            paymentMethod: preset.mode === "business" ? (preset.paymentMethod ?? "") : "",
            amountYuan:
              preset.mode === "business" &&
              preset.amountMinor !== null &&
              preset.amountMinor !== undefined
                ? amountMinorInputValue(preset.amountMinor)
                : "",
          }
        : {}),
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
    let amountMinor: number | null = null;
    try {
      amountMinor = parseAmountMinor(draft.amountYuan);
    } catch (cause) {
      nextErrors.push(cause instanceof Error ? cause.message : "账单金额格式不正确");
    }
    if (draft.mode === "business" && draft.settlementStatus === "settled" && amountMinor === null) {
      nextErrors.push("已结算预约必须填写金额");
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

    const account = accountInputFromDraft(true);
    options.onSave(
      inputFromDraft(account, {
        serviceStatus: draft.serviceStatus,
        settlementStatus: draft.settlementStatus,
      }),
    );
  }

  function accountInputFromDraft(trimText: boolean): AppointmentInput["account"] {
    const text = (value: string) => (trimText ? value.trim() : value);
    if (draft.account.kind === "none") return null;
    if (draft.account.kind === "profile") {
      return { kind: "profile", profileId: draft.account.profileId };
    }
    const details = {
      accountName: text(draft.account.details.accountName),
      specialization: text(draft.account.details.specialization ?? "") || null,
      gearScore: text(draft.account.details.gearScore ?? "") || null,
      server: text(draft.account.details.server ?? "") || null,
    };
    const credential: AppointmentAccountCredential =
      draft.account.credentialKind === "none"
        ? { kind: "none" }
        : draft.account.credentialKind === "keep"
          ? { kind: "keep" }
          : draft.account.credentialKind === "copyFromAppointment"
            ? {
                kind: "copyFromAppointment",
                sourceAppointmentId: draft.account.sourceAppointmentId,
              }
            : { kind: "replace", password: draft.account.password };
    return draft.account.preservesSnapshot
      ? {
          kind: "snapshot",
          source: draft.account.source,
          characterName: draft.account.source === "profile" ? draft.account.characterName : null,
          details,
          credential,
        }
      : { kind: "embedded", details, credential };
  }

  function inputFromDraft(
    account: AppointmentInput["account"],
    statuses: Pick<AppointmentInput, "serviceStatus" | "settlementStatus">,
    trimText = true,
  ): AppointmentInput {
    const text = (value: string) => (trimText ? value.trim() : value);
    const amountMinor = draft.mode === "business" ? parseAmountMinor(draft.amountYuan) : null;
    return {
      serviceDate: draft.serviceDate,
      startTime: draft.startTime || null,
      endTime: draft.endTime || null,
      contactName: text(draft.contactName),
      content: text(draft.content) || null,
      mode: draft.mode,
      serviceStatus: statuses.serviceStatus,
      settlementStatus: statuses.settlementStatus,
      account,
      rateNote: draft.mode === "business" ? text(draft.rateNote) || null : null,
      paymentMethod: draft.mode === "business" ? text(draft.paymentMethod) || null : null,
      amountMinor,
      reminderMinutes: draft.reminderEnabled ? Number(draft.reminderMinutes) : null,
      voicePlatform: draft.voicePlatform || null,
      voiceChannel: draft.voicePlatform === "yy" ? text(draft.voiceChannel) || null : null,
      notes: text(draft.notes) || null,
    };
  }

  function duplicateAsToday(
    serviceDate: string,
    sourceAppointmentId: string,
  ): AppointmentDraftSeed {
    const account = accountInputFromDraft(false);
    let copiedAccount = account;
    if (account && account.kind !== "profile" && draft.account.credentialKind === "keep") {
      copiedAccount = {
        ...account,
        credential: draft.account.hasPassword
          ? { kind: "copyFromAppointment", sourceAppointmentId }
          : { kind: "none" },
      };
    }
    return {
      sourceAppointmentId,
      input: {
        ...inputFromDraft(
          copiedAccount,
          {
            serviceStatus: "scheduled",
            settlementStatus: draft.mode === "business" ? "unsettled" : "not_applicable",
          },
          false,
        ),
        serviceDate,
      },
    };
  }

  watch(
    () =>
      [
        toValue(options.open),
        toValue(options.appointment),
        toValue(options.seed),
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
    duplicateAsToday,
  };
}
