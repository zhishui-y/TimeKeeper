<script setup lang="ts">
import {
  BellRing,
  CheckCircle2,
  DatabaseBackup,
  FileSearch,
  FileSpreadsheet,
  HardDriveDownload,
  Save,
  ServerCog,
  ShieldCheck,
  Upload,
  Palette,
} from "@lucide/vue";
import { computed, shallowRef, useTemplateRef } from "vue";
import { api, errorMessage } from "../../api/client";
import { useSettingsWorkspaceBackup } from "../../composables/useSettingsWorkspaceBackup";
import { useSettingsWorkspaceExcel } from "../../composables/useSettingsWorkspaceExcel";
import { useSettingsWorkspaceLeave } from "../../composables/useSettingsWorkspaceLeave";
import { useSettingsWorkspaceSettings } from "../../composables/useSettingsWorkspaceSettings";
import { useModalFocus } from "../../composables/useModalFocus";
import { useOperationStore } from "../../stores/operations";
import { useUiStore } from "../../stores/ui";
import type { AppNotificationPermission } from "../../api/types";
import { formatFileSize } from "../../utils/formatters";
import AccountRoleDataServerPanel from "./AccountRoleDataServerPanel.vue";
import OperationProgress from "./OperationProgress.vue";
import ExcelImportScopeSelector from "./ExcelImportScopeSelector.vue";
import AppAccessSettingsPanel from "./AppAccessSettingsPanel.vue";
import AppearanceSettingsPanel from "./AppearanceSettingsPanel.vue";

type HtmlElement = InstanceType<typeof globalThis.HTMLElement>;

const ui = useUiStore();
const operations = useOperationStore();
const {
  settings,
  loadingSettings,
  savingSettings,
  settingsState,
  settingsError,
  settingsDirty,
  serverUrlError,
  appearance,
  loadSettings,
  saveSettings,
  updateAppearance,
  rollbackAppearance,
  discardSettings,
} = useSettingsWorkspaceSettings();
const {
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
} = useSettingsWorkspaceExcel();
const { backupOperation, backupBusy, lastBackup, backupProgress, createBackup, restoreBackup } =
  useSettingsWorkspaceBackup({ reloadSettings: loadSettings });
const { leaveDialogOpen, finishLeaveDecision, saveAndLeave, discardAndLeave } =
  useSettingsWorkspaceLeave({
    dirty: settingsDirty,
    save: saveSettings,
    discard: discardSettings,
    rollbackPreview: () => appearance.rollback(),
  });
const notificationPermission = shallowRef<AppNotificationPermission>("default");
const settingsGrid = useTemplateRef<HtmlElement>("settingsGrid");
const leaveDialog = useTemplateRef<HtmlElement>("leaveDialog");
const settingsInteractionBusy = computed(
  () =>
    loadingSettings.value ||
    savingSettings.value ||
    operations.busy ||
    settingsState.value !== "ready",
);

useModalFocus({
  open: () => leaveDialogOpen.value,
  container: leaveDialog,
  close: () => finishLeaveDecision(false),
});

function scrollToSettingsSection(sectionId: string): void {
  const grid = settingsGrid.value;
  const section = grid?.querySelector<HtmlElement>(`#${sectionId}`);
  if (!grid || !section) return;
  const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  grid.scrollTo({
    top: section.offsetTop - grid.offsetTop + grid.scrollTop,
    behavior: prefersReducedMotion ? "auto" : "smooth",
  });
  section.focus({ preventScroll: true });
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
</script>

<template>
  <div class="settings-workspace page-stack">
    <div v-if="loadingSettings" class="loading-line" />
    <div v-if="settingsState === 'error'" class="settings-load-error" role="alert">
      <span>{{ settingsError || "设置加载失败" }}</span>
      <button class="button button--compact" type="button" @click="loadSettings">重试</button>
    </div>
    <div v-else-if="settingsState === 'stale'" class="stale-banner" role="status">
      设置刷新失败，当前保留上次成功加载的快照；重新加载成功前不能保存。
      <button class="button button--compact" type="button" @click="loadSettings">重新加载</button>
    </div>
    <nav class="settings-nav" aria-label="设置分类">
      <button
        type="button"
        aria-controls="appearance"
        @click="scrollToSettingsSection('appearance')"
      >
        <Palette :size="15" />外观
      </button>
      <button type="button" aria-controls="access" @click="scrollToSettingsSection('access')">
        <ShieldCheck :size="15" />入口安全
      </button>
      <button
        type="button"
        aria-controls="notifications"
        @click="scrollToSettingsSection('notifications')"
      >
        <BellRing :size="15" />提醒
      </button>
      <button type="button" aria-controls="role-data" @click="scrollToSettingsSection('role-data')">
        <ServerCog :size="15" />角色数据
      </button>
      <button type="button" aria-controls="excel" @click="scrollToSettingsSection('excel')">
        <FileSpreadsheet :size="15" />Excel
      </button>
      <button type="button" aria-controls="backup" @click="scrollToSettingsSection('backup')">
        <DatabaseBackup :size="15" />备份
      </button>
    </nav>
    <div
      ref="settingsGrid"
      class="settings-grid"
      :inert="settingsInteractionBusy"
      :aria-busy="settingsInteractionBusy"
    >
      <section id="appearance" class="settings-section settings-section--appearance" tabindex="-1">
        <header class="settings-section__header">
          <div class="settings-section__icon"><Palette :size="19" /></div>
          <div>
            <h2>外观与字体</h2>
            <p>字体和字号覆盖锁屏、导航、表格与日历；只使用本机已安装字体。</p>
          </div>
        </header>
        <div class="settings-section__body">
          <AppearanceSettingsPanel
            :model-value="{ fontFamily: settings.fontFamily, baseFontSize: settings.baseFontSize }"
            :fallback-message="appearance.fallbackMessage.value"
            @update="updateAppearance"
          />
        </div>
      </section>

      <section id="excel" class="settings-section settings-section--import" tabindex="-1">
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
              <span :class="{ 'is-excluded': !importSelection.appointments }"
                ><strong>{{ importPreview.yyChannelCount }}</strong
                >YY频道{{ importSelection.appointments ? "" : "（不导入）" }}</span
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
              <ul v-if="importResult.warnings.length" class="warning-list">
                <li v-for="warning in importResult.warnings" :key="warning">{{ warning }}</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section
        id="notifications"
        class="settings-section settings-section--notifications"
        tabindex="-1"
      >
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

      <section id="access" class="settings-section settings-section--access" tabindex="-1">
        <header class="settings-section__header">
          <div class="settings-section__icon"><ShieldCheck :size="19" /></div>
          <div>
            <h2>应用入口</h2>
            <p>入口密码用于防止他人随手打开应用；忘记后可以无损重置。</p>
          </div>
        </header>
        <div class="settings-section__body">
          <AppAccessSettingsPanel />
        </div>
      </section>

      <section id="role-data" class="settings-section settings-section--role-data" tabindex="-1">
        <header class="settings-section__header">
          <div class="settings-section__icon"><ServerCog :size="19" /></div>
          <div>
            <h2>角色数据服务器</h2>
            <p>为账号档案更新装分、当前分、最高分、本周胜场和服务端日期。</p>
          </div>
        </header>
        <div class="settings-section__body">
          <AccountRoleDataServerPanel
            v-model:server-url="settings.accountRoleDataServerUrl"
            v-model:api-key="settings.accountRoleDataApiKey"
          />
        </div>
      </section>

      <section id="backup" class="settings-section settings-section--backup" tabindex="-1">
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
      <button
        class="button button--ghost button--compact"
        type="button"
        :disabled="settingsInteractionBusy"
        @click="rollbackAppearance"
      >
        撤销外观预览
      </button>
      <button
        class="button button--primary"
        type="button"
        :disabled="Boolean(serverUrlError) || settingsInteractionBusy || !settingsDirty"
        @click="saveSettings"
      >
        <Save :size="15" />{{ savingSettings ? "正在保存…" : "保存设置" }}
      </button>
    </footer>

    <Teleport to="body">
      <div v-if="leaveDialogOpen" class="leave-dialog-layer">
        <div
          ref="leaveDialog"
          class="leave-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-title"
          tabindex="-1"
        >
          <h2 id="leave-title">设置尚未保存</h2>
          <p>外观预览和其他修改尚未写入。你可以保存后离开、放弃修改，或继续编辑。</p>
          <div class="leave-dialog__actions">
            <button
              class="button"
              type="button"
              :disabled="savingSettings"
              @click="finishLeaveDecision(false)"
            >
              继续编辑
            </button>
            <button
              class="button"
              type="button"
              :disabled="savingSettings"
              @click="discardAndLeave"
            >
              放弃修改
            </button>
            <button
              class="button button--primary"
              type="button"
              :disabled="savingSettings || operations.busy"
              @click="saveAndLeave"
            >
              {{ savingSettings ? "正在保存…" : "保存并离开" }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.settings-workspace {
  position: relative;
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: max-content minmax(0, 1fr) 56px;
  gap: 14px;
}

.settings-load-error,
.stale-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  border: 1px solid var(--amber-border);
  border-radius: var(--radius-sm, 8px);
  color: #815414;
  background: var(--amber-soft);
}

.leave-dialog-layer {
  position: fixed;
  z-index: 120;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(24, 35, 31, 0.42);
}

.leave-dialog {
  width: min(460px, 100%);
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg, 16px);
  background: var(--surface);
  box-shadow: 0 24px 64px rgba(20, 35, 29, 0.24);
}

.leave-dialog h2 {
  color: var(--ink-strong);
  font-size: calc(18px + var(--app-font-size-offset, 0px));
}

.leave-dialog p {
  margin-top: 10px;
  color: var(--ink-muted);
  line-height: 1.6;
}

.leave-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.settings-nav {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 1px 0;
  scrollbar-gutter: stable;
}

.settings-nav button {
  display: inline-flex;
  min-height: 32px;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 0 11px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink-muted);
  background: color-mix(in srgb, var(--surface) 86%, transparent);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
  font-family: inherit;
  cursor: pointer;
}

.settings-nav button:hover,
.settings-nav button:focus-visible {
  border-color: var(--brand-border);
  color: var(--brand-strong);
  background: var(--brand-soft);
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
  grid-template-rows: max-content max-content max-content max-content max-content;
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
  grid-row: 2 / 4;
  align-self: start;
}

.settings-section--appearance {
  grid-column: 1 / -1;
  grid-row: 1;
}

.settings-section--backup {
  grid-column: 2;
  grid-row: 2;
}

.settings-section--notifications {
  grid-column: 2;
  grid-row: 3;
}

.settings-section--access {
  grid-column: 1 / -1;
  grid-row: 5;
}

.settings-section--role-data {
  grid-column: 2;
  grid-row: 4;
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
  font-size: calc(15px + var(--app-font-size-offset, 0px));
  letter-spacing: 0.025em;
}

.settings-section__header p {
  margin-top: 3px;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.import-preview__title span {
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.preview-stats strong {
  color: var(--ink-strong);
  font-family: var(--app-font-family), "Bahnschrift", sans-serif;
  font-size: calc(14px + var(--app-font-size-offset, 0px));
}

.preview-stats .is-excluded {
  opacity: 0.48;
  filter: grayscale(0.7);
}

.warning-list {
  margin: 0 0 12px;
  padding-left: 18px;
  color: #7b5d2c;
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.import-result span {
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
}

.backup-result span,
.settings-note {
  flex: 0 0 auto;
  color: var(--ink-muted);
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
  font-size: calc(12px + var(--app-font-size-offset, 0px));
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
