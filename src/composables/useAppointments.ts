import { computed, onMounted, readonly, reactive } from "vue";
import { api } from "../api/client";
import type { Appointment, AppointmentFilters } from "../types/domain";
import { useAsyncResource } from "./useAsyncResource";

interface UseAppointmentsOptions {
  immediate?: boolean;
}

export function useAppointments(
  initialFilters: AppointmentFilters = {},
  { immediate = true }: UseAppointmentsOptions = {},
) {
  const filters = reactive<AppointmentFilters>({ ...initialFilters });
  const resource = useAsyncResource<Appointment[], AppointmentFilters>(
    (left, right) => requestKey(left) === requestKey(right),
  );
  const items = computed<Appointment[]>(() => resource.data.value ?? []);
  const inFlight = new Map<string, Promise<Appointment[]>>();

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
    const requestedFilters = { ...filters };
    await resource.load(requestedFilters, () => fetchAppointments(requestedFilters));
  }

  onMounted(() => {
    if (immediate) void load();
  });

  return {
    filters,
    items: readonly(items),
    loading: resource.loading,
    error: resource.error,
    status: resource.status,
    stale: resource.stale,
    actionsDisabled: resource.actionsDisabled,
    requestedKey: resource.requestedKey,
    resolvedKey: resource.resolvedKey,
    load,
  };
}
