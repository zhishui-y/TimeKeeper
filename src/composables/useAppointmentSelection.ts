import { computed, readonly, shallowRef } from "vue";
import { api, errorMessage } from "../api/client";
import type {
  AppointmentDeleteSelection,
  AppointmentFilters,
  AppointmentSelectionSnapshot,
} from "../types/domain";

export function useAppointmentSelection() {
  const explicitIds = shallowRef<ReadonlySet<string>>(new Set());
  const exclusions = shallowRef<ReadonlySet<string>>(new Set());
  const snapshot = shallowRef<AppointmentSelectionSnapshot | null>(null);
  const selectingAll = shallowRef(false);
  const error = shallowRef<string | null>(null);

  const selectedCount = computed(() =>
    snapshot.value
      ? Math.max(snapshot.value.totalCount - exclusions.value.size, 0)
      : explicitIds.value.size,
  );

  function isSelected(id: string): boolean {
    return snapshot.value ? !exclusions.value.has(id) : explicitIds.value.has(id);
  }

  function replaceSet(
    source: ReadonlySet<string>,
    id: string,
    included: boolean,
  ): ReadonlySet<string> {
    const next = new Set(source);
    if (included) next.add(id);
    else next.delete(id);
    return next;
  }

  function toggleOne(id: string, selected: boolean): void {
    if (snapshot.value) {
      exclusions.value = replaceSet(exclusions.value, id, !selected);
      return;
    }
    explicitIds.value = replaceSet(explicitIds.value, id, selected);
  }

  async function selectAll(filters: AppointmentFilters): Promise<boolean> {
    if (selectingAll.value) return false;
    selectingAll.value = true;
    error.value = null;
    try {
      snapshot.value = await api.createAppointmentSelection({ ...filters });
      explicitIds.value = new Set();
      exclusions.value = new Set();
      return true;
    } catch (cause) {
      error.value = errorMessage(cause);
      return false;
    } finally {
      selectingAll.value = false;
    }
  }

  function clear(): void {
    explicitIds.value = new Set();
    exclusions.value = new Set();
    snapshot.value = null;
    error.value = null;
  }

  function removeId(id: string): void {
    if (snapshot.value) {
      exclusions.value = replaceSet(exclusions.value, id, true);
    } else {
      explicitIds.value = replaceSet(explicitIds.value, id, false);
    }
  }

  function deleteSelection(): AppointmentDeleteSelection | null {
    if (selectedCount.value === 0) return null;
    if (snapshot.value) {
      return {
        kind: "token",
        token: snapshot.value.token,
        excludedIds: [...exclusions.value],
      };
    }
    return { kind: "explicit", ids: [...explicitIds.value] };
  }

  return {
    explicitIds: readonly(explicitIds),
    exclusions: readonly(exclusions),
    snapshot: readonly(snapshot),
    selectingAll: readonly(selectingAll),
    error: readonly(error),
    selectedCount,
    isSelected,
    toggleOne,
    selectAll,
    clear,
    removeId,
    deleteSelection,
  };
}
