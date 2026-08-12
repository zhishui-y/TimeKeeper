// @vitest-environment jsdom

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../api/mockClient";
import type { ExcelImportPreview } from "../types/domain";
import { useOperationStore } from "./operations";

const preview: ExcelImportPreview = {
  sourcePath: "C:\\demo.xlsx",
  baseYear: 2026,
  appointmentCount: 1,
  profileCount: 0,
  unmatchedProfileCount: 0,
  crossMidnightCount: 0,
  yyChannelCount: 0,
  passwordConflictCount: 0,
  skippedCount: 0,
  warningCount: 0,
  warnings: [],
  previewToken: "single-use-token",
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("operation coordinator", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("keeps a long task observable from every store consumer and rejects conflicts", async () => {
    const pending = deferred<ExcelImportPreview>();
    vi.spyOn(mockApi, "previewExcelImport").mockReturnValue(pending.promise);
    const first = useOperationStore();
    const request = first.previewExcel(preview.sourcePath, preview.baseYear);
    const second = useOperationStore();

    expect(second).toBe(first);
    expect(second.current?.kind).toBe("excelPreview");
    await expect(second.exportBackup("C:\\backup.tkbackup")).rejects.toThrow("尚未完成");

    pending.resolve(preview);
    await expect(request).resolves.toEqual(preview);
    expect(second.current).toBeNull();
    expect(second.excelPreview?.previewToken).toBe(preview.previewToken);
  });

  it("clears the single-use preview token as soon as commit starts, including failures", async () => {
    vi.spyOn(mockApi, "previewExcelImport").mockResolvedValue(preview);
    vi.spyOn(mockApi, "commitExcelImport").mockRejectedValue(new Error("写入失败"));
    const operations = useOperationStore();
    await operations.previewExcel(preview.sourcePath, preview.baseYear);

    const request = operations.commitExcel({ appointments: true, accounts: false });
    expect(operations.excelPreview).toBeNull();
    await expect(request).rejects.toThrow("写入失败");
    expect(operations.excelPreview).toBeNull();
    expect(operations.lastCompleted).toMatchObject({ status: "failed", error: "写入失败" });
  });

  it("caps role refresh targets before opening an operation", async () => {
    const operations = useOperationStore();
    await expect(
      operations.refreshRoleData(Array.from({ length: 1_001 }, (_, index) => `id-${index}`)),
    ).rejects.toThrow("1000");
    expect(operations.current).toBeNull();
  });
});
