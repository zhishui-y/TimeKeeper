// @vitest-environment jsdom

import { effectScope } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../api/mockClient";
import type {
  AccountRoleDataRefreshProgress,
  AccountRoleDataRefreshResult,
  AccountRoleDataRefreshStatus,
} from "../types/domain";
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
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

  it("removes completed targets and forwards progress before the command resolves", async () => {
    const pending = deferred<AccountRoleDataRefreshResult>();
    let reportProgress: ((progress: AccountRoleDataRefreshProgress) => void) | undefined;
    vi.spyOn(mockApi, "refreshAccountProfileRoleData").mockImplementation((_ids, onProgress) => {
      reportProgress = onProgress!;
      return pending.promise;
    });
    const onProgress = vi.fn();
    const scope = effectScope();
    const refreshState = scope.run(() => useAccountRoleDataRefresh({ onProgress }))!;

    const refreshPromise = refreshState.refresh(["account-1", "account-2"]);
    expect([...refreshState.targetIds.value]).toEqual(["account-1", "account-2"]);
    await vi.waitFor(() => expect(reportProgress).toBeTypeOf("function"));
    reportProgress!({
      completedCount: 1,
      requestedCount: 2,
      item: { accountId: "account-1", status: "updated" },
      patch: {
        accountId: "account-1",
        gearScore: "200000",
        currentScore: 2500,
        highestScore: 2600,
        scoreUpdatedAt: "2026-08-09",
        weeklyWins: 6,
        updatedAt: "2026-08-09T00:00:00Z",
      },
    });

    expect([...refreshState.targetIds.value]).toEqual(["account-2"]);
    expect(onProgress).toHaveBeenCalledOnce();
    expect(refreshState.busy.value).toBe(true);

    pending.resolve({
      requestedCount: 2,
      updatedCount: 1,
      noRecordCount: 1,
      skippedCount: 0,
      failedCount: 0,
      items: [
        { accountId: "account-1", status: "updated" },
        { accountId: "account-2", status: "noRecord" },
      ],
    });
    await refreshPromise;
    expect(refreshState.busy.value).toBe(false);
    expect(refreshState.targetIds.value.size).toBe(0);
    scope.stop();
  });
});
