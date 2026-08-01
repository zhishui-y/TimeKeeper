import { createRouter, createWebHashHistory } from "vue-router";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "today",
      component: () => import("../views/TodayView.vue"),
      meta: { title: "今日工作台", subtitle: "今天的安排与本周节奏" },
    },
    {
      path: "/calendar",
      name: "calendar",
      component: () => import("../views/CalendarView.vue"),
      meta: { title: "排班日历", subtitle: "点击预约即可查看或编辑安排" },
    },
    {
      path: "/appointments",
      name: "appointments",
      component: () => import("../views/AppointmentsView.vue"),
      meta: { title: "预约记录", subtitle: "查询、结算与回顾每一单" },
    },
    {
      path: "/accounts",
      name: "accounts",
      component: () => import("../views/AccountsView.vue"),
      meta: { title: "账号档案", subtitle: "账号资料与密码库" },
    },
    {
      path: "/revenue",
      name: "revenue",
      component: () => import("../views/RevenueView.vue"),
      meta: { title: "收益总结", subtitle: "按日、周、月复盘收入" },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("../views/SettingsView.vue"),
      meta: { title: "数据与设置", subtitle: "Excel 导入、完整备份与应用设置" },
    },
  ],
});
