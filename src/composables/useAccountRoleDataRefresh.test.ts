// @vitest-environment jsdom

import { effectScope } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../api/mockClient";
import type { AccountRoleDataRefreshResult, AccountRoleDataRefreshStatus } from "../types/domain";
import { useAccountRoleDataRefresh } from "./useAccountRoleDataRefresh";

function resultFor(status: AccountRoleDataRefreshStatus): AccountRoleDataRefreshResult {
  return {
    requestedCount: 1,
    updatedCount: status === "updated" ? 1 : 0,
    noRecordCount: status === "noRecord" ? 1 : 0,
    skippedCount: status === "skipped" ? 1 : 0,
    failedCount: status === "failed" ? 1 : 0,
    items: [{ accountId: "account-1", status }],
  };
}

describe("useAccountRoleDataRefresh", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(["updated", "noRecord", "skipped"] as const)(
    "dismisses a %s result after 3000ms",
    async (status) => {
      vi.useFakeTimers();
      vi.spyOn(mockApi, "refreshAccountProfileRoleData").mockResolvedValue(resultFor(status));
      const scope = effectScope();
      const refreshState = scope.run(() => useAccountRoleDataRefresh())!;

      await refreshState.refresh(["account-1"]);
      vi.advanceTimersByTime(2_999);
      expect(refreshState.result.value).not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(refreshState.result.value).toBeNull();
      scope.stop();
    },
  );

  it("keeps failed results and command errors visible", async () => {
    vi.useFakeTimers();
    const refresh = vi.spyOn(mockApi, "refreshAccountProfileRoleData");
    refresh.mockResolvedValueOnce(resultFor("failed"));
    const scope = effectScope();
    const refreshState = scope.run(() => useAccountRoleDataRefresh())!;

    await refreshState.refresh(["account-1"]);
    vi.advanceTimersByTime(3_000);
    expect(refreshState.result.value?.failedCount).toBe(1);

    refresh.mockRejectedValueOnce(new Error("连接失败"));
    await refreshState.refresh(["account-1"]);
    vi.advanceTimersByTime(3_000);
    expect(refreshState.error.value).toContain("连接失败");
    scope.stop();
  });

  it("cancels old timers for manual close, new tasks, and scope disposal", async () => {
    vi.useFakeTimers();
    const refresh = vi
      .spyOn(mockApi, "refreshAccountProfileRoleData")
      .mockResolvedValue(resultFor("updated"));
    const scope = effectScope();
    const refreshState = scope.run(() => useAccountRoleDataRefresh())!;

    await refreshState.refresh(["account-1"]);
    refreshState.clearResult();
    vi.advanceTimersByTime(3_000);
    expect(refreshState.result.value).toBeNull();

    await refreshState.refresh(["account-1"]);
    vi.advanceTimersByTime(1_000);
    await refreshState.refresh(["account-2"]);
    vi.advanceTimersByTime(2_999);
    expect(refreshState.result.value).not.toBeNull();

    scope.stop();
    vi.advanceTimersByTime(1);
    expect(refreshState.result.value).not.toBeNull();
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});
