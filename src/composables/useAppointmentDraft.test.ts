import { nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { Appointment, AppointmentInput, ContactPreset } from "../types/domain";
import { useAppointmentDraft } from "./useAppointmentDraft";

function setup(options?: {
  appointment?: Appointment | null;
  requestedStartTime?: string | null;
  onSave?: (input: AppointmentInput) => void;
}) {
  const open = ref(true);
  const appointment = ref(options?.appointment ?? null);
  const requestedDate = ref("2026-08-20");
  const requestedStartTime = ref(options?.requestedStartTime ?? null);
  const defaultReminderMinutes = ref(45);
  const saving = ref(false);
  const result = useAppointmentDraft({
    open,
    appointment,
    requestedDate,
    requestedStartTime,
    defaultReminderMinutes,
    saving,
    onSave: options?.onSave ?? vi.fn(),
  });
  return { ...result, open };
}

function preset(): ContactPreset {
  return {
    sourceAppointmentId: "source-appointment",
    contactName: "南枝",
    startTime: "19:30",
    endTime: "22:00",
    content: "赛季冲分",
    mode: "business",
    account: {
      accountName: "nanzhi_0217",
      specialization: "无方",
      gearScore: "19.8万",
      server: "梦江南",
      password: "demo-secret",
    },
    rateNote: "180元/小时",
    paymentMethod: "微信",
    amountMinor: 36_000,
    reminderMinutes: 20,
    voicePlatform: "yy",
    voiceChannel: "123456",
    notes: "历史模板",
  };
}

describe("useAppointmentDraft", () => {
  it("defaults a blank appointment to profile selection and YY voice", () => {
    const { draft } = setup();

    expect(draft.account).toMatchObject({ kind: "profile", profileId: "" });
    expect(draft.voicePlatform).toBe("yy");
    expect(draft.voiceChannel).toBe("");
  });

  it("keeps the configured reminder value but disables reminders for a blank appointment", () => {
    const { draft } = setup();

    expect(draft.reminderEnabled).toBe(false);
    expect(draft.reminderMinutes).toBe(45);
  });

  it("applies an explicitly selected contact preset without changing the requested date", () => {
    const { draft, applyContactPreset } = setup();

    applyContactPreset(preset());

    expect(draft).toMatchObject({
      serviceDate: "2026-08-20",
      startTime: "19:30",
      endTime: "22:00",
      contactName: "南枝",
      content: "赛季冲分",
      serviceStatus: "scheduled",
      settlementStatus: "unsettled",
      reminderEnabled: true,
      reminderMinutes: 20,
      voicePlatform: "yy",
      voiceChannel: "123456",
    });
    expect(draft.account).toMatchObject({
      kind: "embedded",
      credentialKind: "copyFromAppointment",
      sourceAppointmentId: "source-appointment",
      password: "",
    });
  });

  it("preserves a calendar-provided time when applying a contact preset", () => {
    const { draft, applyContactPreset } = setup({ requestedStartTime: "16:00" });

    applyContactPreset(preset());

    expect(draft.startTime).toBe("16:00");
    expect(draft.endTime).toBe("");
  });

  it("requires a password for a newly entered one-time account", () => {
    const onSave = vi.fn();
    const { draft, errors, submit } = setup({ onSave });
    draft.contactName = "临时联系人";
    draft.account = {
      kind: "embedded",
      profileId: "",
      details: { accountName: "one-off", specialization: null, gearScore: null, server: null },
      credentialKind: "replace",
      password: "",
      sourceAppointmentId: "",
      hasPassword: false,
    };

    submit();

    expect(errors.value).toContain("临时账号必须填写密码");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps an imported appointment without a password editable without inventing a secret", () => {
    const onSave = vi.fn();
    const appointment: Appointment = {
      id: "imported-without-password",
      serviceDate: "2026-08-20",
      startsAt: null,
      endsAt: null,
      contactName: "旧联系人",
      content: "待补密码记录",
      mode: "business",
      serviceStatus: "scheduled",
      settlementStatus: "unsettled",
      account: {
        accountName: "legacy-account",
        specialization: null,
        gearScore: null,
        server: null,
        password: null,
      },
      amountMinor: null,
      reminderMinutes: null,
      voicePlatform: null,
      voiceChannel: null,
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    };
    const { draft, submit } = setup({ appointment, onSave });

    expect(draft.voicePlatform).toBe("");
    expect(draft.account).toMatchObject({
      kind: "embedded",
      credentialKind: "keep",
      hasPassword: false,
    });
    submit();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({ credential: { kind: "keep" } }),
      }),
    );
  });

  it("emits the temporary password only in the mutation credential and clears it on close", async () => {
    const onSave = vi.fn();
    const { draft, open, submit } = setup({ onSave });
    draft.contactName = "临时联系人";
    draft.account = {
      kind: "embedded",
      profileId: "",
      details: { accountName: "one-off", specialization: "冰心", gearScore: null, server: null },
      credentialKind: "replace",
      password: "one-time-secret",
      sourceAppointmentId: "",
      hasPassword: false,
    };

    submit();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({
          credential: { kind: "replace", password: "one-time-secret" },
        }),
      }),
    );

    open.value = false;
    await nextTick();
    expect(draft.account.password).toBe("");
  });
});
