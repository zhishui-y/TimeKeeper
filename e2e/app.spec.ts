import { expect, test, type Page } from "@playwright/test";
import { format } from "date-fns";

interface BusinessAppointmentDraft {
  contactName: string;
  startTime: string;
  endTime: string;
  amountYuan: string;
  progressStatus?: "scheduled" | "in_progress" | "pending_settlement" | "completed";
}

async function createBusinessAppointment(
  page: Page,
  serviceDate: string,
  draft: BusinessAppointmentDraft,
): Promise<void> {
  await page.getByRole("button", { name: "新建预约" }).click();
  const drawer = page.getByRole("dialog", { name: /新建预约|编辑预约/ });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("日期 *").fill(serviceDate);
  await drawer.getByLabel("开始时间", { exact: true }).fill(draft.startTime);
  await drawer.getByLabel("结束时间（可留空）", { exact: true }).fill(draft.endTime);
  await drawer.getByLabel("联系人", { exact: true }).fill(draft.contactName);
  await drawer.getByLabel("金额（元）").fill(draft.amountYuan);
  await drawer.getByRole("button", { name: "不使用账号", exact: true }).click();
  if (draft.progressStatus) {
    await drawer.getByLabel("预约进度").selectOption(draft.progressStatus);
  }
  await drawer.getByRole("button", { name: "保存预约" }).click();
  await expect(drawer).toBeHidden();
}

async function readSettledMinor(page: Page): Promise<number> {
  await expect(page.locator(".revenue-dashboard .loading-line")).toHaveCount(0);
  const text = await page.locator(".revenue-metric--primary .mono-number").innerText();
  return Math.round(Number(text.replace(/[^\d.-]/g, "")) * 100);
}

async function expectOnlyGlobalCreateAction(page: Page): Promise<void> {
  const createAction = page.getByRole("button", { name: "新建预约", exact: true });
  await expect(createAction).toHaveCount(1);
  await expect(
    page.locator(".header").getByRole("button", { name: "新建预约", exact: true }),
  ).toHaveCount(1);
}

async function readHashRoute(page: Page): Promise<{
  path: string;
  queryEntries: [string, string][];
}> {
  return page.evaluate(() => {
    const [path = "", search = ""] = globalThis.location.hash.slice(1).split("?");
    return {
      path,
      queryEntries: Array.from(new URLSearchParams(search).entries()),
    };
  });
}

test("核心页面在桌面窗口中可访问且没有横向溢出", async ({ page }) => {
  test.setTimeout(60_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "今日工作台" })).toBeVisible();
  await expectOnlyGlobalCreateAction(page);
  await expect(page.getByRole("button", { name: "记一笔预约", exact: true })).toHaveCount(0);
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

  const lastTodayAppointment = page.locator(".today-list .appointment-row").last();
  if (await lastTodayAppointment.count()) {
    await lastTodayAppointment.scrollIntoViewIfNeeded();
    const lastRowIsVisible = await lastTodayAppointment.evaluate((row) => {
      const body = row.closest<HTMLElement>(".today-list__body");
      if (!body) return false;
      return row.getBoundingClientRect().bottom <= body.getBoundingClientRect().bottom + 0.5;
    });
    expect(lastRowIsVisible).toBe(true);
  }

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
    await expectOnlyGlobalCreateAction(page);
    if (linkName === "预约记录") {
      await expect(page.getByPlaceholder("搜索联系人、内容或账号")).toBeVisible();
      await expect(page.getByLabel("预约模式")).toBeVisible();
      await expect(
        page.locator(".appointments-workspace").getByRole("button", { name: "新建", exact: true }),
      ).toHaveCount(0);
    }
    if (linkName === "数据与设置") {
      const backup = page.locator(".settings-section--backup");
      const notifications = page.locator(".settings-section--notifications");
      await expect(backup).toBeVisible();
      await expect(notifications).toBeVisible();
      const [backupBox, notificationsBox] = await Promise.all([
        backup.boundingBox(),
        notifications.boundingBox(),
      ]);
      expect(backupBox).not.toBeNull();
      expect(notificationsBox).not.toBeNull();
      expect(backupBox!.y + backupBox!.height).toBeLessThanOrEqual(notificationsBox!.y);
    }
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

test("今日待结场次仅传递待结状态且浏览器前进后退可恢复筛选", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "今日工作台" })).toBeVisible();

  await page.getByRole("button", { name: "查看待结算预约", exact: true }).click();

  await expect(page.getByRole("heading", { name: "预约记录", level: 1 })).toBeVisible();
  expect(await readHashRoute(page)).toEqual({
    path: "/appointments",
    queryEntries: [["progressStatus", "pending_settlement"]],
  });
  await expect(page.getByLabel("开始日期")).toHaveValue("");
  await expect(page.getByLabel("结束日期")).toHaveValue("");
  await expect(page.getByLabel("预约模式").locator("option:checked")).toHaveText("全部模式");
  await expect(page.getByLabel("预约进度")).toHaveValue("pending_settlement");

  await page.goBack();
  await expect(page.getByRole("heading", { name: "今日工作台", level: 1 })).toBeVisible();

  await page.goForward();
  await expect(page.getByRole("heading", { name: "预约记录", level: 1 })).toBeVisible();
  expect(await readHashRoute(page)).toEqual({
    path: "/appointments",
    queryEntries: [["progressStatus", "pending_settlement"]],
  });
  await expect(page.getByLabel("预约进度")).toHaveValue("pending_settlement");
});

test("收益待结场次使用最后成功报表的日期范围过滤预约", async ({ page }) => {
  await page.goto("/#/revenue");
  await expect(page.getByRole("heading", { name: "收益总结", level: 1 })).toBeVisible();

  const pendingAction = page.getByRole("button", {
    name: "查看当前统计范围内的待结算预约",
    exact: true,
  });
  await expect(pendingAction).toBeEnabled();
  const rangeLabel = (await page.locator(".range-navigator__actual").innerText()).trim();
  const rangeMatch = rangeLabel.match(/^(\d{4}-\d{2}-\d{2}) — (\d{4}-\d{2}-\d{2})$/);
  if (!rangeMatch?.[1] || !rangeMatch[2]) {
    throw new Error(`收益页未显示有效的实际统计范围：${rangeLabel}`);
  }
  const [, from, to] = rangeMatch;

  await pendingAction.click();

  await expect(page.getByRole("heading", { name: "预约记录", level: 1 })).toBeVisible();
  const route = await readHashRoute(page);
  expect(route.path).toBe("/appointments");
  expect(route.queryEntries).toHaveLength(3);
  expect(Object.fromEntries(route.queryEntries)).toEqual({
    from,
    to,
    progressStatus: "pending_settlement",
  });
  await expect(page.getByLabel("开始日期")).toHaveValue(from);
  await expect(page.getByLabel("结束日期")).toHaveValue(to);
  await expect(page.getByLabel("预约进度")).toHaveValue("pending_settlement");
});

test("收益周明细可下钻到当日并恢复键盘焦点", async ({ page }) => {
  await page.goto("/#/revenue");
  await expect(page.getByRole("heading", { name: "收益总结", level: 1 })).toBeVisible();

  const grouping = page.getByLabel("趋势分组");
  const weeklyGrouping = grouping.getByRole("button", { name: "周", exact: true });
  await weeklyGrouping.click();
  await expect(weeklyGrouping).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".revenue-dashboard .loading-line")).toHaveCount(0);
  await weeklyGrouping.focus();

  const canvas = page.locator(".revenue-chart canvas");
  await expect(canvas).toBeVisible();
  const chartBox = await canvas.boundingBox();
  if (!chartBox) throw new Error("收益趋势图未生成可点击画布");
  await canvas.click({
    position: {
      x: chartBox.width / 2 + 17,
      y: chartBox.height - 46,
    },
  });

  const detail = page.locator("aside.period-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("heading", { name: "周收入明细" })).toBeVisible();
  expect(await detail.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  const dayRow = detail.locator(".daily-table__row:not(:disabled)").first();
  await dayRow.click();
  await expect(detail.getByRole("heading", { name: "当日预约明细" })).toBeVisible();
  const backButton = detail.getByRole("button", { name: "返回周收入明细" });
  await expect(backButton).toBeFocused();

  await backButton.click();
  await expect(detail.getByRole("heading", { name: "周收入明细" })).toBeVisible();
  await expect(dayRow).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await expect(page.locator(".revenue-chart")).toBeFocused();
});

test("预约抽屉圈定键盘焦点并可用 Escape 关闭", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "新建预约", exact: true });
  await trigger.click();

  const drawer = page.getByRole("dialog", { name: "新建预约" });
  await expect(drawer).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.querySelector<HTMLElement>("#app")?.inert)))
    .toBe(true);
  expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  for (let index = 0; index < 5; index += 1) await page.keyboard.press("Tab");
  expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("应用全局阻止浏览器右键菜单", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建预约", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "新建预约" });
  await expect(drawer).toBeVisible();

  const contextMenuPrevented = await drawer.evaluate((element) => {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });

  expect(contextMenuPrevented).toBe(true);
});

test("排班日历显示完整起止时间且时间标签未被截断", async ({ page }) => {
  await page.goto("/#/calendar");

  const timeLabels = page
    .locator(".calendar-event-card__time")
    .filter({ hasText: /\d{2}:\d{2}.*\d{2}:\d{2}/ });
  await expect(timeLabels.first()).toBeVisible();

  const clippedLabels = await timeLabels.evaluateAll((elements) =>
    elements
      .filter((element) => element.scrollWidth > element.clientWidth)
      .map((element) => element.textContent?.trim()),
  );
  expect(clippedLabels).toEqual([]);
  await expect(page.locator(".fc-event-draggable")).toHaveCount(0);
  await expect(page.locator(".fc-event-resizable")).toHaveCount(0);
});

test("账号档案可通过左侧手柄拖动排序", async ({ page }) => {
  await page.goto("/#/accounts");

  const rows = page.locator(".account-table tbody tr");
  const originalFirstAccount = await rows
    .first()
    .getByRole("button", { name: /复制账号 / })
    .getAttribute("aria-label");
  const sourceHandle = rows.first().getByRole("button", { name: /拖动账号.+调整顺序/ });
  const targetHandle = rows.last().getByRole("button", { name: /拖动账号.+调整顺序/ });

  await sourceHandle.dragTo(targetHandle);

  await expect(rows.first().getByRole("button", { name: /复制账号 / })).not.toHaveAttribute(
    "aria-label",
    originalFirstAccount!,
  );
  await expect(page.getByRole("status")).toContainText("账号顺序已保存");
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
  await page.getByRole("button", { name: "立即锁定", exact: true }).click();

  const accessGate = page.getByRole("dialog", { name: "解锁时约管家" });
  await expect(accessGate).toBeVisible();
  await accessGate.getByLabel("入口密码", { exact: true }).fill("demo");
  await accessGate.getByRole("button", { name: "进入", exact: true }).click();
  await expect(accessGate).toBeHidden();

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
  await expect(targetRow).toContainText("已预约");
  await targetRow.getByRole("button", { name: "编辑预约" }).click();
  const progressDrawer = page.getByRole("dialog", { name: "编辑预约" });
  await progressDrawer.getByLabel("预约进度").selectOption("in_progress");
  await progressDrawer.getByRole("button", { name: "保存预约" }).click();
  await expect(progressDrawer).toBeHidden();
  await expect(targetRow).toContainText("进行中");
  await targetRow.getByRole("button", { name: "完成预约" }).click();
  await expect(targetRow).toContainText("待结算");

  await targetRow.getByRole("button", { name: "编辑结算" }).click();
  const settlementDrawer = page.getByRole("dialog", { name: "编辑预约" });
  await expect(settlementDrawer.getByLabel("金额（元）")).toBeFocused();
  await settlementDrawer.getByLabel("预约进度").selectOption("completed");
  await settlementDrawer.getByLabel("收款方式").fill("微信");
  await settlementDrawer.getByRole("button", { name: "保存预约" }).click();
  await expect(settlementDrawer).toBeHidden();
  await expect(page.getByRole("status")).toContainText("已完成；该预约仍与");
  await expect(targetRow).toContainText("已完成");

  await page.getByRole("link", { name: "收益总结" }).click();
  await expect.poll(() => readSettledMinor(page)).toBe(baselineSettledMinor + targetAmountMinor);

  await createBusinessAppointment(page, today, {
    contactName: "收益页热更新",
    startTime: "11:00",
    endTime: "12:00",
    amountYuan: "1.23",
    progressStatus: "completed",
  });
  const settledAfterLiveRefresh = baselineSettledMinor + targetAmountMinor + liveRefreshAmountMinor;
  await expect.poll(() => readSettledMinor(page)).toBe(settledAfterLiveRefresh);

  await page.getByRole("link", { name: "数据与设置" }).click();
  await page.getByRole("button", { name: "导出完整备份" }).click();
  await expect(page.getByRole("status")).toContainText("完整备份已创建");
  await expect(page.locator(".backup-result")).toContainText("TimeKeeper-demo.tkbackup");

  await page.getByRole("link", { name: "预约记录" }).click();
  const tableRow = page.locator("tbody tr").filter({ hasText: "闭环验收目标" });
  await tableRow.getByRole("button", { name: "删除", exact: true }).click();
  const deleteDialog = page.getByRole("dialog", { name: "处理预约记录" });
  await deleteDialog.getByRole("button", { name: "取消预约", exact: true }).click();
  await expect(tableRow).toContainText("已取消");

  await page.getByRole("link", { name: "收益总结" }).click();
  await expect.poll(() => readSettledMinor(page)).toBe(settledAfterLiveRefresh - targetAmountMinor);

  await page.getByRole("link", { name: "数据与设置" }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "从备份恢复" }).click();

  await expect(accessGate).toBeVisible();
  await accessGate.getByLabel("入口密码", { exact: true }).fill("demo");
  await accessGate.getByRole("button", { name: "进入", exact: true }).click();
  await expect(accessGate).toBeHidden();

  await page.getByRole("link", { name: "预约记录" }).click();
  const restoredRow = page.locator("tbody tr").filter({ hasText: "闭环验收目标" });
  await expect(restoredRow).toContainText("已完成");
  await expect(restoredRow).not.toContainText("已取消");

  await page.getByRole("link", { name: "收益总结" }).click();
  await expect.poll(() => readSettledMinor(page)).toBe(settledAfterLiveRefresh);
});
