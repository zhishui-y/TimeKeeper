import { describe, expect, it } from "vitest";
import type { RevenueAnalyticsReport } from "../types/domain";
import { buildRevenueAnalyticsInsights, compactRevenueAnalyticsContacts } from "./revenueAnalytics";

function report(): RevenueAnalyticsReport {
  return {
    from: "2026-08-01",
    to: "2026-08-14",
    overview: {
      settledMinor: 20_000,
      unsettledMinor: 5_000,
      pendingCount: 1,
      businessMinutes: 240,
      averageHourlyMinor: 5_000,
      appointmentCount: 4,
      completedCount: 3,
    },
    weeks: [
      {
        from: "2026-07-27",
        to: "2026-08-02",
        settledMinor: 10_000,
        unsettledMinor: 0,
        pendingCount: 0,
        businessMinutes: 120,
        appointmentCount: 2,
        completedCount: 2,
        days: [],
      },
      {
        from: "2026-08-03",
        to: "2026-08-09",
        settledMinor: 10_000,
        unsettledMinor: 5_000,
        pendingCount: 1,
        businessMinutes: 120,
        appointmentCount: 2,
        completedCount: 1,
        days: [],
      },
    ],
    weekdays: Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      label: `周${"一二三四五六日"[index]}`,
      settledMinor: index < 2 ? 10_000 : 0,
      unsettledMinor: 0,
      pendingCount: 0,
      businessMinutes: index < 2 ? 120 : 0,
      appointmentCount: index < 2 ? 2 : 0,
      completedCount: index < 2 ? 1 : 0,
    })),
    hours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      businessMinutes: hour === 9 || hour === 10 ? 120 : 0,
      appointmentCount: hour === 9 || hour === 10 ? 2 : 0,
    })),
    contacts: [
      {
        name: "南枝",
        settledMinor: 10_000,
        revenueShareBps: 5_000,
        appointmentCount: 2,
        settledCount: 1,
        completedCount: 2,
        businessMinutes: 120,
        averageTicketMinor: 10_000,
      },
      {
        name: "小北",
        settledMinor: 10_000,
        revenueShareBps: 5_000,
        appointmentCount: 2,
        settledCount: 1,
        completedCount: 1,
        businessMinutes: 120,
        averageTicketMinor: 10_000,
      },
    ],
    paymentMethods: [{ name: "微信", amountMinor: 20_000, appointmentCount: 2 }],
  };
}

describe("revenueAnalytics", () => {
  it("reports ties explicitly without inventing causal explanations", () => {
    const insights = buildRevenueAnalyticsInsights(report());

    expect(insights).toEqual([
      "已结收益最高周：07-27—08-02、08-03—08-09。",
      "完成工时最高的星期：周一、周二。",
      "工作覆盖最多的小时段：09:00–10:00、10:00–11:00。",
      "已结贡献最高顾客：南枝、小北。",
      "仍有 1 场已完成但未结算，已填写待结金额合计 ¥50。",
    ]);
  });

  it("returns a single honest empty-range insight", () => {
    const empty = report();
    empty.overview.appointmentCount = 0;
    expect(buildRevenueAnalyticsInsights(empty)).toEqual([
      "当前统计范围内没有未取消的业务预约，暂无可比较的经营结论。",
    ]);
  });

  it("keeps the top ten contacts and merges the remainder", () => {
    const contacts = Array.from({ length: 12 }, (_, index) => ({
      name: `顾客${index + 1}`,
      settledMinor: 1_200 - index * 100,
      revenueShareBps: 100,
      appointmentCount: 1,
      settledCount: 1,
      completedCount: 1,
      businessMinutes: 60,
      averageTicketMinor: 1_200 - index * 100,
    }));

    const compact = compactRevenueAnalyticsContacts(contacts);
    expect(compact).toHaveLength(11);
    expect(compact[9]?.name).toBe("顾客10");
    expect(compact[10]).toMatchObject({
      name: "其他 2 位",
      settledMinor: 300,
      appointmentCount: 2,
      businessMinutes: 120,
      averageTicketMinor: 150,
      mergedCount: 2,
    });
  });
});
