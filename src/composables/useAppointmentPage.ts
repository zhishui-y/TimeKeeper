import { computed, onMounted, readonly, reactive, shallowRef } from "vue";
import { api } from "../api/client";
import type { AppointmentFilters, AppointmentPage } from "../types/domain";
import { useAsyncResource } from "./useAsyncResource";

interface UseAppointmentPageOptions {
  pageSize?: number;
  immediate?: boolean;
}

export function useAppointmentPage(
  initialFilters: AppointmentFilters = {},
  { pageSize: initialPageSize = 100, immediate = true }: UseAppointmentPageOptions = {},
) {
  interface AppointmentPageRequestKey {
    filters: AppointmentFilters;
    page: number;
    pageSize: number;
  }
  const filters = reactive<AppointmentFilters>({ ...initialFilters });
  const page = shallowRef(1);
  const pageSize = shallowRef(initialPageSize);
  const resource = useAsyncResource<AppointmentPage, AppointmentPageRequestKey>(
    (left, right) => JSON.stringify(left) === JSON.stringify(right),
  );
  const items = computed<AppointmentPage["items"]>(() => resource.data.value?.items ?? []);
  const totalCount = computed(() => resource.data.value?.totalCount ?? 0);
  const totalPages = computed(() => resource.data.value?.totalPages ?? 0);

  async function load(): Promise<void> {
    const requestedFilters = { ...filters };
    const requestedPage = page.value;
    const requestedPageSize = pageSize.value;
    const result = await resource.load(
      { filters: requestedFilters, page: requestedPage, pageSize: requestedPageSize },
      () => api.listAppointmentPage(requestedFilters, requestedPage, requestedPageSize),
      (response) => ({
        filters: requestedFilters,
        page: response.page,
        pageSize: response.pageSize,
      }),
    );
    if (result) {
      page.value = result.page;
      pageSize.value = result.pageSize;
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
    loading: resource.loading,
    error: resource.error,
    status: resource.status,
    stale: resource.stale,
    actionsDisabled: resource.actionsDisabled,
    requestedKey: resource.requestedKey,
    resolvedKey: resource.resolvedKey,
    load,
    applyFilters,
    goToPage,
    reloadAfterDeletion,
  };
}
