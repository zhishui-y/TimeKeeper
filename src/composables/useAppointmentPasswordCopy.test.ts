// @vitest-environment jsdom

import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../api/mockClient";
import { useUiStore } from "../stores/ui";
import {
  useAppointmentPasswordCopy,
  type AppointmentPasswordCopyController,
} from "./useAppointmentPasswordCopy";

function mountController(): AppointmentPasswordCopyController {
  let controller!: AppointmentPasswordCopyController;
  mount(
    defineComponent({
      setup() {
        controller = useAppointmentPasswordCopy();
        return () => h("div");
      },
    }),
    { global: { plugins: [createPinia()] } },
  );
  return controller;
}

describe("useAppointmentPasswordCopy", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("unlocks, retries copying, and queues complete migration statistics", async () => {
    vi.spyOn(mockApi, "vaultStatus")
      .mockResolvedValueOnce({
        initialized: true,
        unlocked: false,
        autoLockMinutes: 15,
      })
      .mockResolvedValue({
        initialized: true,
        unlocked: true,
        autoLockMinutes: 15,
      });
    vi.spyOn(mockApi, "unlockVault").mockResolvedValue({
      initialized: true,
      unlocked: true,
      autoLockMinutes: 15,
      appointmentPasswordMigration: { migratedCount: 3, missingCount: 1, pendingCount: 2 },
    });
    const copy = vi.spyOn(mockApi, "copyAppointmentAccountPassword").mockResolvedValue();
    const controller = mountController();

    await controller.copy("appointment-1");
    expect(controller.unlockOpen.value).toBe(true);
    expect(copy).not.toHaveBeenCalled();

    await controller.unlockAndRetry("master-password");
    expect(copy).toHaveBeenCalledWith("appointment-1");
    expect(controller.unlockOpen.value).toBe(false);
    const ui = useUiStore();
    expect(ui.toast?.message).toContain("账号密码已复制");
    vi.advanceTimersByTime(3_600);
    expect(ui.toast?.message).toContain("已迁移 3 条历史预约密码");
    expect(ui.toast?.message).toContain("1 条缺少来源密码");
    expect(ui.toast?.message).toContain("2 条待下次解锁重试");
  });

  it("opens the unlock dialog and retries a pending legacy duplicate", async () => {
    vi.spyOn(mockApi, "vaultStatus").mockResolvedValue({
      initialized: true,
      unlocked: false,
      autoLockMinutes: 15,
    });
    vi.spyOn(mockApi, "unlockVault").mockResolvedValue({
      initialized: true,
      unlocked: true,
      autoLockMinutes: 15,
    });
    const action = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("请先解锁完成历史预约密码迁移"))
      .mockResolvedValueOnce();
    const controller = mountController();

    await controller.runWithUnlockRetry(action);
    expect(controller.unlockOpen.value).toBe(true);
    await controller.unlockAndRetry("master-password");

    expect(action).toHaveBeenCalledTimes(2);
    expect(controller.unlockOpen.value).toBe(false);
  });

  it("reports migration statistics even when the retried action fails", async () => {
    vi.spyOn(mockApi, "vaultStatus")
      .mockResolvedValueOnce({
        initialized: true,
        unlocked: false,
        autoLockMinutes: 15,
      })
      .mockResolvedValue({
        initialized: true,
        unlocked: true,
        autoLockMinutes: 15,
      });
    vi.spyOn(mockApi, "unlockVault").mockResolvedValue({
      initialized: true,
      unlocked: true,
      autoLockMinutes: 15,
      appointmentPasswordMigration: { migratedCount: 1, missingCount: 0, pendingCount: 1 },
    });
    const action = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("重试操作失败"));
    const controller = mountController();

    await controller.runWithUnlockRetry(action);
    await controller.unlockAndRetry("master-password");

    expect(controller.unlockOpen.value).toBe(true);
    expect(controller.unlockError.value).toBe("重试操作失败");
    expect(useUiStore().toast?.message).toContain("已迁移 1 条历史预约密码");
    expect(useUiStore().toast?.message).toContain("1 条待下次解锁重试");
  });
});
