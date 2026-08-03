// @vitest-environment jsdom

import { createPinia } from "pinia";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../../api/mockClient";
import { useUiStore } from "../../stores/ui";
import type { BackupResult, ExcelImportPreview, ExcelImportResult } from "../../types/domain";
import SettingsWorkspace from "./SettingsWorkspace.vue";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function buttonWithText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().includes(text));
  if (!button) throw new Error(`未找到按钮：${text}`);
  return button;
}

const preview: ExcelImportPreview = {
  sourcePath: "C:\\demo\\account.xlsm",
  baseYear: 2026,
  appointmentCount: 408,
  profileCount: 23,
  unmatchedProfileCount: 16,
  crossMidnightCount: 63,
  yyChannelCount: 64,
  passwordConflictCount: 1,
  skippedCount: 0,
  warningCount: 0,
  warnings: [],
  previewToken: "preview-token",
};

describe("SettingsWorkspace operation progress", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows an accessible progress state while generating an import preview", async () => {
    const pendingPreview = deferred<ExcelImportPreview>();
    vi.spyOn(mockApi, "selectExcelFile").mockResolvedValue(preview.sourcePath);
    const previewRequest = vi
      .spyOn(mockApi, "previewExcelImport")
      .mockReturnValue(pendingPreview.promise);

    const wrapper = mount(SettingsWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    await buttonWithText(wrapper, "选择文件").trigger("click");
    await flushPromises();
    await buttonWithText(wrapper, "生成预览").trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="status"]').text()).toContain("正在生成导入预览");
    expect(wrapper.get('[role="progressbar"]').attributes("aria-valuetext")).toBe("正在处理");
    expect(buttonWithText(wrapper, "正在生成").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".import-year input").attributes("disabled")).toBeDefined();

    pendingPreview.resolve(preview);
    await flushPromises();

    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("408");
    expect(wrapper.text()).toContain("64YY频道");
    expect(wrapper.text()).toContain("预览结果");

    const replacementPreview = deferred<ExcelImportPreview>();
    previewRequest.mockReturnValue(replacementPreview.promise);
    await buttonWithText(wrapper, "生成预览").trigger("click");
    await flushPromises();

    expect(wrapper.text()).not.toContain("预览结果");
    replacementPreview.resolve(preview);
    await flushPromises();
    wrapper.unmount();
  });

  it("shows import progress until the preview transaction is committed", async () => {
    const pendingImport = deferred<ExcelImportResult>();
    vi.spyOn(mockApi, "selectExcelFile").mockResolvedValue(preview.sourcePath);
    vi.spyOn(mockApi, "previewExcelImport").mockResolvedValue(preview);
    const commitExcelImport = vi
      .spyOn(mockApi, "commitExcelImport")
      .mockReturnValue(pendingImport.promise);
    const pinia = createPinia();
    const wrapper = mount(SettingsWorkspace, {
      global: { plugins: [pinia] },
    });
    const ui = useUiStore(pinia);
    await flushPromises();

    await buttonWithText(wrapper, "选择文件").trigger("click");
    await flushPromises();
    await buttonWithText(wrapper, "生成预览").trigger("click");
    await flushPromises();
    await buttonWithText(wrapper, "导入预约与账号").trigger("click");
    await flushPromises();

    expect(commitExcelImport).toHaveBeenCalledWith("preview-token", {
      appointments: true,
      accounts: true,
    });
    expect(wrapper.get('[role="status"]').text()).toContain("正在导入预约与账号");
    expect(buttonWithText(wrapper, "正在导入").attributes("disabled")).toBeDefined();

    pendingImport.resolve({
      importedAppointments: 408,
      importedProfiles: 23,
      skippedDuplicates: 0,
      skippedAppointmentDuplicates: 0,
      skippedProfileDuplicates: 0,
      warnings: [],
    });
    await flushPromises();

    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("导入完成");
    expect(ui.dataRevision).toBe(1);
    expect(ui.accountRevision).toBe(1);
    wrapper.unmount();
  });

  it("commits only the selected import data type and updates the matching revision", async () => {
    vi.spyOn(mockApi, "selectExcelFile").mockResolvedValue(preview.sourcePath);
    vi.spyOn(mockApi, "previewExcelImport").mockResolvedValue(preview);
    const commitExcelImport = vi.spyOn(mockApi, "commitExcelImport").mockResolvedValue({
      importedAppointments: 400,
      importedProfiles: 0,
      skippedDuplicates: 8,
      skippedAppointmentDuplicates: 8,
      skippedProfileDuplicates: 0,
      warnings: ["预约已导入，但通知调度失败：测试错误"],
    });
    const pinia = createPinia();
    const wrapper = mount(SettingsWorkspace, {
      global: { plugins: [pinia] },
    });
    const ui = useUiStore(pinia);
    await flushPromises();

    await wrapper.get('input[aria-label="导入账号档案"]').setValue(false);
    await buttonWithText(wrapper, "选择文件").trigger("click");
    await flushPromises();
    await buttonWithText(wrapper, "生成预览").trigger("click");
    await flushPromises();
    await buttonWithText(wrapper, "导入预约记录").trigger("click");
    await flushPromises();

    expect(commitExcelImport).toHaveBeenCalledWith("preview-token", {
      appointments: true,
      accounts: false,
    });
    expect(wrapper.text()).toContain("去重跳过 8 条预约、0 个账号");
    expect(wrapper.text()).toContain("预约已导入，但通知调度失败：测试错误");
    expect(ui.toast?.tone).toBe("warning");
    expect(ui.dataRevision).toBe(1);
    expect(ui.accountRevision).toBe(0);
    wrapper.unmount();
  });

  it("marks YY channels as excluded when appointment import is disabled", async () => {
    vi.spyOn(mockApi, "selectExcelFile").mockResolvedValue(preview.sourcePath);
    vi.spyOn(mockApi, "previewExcelImport").mockResolvedValue(preview);
    const wrapper = mount(SettingsWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    await wrapper.get('input[aria-label="导入预约记录"]').setValue(false);
    await buttonWithText(wrapper, "选择文件").trigger("click");
    await flushPromises();
    await buttonWithText(wrapper, "生成预览").trigger("click");
    await flushPromises();

    const yyStat = wrapper
      .findAll(".preview-stats > span")
      .find((item) => item.text().includes("YY频道"));
    expect(yyStat?.text()).toContain("64YY频道（不导入）");
    expect(yyStat?.classes()).toContain("is-excluded");
    wrapper.unmount();
  });

  it("shows backup export progress and clears it after completion", async () => {
    const destination = "C:\\demo\\TimeKeeper-20260727.tkbackup";
    const pendingBackup = deferred<BackupResult>();
    vi.spyOn(mockApi, "selectBackupDestination").mockResolvedValue(destination);
    vi.spyOn(mockApi, "createBackup").mockReturnValue(pendingBackup.promise);

    const wrapper = mount(SettingsWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    await buttonWithText(wrapper, "导出完整备份").trigger("click");
    await flushPromises();

    const progressText = wrapper.get('[role="status"]').text();
    expect(progressText).toContain("正在导出完整备份");
    expect(progressText).toContain("成对的旧密码迁移文件");
    expect(buttonWithText(wrapper, "正在导出").attributes("disabled")).toBeDefined();
    expect(buttonWithText(wrapper, "从备份恢复").attributes("disabled")).toBeDefined();

    pendingBackup.resolve({
      path: destination,
      createdAt: "2026-07-27T08:00:00Z",
      sizeBytes: 4096,
    });
    await flushPromises();

    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.text()).toContain(destination);
    wrapper.unmount();
  });

  it("clears a failed operation so the user can retry", async () => {
    vi.spyOn(mockApi, "selectBackupDestination").mockResolvedValue("C:\\demo\\failed.tkbackup");
    vi.spyOn(mockApi, "createBackup").mockRejectedValue(new Error("备份写入失败"));

    const wrapper = mount(SettingsWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    await buttonWithText(wrapper, "导出完整备份").trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(buttonWithText(wrapper, "导出完整备份").attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("loads, validates, and saves the role data server URL through unified settings", async () => {
    const previous = await mockApi.getSettings();
    const updateSettings = vi.spyOn(mockApi, "updateSettings").mockImplementation(async (next) => ({
      ...next,
      accountRoleDataServerUrl: next.accountRoleDataServerUrl.trim(),
    }));
    vi.spyOn(mockApi, "getSettings").mockResolvedValue(previous);

    const wrapper = mount(SettingsWorkspace, { global: { plugins: [createPinia()] } });
    await flushPromises();
    const input = wrapper.get('input[aria-label="角色数据服务器基础 URL"]');
    await input.setValue("https://example.test/jx3/");
    await buttonWithText(wrapper, "保存设置").trigger("click");
    await flushPromises();

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ accountRoleDataServerUrl: "https://example.test/jx3/" }),
    );
    await input.setValue("https://user:password@example.test/jx3/");
    expect(wrapper.get('[role="alert"]').text()).toContain("不能包含用户名或密码");
    expect(buttonWithText(wrapper, "保存设置").attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });
});
