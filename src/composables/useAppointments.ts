import { onMounted, readonly, reactive, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type { Appointment, AppointmentFilters } from "../types/domain";

interface UseAppointmentsOptions {
  immediate?: boolean;
}

export function useAppointments(
  initialFilters: AppointmentFilters = {},
  { immediate = true }: UseAppointmentsOptions = {},
) {
  const filters = reactive<AppointmentFilters>({ ...initialFilters });
  const items = shallowRef<Appointment[]>([]);
  const loading = shallowRef(false);
  const error = shallowRef<string | null>(null);
  const inFlight = new Map<string, Promise<Appointment[]>>();
  let requestVersion = 0;

  function requestKey(value: AppointmentFilters): string {
    return JSON.stringify([
      value.from ?? null,
      value.to ?? null,
      value.query ?? null,
      value.mode ?? null,
      value.progressStatus ?? null,
      value.serviceStatus ?? null,
      value.settlementStatus ?? null,
    ]);
  }

  function fetchAppointments(requestedFilters: AppointmentFilters): Promise<Appointment[]> {
    if (!requestedFilters.from || !requestedFilters.to) {
      return Promise.reject(new Error("预约范围查询必须同时提供开始日期和结束日期"));
    }
    const key = requestKey(requestedFilters);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const request = api.listAppointments({
      ...requestedFilters,
      from: requestedFilters.from,
      to: requestedFilters.to,
    });
    inFlight.set(key, request);
    const clear = () => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    };
    void request.then(clear, clear);
    return request;
  }

  async function load(): Promise<void> {
    const version = ++requestVersion;
    const requestedFilters = { ...filters };
    loading.value = true;
    error.value = null;
    try {
      const nextItems = await fetchAppointments(requestedFilters);
      if (version === requestVersion) items.value = nextItems;
    } catch (cause) {
      if (version === requestVersion) error.value = errorMessage(cause);
    } finally {
      if (version === requestVersion) loading.value = false;
    }
  }

  onMounted(() => {
    if (immediate) void load();
  });

  return {
    filters,
    items: readonly(items),
    loading: readonly(loading),
    error: readonly(error),
    load,
  };
}
