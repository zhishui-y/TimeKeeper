import { expect, test, type Locator, type Page } from "@playwright/test";
import { format } from "date-fns";

const today = format(new Date(), "yyyy-MM-dd");

function appointmentRow(page: Page, text: string): Locator {
  return page.locator("tbody tr").filter({ hasText: text });
}

function accountRow(page: Page, text: string): Locator {
  return page.locator(".account-table tbody tr").filter({ hasText: text });
}

async function readMoneyMinor(metric: Locator): Promise<number> {
  const value = await metric.locator(".mono-number").innerText();
  const normalized = value.replace(/[^\d.-]/g, "");
  return Math.round(Number(normalized || "0") * 100);
}

async function createBusinessAppointment(
  page: Page,
  contactName: string,
  content: string,
): Promise<void> {
  await page.getByRole("button", { name: "新建预约", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: /新建预约|编辑预约/ });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("日期 *").fill(today);
  await drawer.getByLabel("开始时间").fill("06:00");
  await drawer.getByLabel("结束时间").fill("07:00");
  await drawer.getByLabel("联系人 *").fill(contactName);
  await drawer.getByLabel("预约内容").fill(content);
  await drawer.getByLabel("金额（元）").fill("88");
  await drawer.getByRole("button", { name: "保存预约" }).click();
  await expect(drawer).toBeHidden();
}

test.describe("浏览器演示模式功能矩阵（不代表 native 验收）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "今日工作台" })).toBeVisible();
  });

  test("新建待完善账号后可查询筛选且全局预约立即可关联", async ({ page }) => {
    const contactName = "矩阵待完善联系人";
    const accountName = "feature_matrix_review";

    await test.step("新建一条待完善账号档案", async () => {
      await page.getByRole("link", { name: "账号档案" }).click();
      await page.getByRole("button", { name: "新建账号" }).click();

      const drawer = page.getByRole("dialog", { name: "新建账号档案" });
      await expect(drawer).toBeVisible();
      await drawer.getByLabel("登录账号 *").fill(accountName);
      await drawer.getByLabel("密码 *").fill("FeatureMatrix#2026");
      await drawer.getByLabel("联系人").fill(contactName);
      await drawer.getByLabel("服务器").fill("测试区服");
      await drawer.getByLabel("标记为待完善").check();
      await drawer.getByRole("button", { name: "保存档案" }).click();

      await expect(drawer).toBeHidden();
      await expect(page.getByRole("status")).toContainText("账号档案已保存");
    });

    await test.step("按账号查询并只筛选待完善档案", async () => {
      const search = page.getByPlaceholder("搜索联系人、区服、角色或账号");
      await search.fill(accountName);
      await page.getByRole("button", { name: "查询", exact: true }).click();
      await expect(accountRow(page, accountName)).toHaveCount(1);

      await search.fill("");
      await page.getByLabel("只看待完善").check();
      await expect(accountRow(page, accountName)).toBeVisible();
      await expect(accountRow(page, "nanzhi_0217")).toHaveCount(0);
    });

    await test.step("不刷新页面打开全局预约并看到新账号", async () => {
      await page.getByRole("button", { name: "新建预约", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: /新建预约|编辑预约/ });
      const accountSelect = drawer.getByLabel("关联账号");
      await expect(accountSelect.locator("option").filter({ hasText: contactName })).toHaveCount(1);
    });
  });

  test("保存默认提醒60分钟后新建预约立即使用该值", async ({ page }) => {
    await page.getByRole("link", { name: "数据与设置" }).click();

    await test.step("修改并保存默认提醒", async () => {
      await page.getByLabel("默认提前提醒").fill("60");
      await page.getByRole("button", { name: "保存设置" }).click();
      await expect(page.getByRole("status")).toContainText("设置已保存");
    });

    await test.step("新建预约继承最新默认值", async () => {
      await page.getByRole("button", { name: "新建预约", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: /新建预约|编辑预约/ });
      await expect(drawer.getByLabel("开启提醒")).toBeChecked();
      await expect(drawer.locator(".reminder-input input")).toHaveValue("60");
    });
  });

  test("Excel预览后修改基准年份会清空旧预览并禁止确认", async ({ page }) => {
    await page.getByRole("link", { name: "数据与设置" }).click();
    const yearInput = page.getByLabel("短日期基准年份");

    await test.step("选择账本并生成预览", async () => {
      await page.getByRole("button", { name: "选择文件" }).click();
      await page.getByRole("button", { name: "生成预览" }).click();
      await expect(page.locator(".import-preview")).toBeVisible();
      await expect(page.getByRole("button", { name: "确认导入" })).toBeEnabled();
    });

    await test.step("修改年份使旧令牌对应的预览失效", async () => {
      const currentYear = Number(await yearInput.inputValue());
      const nextYear = currentYear >= 2100 ? currentYear - 1 : currentYear + 1;
      await yearInput.fill(String(nextYear));
      await expect(page.locator(".import-preview")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "确认导入" })).toHaveCount(0);
    });
  });

  test("保存娱乐预约后记录存在且已结与待结收益均不增加", async ({ page }) => {
    const contactName = "矩阵娱乐预约";
    await page.getByRole("link", { name: "收益总结" }).click();
    await expect(page.locator(".revenue-dashboard .loading-line")).toHaveCount(0);
    const settledMetric = page.locator(".revenue-metric--primary");
    const pendingMetric = page.locator(".revenue-metric--pending");
    const settledBefore = await readMoneyMinor(settledMetric);
    const pendingBefore = await readMoneyMinor(pendingMetric);

    await test.step("保存一条娱乐预约", async () => {
      await page.getByRole("button", { name: "新建预约", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: /新建预约|编辑预约/ });
      await drawer.getByRole("button", { name: /娱乐模式/ }).click();
      await drawer.getByLabel("日期 *").fill(today);
      await drawer.getByLabel("开始时间").fill("07:00");
      await drawer.getByLabel("结束时间").fill("08:00");
      await drawer.getByLabel("联系人 *").fill(contactName);
      await drawer.getByLabel("预约内容").fill("仅供娱乐模式回归");
      await drawer.getByRole("button", { name: "保存预约" }).click();
      await expect(drawer).toBeHidden();
    });

    await test.step("预约记录可查询到娱乐模式数据", async () => {
      await page.getByRole("link", { name: "预约记录" }).click();
      await page.getByPlaceholder("搜索联系人、内容或账号").fill(contactName);
      await page.getByRole("button", { name: "筛选", exact: true }).click();
      const row = appointmentRow(page, contactName);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("娱乐");
    });

    await test.step("收益页的已结与待结金额保持不变", async () => {
      await page.getByRole("link", { name: "收益总结" }).click();
      await expect(page.locator(".revenue-dashboard .loading-line")).toHaveCount(0);
      await expect.poll(() => readMoneyMinor(settledMetric)).toBe(settledBefore);
      await expect.poll(() => readMoneyMinor(pendingMetric)).toBe(pendingBefore);
    });
  });

  test("预约记录可查询重置复制编辑取消并删除自建数据", async ({ page }) => {
    test.setTimeout(60_000);
    const originalContact = "矩阵预约甲";
    const copiedContact = "矩阵预约乙";
    const editedContact = "矩阵预约丙";

    await createBusinessAppointment(page, originalContact, "预约记录操作回归");
    await page.getByRole("link", { name: "预约记录" }).click();

    await test.step("查询并重置筛选", async () => {
      const search = page.getByPlaceholder("搜索联系人、内容或账号");
      await search.fill(originalContact);
      await page.getByRole("button", { name: "筛选", exact: true }).click();
      await expect(appointmentRow(page, originalContact)).toHaveCount(1);
      await expect(page.locator("tbody tr")).toHaveCount(1);

      await page.getByRole("button", { name: "重置筛选" }).click();
      await expect(search).toHaveValue("");
      await expect(appointmentRow(page, originalContact)).toBeVisible();
      await expect(page.locator("tbody tr")).not.toHaveCount(1);
    });

    await test.step("复制预约并把副本编辑成可区分的数据", async () => {
      await appointmentRow(page, originalContact).getByRole("button", { name: "复制预约" }).click();
      const drawer = page.getByRole("dialog", { name: "编辑预约" });
      await expect(drawer.getByRole("heading", { name: "编辑预约" })).toBeVisible();
      await drawer.getByLabel("联系人 *").fill(copiedContact);
      await drawer.getByLabel("预约内容").fill("复制后的安全测试数据");
      await drawer.getByRole("button", { name: "保存预约" }).click();
      await expect(drawer).toBeHidden();
      await expect(appointmentRow(page, copiedContact)).toHaveCount(1);
    });

    await test.step("编辑原预约", async () => {
      await appointmentRow(page, originalContact)
        .getByRole("button", { name: "编辑", exact: true })
        .click();
      const drawer = page.getByRole("dialog", { name: "编辑预约" });
      await drawer.getByLabel("联系人 *").fill(editedContact);
      await drawer.getByRole("button", { name: "保存预约" }).click();
      await expect(drawer).toBeHidden();
      await expect(appointmentRow(page, originalContact)).toHaveCount(0);
      await expect(appointmentRow(page, editedContact)).toHaveCount(1);
    });

    await test.step("取消原预约并仅删除本测试创建的数据", async () => {
      const editedRow = appointmentRow(page, editedContact);
      await editedRow.getByRole("button", { name: "取消预约" }).click();
      await expect(editedRow).toContainText("已取消");

      page.once("dialog", (dialog) => void dialog.accept());
      await appointmentRow(page, copiedContact).getByRole("button", { name: "永久删除" }).click();
      await expect(appointmentRow(page, copiedContact)).toHaveCount(0);

      page.once("dialog", (dialog) => void dialog.accept());
      await appointmentRow(page, editedContact).getByRole("button", { name: "永久删除" }).click();
      await expect(appointmentRow(page, editedContact)).toHaveCount(0);
    });
  });
});
