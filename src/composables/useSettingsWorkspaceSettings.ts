import { computed, onMounted, reactive, readonly, shallowRef, toRaw } from "vue";
import { api, errorMessage } from "../api/client";
import { useUiStore } from "../stores/ui";
import type { AppSettings, AppearanceSettings } from "../types/domain";
import { DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS } from "../utils/accountTableColumns";
import {
  DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL,
  validateAccountRoleDataServerUrl,
} from "../utils/accountRoleData";
import { DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS } from "../utils/appointmentTableColumns";
import { useAppAppearance } from "./useAppAppearance";

function createDefaultSettings(): AppSettings {
  return {
    fontFamily: "Microsoft YaHei UI",
    baseFontSize: 15,
    defaultReminderMinutes: 30,
    backupRetention: 30,
    lastAutomaticBackupDate: null,
    accountTableColumnWidths: { ...DEFAULT_ACCOUNT_TABLE_COLUMN_WIDTHS },
    appointmentTableColumnWidths: { ...DEFAULT_APPOINTMENT_TABLE_COLUMN_WIDTHS },
    accountRoleDataServerUrl: DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL,
    accountRoleDataApiKey: "",
  };
}

export function useSettingsWorkspaceSettings() {
  const ui = useUiStore();
  const appearance = useAppAppearance();
  const settings = reactive<AppSettings>(createDefaultSettings());
  const loadingSettings = shallowRef(false);
  const savingSettings = shallowRef(false);
  const settingsState = shallowRef<"idle" | "loading" | "ready" | "stale" | "error">("idle");
  const settingsError = shallowRef<string | null>(null);
  const loadedSettingsSnapshot = shallowRef<AppSettings | null>(null);
  let settingsRequestVersion = 0;

  const settingsDirty = computed(() =>
    loadedSettingsSnapshot.value
      ? JSON.stringify(settings) !== JSON.stringify(loadedSettingsSnapshot.value)
      : false,
  );
  const serverUrlError = computed(() =>
    validateAccountRoleDataServerUrl(settings.accountRoleDataServerUrl),
  );

  function applyLoadedSettings(loaded: AppSettings): void {
    Object.assign(settings, loaded);
    loadedSettingsSnapshot.value = structuredClone(loaded);
    appearance.preview(settings);
    ui.setAppointmentDefaultReminderMinutes(settings.defaultReminderMinutes);
  }

  async function loadSettings(): Promise<void> {
    const version = ++settingsRequestVersion;
    loadingSettings.value = true;
    settingsState.value = "loading";
    settingsError.value = null;
    try {
      const loaded = await api.getSettings();
      if (version !== settingsRequestVersion) return;
      applyLoadedSettings(loaded);
      settingsState.value = "ready";
    } catch (cause) {
      if (version === settingsRequestVersion) {
        settingsError.value = errorMessage(cause);
        settingsState.value = loadedSettingsSnapshot.value ? "stale" : "error";
        ui.notify(settingsError.value, "danger");
      }
    } finally {
      if (version === settingsRequestVersion) loadingSettings.value = false;
    }
  }

  async function saveSettings(): Promise<boolean> {
    if (savingSettings.value || loadingSettings.value || settingsState.value !== "ready") {
      return false;
    }
    savingSettings.value = true;
    const version = ++settingsRequestVersion;
    try {
      // `settings` is a reactive proxy; clone its raw snapshot before crossing the API boundary.
      const saved = await appearance.persist(structuredClone(toRaw(settings)));
      if (version !== settingsRequestVersion) return false;
      applyLoadedSettings(saved);
      ui.notify("设置已保存", "success");
      return true;
    } catch (cause) {
      if (version === settingsRequestVersion) ui.notify(errorMessage(cause), "danger");
      return false;
    } finally {
      if (version === settingsRequestVersion) savingSettings.value = false;
    }
  }

  function updateAppearance(value: AppearanceSettings): void {
    settings.fontFamily = value.fontFamily;
    settings.baseFontSize = value.baseFontSize;
    appearance.preview(value);
  }

  function rollbackAppearance(): void {
    const restored = appearance.rollback();
    settings.fontFamily = restored.fontFamily;
    settings.baseFontSize = restored.baseFontSize;
  }

  function discardSettings(): void {
    const snapshot = loadedSettingsSnapshot.value;
    if (!snapshot) {
      rollbackAppearance();
      return;
    }
    Object.assign(settings, structuredClone(snapshot));
    appearance.preview(snapshot);
  }

  onMounted(() => {
    void loadSettings();
  });

  return {
    settings,
    loadingSettings: readonly(loadingSettings),
    savingSettings: readonly(savingSettings),
    settingsState: readonly(settingsState),
    settingsError: readonly(settingsError),
    settingsDirty,
    serverUrlError,
    appearance,
    loadSettings,
    saveSettings,
    updateAppearance,
    rollbackAppearance,
    discardSettings,
  };
}
