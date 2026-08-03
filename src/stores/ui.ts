import { defineStore } from "pinia";
import { format } from "date-fns";
import { shallowRef } from "vue";
import type { Appointment } from "../types/domain";

export type ToastTone = "success" | "warning" | "danger" | "neutral";

export interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

export const useUiStore = defineStore("ui", () => {
  const appointmentDrawerOpen = shallowRef(false);
  const activeAppointment = shallowRef<Appointment | null>(null);
  const appointmentDrawerInitialFocus = shallowRef<"default" | "amount">("default");
  const requestedDate = shallowRef(format(new Date(), "yyyy-MM-dd"));
  const requestedStartTime = shallowRef<string | null>(null);
  const dataRevision = shallowRef(0);
  const accountRevision = shallowRef(0);
  const appointmentDefaultReminderMinutes = shallowRef(30);
  const toast = shallowRef<ToastMessage | null>(null);
  const queuedToasts: Array<Omit<ToastMessage, "id">> = [];
  let toastTimer: number | undefined;
  let toastSequence = 0;

  function openCreateAppointment(
    serviceDate = format(new Date(), "yyyy-MM-dd"),
    startTime?: string,
  ): void {
    activeAppointment.value = null;
    appointmentDrawerInitialFocus.value = "default";
    requestedDate.value = serviceDate;
    requestedStartTime.value = startTime ?? null;
    appointmentDrawerOpen.value = true;
  }

  function openEditAppointment(appointment: Appointment): void {
    activeAppointment.value = appointment;
    appointmentDrawerInitialFocus.value = "default";
    requestedDate.value = appointment.serviceDate;
    requestedStartTime.value = null;
    appointmentDrawerOpen.value = true;
  }

  function openSettleAppointment(appointment: Appointment): void {
    activeAppointment.value = appointment;
    appointmentDrawerInitialFocus.value = "amount";
    requestedDate.value = appointment.serviceDate;
    requestedStartTime.value = null;
    appointmentDrawerOpen.value = true;
  }

  function closeAppointmentDrawer(): void {
    appointmentDrawerOpen.value = false;
    activeAppointment.value = null;
    appointmentDrawerInitialFocus.value = "default";
  }

  function markDataChanged(): void {
    dataRevision.value += 1;
  }

  function markAccountsChanged(): void {
    accountRevision.value += 1;
  }

  function setAppointmentDefaultReminderMinutes(minutes: number): void {
    appointmentDefaultReminderMinutes.value = minutes;
  }

  function showToast(message: string, tone: ToastTone): void {
    window.clearTimeout(toastTimer);
    toastSequence += 1;
    toast.value = { id: Date.now() + toastSequence, message, tone };
    toastTimer = window.setTimeout(dismissToast, 3600);
  }

  function notify(message: string, tone: ToastTone = "neutral"): void {
    queuedToasts.splice(0);
    showToast(message, tone);
  }

  function notifyAfterCurrent(message: string, tone: ToastTone = "neutral"): void {
    if (!toast.value) {
      showToast(message, tone);
      return;
    }
    queuedToasts.push({ message, tone });
  }

  function dismissToast(): void {
    window.clearTimeout(toastTimer);
    const next = queuedToasts.shift();
    if (next) {
      showToast(next.message, next.tone);
    } else {
      toast.value = null;
    }
  }

  return {
    appointmentDrawerOpen,
    activeAppointment,
    appointmentDrawerInitialFocus,
    requestedDate,
    requestedStartTime,
    dataRevision,
    accountRevision,
    appointmentDefaultReminderMinutes,
    toast,
    openCreateAppointment,
    openEditAppointment,
    openSettleAppointment,
    closeAppointmentDrawer,
    markDataChanged,
    markAccountsChanged,
    setAppointmentDefaultReminderMinutes,
    notify,
    notifyAfterCurrent,
    dismissToast,
  };
});
