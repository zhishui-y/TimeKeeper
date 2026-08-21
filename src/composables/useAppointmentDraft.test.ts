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
    serviceDate: "2026-08-01",
    contactName: "南枝",
    startTime: "19:30",
    endTime: "22:00",
    content: "赛季冲分",
    mode: "business",
    account: {
      source: "profile",
      characterName: "南枝角色",
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

  it("keeps mode, unified status and billing fields when applying a preset while editing", () => {
    const appointment: Appointment = {
      id: "editing-preset",
      serviceDate: "2026-08-20",
      contactName: "原联系人",
      mode: "business",
      serviceStatus: "completed",
      settlementStatus: "settled",
      amountMinor: 12_345,
      paymentMethod: "支付宝",
      rateNote: "保留费率",
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    };
    const { draft, applyContactPreset } = setup({ appointment });

    applyContactPreset({ ...preset(), mode: "entertainment", amountMinor: null });

    expect(draft).toMatchObject({
      contactName: "南枝",
      content: "赛季冲分",
      mode: "business",
      serviceStatus: "completed",
      settlementStatus: "settled",
      amountYuan: "123.45",
      paymentMethod: "支付宝",
      rateNote: "保留费率",
    });
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
      source: "embedded",
      characterName: null,
      preservesSnapshot: false,
    };

    submit();

    expect(errors.value).toContain("临时账号必须填写密码");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("continues to reject a negative business amount", () => {
    const onSave = vi.fn();
    const { draft, errors, submit } = setup({ onSave });
    draft.contactName = "负金额预约";
    draft.account = {
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
    draft.amountYuan = "-1";

    submit();

    expect(errors.value).toContain("账单金额最多保留两位小数");
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
        source: "embedded",
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
      source: "embedded",
      characterName: null,
      preservesSnapshot: true,
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
      source: "embedded",
      characterName: null,
      preservesSnapshot: false,
    };

    submit();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({
          kind: "embedded",
          credential: { kind: "replace", password: "one-time-secret" },
        }),
      }),
    );

    open.value = false;
    await nextTick();
    expect(draft.account.password).toBe("");
  });

  it("preserves a profile snapshot and converts its kept password when copied", () => {
    const onSave = vi.fn();
    const appointment: Appointment = {
      id: "profile-snapshot",
      serviceDate: "2026-08-20",
      contactName: "档案联系人",
      mode: "business",
      serviceStatus: "in_progress",
      settlementStatus: "unsettled",
      account: {
        source: "profile",
        characterName: "清心",
        accountName: "profile-login",
        server: "梦江南",
        specialization: "冰心",
        gearScore: "19.8万",
        password: "secret",
      },
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    };
    const { draft, submit, duplicateAsToday } = setup({ appointment, onSave });

    submit();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({
          kind: "snapshot",
          source: "profile",
          characterName: "清心",
          credential: { kind: "keep" },
        }),
      }),
    );

    draft.content = "未保存修改";
    expect(duplicateAsToday("2026-08-04", appointment.id).input).toEqual(
      expect.objectContaining({
        content: "未保存修改",
        serviceStatus: "scheduled",
        settlementStatus: "unsettled",
        account: expect.objectContaining({
          source: "profile",
          characterName: "清心",
          credential: { kind: "copyFromAppointment", sourceAppointmentId: appointment.id },
        }),
      }),
    );
  });
});
