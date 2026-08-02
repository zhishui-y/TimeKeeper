<script setup lang="ts">
import {
  BellRing,
  CheckCircle2,
  DatabaseBackup,
  FileSearch,
  FileSpreadsheet,
  HardDriveDownload,
  Save,
  ShieldCheck,
  Upload,
} from "@lucide/vue";
import { computed, onMounted, reactive, shallowRef, watch } from "vue";
import { api, errorMessage, isTauri } from "../../api/client";
import { useUiStore } from "../../stores/ui";
import type {
  AppSettings,
  BackupResult,
  ExcelImportPreview,
  ExcelImportResult,
  ExcelImportSelection,
} from "../../types/domain";
import type { AppNotificationPermission } from "../../api/types";
import { formatFileSize } from "../../utils/formatters";
import { DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS } from "../../utils/accountTableColumns";
import OperationProgress from "./OperationProgress.vue";
import ExcelImportScopeSelector from "./ExcelImportScopeSelector.vue";
import VaultSettingsPanel from "./VaultSettingsPanel.vue";

type ImportOperation = "preview" | "commit";
type BackupOperation = "export" | "restore";

const ui = useUiStore();
const settings = reactive<AppSettings>({
  defaultReminderMinutes: 30,
  autoLockMinutes: 15,
  backupRetention: 30,
  lastAutomaticBackupDate: null,
  accountTableColumnWidths: { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS },
  lastAccountUsageWeekStart: null,
});
const loadingSettings = shallowRef(false);
const importPath = shallowRef("");
const baseYear = shallowRef(new Date().getFullYear());
const importPreview = shallowRef<ExcelImportPreview | null>(null);
const importResult = shallowRef<ExcelImportResult | null>(null);
const importSelection = reactive<ExcelImportSelection>({ appointments: true, accounts: true });
const importOperation = shallowRef<ImportOperation | null>(null);
const backupOperation = shallowRef<BackupOperation | null>(null);
const lastBackup = shallowRef<BackupResult | null>(null);
const notificationPermission = shallowRef<AppNotificationPermission>("default");
const vaultPanel = shallowRef<InstanceType<typeof VaultSettingsPanel> | null>(null);

const importBusy = computed(() => importOperation.value !== null);
const hasImportSelection = computed(() => importSelection.appointments || importSelection.accounts);
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
const backupBusy = computed(() => backupOperation.value !== null);
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
const backupProgress = computed(() => {
  if (backupOperation.value === "export") {
    return {
      title: "正在导出完整备份",
      detail: "正在快照数据库，并打包设置与本地加密密码库。",
    };
  }
  if (backupOperation.value === "restore") {
    return {
      title: "正在校验并准备恢复",
      detail: "正在验证备份内容并保存当前版本，完成后应用将自动重启。",
    };
  }
  return null;
});

async function loadSettings(): Promise<void> {
  loadingSettings.value = true;
  try {
    Object.assign(settings, await api.getSettings());
    ui.setAppointmentDefaultReminderMinutes(settings.defaultReminderMinutes);
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    loadingSettings.value = false;
  }
}

async function saveSettings(): Promise<void> {
  try {
    Object.assign(settings, await api.updateSettings({ ...settings }));
    ui.setAppointmentDefaultReminderMinutes(settings.defaultReminderMinutes);
    await vaultPanel.value?.refresh();
    ui.notify("设置已保存", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function chooseExcel(): Promise<void> {
  const selected = await api.selectExcelFile();
  if (!selected) return;
  importPath.value = selected;
  importPreview.value = null;
  importResult.value = null;
}

async function previewImport(): Promise<void> {
  if (!importPath.value) {
    ui.notify("请先选择 Excel 账本", "warning");
    return;
  }
  importOperation.value = "preview";
  importPreview.value = null;
  importResult.value = null;
  const path = importPath.value;
  const year = baseYear.value;
  try {
    const preview = await api.previewExcelImport(path, year);
    if (path !== importPath.value || year !== baseYear.value) return;
    importPreview.value = preview;
    ui.notify("导入预览已生成，请确认后再提交", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    importOperation.value = null;
  }
}

async function commitImport(): Promise<void> {
  if (!importPreview.value) return;
  if (!hasImportSelection.value) {
    ui.notify("请至少选择导入预约或账号", "warning");
    return;
  }
  const previewToken = importPreview.value.previewToken;
  const selection = { ...importSelection };
  importOperation.value = "commit";
  try {
    importResult.value = await api.commitExcelImport(previewToken, selection);
    importPreview.value = null;
    if (selection.appointments) ui.markDataChanged();
    if (selection.accounts) ui.markAccountsChanged();
    ui.notify("Excel 账本导入完成", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    importOperation.value = null;
  }
}

async function requestNotifications(): Promise<void> {
  try {
    notificationPermission.value = await api.requestNotificationPermission();
    ui.notify(
      notificationPermission.value === "granted" ? "系统通知已允许" : "系统通知未获授权",
      notificationPermission.value === "granted" ? "success" : "warning",
    );
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  }
}

async function createBackup(): Promise<void> {
  const destination = await api.selectBackupDestination();
  if (!destination) return;
  backupOperation.value = "export";
  try {
    lastBackup.value = await api.createBackup(destination);
    ui.notify("完整备份已创建", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    backupOperation.value = null;
  }
}

async function restoreBackup(): Promise<void> {
  const path = await api.selectBackupFile();
  if (!path) return;
  if (!globalThis.confirm("恢复备份会先保存当前数据，成功后应用将重启。是否继续？")) return;
  backupOperation.value = "restore";
  try {
    await api.restoreBackup(path);
    if (!isTauri) {
      ui.markDataChanged();
      await Promise.all([loadSettings(), vaultPanel.value?.refresh()]);
    }
    ui.notify(
      isTauri ? "备份已恢复，正在重启应用" : "演示模式：备份校验与恢复流程已完成",
      "success",
    );
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    backupOperation.value = null;
  }
}

watch(baseYear, () => {
  importPreview.value = null;
});

onMounted(() => {
  void loadSettings();
});
</script>

<template>
  <div class="settings-workspace page-stack">
    <div v-if="loadingSettings" class="loading-line" />
    <div class="settings-grid">
      <section class="settings-section settings-section--import">
        <header class="settings-section__header">
          <div class="settings-section__icon"><FileSpreadsheet :size="19" /></div>
          <div>
            <h2>Excel 账本导入</h2>
            <p>先预览，再确认写入；预览中不会返回或展示密码。</p>
          </div>
        </header>
        <div class="settings-section__body">
          <div class="file-picker">
            <div class="file-picker__path truncate">{{ importPath || "尚未选择账本" }}</div>
            <button
              class="button button--compact"
              type="button"
              :disabled="importBusy"
              @click="chooseExcel"
            >
              <Upload :size="14" />选择文件
            </button>
          </div>
          <ExcelImportScopeSelector
            v-model:appointments="importSelection.appointments"
            v-model:accounts="importSelection.accounts"
            :disabled="importBusy"
          />
          <div v-if="!hasImportSelection" class="import-scope-warning" role="alert">
            请至少选择导入预约记录或账号档案。
          </div>
          <div class="import-actions">
            <label class="field import-year">
              <span class="field__label">短日期基准年份</span>
              <input
                v-model.number="baseYear"
                class="input mono-number"
                type="number"
                min="2000"
                max="2100"
                :disabled="importBusy"
              />
            </label>
            <button
              class="button"
              type="button"
              :disabled="!importPath || importBusy || !hasImportSelection"
              @click="previewImport"
            >
              <FileSearch :size="15" />{{ importOperation === "preview" ? "正在生成" : "生成预览" }}
            </button>
          </div>

          <OperationProgress
            v-if="importProgress"
            :title="importProgress.title"
            :detail="importProgress.detail"
          />

          <div v-if="importPreview" class="import-preview">
            <div class="import-preview__title">
              <strong>预览结果</strong>
              <span>本次导入：{{ importSelectionLabel }} · 令牌30分钟内有效</span>
            </div>
            <div class="preview-stats">
              <span :class="{ 'is-excluded': !importSelection.appointments }"
                ><strong>{{ importPreview.appointmentCount }}</strong
                >预约{{ importSelection.appointments ? "" : "（不导入）" }}</span
              >
              <span :class="{ 'is-excluded': !importSelection.accounts }"
                ><strong>{{ importPreview.profileCount }}</strong
                >账号{{ importSelection.accounts ? "" : "（不导入）" }}</span
              >
              <span :class="{ 'is-excluded': !importSelection.appointments }"
                ><strong>{{ importPreview.crossMidnightCount }}</strong
                >跨夜{{ importSelection.appointments ? "" : "（不导入）" }}</span
              >
              <span :class="{ 'is-excluded': !importSelection.accounts }"
                ><strong>{{ importPreview.unmatchedProfileCount }}</strong
                >待完善{{ importSelection.accounts ? "" : "（不导入）" }}</span
              >
              <span :class="{ 'is-excluded': !importSelection.accounts }"
                ><strong>{{ importPreview.passwordConflictCount }}</strong
                >密码冲突{{ importSelection.accounts ? "" : "（不处理）" }}</span
              >
              <span
                ><strong>{{ importPreview.skippedCount }}</strong
                >跳过</span
              >
            </div>
            <ul class="warning-list">
              <li v-for="warning in importPreview.warnings" :key="warning">{{ warning }}</li>
            </ul>
            <button
              class="button button--primary"
              type="button"
              :disabled="importBusy || !hasImportSelection"
              @click="commitImport"
            >
              <CheckCircle2 :size="15" />{{ importButtonLabel }}
            </button>
          </div>

          <div v-if="importResult" class="import-result">
            <CheckCircle2 :size="18" />
            <div>
              <strong>导入完成</strong>
              <span
                >新增 {{ importResult.importedAppointments }} 条预约、{{
                  importResult.importedProfiles
                }}
                个账号。</span
              >
              <span class="import-result__dedup"
                >去重跳过 {{ importResult.skippedAppointmentDuplicates }} 条预约、{{
                  importResult.skippedProfileDuplicates
                }}
                个账号，共 {{ importResult.skippedDuplicates }} 条重复数据。</span
              >
            </div>
          </div>
        </div>
      </section>

      <section class="settings-section settings-section--notifications">
        <header class="settings-section__header">
          <div class="settings-section__icon"><BellRing :size="19" /></div>
          <div>
            <h2>提醒与通知</h2>
            <p>预约更新或取消时，原提醒会同步重排。</p>
          </div>
        </header>
        <div class="settings-section__body settings-form">
          <label class="field">
            <span class="field__label">默认提前提醒</span>
            <div class="unit-input">
              <input
                v-model.number="settings.defaultReminderMinutes"
                class="input mono-number"
                type="number"
                min="0"
                max="1440"
              />
              <span>分钟</span>
            </div>
          </label>
          <div class="inline-status">
            <span :class="{ 'is-success': notificationPermission === 'granted' }">
              {{ notificationPermission === "granted" ? "系统通知已允许" : "等待通知授权" }}
            </span>
            <button class="button button--compact" type="button" @click="requestNotifications">
              检查并授权
            </button>
          </div>
        </div>
      </section>

      <section class="settings-section settings-section--vault">
        <header class="settings-section__header">
          <div class="settings-section__icon"><ShieldCheck :size="19" /></div>
          <div>
            <h2>密码库</h2>
            <p>密码只在本地加密存储，忘记主密码后无法恢复。</p>
          </div>
        </header>
        <div class="settings-section__body">
          <VaultSettingsPanel
            ref="vaultPanel"
            v-model:auto-lock-minutes="settings.autoLockMinutes"
          />
        </div>
      </section>

      <section class="settings-section settings-section--backup">
        <header class="settings-section__header">
          <div class="settings-section__icon"><DatabaseBackup :size="19" /></div>
          <div>
            <h2>完整备份导出与恢复</h2>
            <p>导出完整数据副本；恢复前会校验并保存当前版本。</p>
          </div>
        </header>
        <div class="settings-section__body settings-form">
          <label class="field">
            <span class="field__label">自动备份保留数量</span>
            <div class="unit-input">
              <input
                v-model.number="settings.backupRetention"
                class="input mono-number"
                type="number"
                min="1"
                max="365"
              />
              <span>份</span>
            </div>
          </label>
          <div class="backup-actions">
            <button class="button" type="button" :disabled="backupBusy" @click="createBackup">
              <HardDriveDownload :size="15" />{{
                backupOperation === "export" ? "正在导出" : "导出完整备份"
              }}
            </button>
            <button class="button" type="button" :disabled="backupBusy" @click="restoreBackup">
              <Upload :size="15" />{{ backupOperation === "restore" ? "正在恢复" : "从备份恢复" }}
            </button>
          </div>
          <OperationProgress
            v-if="backupProgress"
            :title="backupProgress.title"
            :detail="backupProgress.detail"
          />
          <div v-if="lastBackup" class="backup-result">
            <strong class="truncate">{{ lastBackup.path }}</strong>
            <span>{{ formatFileSize(lastBackup.sizeBytes) }}</span>
          </div>
          <span v-else class="settings-note">
            最近自动备份：{{ settings.lastAutomaticBackupDate || "暂无" }}
          </span>
        </div>
      </section>
    </div>

    <footer class="settings-footer">
      <span>数据仅保存在本机；当前设置修改后需手动保存。</span>
      <button class="button button--primary" type="button" @click="saveSettings">
        <Save :size="15" />保存设置
      </button>
    </footer>
  </div>
</template>

<style scoped>
.settings-workspace {
  position: relative;
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) 56px;
  gap: 14px;
}

.settings-workspace > .loading-line {
  position: absolute;
  z-index: 4;
  top: 0;
  right: 4px;
  left: 0;
}

.settings-grid {
  display: grid;
  min-height: 0;
  grid-template-columns: minmax(0, 1.3fr) minmax(330px, 0.8fr);
  grid-template-rows: max-content max-content max-content;
  align-content: start;
  align-items: start;
  gap: 14px;
  overflow-y: auto;
  padding: 1px 5px 5px 1px;
}

.settings-section {
  min-height: max-content;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 18px);
  background: var(--surface);
  box-shadow: var(--shadow-soft);
}

.settings-section--import {
  grid-column: 1;
  grid-row: 1 / 3;
  align-self: start;
}

.settings-section--backup {
  grid-column: 2;
  grid-row: 1;
}

.settings-section--notifications {
  grid-column: 2;
  grid-row: 2;
}

.settings-section--vault {
  grid-column: 1 / -1;
  grid-row: 3;
}

.settings-section__header {
  display: flex;
  min-height: 72px;
  align-items: center;
  gap: 12px;
  padding: 13px 17px;
  border-bottom: 1px solid var(--line);
  border-radius: var(--radius-lg, 18px) var(--radius-lg, 18px) 0 0;
  background:
    linear-gradient(
      105deg,
      color-mix(in srgb, var(--brand-soft) 48%, transparent),
      transparent 60%
    ),
    var(--surface-soft);
}

.settings-section__icon {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  place-items: center;
  border: 1px solid var(--brand-border, #cbdcd2);
  border-radius: 12px;
  color: var(--brand);
  background: var(--brand-soft);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
}

.settings-section__header h2 {
  color: var(--ink-strong);
  font-size: 15px;
  letter-spacing: 0.025em;
}

.settings-section__header p {
  margin-top: 3px;
  color: var(--ink-muted);
  font-size: 11px;
  line-height: 1.45;
}

.settings-section__body {
  padding: 17px;
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.file-picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.file-picker__path {
  display: flex;
  height: var(--control-height, 36px);
  align-items: center;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm, 9px);
  color: var(--ink-muted);
  background: var(--surface-soft);
  font-size: 12px;
}

.import-actions {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.import-scope-warning {
  margin-top: 8px;
  padding: 7px 9px;
  border: 1px solid #e5c690;
  border-radius: var(--radius-sm, 9px);
  color: #805c1e;
  background: #fff8e9;
  font-size: 10px;
}

.import-year {
  width: 150px;
}

.import-preview {
  margin-top: 15px;
  padding: 14px;
  border: 1px solid var(--brand-border, #c8d9cf);
  border-radius: var(--radius, 12px);
  background: color-mix(in srgb, var(--brand-soft) 42%, var(--surface));
}

.import-preview__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.import-preview__title strong {
  color: var(--ink-strong);
  font-size: 12px;
}

.import-preview__title span {
  color: var(--ink-muted);
  font-size: 11px;
}

.preview-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
  margin: 11px 0;
}

.preview-stats span {
  display: flex;
  height: 38px;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  padding-top: 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm, 9px);
  color: var(--ink-muted);
  background: #fff;
  font-size: 10px;
}

.preview-stats strong {
  color: var(--ink-strong);
  font-family: "Bahnschrift", sans-serif;
  font-size: 14px;
}

.preview-stats .is-excluded {
  opacity: 0.48;
  filter: grayscale(0.7);
}

.warning-list {
  margin: 0 0 12px;
  padding-left: 18px;
  color: #7b5d2c;
  font-size: 11px;
  line-height: 1.7;
}

.import-result {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 14px;
  padding: 11px;
  border: 1px solid #bcd4c5;
  border-radius: var(--radius);
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.import-result div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.import-result strong {
  font-size: 12px;
}

.import-result span {
  font-size: 11px;
  line-height: 1.5;
}

.import-result .import-result__dedup {
  color: var(--ink-muted);
}

.unit-input {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-muted);
  font-size: 11px;
}

.unit-input .input {
  width: 96px;
}

.inline-status {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.inline-status > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--amber);
  font-size: 12px;
  font-weight: 650;
}

.inline-status > span::before {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  content: "";
}

.inline-status > span.is-success {
  color: var(--brand);
}

.backup-actions {
  display: flex;
  gap: 7px;
}

.backup-result {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm, 9px);
  background: var(--surface-soft);
}

.backup-result strong {
  min-width: 0;
  color: var(--ink);
  font-size: 11px;
}

.backup-result span,
.settings-note {
  flex: 0 0 auto;
  color: var(--ink-muted);
  font-size: 11px;
}

.settings-footer {
  display: flex;
  min-height: 56px;
  flex: 0 0 56px;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 18px);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  box-shadow: var(--shadow-soft);
  backdrop-filter: blur(12px);
}

.settings-footer span {
  color: var(--ink-muted);
  font-size: 12px;
}

@media (max-width: 1180px) {
  .settings-grid {
    grid-template-columns: minmax(0, 1.18fr) minmax(315px, 0.82fr);
    gap: 12px;
  }

  .settings-section__header {
    padding-inline: 14px;
  }

  .settings-section__body {
    padding: 14px;
  }
}
</style>
