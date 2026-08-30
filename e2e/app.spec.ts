import { expect, test, type Page } from "@playwright/test";
import { chinaDateKey, startOfChinaWeek } from "./china-date";

interface BusinessAppointmentDraft {
  contactName: string;
  startTime: string;
  endTime: string;
  amountYuan: string;
  serviceStatus?: "scheduled" | "in_progress" | "completed" | "cancelled";
  settlementStatus?: "unsettled" | "settled";
}

const progressStatusLabels = {
  scheduled: "已预约",
  in_progress: "进行中",
  pending_settlement: "待结算",
  completed: "完成",
  cancelled: "已取消",
} as const;

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
  await drawer.locator(".account-kind__item", { hasText: "不使用账号" }).click();
  if (draft.serviceStatus) {
    const progressStatus =
      draft.serviceStatus === "completed"
        ? draft.settlementStatus === "settled"
          ? "completed"
          : "pending_settlement"
        : draft.serviceStatus;
    await drawer.getByRole("radio", { name: progressStatusLabels[progressStatus] }).check();
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

async function expectIndependentWeekDayScrolling(page: Page): Promise<void> {
  const tracks = page.locator(".week-day__track");
  await expect(tracks).toHaveCount(7);

  const trackIndexes = await tracks.evaluateAll((elements) => {
    const overflowByIndex = elements.map((element) => element.scrollHeight - element.clientHeight);
    const largestOverflow = Math.max(...overflowByIndex);
    const appointmentCounts = elements.map(
      (element) => element.querySelectorAll(".schedule-chip").length,
    );
    return {
      overflow: largestOverflow > 0 ? overflowByIndex.indexOf(largestOverflow) : -1,
      populated: appointmentCounts.indexOf(Math.max(...appointmentCounts)),
    };
  });
  expect(trackIndexes.populated, "演示数据应至少包含一天预约").toBeGreaterThanOrEqual(0);

  const targetIndex = trackIndexes.overflow >= 0 ? trackIndexes.overflow : trackIndexes.populated;
  const targetTrack = tracks.nth(targetIndex);
  const scrollbarStyles = await tracks.evaluateAll((elements) => {
    return elements.map((element) => {
      const style = globalThis.getComputedStyle(element);
      const webkitScrollbar = globalThis.getComputedStyle(element, "::-webkit-scrollbar");
      return {
        overflowY: style.overflowY,
        scrollbarWidth: style.scrollbarWidth,
        webkitWidth: webkitScrollbar.width,
        webkitHeight: webkitScrollbar.height,
      };
    });
  });
  for (const style of scrollbarStyles) {
    expect(style.overflowY).toBe("auto");
    expect(style.scrollbarWidth).toBe("none");
    expect(Number.parseFloat(style.webkitWidth || "0")).toBe(0);
    expect(Number.parseFloat(style.webkitHeight || "0")).toBe(0);
  }

  if (trackIndexes.overflow >= 0) {
    const before = await tracks.evaluateAll((elements) =>
      elements.map((element) => element.scrollTop),
    );
    await targetTrack.hover();
    await page.mouse.wheel(0, 800);
    await expect
      .poll(() => targetTrack.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(before[targetIndex] ?? 0);

    const after = await tracks.evaluateAll((elements) =>
      elements.map((element) => element.scrollTop),
    );
    for (const [index, scrollTop] of after.entries()) {
      if (index !== targetIndex) expect(scrollTop).toBe(before[index]);
    }
  }

  const lastAppointment = targetTrack.locator(".schedule-chip").last();
  await expect(lastAppointment).toBeVisible();
  expect(
    await lastAppointment.evaluate((appointment) => {
      const track = appointment.closest<HTMLElement>(".week-day__track");
      if (!track) return false;
      const appointmentBounds = appointment.getBoundingClientRect();
      const trackBounds = track.getBoundingClientRect();
      return (
        appointmentBounds.top >= trackBounds.top - 0.5 &&
        appointmentBounds.bottom <= trackBounds.bottom + 0.5
      );
    }),
  ).toBe(true);

  await lastAppointment.click({ position: { x: 16, y: 16 } });
  const drawer = page.getByRole("dialog", { name: "编辑预约" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(drawer).toBeHidden();
}

async function calendarShowsDefaultTimedRange(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".calendar-board__canvas");
    const body = document.querySelector<HTMLElement>(".fc-timegrid-body");
    const scroller = body?.closest<HTMLElement>(".fc-scroller");
    const noon = body?.querySelector<HTMLElement>('.fc-timegrid-slot-lane[data-time="12:00:00"]');
    const one = body?.querySelector<HTMLElement>('.fc-timegrid-slot-lane[data-time="01:00:00"]');
    const oneThirty = body?.querySelector<HTMLElement>(
      '.fc-timegrid-slot-lane[data-time="01:30:00"]',
    );
    if (
      !canvas?.style.getPropertyValue("--calendar-slot-height") ||
      !scroller ||
      !noon ||
      !one ||
      !oneThirty
    ) {
      return false;
    }

    const scrollerTop = scroller.getBoundingClientRect().top;
    const viewportBottom = scrollerTop + scroller.clientHeight;
    const noonBounds = noon.getBoundingClientRect();
    const oneBounds = one.getBoundingClientRect();
    const oneThirtyBounds = oneThirty.getBoundingClientRect();
    return (
      Math.abs(noonBounds.top - scrollerTop) <= 2 &&
      Math.abs(oneBounds.bottom - viewportBottom) <= 2 &&
      oneThirtyBounds.top >= viewportBottom - 1
    );
  });
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
  const dateHeading = page.getByRole("heading", { name: /今天 · \d+月\d+日 周[一二三四五六日]/ });
  await expect(dateHeading).toBeVisible();
  expect(await dateHeading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  const nextCountdown = page.locator(".metric--next strong");
  expect(
    await nextCountdown.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await expectIndependentWeekDayScrolling(page);

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
      await expect(page.getByPlaceholder("搜索联系人、内容、账号、YY频道或备注")).toBeVisible();
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
  const canvasElement = await canvas.elementHandle();
  if (!canvasElement) throw new Error("收益趋势图画布节点不存在");
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
  expect(await canvas.evaluate((element, original) => element === original, canvasElement)).toBe(
    true,
  );
  expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
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
  const keyboardStatus = page.locator(".revenue-chart__keyboard-status");
  await page.keyboard.press("End");
  await expect(keyboardStatus).toBeVisible();
  await expect(keyboardStatus).toContainText("当前：");
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

test("排班日历隐私开关只保留时间并且仍可打开预约", async ({ page }) => {
  await page.goto("/#/calendar");
  const contact = (
    await page.locator(".calendar-event-card__contact").first().textContent()
  )?.trim();
  expect(contact).toBeTruthy();

  await page.getByRole("button", { name: "隐藏预约详情" }).click();
  await expect(page.locator(".calendar-event-card__private-time").first()).toBeVisible();
  await expect(page.locator(".calendar-event-card__contact")).toHaveCount(0);
  await expect(page.locator(".calendar-event-card__content")).toHaveCount(0);
  await expect(page.locator(".calendar-event-card__progress")).toHaveCount(0);
  await expect(page.locator(".appointment-event--private").first()).not.toHaveAttribute("title");
  await expect(page.locator(".fc-event[class*='appointment-event--business']")).toHaveCount(0);
  await expect(page.locator(".fc-event[class*='appointment-event--scheduled']")).toHaveCount(0);
  await expect(page.locator(".calendar-day-heading__count")).toHaveCount(0);
  expect(
    (await page.locator(".appointment-event--private").first().getAttribute("aria-label")) ?? "",
  ).not.toContain(contact!);

  await page.locator(".appointment-event--private").first().click();
  await expect(page.getByRole("dialog", { name: "编辑预约" })).toBeVisible();
  await page
    .getByRole("dialog", { name: "编辑预约" })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("link", { name: "今日", exact: true }).click();
  await page.getByRole("link", { name: "排班日历" }).click();
  await expect(page.getByRole("button", { name: "隐藏预约详情" })).toBeVisible();
  await expect(page.locator(".calendar-event-card__contact").first()).toBeVisible();
});

test("排班日历按窗口高度默认显示12时至次日1时半格", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/#/calendar");

  await expect.poll(() => calendarShowsDefaultTimedRange(page)).toBe(true);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Playwright 视口不可用");
  await page.setViewportSize({ width: viewport.width, height: viewport.height - 40 });
  await expect.poll(() => calendarShowsDefaultTimedRange(page)).toBe(true);

  await page.getByRole("button", { name: "月", exact: true }).click();
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible();
  await page.getByRole("button", { name: "周", exact: true }).click();
  await expect(page.locator(".fc-timeGridWeek-view")).toBeVisible();
  await expect.poll(() => calendarShowsDefaultTimedRange(page)).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test("相邻短预约保持整列且不遮挡后续预约", async ({ page }) => {
  const serviceDate = startOfChinaWeek(chinaDateKey());
  const shortContact = "短预约回归";
  const followingContact = "后续预约回归";

  await page.goto("/");
  await createBusinessAppointment(page, serviceDate, {
    contactName: shortContact,
    startTime: "19:37",
    endTime: "20:00",
    amountYuan: "10",
  });
  await createBusinessAppointment(page, serviceDate, {
    contactName: followingContact,
    startTime: "20:00",
    endTime: "22:00",
    amountYuan: "20",
  });
  await page.getByRole("link", { name: "排班日历" }).click();

  const shortCard = page.locator(".calendar-event-card").filter({ hasText: shortContact });
  const followingCard = page.locator(".calendar-event-card").filter({ hasText: followingContact });
  await expect(shortCard).toBeVisible();
  await expect(followingCard).toBeVisible();

  const geometry = await Promise.all(
    [shortCard, followingCard].map((card) =>
      card.evaluate((element) => {
        const event = element.closest<HTMLElement>(".fc-timegrid-event-harness");
        const column = element.closest<HTMLElement>(".fc-timegrid-col");
        if (!event || !column) throw new Error("预约卡片未渲染在日历时间列中");
        const eventBounds = event.getBoundingClientRect();
        const columnBounds = column.getBoundingClientRect();
        return {
          x: eventBounds.x,
          y: eventBounds.y,
          width: eventBounds.width,
          height: eventBounds.height,
          columnWidth: columnBounds.width,
        };
      }),
    ),
  );
  const [shortGeometry, followingGeometry] = geometry;

  expect(shortGeometry.width / shortGeometry.columnWidth).toBeGreaterThan(0.9);
  expect(followingGeometry.width / followingGeometry.columnWidth).toBeGreaterThan(0.9);
  expect(Math.abs(shortGeometry.x - followingGeometry.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(shortGeometry.width - followingGeometry.width)).toBeLessThanOrEqual(2);
  expect(shortGeometry.y + shortGeometry.height).toBeLessThanOrEqual(followingGeometry.y + 1);
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

  await page.locator(".mode-switch__item", { hasText: "娱乐模式" }).click();
  await expect(page.getByRole("heading", { name: "账单信息" })).toBeHidden();
  await expect(page.getByRole("button", { name: "保存预约" })).toBeVisible();
});

test("预约抽屉使用双栏、状态胶囊与分层编辑操作", async ({ page }) => {
  const today = chinaDateKey();
  const contactName = "方案B布局验收";
  await page.goto("/");
  await page.getByRole("button", { name: "新建预约", exact: true }).click();
  const createDrawer = page.getByRole("dialog", { name: "新建预约" });

  await expect(createDrawer.getByRole("radio", { name: "已预约" })).toBeChecked();
  await expect(createDrawer.getByRole("radio", { name: "待结算" })).toBeVisible();
  const statusPills = createDrawer.locator(".status-choice__item");
  const statusPillTops = await statusPills.evaluateAll((items) =>
    items.map((item) => Math.round(item.getBoundingClientRect().top)),
  );
  expect(new Set(statusPillTops).size).toBe(1);
  expect(
    await createDrawer.evaluate((drawer) => ({
      hasHorizontalOverflow: drawer.scrollWidth > drawer.clientWidth + 1,
      columnCount: getComputedStyle(drawer.querySelector(".appointment-layout")!)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length,
    })),
  ).toEqual({ hasHorizontalOverflow: false, columnCount: 2 });
  await createDrawer.getByRole("button", { name: "关闭", exact: true }).click();

  await createBusinessAppointment(page, today, {
    contactName,
    startTime: "13:00",
    endTime: "14:00",
    amountYuan: "100",
  });
  const row = page.locator("article.appointment-row").filter({ hasText: contactName });
  await row.getByRole("button", { name: "编辑预约" }).click();
  const editDrawer = page.getByRole("dialog", { name: "编辑预约" });
  await expect(editDrawer.getByRole("button", { name: "复制为今日预约" })).toBeVisible();
  await expect(editDrawer.getByRole("button", { name: "完成预约" })).toBeVisible();
  await expect(editDrawer.getByRole("button", { name: "保存修改" })).toBeVisible();

  const moreActions = editDrawer.getByRole("button", { name: "更多操作" });
  await moreActions.click();
  await expect(editDrawer.getByRole("menu", { name: "更多预约操作" })).toBeVisible();
  await expect(editDrawer.getByRole("menuitem", { name: "取消预约" })).toBeVisible();
  await expect(editDrawer.getByRole("menuitem", { name: "永久删除" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editDrawer.getByRole("menu", { name: "更多预约操作" })).toBeHidden();
  await expect(moreActions).toBeFocused();
});

test("完整业务流程可从解锁走到收益与备份恢复", async ({ page }) => {
  test.setTimeout(60_000);
  const today = chinaDateKey();
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
  await progressDrawer.getByRole("radio", { name: "进行中" }).check();
  await progressDrawer.getByRole("button", { name: "保存修改" }).click();
  await expect(progressDrawer).toBeHidden();
  await expect(targetRow).toContainText("进行中");
  await targetRow.getByRole("button", { name: "完成预约" }).click();
  await expect(targetRow).toContainText("待结算");

  await targetRow.getByRole("button", { name: "填写闭环验收目标 的结算金额", exact: true }).click();
  const settlementDrawer = page.getByRole("dialog", { name: "编辑预约" });
  await expect(settlementDrawer.getByLabel("金额（元）")).toBeFocused();
  await settlementDrawer.getByRole("radio", { name: "完成" }).check();
  await settlementDrawer.getByLabel("收款方式").fill("微信");
  await settlementDrawer.getByRole("button", { name: "保存修改" }).click();
  await expect(settlementDrawer).toBeHidden();
  await expect(page.getByRole("status")).toContainText("已完成；该预约仍与");
  await expect(targetRow).toContainText("完成");

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
  await expect(restoredRow).toContainText("完成");
  await expect(restoredRow).not.toContainText("已取消");

  await page.getByRole("link", { name: "收益总结" }).click();
  await expect.poll(() => readSettledMinor(page)).toBe(settledAfterLiveRefresh);
});
