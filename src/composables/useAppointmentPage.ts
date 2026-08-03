import { onMounted, readonly, reactive, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type { Appointment, AppointmentFilters } from "../types/domain";

interface UseAppointmentPageOptions {
  pageSize?: number;
  immediate?: boolean;
}

export function useAppointmentPage(
  initialFilters: AppointmentFilters = {},
  { pageSize: initialPageSize = 100, immediate = true }: UseAppointmentPageOptions = {},
) {
  const filters = reactive<AppointmentFilters>({ ...initialFilters });
  const items = shallowRef<Appointment[]>([]);
  const totalCount = shallowRef(0);
  const page = shallowRef(1);
  const pageSize = shallowRef(initialPageSize);
  const totalPages = shallowRef(0);
  const loading = shallowRef(false);
  const error = shallowRef<string | null>(null);
  let requestVersion = 0;

  async function load(): Promise<void> {
    const version = ++requestVersion;
    const requestedFilters = { ...filters };
    const requestedPage = page.value;
    const requestedPageSize = pageSize.value;
    loading.value = true;
    error.value = null;
    try {
      const result = await api.listAppointmentPage(
        requestedFilters,
        requestedPage,
        requestedPageSize,
      );
      if (version !== requestVersion) return;
      items.value = result.items;
      totalCount.value = result.totalCount;
      page.value = result.page;
      pageSize.value = result.pageSize;
      totalPages.value = result.totalPages;
    } catch (cause) {
      if (version === requestVersion) error.value = errorMessage(cause);
    } finally {
      if (version === requestVersion) loading.value = false;
    }
  }

  async function applyFilters(next: AppointmentFilters): Promise<void> {
    for (const key of Object.keys(filters)) delete filters[key as keyof AppointmentFilters];
    Object.assign(filters, next);
    page.value = 1;
    await load();
  }

  async function goToPage(nextPage: number): Promise<void> {
    const maximum = Math.max(totalPages.value, 1);
    const normalized = Math.min(Math.max(Math.trunc(nextPage), 1), maximum);
    if (normalized === page.value && items.value.length > 0) return;
    page.value = normalized;
    await load();
  }

  async function reloadAfterDeletion(): Promise<void> {
    await load();
    if (page.value > Math.max(totalPages.value, 1)) {
      page.value = Math.max(totalPages.value, 1);
      await load();
    }
  }

  onMounted(() => {
    if (immediate) void load();
  });

  return {
    filters,
    items: readonly(items),
    totalCount: readonly(totalCount),
    page: readonly(page),
    pageSize: readonly(pageSize),
    totalPages: readonly(totalPages),
    loading: readonly(loading),
    error: readonly(error),
    load,
    applyFilters,
    goToPage,
    reloadAfterDeletion,
  };
}
