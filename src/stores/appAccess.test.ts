import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../api/mockClient";
import { useAppAccessStore } from "./appAccess";

describe("appAccess store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("bootstraps once and keeps the command response as the only status source", async () => {
    const status = vi.spyOn(mockApi, "appAccessStatus").mockResolvedValue({
      initialized: true,
      unlocked: false,
      legacyMigrationPendingCount: 3,
      recoveryQuestion: "常用角色？",
      dataRepairIssueCount: 0,
      dataRepairIssues: [],
    });
    const store = useAppAccessStore();

    await Promise.all([store.bootstrap(), store.bootstrap()]);

    expect(status).toHaveBeenCalledTimes(1);
    expect(store.ready).toBe(true);
    expect(store.initialized).toBe(true);
    expect(store.unlocked).toBe(false);
    expect(store.legacyMigrationPendingCount).toBe(3);
  });

  it("refreshes status after a legacy credential migration", async () => {
    vi.spyOn(mockApi, "migrateLegacyCredentials").mockResolvedValue({
      migratedCount: 2,
      missingCount: 1,
      pendingCount: 0,
    });
    vi.spyOn(mockApi, "appAccessStatus").mockResolvedValue({
      initialized: true,
      unlocked: true,
      legacyMigrationPendingCount: 0,
      recoveryQuestion: "常用角色？",
      dataRepairIssueCount: 0,
      dataRepairIssues: [],
    });
    const store = useAppAccessStore();

    await expect(store.migrateLegacyCredentials("old-password")).resolves.toEqual({
      migratedCount: 2,
      missingCount: 1,
      pendingCount: 0,
    });
    expect(store.unlocked).toBe(true);
    expect(store.legacyMigrationPendingCount).toBe(0);
  });
});
