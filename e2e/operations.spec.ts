import { expect, test } from "@playwright/test";

test("长任务切页后持续展示进度并互斥冲突数据操作", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "代表视口验证跨路由任务协调");
  await page.addInitScript(() => {
    localStorage.setItem("timekeeper-operation-delay-ms", "4000");
  });
  await page.goto("/#/settings");
  await expect(page.getByRole("heading", { name: "完整备份导出与恢复" })).toBeVisible();

  await page.getByRole("button", { name: "导出完整备份" }).click();
  const operation = page.locator(".app-shell__operation");
  await expect(operation).toContainText("正在导出完整备份");
  await page.getByRole("link", { name: "今日" }).click();

  await expect(page.getByRole("heading", { name: "今日工作台" })).toBeVisible();
  await expect(operation).toContainText("正在导出完整备份");
  await expect(page.getByRole("button", { name: "新建预约", exact: true })).toBeDisabled();
  await expect(operation).toBeHidden({ timeout: 7_000 });
  await expect(page.getByRole("button", { name: "新建预约", exact: true })).toBeEnabled();
});
