import { expect, test, type Page } from "@playwright/test";
import { format } from "date-fns";

interface BusinessAppointmentDraft {
  contactName: string;
  startTime: string;
  endTime: string;
  amountYuan: string;
  serviceStatus?: "scheduled" | "completed";
  settlementStatus?: "unsettled" | "settled";
}

async function createBusinessAppointment(
  page: Page,
  serviceDate: string,
  draft: BusinessAppointmentDraft,
): Promise<void> {
  await page.getByRole("button", { name: "新建预约" }).click();
  const drawer = page.getByRole("complementary", { name: "预约编辑" });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("日期 *").fill(serviceDate);
  await drawer.getByLabel("开始时间").fill(draft.startTime);
  await drawer.getByLabel("结束时间").fill(draft.endTime);
  await drawer.getByLabel("联系人 *").fill(draft.contactName);
  await drawer.getByLabel("金额（元）").fill(draft.amountYuan);
  if (draft.serviceStatus) {
    await drawer.getByLabel("预约进度").selectOption(draft.serviceStatus);
  }
  if (draft.settlementStatus) {
    await drawer.getByLabel("结算状态").selectOption(draft.settlementStatus);
  }
  await drawer.getByRole("button", { name: "保存预约" }).click();
  await expect(drawer).toBeHidden();
}

async function readSettledMinor(page: Page): Promise<number> {
  await expect(page.locator(".revenue-dashboard .loading-line")).toHaveCount(0);
  const text = await page.locator(".revenue-metric--primary .mono-number").innerText();
  return Math.round(Number(text.replace(/[^\d.-]/g, "")) * 100);
}

test("核心页面在桌面窗口中可访问且没有横向溢出", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "今日工作台" })).toBeVisible();
  const dateHeading = page.getByRole("heading", { name: /今天 · \d+月\d+日 星期/ });
  await expect(dateHeading).toBeVisible();
  expect(await dateHeading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  const nextCountdown = page.locator(".metric--next strong");
  expect(
    await nextCountdown.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  const weekContentIsClipped = await page.locator(".week-schedule").evaluate((schedule) => {
    const scheduleBounds = schedule.getBoundingClientRect();
    return Array.from(schedule.querySelectorAll<HTMLElement>(".schedule-chip, .week-day__more"))
      .filter((element) => {
        const style = globalThis.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .some((element) => element.getBoundingClientRect().bottom > scheduleBounds.bottom + 0.5);
  });
  expect(weekContentIsClipped).toBe(false);

  const routes = [
    ["排班日历", "排班日历"],
    ["预约记录", "预约记录"],
    ["账号档案", "账号档案"],
    ["收益总结", "收益总结"],
    ["数据与设置", "数据与设置"],
  ] as const;

  for (const [linkName, headingName] of routes) {
    await page.getByRole("link", { name: linkName }).click();
    await expect(page.getByRole("heading", { name: headingName, level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }

  await expect(page.getByRole("heading", { name: "Excel 账本导入" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出完整备份" })).toBeVisible();
  await expect(page.getByRole("button", { name: "从备份恢复" })).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("娱乐预约不会显示账单字段", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建预约" }).click();
  await expect(page.getByRole("heading", { name: "账单信息" })).toBeVisible();

  await page.getByRole("button", { name: /娱乐模式/ }).click();
  await expect(page.getByRole("heading", { name: "账单信息" })).toBeHidden();
  await expect(page.getByRole("button", { name: "保存预约" })).toBeVisible();
});

test("完整业务流程可从解锁走到收益与备份恢复", async ({ page }) => {
  test.setTimeout(60_000);
  const today = format(new Date(), "yyyy-MM-dd");
  const targetAmountMinor = 28_888;
  const liveRefreshAmountMinor = 123;

  await page.goto("/");
  await page.getByRole("link", { name: "数据与设置" }).click();
  await page.getByRole("button", { name: "立即锁定" }).click();

  const vaultGate = page.locator(".vault-gate");
  await expect(vaultGate.getByRole("heading", { name: "解锁时约管家" })).toBeVisible();
  await vaultGate.getByLabel("主密码").fill("demo-master-password");
  await vaultGate.getByRole("button", { name: "解锁", exact: true }).click();
  await expect(vaultGate).toBeHidden();

  await page.getByRole("link", { name: "收益总结" }).click();
  const baselineSettledMinor = await readSettledMinor(page);

  await page.getByRole("link", { name: "今日", exact: true }).click();
  await createBusinessAppointment(page, today, {
    contactName: "闭环冲突基准",
    startTime: "09:00",
    endTime: "10:00",
    amountYuan: "100",
  });
  await expect(page.getByRole("status")).toContainText("预约已创建");

  await createBusinessAppointment(page, today, {
    contactName: "闭环验收目标",
    startTime: "09:30",
    endTime: "10:30",
    amountYuan: "288.88",
  });
  await expect(page.getByRole("status")).toContainText(/已保存；与 \d+ 条预约存在时间重叠/);

  const targetRow = page.locator("article.appointment-row").filter({ hasText: "闭环验收目标" });
  await expect(targetRow).toContainText("待结算");
  await targetRow.getByRole("button", { name: "开始预约" }).click();
  await expect(targetRow).toContainText("进行中");
  await targetRow.getByRole("button", { name: "完成预约" }).click();
  await expect(targetRow).toContainText("已完成");
  await expect(targetRow).toContainText("待结算");

  await targetRow.getByRole("button", { name: "编辑结算" }).click();
  const settlementDrawer = page.getByRole("complementary", { name: "预约编辑" });
  await settlementDrawer.getByLabel("结算状态").selectOption("settled");
  await settlementDrawer.getByLabel("收款方式").fill("微信");
  await settlementDrawer.getByRole("button", { name: "保存预约" }).click();
  await expect(settlementDrawer).toBeHidden();
  await expect(page.getByRole("status")).toContainText("已结算；该预约仍与");
  await expect(targetRow).toContainText("已结算");

  await page.getByRole("link", { name: "收益总结" }).click();
  await expect.poll(() => readSettledMinor(page)).toBe(baselineSettledMinor + targetAmountMinor);

  await createBusinessAppointment(page, today, {
    contactName: "收益页热更新",
    startTime: "11:00",
    endTime: "12:00",
    amountYuan: "1.23",
    serviceStatus: "completed",
    settlementStatus: "settled",
  });
  const settledAfterLiveRefresh = baselineSettledMinor + targetAmountMinor + liveRefreshAmountMinor;
  await expect.poll(() => readSettledMinor(page)).toBe(settledAfterLiveRefresh);

  await page.getByRole("link", { name: "数据与设置" }).click();
  await page.getByRole("button", { name: "导出完整备份" }).click();
  await expect(page.getByRole("status")).toContainText("完整备份已创建");
  await expect(page.locator(".backup-result")).toContainText("TimeKeeper-demo.tkbackup");

  await page.getByRole("link", { name: "预约记录" }).click();
  const tableRow = page.locator("tbody tr").filter({ hasText: "闭环验收目标" });
  await tableRow.getByRole("button", { name: "取消预约" }).click();
  await expect(tableRow).toContainText("已取消");

  await page.getByRole("link", { name: "收益总结" }).click();
  await expect.poll(() => readSettledMinor(page)).toBe(settledAfterLiveRefresh - targetAmountMinor);

  await page.getByRole("link", { name: "数据与设置" }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "从备份恢复" }).click();
  await expect(page.getByRole("status")).toContainText("备份校验与恢复流程已完成");

  await expect(vaultGate.getByRole("heading", { name: "解锁时约管家" })).toBeVisible();
  await vaultGate.getByLabel("主密码").fill("demo-master-password");
  await vaultGate.getByRole("button", { name: "解锁", exact: true }).click();
  await expect(vaultGate).toBeHidden();

  await page.getByRole("link", { name: "预约记录" }).click();
  const restoredRow = page.locator("tbody tr").filter({ hasText: "闭环验收目标" });
  await expect(restoredRow).toContainText("已完成");
  await expect(restoredRow).toContainText("已结算");
  await expect(restoredRow).not.toContainText("已取消");

  await page.getByRole("link", { name: "收益总结" }).click();
  await expect.poll(() => readSettledMinor(page)).toBe(settledAfterLiveRefresh);
});
