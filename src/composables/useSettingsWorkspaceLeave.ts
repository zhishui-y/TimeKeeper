import { onBeforeUnmount, readonly, shallowRef, type ComputedRef } from "vue";
import { onBeforeRouteLeave } from "vue-router";

interface UseSettingsWorkspaceLeaveOptions {
  dirty: ComputedRef<boolean>;
  save: () => Promise<boolean>;
  discard: () => void;
  rollbackPreview: () => void;
}

export function useSettingsWorkspaceLeave(options: UseSettingsWorkspaceLeaveOptions) {
  const leaveDialogOpen = shallowRef(false);
  let resolveLeave: ((allow: boolean) => void) | null = null;

  function finishLeaveDecision(allow: boolean): void {
    leaveDialogOpen.value = false;
    const resolve = resolveLeave;
    resolveLeave = null;
    resolve?.(allow);
  }

  async function saveAndLeave(): Promise<void> {
    if (await options.save()) finishLeaveDecision(true);
  }

  function discardAndLeave(): void {
    options.discard();
    finishLeaveDecision(true);
  }

  onBeforeRouteLeave(() => {
    if (!options.dirty.value) return true;
    return new Promise<boolean>((resolve) => {
      resolveLeave?.(false);
      resolveLeave = resolve;
      leaveDialogOpen.value = true;
    });
  });

  onBeforeUnmount(() => {
    if (options.dirty.value) options.rollbackPreview();
    resolveLeave?.(false);
    resolveLeave = null;
  });

  return {
    leaveDialogOpen: readonly(leaveDialogOpen),
    finishLeaveDecision,
    saveAndLeave,
    discardAndLeave,
  };
}
