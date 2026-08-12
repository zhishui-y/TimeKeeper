import { computed, reactive, shallowRef, watch } from "vue";
import { api, errorMessage } from "../api/client";
import { useOperationStore } from "../stores/operations";
import { useUiStore } from "../stores/ui";
import type { ExcelImportSelection } from "../types/domain";
import { chinaDateKey, parseDateKey } from "../utils/chinaDateTime";

export function useSettingsWorkspaceExcel() {
  const ui = useUiStore();
  const operations = useOperationStore();
  const existingPreview = operations.excelPreview;
  const importPath = shallowRef(existingPreview?.sourcePath ?? "");
  const baseYear = shallowRef(
    existingPreview?.baseYear ?? parseDateKey(chinaDateKey())?.year ?? 2026,
  );
  const importSelection = reactive<ExcelImportSelection>({ appointments: true, accounts: true });

  const importPreview = computed(() => operations.excelPreview);
  const importResult = computed(() => operations.excelResult);
  const importOperation = computed(() => {
    if (operations.current?.kind === "excelPreview") return "preview";
    if (operations.current?.kind === "excelCommit") return "commit";
    return null;
  });
  const importBusy = computed(() => operations.busy);
  const hasImportSelection = computed(
    () => importSelection.appointments || importSelection.accounts,
  );
  const importSelectionLabel = computed(() => {
    if (importSelection.appointments && importSelection.accounts) return "预约与账号";
    if (importSelection.appointments) return "预约记录";
    if (importSelection.accounts) return "账号档案";
    return "未选择导入内容";
  });
  const importButtonLabel = computed(() => {
    if (importOperation.value === "commit") return "正在导入";
    if (!hasImportSelection.value) return "请选择导入内容";
    return `导入${importSelectionLabel.value}`;
  });
  const importProgress = computed(() => {
    if (importOperation.value === "preview") {
      return {
        title: "正在生成导入预览",
        detail: "正在读取并解析 Excel 工作表，完成前请保持应用开启。",
      };
    }
    if (importOperation.value === "commit") {
      return {
        title: `正在导入${importSelectionLabel.value}`,
        detail: "正在写入所选数据并检查重复内容，请勿关闭应用。",
      };
    }
    return null;
  });

  async function chooseExcel(): Promise<void> {
    const selected = await api.selectExcelFile();
    if (!selected) return;
    importPath.value = selected;
    operations.clearExcelPreview();
  }

  async function previewImport(): Promise<void> {
    if (!importPath.value) {
      ui.notify("请先选择 Excel 账本", "warning");
      return;
    }
    operations.clearExcelPreview();
    const path = importPath.value;
    const year = baseYear.value;
    try {
      await operations.previewExcel(path, year);
      if (path !== importPath.value || year !== baseYear.value) return;
      ui.notify("导入预览已生成，请确认后再提交", "success");
    } catch (cause) {
      ui.notify(errorMessage(cause), "danger");
    }
  }

  async function commitImport(): Promise<void> {
    if (!importPreview.value) return;
    if (!hasImportSelection.value) {
      ui.notify("请至少选择导入预约或账号", "warning");
      return;
    }
    const selection = { ...importSelection };
    try {
      const result = await operations.commitExcel(selection);
      if (selection.appointments) ui.markDataChanged();
      if (selection.accounts) ui.markAccountsChanged();
      if (result.warnings.length > 0) {
        ui.notify(`Excel 账本已导入，并有 ${result.warnings.length} 条提示`, "warning");
      } else {
        ui.notify("Excel 账本导入完成", "success");
      }
    } catch (cause) {
      ui.notify(errorMessage(cause), "danger");
    }
  }

  watch(baseYear, () => {
    operations.clearExcelPreview();
  });
  watch(importPreview, (preview) => {
    if (preview && !importPath.value) importPath.value = preview.sourcePath;
  });

  return {
    importPath,
    baseYear,
    importSelection,
    importPreview,
    importResult,
    importOperation,
    importBusy,
    hasImportSelection,
    importSelectionLabel,
    importButtonLabel,
    importProgress,
    chooseExcel,
    previewImport,
    commitImport,
  };
}
