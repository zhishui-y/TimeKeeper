import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, shallowRef } from "vue";
import { mockApi } from "../api/mockClient";
import type { Appointment } from "../types/domain";
import { useHomeSchedule } from "./useHomeSchedule";

function appointment(serviceDate: string): Appointment {
  return {
    id: serviceDate,
    serviceDate,
    contactName: "测试联系人",
    mode: "entertainment",
    serviceStatus: "scheduled",
    settlementStatus: "not_applicable",
    createdAt: "2026-12-01T00:00:00Z",
    updatedAt: "2026-12-01T00:00:00Z",
  };
}

function setup(date = "2027-01-01T12:00:00+08:00") {
  const now = shallowRef(new Date(date));
  let schedule!: ReturnType<typeof useHomeSchedule>;
  const wrapper = mount(
    defineComponent({
      setup() {
        schedule = useHomeSchedule(now);
        return () => h("div");
      },
    }),
  );
  return { schedule, now, wrapper };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("useHomeSchedule", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads adjacent weeks across a year boundary and preserves the selected weekday", async () => {
    const records = [
      appointment("2026-12-25"),
      appointment("2027-01-01"),
      appointment("2027-01-08"),
    ];
    const list = vi
      .spyOn(mockApi, "listAppointments")
      .mockImplementation(async ({ from, to }) =>
        records.filter((item) => item.serviceDate >= from && item.serviceDate <= to),
      );
    const { schedule, wrapper } = setup();
    await flushPromises();
    expect(schedule.selectedAppointments.value.map((item) => item.id)).toEqual(["2027-01-01"]);

    schedule.changeWeek(-1);
    await flushPromises();
    expect(list).toHaveBeenLastCalledWith({ from: "2026-12-21", to: "2026-12-27" });
    expect(schedule.selectedDateKey.value).toBe("2026-12-25");
    expect(schedule.selectedAppointments.value.map((item) => item.id)).toEqual(["2026-12-25"]);
    expect(schedule.isCurrentWeek.value).toBe(false);

    schedule.changeWeek(1);
    await flushPromises();
    schedule.changeWeek(1);
    await flushPromises();
    expect(list).toHaveBeenLastCalledWith({ from: "2027-01-04", to: "2027-01-10" });
    expect(schedule.selectedDateKey.value).toBe("2027-01-08");
    expect(schedule.selectedAppointments.value.map((item) => item.id)).toEqual(["2027-01-08"]);
    expect(schedule.weekDays.value.map((day) => day.dayNumber)).toEqual([
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);

    schedule.selectDate("2027-01-06");
    schedule.changeWeek(-1);
    await flushPromises();
    expect(schedule.selectedDateKey.value).toBe("2026-12-30");
    schedule.returnToCurrentWeek();
    await flushPromises();
    expect(schedule.selectedDateKey.value).toBe("2027-01-01");
    expect(schedule.isCurrentWeek.value).toBe(true);
    expect(schedule.selectedAppointments.value.map((item) => item.id)).toEqual(["2027-01-01"]);
    wrapper.unmount();
  });

  it("ignores an older response after quickly navigating to a different week", async () => {
    const older = deferred<Appointment[]>();
    const newer = deferred<Appointment[]>();
    vi.spyOn(mockApi, "listAppointments")
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const { schedule, wrapper } = setup();
    await flushPromises();
    schedule.changeWeek(-1);
    await flushPromises();
    schedule.changeWeek(1);
    schedule.changeWeek(1);
    await flushPromises();

    newer.resolve([appointment("2027-01-08")]);
    await flushPromises();
    older.resolve([appointment("2026-12-25")]);
    await flushPromises();
    expect(schedule.items.value.map((item) => item.id)).toEqual(["2027-01-08"]);
    expect(schedule.resolvedKey.value).toEqual({ from: "2027-01-04", to: "2027-01-10" });
    expect(schedule.actionsDisabled.value).toBe(false);
    wrapper.unmount();
  });

  it("recovers from a failed week query by returning to the current week", async () => {
    vi.spyOn(mockApi, "listAppointments")
      .mockResolvedValueOnce([appointment("2027-01-01")])
      .mockRejectedValueOnce(new Error("加载失败"))
      .mockResolvedValueOnce([appointment("2027-01-01")]);
    const { schedule, wrapper } = setup();
    await flushPromises();
    schedule.changeWeek(-1);
    await flushPromises();
    expect(schedule.error.value).toBe("加载失败");
    expect(schedule.stale.value).toBe(true);
    expect(schedule.actionsDisabled.value).toBe(true);
    expect(schedule.selectedAppointments.value).toEqual([]);

    schedule.returnToCurrentWeek();
    await flushPromises();
    expect(schedule.error.value).toBeNull();
    expect(schedule.actionsDisabled.value).toBe(false);
    expect(schedule.selectedAppointments.value.map((item) => item.id)).toEqual(["2027-01-01"]);
    wrapper.unmount();
  });

  it("keeps a browsed week in place when midnight starts a new week", async () => {
    const list = vi.spyOn(mockApi, "listAppointments").mockResolvedValue([]);
    const { schedule, now, wrapper } = setup("2026-07-19T23:59:50+08:00");
    await flushPromises();
    schedule.changeWeek(1);
    await flushPromises();
    now.value = new Date("2026-07-20T00:00:20+08:00");
    await flushPromises();
    expect(schedule.selectedDateKey.value).toBe("2026-07-26");
    expect(schedule.weekStartKey.value).toBe("2026-07-20");
    expect(list).toHaveBeenLastCalledWith({ from: "2026-07-20", to: "2026-07-26" });
    wrapper.unmount();
  });
});
