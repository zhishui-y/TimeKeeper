import { expect, test } from "@playwright/test";

const boundaryInstant = new Date("2026-08-09T16:30:00.000Z");

for (const timezoneId of ["UTC", "Asia/Shanghai", "America/Los_Angeles"]) {
  test.describe(`北京时间业务边界 ${timezoneId}`, () => {
    test.use({ timezoneId });

    test("北京时间午夜与周一边界不受 OS 时区影响", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop-1440", "代表视口执行三时区边界回归");
      await page.clock.setFixedTime(boundaryInstant);
      await page.goto("/");

      await expect(page.getByRole("heading", { name: "今天 · 8月10日 周一" })).toBeVisible();
      await expect(page.locator(".week-day.is-today .week-day__heading")).toContainText("10");

      await page.getByRole("link", { name: "收益总结" }).click();
      await expect(page.locator(".panel-header__range")).toContainText("2026-08-10 — 2026-08-16");
    });
  });
}
