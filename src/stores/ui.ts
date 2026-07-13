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
  const requestedDate = shallowRef(format(new Date(), "yyyy-MM-dd"));
  const requestedStartTime = shallowRef<string | null>(null);
  const dataRevision = shallowRef(0);
  const toast = shallowRef<ToastMessage | null>(null);
  let toastTimer: number | undefined;

  function openCreateAppointment(
    serviceDate = format(new Date(), "yyyy-MM-dd"),
    startTime?: string,
  ): void {
    activeAppointment.value = null;
    requestedDate.value = serviceDate;
    requestedStartTime.value = startTime ?? null;
    appointmentDrawerOpen.value = true;
  }

  function openEditAppointment(appointment: Appointment): void {
    activeAppointment.value = appointment;
    requestedDate.value = appointment.serviceDate;
    requestedStartTime.value = null;
    appointmentDrawerOpen.value = true;
  }

  function closeAppointmentDrawer(): void {
    appointmentDrawerOpen.value = false;
    activeAppointment.value = null;
  }

  function markDataChanged(): void {
    dataRevision.value += 1;
  }

  function notify(message: string, tone: ToastTone = "neutral"): void {
    window.clearTimeout(toastTimer);
    toast.value = { id: Date.now(), message, tone };
    toastTimer = window.setTimeout(() => {
      toast.value = null;
    }, 3600);
  }

  function dismissToast(): void {
    window.clearTimeout(toastTimer);
    toast.value = null;
  }

  return {
    appointmentDrawerOpen,
    activeAppointment,
    requestedDate,
    requestedStartTime,
    dataRevision,
    toast,
    openCreateAppointment,
    openEditAppointment,
    closeAppointmentDrawer,
    markDataChanged,
    notify,
    dismissToast,
  };
});
