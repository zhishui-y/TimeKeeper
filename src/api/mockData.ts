import type { AccountProfile, Appointment } from "../types/domain";
import {
  addDateKeyDays,
  chinaCivilDateTime,
  chinaDateKey,
  endOfChinaWeek,
  startOfChinaWeek,
} from "../utils/chinaDateTime";

const now = new Date();
const today = chinaDateKey(now);
const weekStart = startOfChinaWeek(today);
const currentChinaHour = Number(chinaCivilDateTime(now).slice(11, 13));

function at(date: string, time: string): string {
  return `${date}T${time}:00`;
}

const createdAt = new Date(now.getTime() - 36 * 86_400_000).toISOString();

export const demoAccounts: AccountProfile[] = [
  {
    id: "account-1",
    contactName: "南枝",
    server: "梦江南",
    characterName: "照野",
    specialization: "无方",
    gearScore: "19.8万",
    accountName: "nanzhi_0217",
    password: "Nanzhi#2026",
    currentScore: 2680,
    highestScore: 2912,
    scoreUpdatedAt: today,
    weeklyWins: 5,
    notes: "晚间优先，赛季末冲分",
    needsReview: false,
    createdAt,
    updatedAt: now.toISOString(),
  },
  {
    id: "account-2",
    contactName: "阿迟",
    server: "唯我独尊",
    characterName: "鹤归",
    specialization: "紫霞",
    gearScore: "18.6万",
    accountName: "latecloud_77",
    password: "LateCloud@77",
    currentScore: 2415,
    highestScore: 2630,
    scoreUpdatedAt: addDateKeyDays(today, -2),
    weeklyWins: 3,
    notes: "不接凌晨时段",
    needsReview: false,
    createdAt,
    updatedAt: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
  },
  {
    id: "account-3",
    contactName: "小北",
    server: "乾坤一掷",
    characterName: "未补充",
    specialization: "太虚",
    gearScore: null,
    accountName: "beibei_game",
    password: "BeiBei-Game",
    currentScore: 1980,
    highestScore: 2120,
    scoreUpdatedAt: addDateKeyDays(today, -8),
    weeklyWins: null,
    notes: "由旧账本导入，角色信息待确认",
    needsReview: true,
    createdAt,
    updatedAt: new Date(now.getTime() - 8 * 86_400_000).toISOString(),
  },
  {
    id: "account-4",
    contactName: "青禾",
    server: "剑胆琴心",
    characterName: "听雨",
    specialization: "铁骨",
    gearScore: "20.1万",
    accountName: "qinghe_09",
    password: "Qinghe_09!",
    currentScore: 3050,
    highestScore: 3186,
    scoreUpdatedAt: addDateKeyDays(today, -1),
    weeklyWins: 1,
    notes: null,
    needsReview: false,
    createdAt,
    updatedAt: new Date(now.getTime() - 86_400_000).toISOString(),
  },
];

interface DemoAppointmentInput {
  id: string;
  day: string;
  start?: string;
  end?: string;
  contact: string;
  content: string;
  mode?: Appointment["mode"];
  serviceStatus?: Appointment["serviceStatus"];
  settlementStatus?: Appointment["settlementStatus"];
  accountId?: string;
  amount?: number;
  paymentMethod?: string;
  note?: string;
}

function appointment(input: DemoAppointmentInput): Appointment {
  const serviceDate = input.day;
  const account = demoAccounts.find((item) => item.id === input.accountId);
  const mode = input.mode ?? "business";
  const endDate =
    input.start && input.end && input.end <= input.start
      ? addDateKeyDays(serviceDate, 1)
      : serviceDate;
  return {
    id: input.id,
    serviceDate,
    startsAt: input.start ? at(serviceDate, input.start) : null,
    endsAt: input.end ? at(endDate, input.end) : null,
    contactName: input.contact,
    content: input.content,
    mode,
    serviceStatus: input.serviceStatus ?? "scheduled",
    settlementStatus:
      mode === "entertainment" ? "not_applicable" : (input.settlementStatus ?? "unsettled"),
    account: account
      ? {
          source: "profile",
          characterName: account.characterName,
          accountName: account.accountName,
          server: account.server,
          specialization: account.specialization,
          gearScore: account.gearScore,
          password: account.password,
        }
      : null,
    rateNote: input.amount ? "按小时计费" : null,
    paymentMethod: input.paymentMethod ?? null,
    amountMinor: input.amount ?? null,
    reminderMinutes: 30,
    voicePlatform: null,
    voiceChannel: null,
    notes: input.note ?? null,
    createdAt,
    updatedAt: now.toISOString(),
  };
}

export const demoAppointments: Appointment[] = [
  appointment({
    id: "appt-1",
    day: weekStart,
    start: "14:00",
    end: "16:00",
    contact: "青禾",
    content: "竞技场冲分",
    accountId: "account-4",
    serviceStatus: "completed",
    settlementStatus: "settled",
    amount: 36000,
    paymentMethod: "支付宝",
  }),
  appointment({
    id: "appt-2",
    day: addDateKeyDays(weekStart, 1),
    start: "19:30",
    end: "22:00",
    contact: "南枝",
    content: "赛季陪练",
    accountId: "account-1",
    serviceStatus: "completed",
    settlementStatus: "settled",
    amount: 45000,
    paymentMethod: "微信",
  }),
  appointment({
    id: "appt-3",
    day: addDateKeyDays(weekStart, 2),
    start: "21:00",
    end: "23:30",
    contact: "阿迟",
    content: "竞技场上分",
    accountId: "account-2",
    serviceStatus: "completed",
    settlementStatus: "unsettled",
    amount: 42000,
    paymentMethod: "QQ",
  }),
  appointment({
    id: "appt-4",
    day: today,
    start: "13:30",
    end: "15:00",
    contact: "小北",
    content: "日常清体力",
    accountId: "account-3",
    serviceStatus:
      currentChinaHour >= 15 ? "completed" : currentChinaHour >= 13 ? "in_progress" : "scheduled",
    settlementStatus: "unsettled",
    amount: 18000,
  }),
  appointment({
    id: "appt-5",
    day: today,
    start: "19:00",
    end: "21:00",
    contact: "南枝",
    content: "赛季冲分",
    accountId: "account-1",
    amount: 36000,
    paymentMethod: "微信",
  }),
  appointment({
    id: "appt-6",
    day: today,
    start: "22:00",
    end: "23:30",
    contact: "青禾",
    content: "朋友娱乐局",
    accountId: "account-4",
    mode: "entertainment",
  }),
  appointment({
    id: "appt-7",
    day: addDateKeyDays(today, 1),
    start: "15:00",
    end: "17:00",
    contact: "阿迟",
    content: "手法陪练",
    accountId: "account-2",
    amount: 30000,
  }),
  appointment({
    id: "appt-8",
    day: addDateKeyDays(today, 2),
    start: "20:00",
    end: "23:00",
    contact: "南枝",
    content: "竞技场冲分",
    accountId: "account-1",
    amount: 54000,
  }),
  appointment({
    id: "appt-9",
    day: addDateKeyDays(today, 3),
    contact: "小北",
    content: "时间待确认",
    accountId: "account-3",
    amount: 24000,
  }),
  appointment({
    id: "appt-10",
    day: addDateKeyDays(today, 4),
    start: "23:00",
    end: "01:00",
    contact: "青禾",
    content: "跨夜赛季单",
    accountId: "account-4",
    amount: 38000,
    note: "结束时间为次日",
  }),
  appointment({
    id: "appt-11",
    day: addDateKeyDays(weekStart, -3),
    start: "18:00",
    end: "20:00",
    contact: "南枝",
    content: "竞技场复盘",
    accountId: "account-1",
    serviceStatus: "completed",
    settlementStatus: "settled",
    amount: 32000,
    paymentMethod: "支付宝",
  }),
  appointment({
    id: "appt-12",
    day: endOfChinaWeek(today),
    start: "20:30",
    end: "23:30",
    contact: "阿迟",
    content: "周末冲分",
    accountId: "account-2",
    amount: 52000,
  }),
];

// Ensure the next appointment is visible even when the demo is opened late at night.
if (!demoAppointments.some((item) => item.serviceDate > today)) {
  demoAppointments.push(
    appointment({
      id: "appt-next",
      day: addDateKeyDays(today, 1),
      start: "15:00",
      end: "17:00",
      contact: "南枝",
      content: "预约提醒演示",
      accountId: "account-1",
      amount: 36000,
    }),
  );
}
