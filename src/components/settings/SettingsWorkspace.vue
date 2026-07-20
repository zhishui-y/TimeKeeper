<script setup lang="ts">
import {
  BellRing,
  CheckCircle2,
  DatabaseBackup,
  FileSearch,
  FileSpreadsheet,
  HardDriveDownload,
  LockKeyhole,
  Save,
  ShieldCheck,
  Upload,
} from "@lucide/vue";
import { onMounted, reactive, shallowRef } from "vue";
import { api, errorMessage, isTauri } from "../../api/client";
import { useVault } from "../../composables/useVault";
import { useUiStore } from "../../stores/ui";
import type {
  AppSettings,
  BackupResult,
  ExcelImportPreview,
  ExcelImportResult,
} from "../../types/domain";
import type { AppNotificationPermission } from "../../api/types";
import { formatFileSize } from "../../utils/formatters";

const ui = useUiStore();
const settings = reactive<AppSettings>({
  defaultReminderMinutes: 30,
  autoLockMinutes: 15,
  backupRetention: 30,
  lastAutomaticBackupDate: null,
});
const loadingSettings = shallowRef(false);
const importPath = shallowRef("");
const baseYear = shallowRef(new Date().getFullYear());
const importPreview = shallowRef<ExcelImportPreview | null>(null);
const importResult = shallowRef<ExcelImportResult | null>(null);
const importBusy = shallowRef(false);
const backupBusy = shallowRef(false);
const lastBackup = shallowRef<BackupResult | null>(null);
const notificationPermission = shallowRef<AppNotificationPermission>("default");
const vaultPassword = shallowRef("");
const { status: vaultStatus, load: loadVault, unlock, initialize, lock } = useVault();

async function loadSettings(): Promise<void> {
  loadingSettings.value = true;
  try {
    Object.assign(settings, await api.getSettings());
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    loadingSettings.value = false;
  }
}

async function saveSettings(): Promise<void> {
  try {
    Object.assign(settings, await api.updateSettings({ ...settings }));
    await loadVault();
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
  importBusy.value = true;
  importResult.value = null;
  try {
    importPreview.value = await api.previewExcelImport(importPath.value, baseYear.value);
    ui.notify("导入预览已生成，请确认后再提交", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    importBusy.value = false;
  }
}

async function commitImport(): Promise<void> {
  if (!importPreview.value) return;
  importBusy.value = true;
  try {
    importResult.value = await api.commitExcelImport(importPreview.value.previewToken);
    importPreview.value = null;
    ui.markDataChanged();
    ui.notify("Excel 账本导入完成", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    importBusy.value = false;
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
  backupBusy.value = true;
  try {
    lastBackup.value = await api.createBackup(destination);
    ui.notify("完整备份已创建", "success");
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    backupBusy.value = false;
  }
}

async function restoreBackup(): Promise<void> {
  const path = await api.selectBackupFile();
  if (!path) return;
  if (!globalThis.confirm("恢复备份会先保存当前数据，成功后应用将重启。是否继续？")) return;
  backupBusy.value = true;
  try {
    await api.restoreBackup(path);
    if (!isTauri) {
      ui.markDataChanged();
      await Promise.all([loadSettings(), loadVault()]);
    }
    ui.notify(
      isTauri ? "备份已恢复，正在重启应用" : "演示模式：备份校验与恢复流程已完成",
      "success",
    );
  } catch (cause) {
    ui.notify(errorMessage(cause), "danger");
  } finally {
    backupBusy.value = false;
  }
}

async function submitVault(): Promise<void> {
  const result = vaultStatus.value.initialized
    ? await unlock(vaultPassword.value)
    : await initialize(vaultPassword.value);
  if (result) {
    vaultPassword.value = "";
    ui.notify("密码库已解锁", "success");
  }
}

async function lockVault(): Promise<void> {
  await lock();
  ui.notify("密码库已锁定", "success");
}

onMounted(() => {
  void Promise.all([loadSettings(), loadVault()]);
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
          <div class="import-actions">
            <label class="field import-year">
              <span class="field__label">短日期基准年份</span>
              <input
                v-model.number="baseYear"
                class="input mono-number"
                type="number"
                min="2000"
                max="2100"
              />
            </label>
            <button
              class="button"
              type="button"
              :disabled="!importPath || importBusy"
              @click="previewImport"
            >
              <FileSearch :size="15" />生成预览
            </button>
          </div>

          <div v-if="importPreview" class="import-preview">
            <div class="import-preview__title">
              <strong>预览结果</strong>
              <span>令牌将在30分钟后失效</span>
            </div>
            <div class="preview-stats">
              <span
                ><strong>{{ importPreview.appointmentCount }}</strong
                >预约</span
              >
              <span
                ><strong>{{ importPreview.profileCount }}</strong
                >账号</span
              >
              <span
                ><strong>{{ importPreview.crossMidnightCount }}</strong
                >跨夜</span
              >
              <span
                ><strong>{{ importPreview.unmatchedProfileCount }}</strong
                >待完善</span
              >
              <span
                ><strong>{{ importPreview.passwordConflictCount }}</strong
                >密码冲突</span
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
              :disabled="importBusy"
              @click="commitImport"
            >
              <CheckCircle2 :size="15" />确认导入
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
                个账号，跳过 {{ importResult.skippedDuplicates }} 条重复记录。</span
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
        <div class="settings-section__body settings-form">
          <div class="inline-status">
            <span :class="{ 'is-success': vaultStatus.unlocked }">
              {{
                vaultStatus.unlocked ? "已解锁" : vaultStatus.initialized ? "已锁定" : "未初始化"
              }}
            </span>
            <button
              v-if="vaultStatus.unlocked"
              class="button button--compact"
              type="button"
              @click="lockVault"
            >
              <LockKeyhole :size="14" />立即锁定
            </button>
          </div>
          <form v-if="!vaultStatus.unlocked" class="vault-form" @submit.prevent="submitVault">
            <input
              v-model="vaultPassword"
              class="input"
              type="password"
              :autocomplete="vaultStatus.initialized ? 'current-password' : 'new-password'"
              :placeholder="vaultStatus.initialized ? '输入主密码' : '设置主密码'"
            />
            <button class="button button--primary button--compact" type="submit">
              {{ vaultStatus.initialized ? "解锁" : "初始化" }}
            </button>
          </form>
          <label class="field">
            <span class="field__label">无操作自动锁定</span>
            <div class="unit-input">
              <input
                v-model.number="settings.autoLockMinutes"
                class="input mono-number"
                type="number"
                min="1"
                max="120"
              />
              <span>分钟</span>
            </div>
          </label>
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
              <HardDriveDownload :size="15" />导出完整备份
            </button>
            <button class="button" type="button" :disabled="backupBusy" @click="restoreBackup">
              <Upload :size="15" />从备份恢复
            </button>
          </div>
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
  min-height: 100%;
  gap: 12px;
}

.settings-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.85fr);
  grid-template-rows: minmax(218px, auto) minmax(205px, auto) minmax(150px, auto);
  gap: 12px;
}

.settings-section {
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.settings-section--import {
  grid-column: 1;
  grid-row: 1 / 3;
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

.settings-section--vault .settings-form {
  display: grid;
  grid-template-columns: minmax(190px, 0.8fr) minmax(260px, 1.2fr) minmax(180px, 0.8fr);
  align-items: end;
}

.settings-section__header {
  display: flex;
  min-height: 66px;
  align-items: center;
  gap: 11px;
  padding: 12px 15px;
  border-bottom: 1px solid var(--line);
  background: #f8faf7;
}

.settings-section__icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  border: 1px solid #cbdcd2;
  border-radius: 5px;
  color: var(--brand);
  background: var(--brand-soft);
}

.settings-section__header h2 {
  color: var(--ink-strong);
  font-size: 14px;
}

.settings-section__header p {
  margin-top: 3px;
  color: var(--ink-muted);
  font-size: 12px;
  line-height: 1.45;
}

.settings-section__body {
  padding: 15px;
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
  height: 34px;
  align-items: center;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--ink-muted);
  background: var(--surface-soft);
  font-size: 11px;
}

.import-actions {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.import-year {
  width: 150px;
}

.import-preview {
  margin-top: 15px;
  padding: 13px;
  border: 1px solid #c8d9cf;
  border-radius: var(--radius);
  background: #f5f8f4;
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
  border-radius: 4px;
  color: var(--ink-muted);
  background: #fff;
  font-size: 10px;
}

.preview-stats strong {
  color: var(--ink-strong);
  font-family: "Bahnschrift", sans-serif;
  font-size: 14px;
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
  font-size: 11px;
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

.vault-form,
.backup-actions {
  display: flex;
  gap: 7px;
}

.vault-form .input {
  min-width: 0;
  flex: 1;
}

.backup-result {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 9px;
  border: 1px solid var(--line);
  border-radius: 4px;
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
  min-height: 48px;
  flex: 0 0 48px;
  align-items: center;
  justify-content: space-between;
  padding: 0 13px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}

.settings-footer span {
  color: var(--ink-muted);
  font-size: 11px;
}
</style>
