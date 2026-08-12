import type {
  Appointment,
  AppointmentMode,
  AppointmentProgressStatus,
  ServiceStatus,
  SettlementStatus,
} from "../types/domain";

export const appointmentProgressStatusLabels: Record<AppointmentProgressStatus, string> = {
  scheduled: "已预约",
  in_progress: "进行中",
  pending_settlement: "待结算",
  completed: "完成",
  cancelled: "已取消",
};

export const entertainmentProgressStatuses: readonly AppointmentProgressStatus[] = [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
];

export const businessProgressStatuses: readonly AppointmentProgressStatus[] = [
  "scheduled",
  "in_progress",
  "pending_settlement",
  "completed",
  "cancelled",
];

export function appointmentProgressStatusesForMode(
  mode: AppointmentMode,
): readonly AppointmentProgressStatus[] {
  return mode === "business" ? businessProgressStatuses : entertainmentProgressStatuses;
}

export function appointmentProgressStatus(
  appointment: Pick<Appointment, "mode" | "serviceStatus" | "settlementStatus">,
): AppointmentProgressStatus {
  if (appointment.serviceStatus === "cancelled") return "cancelled";
  if (appointment.mode === "entertainment") return appointment.serviceStatus;
  if (appointment.serviceStatus === "completed") {
    return appointment.settlementStatus === "settled" ? "completed" : "pending_settlement";
  }
  return appointment.serviceStatus;
}

export function appointmentStatusesFromProgress(
  mode: AppointmentMode,
  progressStatus: AppointmentProgressStatus,
  currentSettlementStatus: SettlementStatus,
): { serviceStatus: ServiceStatus; settlementStatus: SettlementStatus } {
  if (mode === "entertainment") {
    return {
      serviceStatus: progressStatus === "pending_settlement" ? "completed" : progressStatus,
      settlementStatus: "not_applicable",
    };
  }

  if (progressStatus === "cancelled") {
    return {
      serviceStatus: "cancelled",
      settlementStatus:
        currentSettlementStatus === "not_applicable" ? "unsettled" : currentSettlementStatus,
    };
  }
  if (progressStatus === "completed") {
    return {
      serviceStatus: "completed",
      settlementStatus: "settled",
    };
  }
  if (progressStatus === "pending_settlement") {
    return { serviceStatus: "completed", settlementStatus: "unsettled" };
  }
  return {
    serviceStatus: progressStatus,
    settlementStatus:
      currentSettlementStatus === "not_applicable" ? "unsettled" : currentSettlementStatus,
  };
}
