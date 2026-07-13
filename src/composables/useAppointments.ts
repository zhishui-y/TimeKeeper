import { onMounted, readonly, reactive, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type { Appointment, AppointmentFilters } from "../types/domain";

export function useAppointments(initialFilters: AppointmentFilters = {}) {
  const filters = reactive<AppointmentFilters>({ ...initialFilters });
  const items = shallowRef<Appointment[]>([]);
  const loading = shallowRef(false);
  const error = shallowRef<string | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      items.value = await api.listAppointments({ ...filters });
    } catch (cause) {
      error.value = errorMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => void load());

  return {
    filters,
    items: readonly(items),
    loading: readonly(loading),
    error: readonly(error),
    load,
  };
}
