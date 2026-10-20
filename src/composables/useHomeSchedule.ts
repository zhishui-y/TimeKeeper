import { computed, shallowRef, watch, type Ref } from "vue";
import {
  addDateKeyDays,
  chinaDateKey,
  dateKeyWeekday,
  parseDateKey,
  startOfChinaWeek,
} from "../utils/chinaDateTime";
import { sortAppointmentsByStartTime } from "../utils/appointment";
import { useAppointments } from "./useAppointments";

export function useHomeSchedule(now: Ref<Date>) {
  const todayKey = computed(() => chinaDateKey(now.value));
  const selectedDateKey = shallowRef(todayKey.value);
  const weekStartKey = computed(() => startOfChinaWeek(selectedDateKey.value));
  const weekEndKey = computed(() => addDateKeyDays(weekStartKey.value, 6));
  const isCurrentWeek = computed(() => weekStartKey.value === startOfChinaWeek(todayKey.value));
  const appointments = useAppointments({ from: weekStartKey.value, to: weekEndKey.value });

  const todayAppointments = computed(() =>
    sortAppointmentsByStartTime(
      appointments.items.value.filter(
        (item) => item.serviceDate === todayKey.value && item.serviceStatus !== "cancelled",
      ),
    ),
  );
  const selectedAppointments = computed(() =>
    sortAppointmentsByStartTime(
      appointments.items.value.filter(
        (item) => item.serviceDate === selectedDateKey.value && item.serviceStatus !== "cancelled",
      ),
    ),
  );
  const weekDays = computed(() =>
    Array.from({ length: 7 }, (_, index) => {
      const date = addDateKeyDays(weekStartKey.value, index);
      const parts = parseDateKey(date);
      return {
        date,
        weekday: dateKeyWeekday(date, true),
        dayNumber: parts ? String(parts.day) : "",
        isToday: date === todayKey.value,
        appointments: sortAppointmentsByStartTime(
          appointments.items.value.filter((item) => item.serviceDate === date),
        ),
      };
    }),
  );

  function selectDate(date: string): void {
    selectedDateKey.value = date;
  }

  function changeWeek(direction: -1 | 1): void {
    selectedDateKey.value = addDateKeyDays(selectedDateKey.value, direction * 7);
  }

  function returnToCurrentWeek(): void {
    selectedDateKey.value = todayKey.value;
  }

  watch(todayKey, (today, previousToday) => {
    if (weekStartKey.value === startOfChinaWeek(previousToday)) selectedDateKey.value = today;
  });

  watch([weekStartKey, todayKey], () => {
    appointments.filters.from = weekStartKey.value;
    appointments.filters.to = weekEndKey.value;
    void appointments.load();
  });

  return {
    ...appointments,
    todayKey,
    selectedDateKey,
    weekStartKey,
    weekEndKey,
    isCurrentWeek,
    todayAppointments,
    selectedAppointments,
    weekDays,
    selectDate,
    changeWeek,
    returnToCurrentWeek,
  };
}
