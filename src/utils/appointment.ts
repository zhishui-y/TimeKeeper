import type { Appointment, AppointmentDraftSeed, AppointmentInput } from "../types/domain";
import {
  addDateKeyDays,
  buildCivilDateTime,
  calendarDateKey,
  calendarTime,
  chinaCivilNowValue,
  chinaDateKey,
  civilDateTimeValue,
  civilTime,
} from "./chinaDateTime";

export const todayInChina = chinaDateKey;

function snapshotAccountInput(
  appointment: Appointment,
  credential: "keep" | "copy",
): AppointmentInput["account"] {
  const account = appointment.account;
  if (!account) return null;
  return {
    kind: "snapshot",
    source: account.source,
    characterName: account.characterName ?? null,
    details: {
      accountName: account.accountName,
      server: account.server,
      specialization: account.specialization,
      gearScore: account.gearScore,
    },
    credential:
      credential === "keep"
        ? { kind: "keep" }
        : account.password
          ? { kind: "copyFromAppointment", sourceAppointmentId: appointment.id }
          : { kind: "none" },
  };
}

export function appointmentToInput(appointment: Appointment): AppointmentInput {
  return {
    serviceDate: appointment.serviceDate,
    startTime: civilTime(appointment.startsAt),
    endTime: civilTime(appointment.endsAt),
    contactName: appointment.contactName,
    content: appointment.content,
    mode: appointment.mode,
    serviceStatus: appointment.serviceStatus,
    settlementStatus: appointment.settlementStatus,
    account: snapshotAccountInput(appointment, "keep"),
    rateNote: appointment.rateNote,
    paymentMethod: appointment.paymentMethod,
    amountMinor: appointment.amountMinor,
    reminderMinutes: appointment.reminderMinutes,
    voicePlatform: appointment.voicePlatform,
    voiceChannel: appointment.voiceChannel,
    notes: appointment.notes,
  };
}

export function duplicateAppointmentDraft(
  appointment: Appointment,
  serviceDate = todayInChina(),
): AppointmentDraftSeed {
  const input = appointmentToInput(appointment);
  return {
    sourceAppointmentId: appointment.id,
    input: {
      ...input,
      serviceDate,
      serviceStatus: "scheduled",
      settlementStatus: appointment.mode === "business" ? "unsettled" : "not_applicable",
      account: snapshotAccountInput(appointment, "copy"),
    },
  };
}

export function rescheduledInput(
  appointment: Appointment,
  startsAt: Date,
  endsAt: Date | null,
  allDay: boolean,
): AppointmentInput {
  const input = appointmentToInput(appointment);
  if (!appointment.startsAt || allDay) {
    return {
      ...input,
      serviceDate: calendarDateKey(startsAt),
      startTime: null,
      endTime: null,
    };
  }
  return {
    ...input,
    serviceDate: calendarDateKey(startsAt),
    startTime: calendarTime(startsAt),
    endTime: endsAt ? calendarTime(endsAt) : null,
  };
}

export function combineDateTime(
  serviceDate: string,
  startTime?: string | null,
  endTime?: string | null,
): { startsAt: string | null; endsAt: string | null } {
  if (!startTime) return { startsAt: null, endsAt: null };
  const startsAt = buildCivilDateTime(serviceDate, startTime);
  if (!startsAt) throw new Error("开始时间格式不正确");
  if (!endTime) return { startsAt, endsAt: null };
  if (endTime === startTime) {
    throw new Error("开始时间和结束时间不能相同");
  }
  const endDate = endTime < startTime ? addDateKeyDays(serviceDate, 1) : serviceDate;
  const endsAt = buildCivilDateTime(endDate, endTime);
  if (!endsAt) throw new Error("结束时间格式不正确");
  return { startsAt, endsAt };
}

export function sortAppointmentsByStartTime(appointments: readonly Appointment[]): Appointment[] {
  return appointments
    .map((appointment, index) => ({ appointment, index }))
    .sort((left, right) => {
      const leftTime = left.appointment.startsAt
        ? civilDateTimeValue(left.appointment.startsAt)
        : Number.POSITIVE_INFINITY;
      const rightTime = right.appointment.startsAt
        ? civilDateTimeValue(right.appointment.startsAt)
        : Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.index - right.index;
    })
    .map(({ appointment }) => appointment);
}

export function findNextScheduledAppointment(
  appointments: readonly Appointment[],
  now: Date,
): Appointment | null {
  const nowTime = chinaCivilNowValue(now);
  const sortedAppointments = sortAppointmentsByStartTime(appointments);
  const ongoingAppointment = sortedAppointments.find((appointment) => {
    if (appointment.serviceStatus !== "scheduled" && appointment.serviceStatus !== "in_progress") {
      return false;
    }
    if (typeof appointment.startsAt !== "string") return false;

    const startsAt = civilDateTimeValue(appointment.startsAt);
    if (startsAt > nowTime) return false;
    if (typeof appointment.endsAt === "string") {
      return civilDateTimeValue(appointment.endsAt) > nowTime;
    }
    return appointment.serviceStatus === "in_progress";
  });
  if (ongoingAppointment) {
    return ongoingAppointment.serviceStatus === "scheduled" ? ongoingAppointment : null;
  }

  return (
    sortedAppointments.find(
      (appointment) =>
        appointment.serviceStatus === "scheduled" &&
        typeof appointment.startsAt === "string" &&
        civilDateTimeValue(appointment.startsAt) > nowTime,
    ) ?? null
  );
}
