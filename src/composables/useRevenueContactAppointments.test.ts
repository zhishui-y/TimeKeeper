import { describe, expect, it, vi } from "vitest";
import { mockApi } from "../api/mockClient";
import type { Appointment } from "../types/domain";
import { useRevenueContactAppointments } from "./useRevenueContactAppointments";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const appointment = (id: string): Appointment => ({
  id,
  serviceDate: "2026-08-01",
  contactName: id,
  mode: "business",
  serviceStatus: "completed",
  settlementStatus: "settled",
  amountMinor: 100,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
});

describe("useRevenueContactAppointments", () => {
  it("allows only the latest contact request to update the visible list", async () => {
    const first = deferred<Appointment[]>();
    const second = deferred<Appointment[]>();
    vi.spyOn(mockApi, "listRevenueContactAppointments")
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const resource = useRevenueContactAppointments();

    const firstLoad = resource.load("2026-08-01", "2026-08-02", ["旧对象"]);
    const secondLoad = resource.load("2026-08-01", "2026-08-02", ["新对象"]);
    second.resolve([appointment("new")]);
    await secondLoad;
    first.resolve([appointment("old")]);
    await firstLoad;

    expect(resource.appointments.value.map((item: Appointment) => item.id)).toEqual(["new"]);
    expect(resource.resolvedKey.value?.contactNames).toEqual(["新对象"]);
    vi.restoreAllMocks();
  });

  it("retains old data as stale and disables actions after a replacement fails", async () => {
    vi.spyOn(mockApi, "listRevenueContactAppointments")
      .mockResolvedValueOnce([appointment("old")])
      .mockRejectedValueOnce(new Error("对象明细加载失败"));
    const resource = useRevenueContactAppointments();

    await resource.load("2026-08-01", "2026-08-02", ["旧对象"]);
    await resource.load("2026-08-01", "2026-08-02", ["新对象"]);

    expect(resource.appointments.value.map((item: Appointment) => item.id)).toEqual(["old"]);
    expect(resource.error.value).toBe("对象明细加载失败");
    expect(resource.stale.value).toBe(true);
    expect(resource.actionsDisabled.value).toBe(true);
    expect(resource.resolvedKey.value?.contactNames).toEqual(["旧对象"]);
    vi.restoreAllMocks();
  });
});
