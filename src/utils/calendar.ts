import { differenceInMinutes, parseISO } from "date-fns";
import type { Appointment } from "../types/domain";
import { formatCurrency, formatTimeRange } from "./formatters";
import { appointmentProgressStatus, appointmentProgressStatusLabels } from "./appointmentProgress";

export function calendarEventClassNames(appointment: Appointment): string[] {
  return [
    `appointment-event--${appointment.mode}`,
    `appointment-event--${appointmentProgressStatus(appointment)}`,
  ];
}

export function calendarProgressLabel(appointment: Appointment): string {
  const statusLabel = appointmentProgressStatusLabels[appointmentProgressStatus(appointment)];
  return appointment.mode !== "business" || appointment.amountMinor == null
    ? statusLabel
    : `${statusLabel} · ${formatCurrency(appointment.amountMinor)}`;
}

export function calendarAppointmentCounts(
  appointments: readonly Appointment[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const appointment of appointments) {
    if (appointment.serviceStatus === "cancelled") continue;
    counts.set(appointment.serviceDate, (counts.get(appointment.serviceDate) ?? 0) + 1);
  }
  return counts;
}

export function isShortCalendarAppointment(appointment: Appointment): boolean {
  if (!appointment.startsAt || !appointment.endsAt) return false;
  const durationMinutes = differenceInMinutes(
    parseISO(appointment.endsAt),
    parseISO(appointment.startsAt),
  );
  return durationMinutes > 0 && durationMinutes < 60;
}

export function calendarEventTimeLabel(appointment: Appointment): string {
  return appointment.startsAt ? formatTimeRange(appointment.startsAt, appointment.endsAt) : "待定";
}

export function calendarEventTooltip(appointment: Appointment): string {
  const progressStatus = appointmentProgressStatus(appointment);
  const amount =
    appointment.mode === "business" ? formatCurrency(appointment.amountMinor) : "无需结算";

  return [
    appointment.contactName,
    `时间：${formatTimeRange(appointment.startsAt, appointment.endsAt)}`,
    `内容：${appointment.content?.trim() || "未填写内容"}`,
    `状态：${appointmentProgressStatusLabels[progressStatus]}`,
    `金额：${amount}`,
  ].join("\n");
}
