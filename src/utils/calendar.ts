import { differenceInMinutes, parseISO } from "date-fns";
import type { Appointment } from "../types/domain";
import {
  formatCurrency,
  formatTime,
  formatTimeRange,
  serviceStatusLabels,
  settlementStatusLabels,
} from "./formatters";

export function calendarEventClassNames(appointment: Appointment): string[] {
  return [
    `appointment-event--${appointment.mode}`,
    `appointment-event--${appointment.serviceStatus}`,
    `appointment-event--${appointment.settlementStatus}`,
  ];
}

export function visibleSettlementStatus(appointment: Appointment): "unsettled" | "settled" | null {
  if (
    appointment.mode !== "business" ||
    appointment.serviceStatus === "cancelled" ||
    appointment.settlementStatus === "not_applicable"
  ) {
    return null;
  }

  return appointment.settlementStatus;
}

export function calendarSettlementLabel(appointment: Appointment): string | null {
  const settlementStatus = visibleSettlementStatus(appointment);
  if (!settlementStatus) return null;

  const statusLabel = settlementStatus === "settled" ? "已结" : "待结";
  return appointment.amountMinor === null || appointment.amountMinor === undefined
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
  return formatTime(appointment.startsAt);
}

export function calendarEventTooltip(appointment: Appointment): string {
  const settlement =
    appointment.mode === "entertainment" || appointment.settlementStatus === "not_applicable"
      ? settlementStatusLabels.not_applicable
      : `${settlementStatusLabels[appointment.settlementStatus]}${
          appointment.amountMinor === null || appointment.amountMinor === undefined
            ? ""
            : ` · ${formatCurrency(appointment.amountMinor)}`
        }`;

  return [
    appointment.contactName,
    `时间：${formatTimeRange(appointment.startsAt, appointment.endsAt)}`,
    `内容：${appointment.content?.trim() || "未填写内容"}`,
    `状态：${serviceStatusLabels[appointment.serviceStatus]}`,
    `结算：${settlement}`,
  ].join("\n");
}
