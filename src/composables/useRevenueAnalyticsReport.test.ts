import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../api/mockClient";
import type { RevenueAnalyticsReport } from "../types/domain";
import { useRevenueAnalyticsReport } from "./useRevenueAnalyticsReport";

function analyticsReport(from: string, to: string): RevenueAnalyticsReport {
  return {
    from,
    to,
    overview: {
      settledMinor: 0,
      unsettledMinor: 0,
      pendingCount: 0,
      businessMinutes: 0,
      averageHourlyMinor: 0,
      appointmentCount: 0,
      completedCount: 0,
    },
    weeks: [],
    weekdays: [],
    hours: [],
    contacts: [],
    paymentMethods: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useRevenueAnalyticsReport", () => {
  afterEach(() => vi.restoreAllMocks());

  it("allows only the newest range request to replace the report", async () => {
    const first = deferred<RevenueAnalyticsReport>();
    const second = deferred<RevenueAnalyticsReport>();
    vi.spyOn(mockApi, "getRevenueAnalyticsReport")
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const resource = useRevenueAnalyticsReport();

    const firstLoad = resource.load("2026-08-01", "2026-08-07");
    const secondLoad = resource.load("2026-08-08", "2026-08-14");
    second.resolve(analyticsReport("2026-08-08", "2026-08-14"));
    await secondLoad;
    first.resolve(analyticsReport("2026-08-01", "2026-08-07"));
    await firstLoad;

    expect(resource.report.value?.from).toBe("2026-08-08");
    expect(resource.resolvedRange.value).toEqual({
      from: "2026-08-08",
      to: "2026-08-14",
    });
  });

  it("retains the previous result as stale when a replacement fails", async () => {
    vi.spyOn(mockApi, "getRevenueAnalyticsReport")
      .mockResolvedValueOnce(analyticsReport("2026-08-01", "2026-08-07"))
      .mockRejectedValueOnce(new Error("报表生成失败"));
    const resource = useRevenueAnalyticsReport();

    await resource.load("2026-08-01", "2026-08-07");
    await resource.load("2026-08-08", "2026-08-14");

    expect(resource.report.value?.from).toBe("2026-08-01");
    expect(resource.error.value).toBe("报表生成失败");
    expect(resource.stale.value).toBe(true);
    expect(resource.actionsDisabled.value).toBe(true);
  });
});
