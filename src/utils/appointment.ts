import { addDays, format, parseISO } from "date-fns";
import type { Appointment, AppointmentInput } from "../types/domain";

export function appointmentToInput(appointment: Appointment): AppointmentInput {
  return {
    serviceDate: appointment.serviceDate,
    startTime: appointment.startsAt ? format(parseISO(appointment.startsAt), "HH:mm") : null,
    endTime: appointment.endsAt ? format(parseISO(appointment.endsAt), "HH:mm") : null,
    contactName: appointment.contactName,
    content: appointment.content,
    mode: appointment.mode,
    serviceStatus: appointment.serviceStatus,
    settlementStatus: appointment.settlementStatus,
    accountProfileId: appointment.accountProfileId,
    rateNote: appointment.rateNote,
    paymentMethod: appointment.paymentMethod,
    amountMinor: appointment.amountMinor,
    reminderMinutes: appointment.reminderMinutes,
    notes: appointment.notes,
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
      serviceDate: format(startsAt, "yyyy-MM-dd"),
      startTime: null,
      endTime: null,
    };
  }
  return {
    ...input,
    serviceDate: format(startsAt, "yyyy-MM-dd"),
    startTime: format(startsAt, "HH:mm"),
    endTime: endsAt ? format(endsAt, "HH:mm") : null,
  };
}

export function combineDateTime(
  serviceDate: string,
  startTime?: string | null,
  endTime?: string | null,
): { startsAt: string | null; endsAt: string | null } {
  if (!startTime) return { startsAt: null, endsAt: null };
  const start = parseISO(`${serviceDate}T${startTime}:00`);
  if (!endTime) return { startsAt: start.toISOString(), endsAt: null };
  let end = parseISO(`${serviceDate}T${endTime}:00`);
  if (end.getTime() === start.getTime()) {
    throw new Error("开始时间和结束时间不能相同");
  }
  if (end < start) end = addDays(end, 1);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

export function sortAppointmentsByStartTime(appointments: readonly Appointment[]): Appointment[] {
  return appointments
    .map((appointment, index) => ({ appointment, index }))
    .sort((left, right) => {
      const leftTime = left.appointment.startsAt
        ? parseISO(left.appointment.startsAt).getTime()
        : Number.POSITIVE_INFINITY;
      const rightTime = right.appointment.startsAt
        ? parseISO(right.appointment.startsAt).getTime()
        : Number.POSITIVE_INFINITY;
      return leftTime - rightTime || left.index - right.index;
    })
    .map(({ appointment }) => appointment);
}

export function findNextScheduledAppointment(
  appointments: readonly Appointment[],
  now: Date,
): Appointment | null {
  const nowTime = now.getTime();
  return (
    sortAppointmentsByStartTime(appointments).find(
      (appointment) =>
        appointment.serviceStatus === "scheduled" &&
        typeof appointment.startsAt === "string" &&
        parseISO(appointment.startsAt).getTime() > nowTime,
    ) ?? null
  );
}
