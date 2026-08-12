import type { Appointment } from "../types/domain";
import { civilDurationInMinutes } from "./chinaDateTime";
import { formatCurrency, formatTimeRange } from "./formatters";
import { appointmentProgressStatus, appointmentProgressStatusLabels } from "./appointmentProgress";

export const CALENDAR_VISIBLE_HALF_HOUR_SLOTS = 27;

export function calendarSlotHeight(viewportHeight: number): number {
  return Math.max(0, viewportHeight) / CALENDAR_VISIBLE_HALF_HOUR_SLOTS;
}

export function calendarEventClassNames(appointment: Appointment): string[] {
  return [
    `appointment-event--${appointment.mode}`,
    `appointment-event--${appointmentProgressStatus(appointment)}`,
  ];
}

export function calendarCardProgressLabel(appointment: Appointment): string | null {
  switch (appointmentProgressStatus(appointment)) {
    case "scheduled":
      return null;
    case "completed":
      return "完成";
    case "cancelled":
      return "取消";
    case "in_progress":
      return "进行中";
    case "pending_settlement":
      return "待结算";
  }
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
  const durationMinutes = civilDurationInMinutes(appointment.startsAt, appointment.endsAt);
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
