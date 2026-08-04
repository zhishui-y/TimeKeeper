import { readonly, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { AppointmentFilters } from "../types/domain";
import {
  appointmentFiltersEqual,
  appointmentFiltersToQuery,
  parseAppointmentFilterQuery,
  validateAppointmentFilterDateRange,
} from "../utils/appointmentRouteQuery";

export function useAppointmentRouteFilters() {
  const route = useRoute();
  const router = useRouter();
  const initial = parseAppointmentFilterQuery(route.query);
  const filters = shallowRef<AppointmentFilters>(initial.filters);

  function synchronizeFromRoute(query: Readonly<Record<string, unknown>>): void {
    const parsed = parseAppointmentFilterQuery(query);
    if (!appointmentFiltersEqual(filters.value, parsed.filters)) {
      filters.value = parsed.filters;
    }
    if (!parsed.isCanonical) {
      void router.replace({ query: parsed.normalizedQuery });
    }
  }

  watch(() => route.query, synchronizeFromRoute, { deep: true });

  if (!initial.isCanonical) {
    void router.replace({ query: initial.normalizedQuery });
  }

  async function replaceFilters(next: AppointmentFilters): Promise<string | null> {
    const dateError = validateAppointmentFilterDateRange(next);
    if (dateError) return dateError;
    await router.replace({ query: appointmentFiltersToQuery(next) });
    return null;
  }

  return {
    initialFilters: { ...initial.filters },
    filters: readonly(filters),
    replaceFilters,
    resetFilters: () => replaceFilters({}),
  };
}
