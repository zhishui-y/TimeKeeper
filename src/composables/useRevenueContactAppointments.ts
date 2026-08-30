import { computed } from "vue";
import { api } from "../api/client";
import type { Appointment } from "../types/domain";
import { useAsyncResource } from "./useAsyncResource";

export interface RevenueContactAppointmentsKey {
  from: string;
  to: string;
  contactNames: readonly string[];
}

function sameKey(left: RevenueContactAppointmentsKey, right: RevenueContactAppointmentsKey) {
  return (
    left.from === right.from &&
    left.to === right.to &&
    left.contactNames.length === right.contactNames.length &&
    left.contactNames.every((name, index) => name === right.contactNames[index])
  );
}

export function useRevenueContactAppointments() {
  const resource = useAsyncResource<Appointment[], RevenueContactAppointmentsKey>(sameKey);

  async function load(from: string, to: string, contactNames: readonly string[]): Promise<void> {
    const key = { from, to, contactNames: [...contactNames] };
    await resource.load(key, () => api.listRevenueContactAppointments(from, to, key.contactNames));
  }

  return {
    appointments: computed(() => resource.data.value ?? []),
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
