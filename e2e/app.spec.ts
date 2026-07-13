import { expect, test } from "@playwright/test";

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

  const routes = [
    ["排班日历", "排班日历"],
    ["预约记录", "预约记录"],
    ["账号档案", "账号档案"],
    ["收益总结", "收益总结"],
    ["设置", "设置"],
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
