import type {
  RevenueAnalyticsContact,
  RevenueAnalyticsReport,
  RevenueAnalyticsWeek,
} from "../types/domain";
import type { DeepReadonly } from "vue";
import { formatCurrency } from "./formatters";

export interface RevenueAnalyticsContactRow extends RevenueAnalyticsContact {
  mergedCount: number;
}

export function formatBusinessHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`;
}

function weekLabel(week: DeepReadonly<RevenueAnalyticsWeek>): string {
  return `${week.from.slice(5)}—${week.to.slice(5)}`;
}

function tiedNames<T>(items: readonly T[], value: (item: T) => number, name: (item: T) => string) {
  const maximum = Math.max(...items.map(value));
  if (maximum <= 0) return [];
  return items.filter((item) => value(item) === maximum).map(name);
}

export function buildRevenueAnalyticsInsights(
  report: DeepReadonly<RevenueAnalyticsReport>,
): string[] {
  if (report.overview.appointmentCount === 0) {
    return ["当前统计范围内没有未取消的业务预约，暂无可比较的经营结论。"];
  }

  const insights: string[] = [];
  const bestWeeks = tiedNames(report.weeks, (week) => week.settledMinor, weekLabel);
  insights.push(
    bestWeeks.length
      ? `已结收益最高周：${bestWeeks.join("、")}。`
      : "当前范围没有已结收益，暂时无法判断收益最高周。",
  );

  const busiestWeekdays = tiedNames(
    report.weekdays,
    (weekday) => weekday.businessMinutes,
    (weekday) => weekday.label,
  );
  insights.push(
    busiestWeekdays.length
      ? `完成工时最高的星期：${busiestWeekdays.join("、")}。`
      : "没有带完整起止时间的已完成预约，暂时无法判断星期工时高峰。",
  );

  const busiestHours = tiedNames(
    report.hours,
    (hour) => hour.businessMinutes,
    (hour) =>
      `${String(hour.hour).padStart(2, "0")}:00–${String((hour.hour + 1) % 24).padStart(2, "0")}:00`,
  );
  insights.push(
    busiestHours.length
      ? `工作覆盖最多的小时段：${busiestHours.join("、")}。`
      : "没有可用于小时分布的完成工时。",
  );

  const topContacts = tiedNames(
    report.contacts,
    (contact) => contact.settledMinor,
    (contact) => contact.name,
  );
  insights.push(
    topContacts.length
      ? `已结贡献最高顾客：${topContacts.join("、")}。`
      : "当前范围没有已结顾客贡献。",
  );

  insights.push(
    report.overview.pendingCount > 0
      ? `仍有 ${report.overview.pendingCount} 场已完成但未结算，已填写待结金额合计 ${formatCurrency(report.overview.unsettledMinor)}。`
      : "当前范围没有已完成但未结算的业务预约。",
  );
  return insights;
}

export function compactRevenueAnalyticsContacts(
  contacts: DeepReadonly<RevenueAnalyticsContact[]>,
  limit = 10,
): RevenueAnalyticsContactRow[] {
  const visible = contacts.slice(0, limit).map((contact) => ({ ...contact, mergedCount: 1 }));
  const rest = contacts.slice(limit);
  if (!rest.length) return visible;

  const total = rest.reduce(
    (result, contact) => ({
      settledMinor: result.settledMinor + contact.settledMinor,
      revenueShareBps: result.revenueShareBps + contact.revenueShareBps,
      appointmentCount: result.appointmentCount + contact.appointmentCount,
      settledCount: result.settledCount + contact.settledCount,
      completedCount: result.completedCount + contact.completedCount,
      businessMinutes: result.businessMinutes + contact.businessMinutes,
    }),
    {
      settledMinor: 0,
      revenueShareBps: 0,
      appointmentCount: 0,
      settledCount: 0,
      completedCount: 0,
      businessMinutes: 0,
    },
  );
  visible.push({
    name: `其他 ${rest.length} 位`,
    ...total,
    averageTicketMinor:
      total.settledCount > 0 ? Math.round(total.settledMinor / total.settledCount) : 0,
    mergedCount: rest.length,
  });
  return visible;
}
