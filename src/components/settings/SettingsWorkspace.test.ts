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
    vi.spyOn(mockApi, "commitExcelImport").mockReturnValue(pendingImport.promise);
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
    await buttonWithText(wrapper, "确认导入").trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="status"]').text()).toContain("正在导入账本数据");
    expect(buttonWithText(wrapper, "正在导入").attributes("disabled")).toBeDefined();

    pendingImport.resolve({
      importedAppointments: 408,
      importedProfiles: 23,
      skippedDuplicates: 0,
      warnings: [],
    });
    await flushPromises();

    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("导入完成");
    expect(ui.dataRevision).toBe(1);
    expect(ui.accountRevision).toBe(1);
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

    expect(wrapper.get('[role="status"]').text()).toContain("正在导出完整备份");
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
});
