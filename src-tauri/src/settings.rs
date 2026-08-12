use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

use serde::{Deserialize, Serialize};
use tauri::State;
use thiserror::Error;

use crate::{
    accounts_remote::validate_account_role_data_server_url, app_access::AppAccessState,
    backup::BackupState,
};

const SETTINGS_FILE_NAME: &str = "settings.json";
const SETTINGS_RECOVERY_FILE_NAME: &str = "settings.previous.json";
pub const DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL: &str = "https://zhishui.cc/api/jx3/excel/";
pub const DEFAULT_FONT_FAMILY: &str = "Microsoft YaHei UI";
pub const DEFAULT_BASE_FONT_SIZE: u32 = 15;
const MAX_DEFAULT_REMINDER_MINUTES: u32 = 1_440;
const LEGACY_MAX_DEFAULT_REMINDER_MINUTES: u32 = 7 * 24 * 60;

fn default_account_role_data_server_url() -> String {
    DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL.to_string()
}

fn default_appointment_voice_column_width() -> u32 {
    88
}

fn default_account_name_column_width() -> u32 {
    48
}

fn default_account_password_column_width() -> u32 {
    104
}

const MIN_RESIZABLE_TABLE_COLUMN_WIDTH: u32 = 48;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountTableColumnWidths {
    pub contact_name: u32,
    pub server: u32,
    pub character_name: u32,
    pub specialization: u32,
    pub gear_score: u32,
    #[serde(default = "default_account_name_column_width")]
    pub account_name: u32,
    #[serde(default = "default_account_password_column_width")]
    pub password: u32,
    pub current_score: u32,
    pub highest_score: u32,
    pub score_updated_at: u32,
    #[serde(alias = "weekly")]
    pub weekly_wins: u32,
    pub notes: u32,
}

impl Default for AccountTableColumnWidths {
    fn default() -> Self {
        Self {
            contact_name: 90,
            server: 86,
            character_name: 86,
            specialization: 82,
            gear_score: 68,
            account_name: default_account_name_column_width(),
            password: default_account_password_column_width(),
            current_score: 62,
            highest_score: 62,
            score_updated_at: 102,
            weekly_wins: 96,
            notes: 160,
        }
    }
}

impl AccountTableColumnWidths {
    fn validate(&self) -> Result<(), SettingsError> {
        let widths = [
            (
                "联系人",
                self.contact_name,
                MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
            ),
            ("服务器", self.server, MIN_RESIZABLE_TABLE_COLUMN_WIDTH),
            (
                "角色名",
                self.character_name,
                MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
            ),
            (
                "职业 / 心法",
                self.specialization,
                MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
            ),
            ("装分", self.gear_score, MIN_RESIZABLE_TABLE_COLUMN_WIDTH),
            ("账号", self.account_name, MIN_RESIZABLE_TABLE_COLUMN_WIDTH),
            ("密码", self.password, MIN_RESIZABLE_TABLE_COLUMN_WIDTH),
            (
                "当前分",
                self.current_score,
                MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
            ),
            (
                "最高分",
                self.highest_score,
                MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
            ),
            (
                "更新日期",
                self.score_updated_at,
                MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
            ),
            (
                "本周胜场",
                self.weekly_wins,
                MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
            ),
            ("备注", self.notes, MIN_RESIZABLE_TABLE_COLUMN_WIDTH),
        ];
        for (label, width, minimum) in widths {
            if !(minimum..=480).contains(&width) {
                return Err(SettingsError::Validation(format!(
                    "账号表格{label}列宽必须在{minimum}到480像素之间"
                )));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentTableColumnWidths {
    pub service_date: u32,
    pub time_range: u32,
    pub contact_name: u32,
    pub content: u32,
    pub account: u32,
    #[serde(default = "default_appointment_voice_column_width")]
    pub voice: u32,
    pub mode: u32,
    pub service_status: u32,
    pub amount: u32,
    #[serde(alias = "paymentMethod")]
    pub notes: u32,
}

impl Default for AppointmentTableColumnWidths {
    fn default() -> Self {
        Self {
            service_date: 60,
            time_range: 88,
            contact_name: 72,
            content: 140,
            account: 180,
            voice: default_appointment_voice_column_width(),
            mode: 56,
            service_status: 74,
            amount: 68,
            notes: 120,
        }
    }
}

impl AppointmentTableColumnWidths {
    fn validate(&self) -> Result<(), SettingsError> {
        let widths = [
            ("日期", self.service_date, MIN_RESIZABLE_TABLE_COLUMN_WIDTH),
            ("时间", self.time_range, MIN_RESIZABLE_TABLE_COLUMN_WIDTH),
            (
                "联系人",
                self.contact_name,
                MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
            ),
            ("内容", self.content, MIN_RESIZABLE_TABLE_COLUMN_WIDTH),
            ("账号", self.account, MIN_RESIZABLE_TABLE_COLUMN_WIDTH),
            ("语音", self.voice, MIN_RESIZABLE_TABLE_COLUMN_WIDTH),
            ("模式", self.mode, MIN_RESIZABLE_TABLE_COLUMN_WIDTH),
            (
                "进度",
                self.service_status,
                MIN_RESIZABLE_TABLE_COLUMN_WIDTH,
            ),
            ("金额", self.amount, MIN_RESIZABLE_TABLE_COLUMN_WIDTH),
            ("备注", self.notes, MIN_RESIZABLE_TABLE_COLUMN_WIDTH),
        ];
        for (label, width, minimum) in widths {
            if !(minimum..=480).contains(&width) {
                return Err(SettingsError::Validation(format!(
                    "预约表格{label}列宽必须在{minimum}到480像素之间"
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_base_font_size")]
    pub base_font_size: u32,
    pub default_reminder_minutes: u32,
    pub backup_retention: u32,
    pub last_automatic_backup_date: Option<String>,
    #[serde(default)]
    pub account_table_column_widths: AccountTableColumnWidths,
    #[serde(default)]
    pub appointment_table_column_widths: AppointmentTableColumnWidths,
    #[serde(default = "default_account_role_data_server_url")]
    pub account_role_data_server_url: String,
    #[serde(default)]
    pub account_role_data_api_key: String,
}

impl std::fmt::Debug for AppSettings {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AppSettings")
            .field("font_family", &self.font_family)
            .field("base_font_size", &self.base_font_size)
            .field("default_reminder_minutes", &self.default_reminder_minutes)
            .field("backup_retention", &self.backup_retention)
            .field(
                "last_automatic_backup_date",
                &self.last_automatic_backup_date,
            )
            .field(
                "account_table_column_widths",
                &self.account_table_column_widths,
            )
            .field(
                "appointment_table_column_widths",
                &self.appointment_table_column_widths,
            )
            .field(
                "account_role_data_server_url",
                &self.account_role_data_server_url,
            )
            .field("account_role_data_api_key", &"<redacted>")
            .finish()
    }
}

fn default_font_family() -> String {
    DEFAULT_FONT_FAMILY.to_string()
}

fn default_base_font_size() -> u32 {
    DEFAULT_BASE_FONT_SIZE
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub font_family: String,
    pub base_font_size: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            font_family: default_font_family(),
            base_font_size: default_base_font_size(),
            default_reminder_minutes: 30,
            backup_retention: 30,
            last_automatic_backup_date: None,
            account_table_column_widths: AccountTableColumnWidths::default(),
            appointment_table_column_widths: AppointmentTableColumnWidths::default(),
            account_role_data_server_url: default_account_role_data_server_url(),
            account_role_data_api_key: String::new(),
        }
    }
}

impl AppSettings {
    fn normalize(&mut self) {
        self.font_family = self.font_family.trim().to_string();
        self.account_role_data_server_url = self.account_role_data_server_url.trim().to_string();
        self.account_role_data_api_key = self.account_role_data_api_key.trim().to_string();
    }

    pub(crate) fn normalize_legacy_default_reminder(&mut self) -> bool {
        if (MAX_DEFAULT_REMINDER_MINUTES + 1..=LEGACY_MAX_DEFAULT_REMINDER_MINUTES)
            .contains(&self.default_reminder_minutes)
        {
            self.default_reminder_minutes = 0;
            return true;
        }
        false
    }

    pub(crate) fn validate(&self) -> Result<(), SettingsError> {
        let font_length = self.font_family.chars().count();
        if !(1..=120).contains(&font_length)
            || self.font_family.contains('\r')
            || self.font_family.contains('\n')
        {
            return Err(SettingsError::Validation(
                "字体名必须是1到120个字符的单一系统字体名".into(),
            ));
        }
        if !(14..=18).contains(&self.base_font_size) {
            return Err(SettingsError::Validation(
                "基础字号必须在14到18像素之间".into(),
            ));
        }
        if self.default_reminder_minutes > MAX_DEFAULT_REMINDER_MINUTES {
            return Err(SettingsError::Validation(
                "默认提醒时间必须是0到1440分钟之间的整数".into(),
            ));
        }
        if !(1..=365).contains(&self.backup_retention) {
            return Err(SettingsError::Validation(
                "备份保留数量必须在1到365之间".into(),
            ));
        }
        if let Some(date) = &self.last_automatic_backup_date {
            chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| {
                SettingsError::Validation("自动备份日期必须使用 YYYY-MM-DD 格式".into())
            })?;
        }
        self.account_table_column_widths.validate()?;
        self.appointment_table_column_widths.validate()?;
        if self.account_role_data_server_url.is_empty() {
            return Err(SettingsError::Validation(
                "角色数据服务器 URL 不能为空".into(),
            ));
        }
        validate_account_role_data_server_url(&self.account_role_data_server_url)
            .map_err(SettingsError::Validation)?;
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("设置不合法：{0}")]
    Validation(String),
    #[error("无法读写设置文件：{0}")]
    Io(#[from] std::io::Error),
    #[error("设置文件格式无效：{0}")]
    Json(#[from] serde_json::Error),
    #[error("设置状态不可用")]
    StatePoisoned,
}

#[derive(Clone)]
pub struct SettingsState {
    path: PathBuf,
    recovery_path: PathBuf,
    inner: Arc<Mutex<AppSettings>>,
}

impl SettingsState {
    pub fn load(data_dir: impl AsRef<Path>) -> Result<Self, SettingsError> {
        let data_dir = data_dir.as_ref();
        fs::create_dir_all(data_dir)?;

        let path = data_dir.join(SETTINGS_FILE_NAME);
        let recovery_path = data_dir.join(SETTINGS_RECOVERY_FILE_NAME);
        let mut settings = load_with_recovery(&path, &recovery_path)?;
        let migrated_legacy_reminder = settings.normalize_legacy_default_reminder();
        settings.validate()?;

        if !path.exists() || migrated_legacy_reminder {
            write_settings_atomic(&path, &recovery_path, &settings)?;
        }

        Ok(Self {
            path,
            recovery_path,
            inner: Arc::new(Mutex::new(settings)),
        })
    }

    pub fn snapshot(&self) -> Result<AppSettings, SettingsError> {
        Ok(self.lock()?.clone())
    }

    #[cfg(test)]
    pub(crate) fn fail_writes_for_test(&mut self) {
        self.path = self.path.join("unwritable-settings.json");
        self.recovery_path = self.path.join("unwritable-settings.previous.json");
    }

    fn update_from_frontend(
        &self,
        mut proposed: AppSettings,
    ) -> Result<AppSettings, SettingsError> {
        let mut current = self.lock()?;

        // This value is maintained only after a backup has actually succeeded.
        proposed.last_automatic_backup_date = current.last_automatic_backup_date.clone();
        proposed.normalize();
        proposed.validate()?;
        write_settings_atomic(&self.path, &self.recovery_path, &proposed)?;
        *current = proposed.clone();
        Ok(proposed)
    }

    pub(crate) fn record_automatic_backup_date(
        &self,
        date: chrono::NaiveDate,
    ) -> Result<AppSettings, SettingsError> {
        let mut current = self.lock()?;
        let mut updated = current.clone();
        updated.last_automatic_backup_date = Some(date.format("%Y-%m-%d").to_string());
        write_settings_atomic(&self.path, &self.recovery_path, &updated)?;
        *current = updated.clone();
        Ok(updated)
    }

    pub(crate) fn update_account_table_column_widths(
        &self,
        widths: AccountTableColumnWidths,
    ) -> Result<AccountTableColumnWidths, SettingsError> {
        widths.validate()?;
        let mut current = self.lock()?;
        let mut updated = current.clone();
        updated.account_table_column_widths = widths.clone();
        write_settings_atomic(&self.path, &self.recovery_path, &updated)?;
        *current = updated;
        Ok(widths)
    }

    pub(crate) fn update_appointment_table_column_widths(
        &self,
        widths: AppointmentTableColumnWidths,
    ) -> Result<AppointmentTableColumnWidths, SettingsError> {
        widths.validate()?;
        let mut current = self.lock()?;
        let mut updated = current.clone();
        updated.appointment_table_column_widths = widths.clone();
        write_settings_atomic(&self.path, &self.recovery_path, &updated)?;
        *current = updated;
        Ok(widths)
    }

    fn lock(&self) -> Result<MutexGuard<'_, AppSettings>, SettingsError> {
        self.inner.lock().map_err(|_| SettingsError::StatePoisoned)
    }
}

#[tauri::command]
pub fn get_settings(
    state: State<'_, SettingsState>,
    access: State<'_, AppAccessState>,
) -> Result<AppSettings, String> {
    access.require_unlocked()?;
    state.snapshot().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_app_appearance(state: State<'_, SettingsState>) -> Result<AppearanceSettings, String> {
    let settings = state.snapshot().map_err(|error| error.to_string())?;
    Ok(AppearanceSettings {
        font_family: settings.font_family,
        base_font_size: settings.base_font_size,
    })
}

#[tauri::command]
pub async fn update_settings(
    mut settings: AppSettings,
    state: State<'_, SettingsState>,
    backup: State<'_, BackupState>,
    access: State<'_, AppAccessState>,
) -> Result<AppSettings, String> {
    access.require_unlocked()?;
    let _operation_guard = backup.lock_data_operation().await;
    settings.normalize();
    settings.validate().map_err(|error| error.to_string())?;
    state
        .update_from_frontend(settings)
        .map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_account_table_column_widths(
    widths: AccountTableColumnWidths,
    state: State<'_, SettingsState>,
    backup: State<'_, BackupState>,
    access: State<'_, AppAccessState>,
) -> Result<AccountTableColumnWidths, String> {
    access.require_unlocked()?;
    let _operation_guard = backup.lock_data_operation().await;
    state
        .update_account_table_column_widths(widths)
        .map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_appointment_table_column_widths(
    widths: AppointmentTableColumnWidths,
    state: State<'_, SettingsState>,
    backup: State<'_, BackupState>,
    access: State<'_, AppAccessState>,
) -> Result<AppointmentTableColumnWidths, String> {
    access.require_unlocked()?;
    let _operation_guard = backup.lock_data_operation().await;
    state
        .update_appointment_table_column_widths(widths)
        .map_err(|error| error.to_string())
}

fn load_with_recovery(path: &Path, recovery_path: &Path) -> Result<AppSettings, SettingsError> {
    if path.exists() {
        return read_settings(path);
    }
    if recovery_path.exists() {
        let settings = read_settings(recovery_path)?;
        let next_path =
            path.with_extension(format!("recovered-{}.next", uuid::Uuid::now_v7().simple()));
        let mut next = File::create(&next_path)?;
        next.write_all(&serde_json::to_vec_pretty(&settings)?)?;
        next.sync_all()?;
        drop(next);
        fs::rename(&next_path, path)?;
        fs::remove_file(recovery_path)?;
        return Ok(settings);
    }
    Ok(AppSettings::default())
}

fn read_settings(path: &Path) -> Result<AppSettings, SettingsError> {
    let bytes = fs::read(path)?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn write_settings_atomic(
    path: &Path,
    recovery_path: &Path,
    settings: &AppSettings,
) -> Result<(), SettingsError> {
    let parent = path
        .parent()
        .ok_or_else(|| SettingsError::Validation("设置文件路径缺少父目录".into()))?;
    fs::create_dir_all(parent)?;

    let next_path = parent.join(format!(".settings-{}.next", uuid::Uuid::now_v7().simple()));
    let bytes = serde_json::to_vec_pretty(settings)?;
    let mut next = File::create(&next_path)?;
    next.write_all(&bytes)?;
    next.sync_all()?;
    drop(next);

    if recovery_path.exists() {
        fs::remove_file(recovery_path)?;
    }
    if path.exists() {
        fs::rename(path, recovery_path)?;
    }

    if let Err(error) = fs::rename(&next_path, path) {
        if recovery_path.exists() {
            let _ = fs::rename(recovery_path, path);
        }
        let _ = fs::remove_file(next_path);
        return Err(SettingsError::Io(error));
    }

    if recovery_path.exists() {
        fs::remove_file(recovery_path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "timekeeper-settings-{name}-{}",
            uuid::Uuid::now_v7()
        ))
    }

    #[test]
    fn creates_and_round_trips_defaults() {
        let dir = test_dir("defaults");
        let state = SettingsState::load(&dir).unwrap();
        assert_eq!(state.snapshot().unwrap(), AppSettings::default());

        let reloaded = SettingsState::load(&dir).unwrap();
        assert_eq!(reloaded.snapshot().unwrap(), AppSettings::default());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn validates_default_reminder_minute_boundaries() {
        for minutes in [0, MAX_DEFAULT_REMINDER_MINUTES] {
            let settings = AppSettings {
                default_reminder_minutes: minutes,
                ..AppSettings::default()
            };
            assert!(settings.validate().is_ok(), "{minutes} should be accepted");
        }

        let settings = AppSettings {
            default_reminder_minutes: MAX_DEFAULT_REMINDER_MINUTES + 1,
            ..AppSettings::default()
        };
        assert!(matches!(
            settings.validate(),
            Err(SettingsError::Validation(message))
                if message == "默认提醒时间必须是0到1440分钟之间的整数"
        ));
    }

    #[test]
    fn rejects_non_unsigned_integer_default_reminder_values_during_deserialization() {
        let defaults = serde_json::to_value(AppSettings::default()).unwrap();
        for invalid in [serde_json::json!(-1), serde_json::json!(1.5)] {
            let mut value = defaults.clone();
            value["defaultReminderMinutes"] = invalid;
            assert!(serde_json::from_value::<AppSettings>(value).is_err());
        }
    }

    #[test]
    fn migrates_legacy_default_reminders_to_disabled_and_persists_the_result() {
        for minutes in [
            MAX_DEFAULT_REMINDER_MINUTES + 1,
            LEGACY_MAX_DEFAULT_REMINDER_MINUTES,
        ] {
            let dir = test_dir("legacy-reminder");
            fs::create_dir_all(&dir).unwrap();
            let legacy = AppSettings {
                default_reminder_minutes: minutes,
                ..AppSettings::default()
            };
            fs::write(
                dir.join(SETTINGS_FILE_NAME),
                serde_json::to_vec_pretty(&legacy).unwrap(),
            )
            .unwrap();

            let loaded = SettingsState::load(&dir).unwrap().snapshot().unwrap();
            assert_eq!(loaded.default_reminder_minutes, 0);
            let persisted: AppSettings =
                serde_json::from_slice(&fs::read(dir.join(SETTINGS_FILE_NAME)).unwrap()).unwrap();
            assert_eq!(persisted.default_reminder_minutes, 0);
            fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn keeps_previously_invalid_default_reminders_rejected_during_load() {
        let dir = test_dir("invalid-legacy-reminder");
        fs::create_dir_all(&dir).unwrap();
        let invalid = AppSettings {
            default_reminder_minutes: LEGACY_MAX_DEFAULT_REMINDER_MINUTES + 1,
            ..AppSettings::default()
        };
        fs::write(
            dir.join(SETTINGS_FILE_NAME),
            serde_json::to_vec_pretty(&invalid).unwrap(),
        )
        .unwrap();

        assert!(matches!(
            SettingsState::load(&dir),
            Err(SettingsError::Validation(_))
        ));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn recovers_previous_file_after_interrupted_replace() {
        let dir = test_dir("recovery");
        fs::create_dir_all(&dir).unwrap();
        let recovery = dir.join(SETTINGS_RECOVERY_FILE_NAME);
        fs::write(
            &recovery,
            serde_json::to_vec(&AppSettings::default()).unwrap(),
        )
        .unwrap();

        let state = SettingsState::load(&dir).unwrap();
        assert_eq!(state.snapshot().unwrap(), AppSettings::default());
        assert!(dir.join(SETTINGS_FILE_NAME).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn automatic_backup_date_is_persisted() {
        let dir = test_dir("backup-date");
        let state = SettingsState::load(&dir).unwrap();
        let date = chrono::NaiveDate::from_ymd_opt(2026, 7, 13).unwrap();
        state.record_automatic_backup_date(date).unwrap();

        let reloaded = SettingsState::load(&dir).unwrap();
        assert_eq!(
            reloaded
                .snapshot()
                .unwrap()
                .last_automatic_backup_date
                .as_deref(),
            Some("2026-07-13")
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn loads_legacy_settings_with_default_account_table_preferences() {
        let dir = test_dir("legacy-account-table-preferences");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(SETTINGS_FILE_NAME),
            serde_json::to_vec(&serde_json::json!({
                "defaultReminderMinutes": 45,
                "autoLockMinutes": 20,
                "backupRetention": 14,
                "lastAutomaticBackupDate": null
            }))
            .unwrap(),
        )
        .unwrap();

        let loaded = SettingsState::load(&dir).unwrap().snapshot().unwrap();
        assert_eq!(
            loaded.account_table_column_widths,
            AccountTableColumnWidths::default()
        );
        assert_eq!(
            loaded.appointment_table_column_widths,
            AppointmentTableColumnWidths::default()
        );
        assert_eq!(loaded.account_role_data_api_key, "");
        assert_eq!(
            loaded.account_role_data_server_url,
            DEFAULT_ACCOUNT_ROLE_DATA_SERVER_URL
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn loads_legacy_payment_method_width_as_notes_width() {
        let widths: AppointmentTableColumnWidths = serde_json::from_value(serde_json::json!({
            "serviceDate": 60,
            "timeRange": 88,
            "contactName": 72,
            "content": 140,
            "account": 180,
            "mode": 56,
            "serviceStatus": 74,
            "settlementStatus": 74,
            "amount": 68,
            "paymentMethod": 88
        }))
        .unwrap();

        assert_eq!(widths.notes, 88);
        assert_eq!(widths.voice, default_appointment_voice_column_width());
        let serialized = serde_json::to_value(widths).unwrap();
        assert_eq!(
            serialized.get("notes").and_then(|value| value.as_u64()),
            Some(88)
        );
        assert!(serialized.get("paymentMethod").is_none());
        assert!(serialized.get("settlementStatus").is_none());
    }

    #[test]
    fn loads_legacy_account_widths_with_account_and_password_defaults() {
        let widths: AccountTableColumnWidths = serde_json::from_value(serde_json::json!({
            "contactName": 90,
            "server": 86,
            "characterName": 86,
            "specialization": 82,
            "gearScore": 68,
            "currentScore": 62,
            "highestScore": 62,
            "scoreUpdatedAt": 102,
            "weekly": 224,
            "notes": 160
        }))
        .unwrap();

        assert_eq!(widths.account_name, default_account_name_column_width());
        assert_eq!(widths.password, default_account_password_column_width());
        assert_eq!(widths.weekly_wins, 224);
    }

    #[test]
    fn validates_normalizes_and_persists_role_data_server_url() {
        let dir = test_dir("role-data-server-url");
        let state = SettingsState::load(&dir).unwrap();
        let proposed = AppSettings {
            account_role_data_server_url: "  https://example.test/jx3/  ".into(),
            account_role_data_api_key: "  excel-secret  ".into(),
            ..AppSettings::default()
        };
        let updated = state.update_from_frontend(proposed).unwrap();
        assert_eq!(
            updated.account_role_data_server_url,
            "https://example.test/jx3/"
        );
        assert_eq!(updated.account_role_data_api_key, "excel-secret");
        assert_eq!(
            SettingsState::load(&dir)
                .unwrap()
                .snapshot()
                .unwrap()
                .account_role_data_server_url,
            "https://example.test/jx3/"
        );

        for invalid in [
            "file:///tmp/data",
            "https://user:pass@example.test/",
            "https://example.test/?token=x",
            "https://example.test/#fragment",
        ] {
            let settings = AppSettings {
                account_role_data_server_url: invalid.into(),
                ..AppSettings::default()
            };
            assert!(matches!(
                settings.validate(),
                Err(SettingsError::Validation(_))
            ));
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn debug_output_redacts_role_data_api_key() {
        let settings = AppSettings {
            account_role_data_api_key: "must-not-appear".into(),
            ..AppSettings::default()
        };
        let output = format!("{settings:?}");
        assert!(!output.contains("must-not-appear"));
        assert!(output.contains("<redacted>"));
    }

    #[test]
    fn validates_and_persists_account_table_column_widths_independently() {
        let dir = test_dir("account-table-widths");
        let state = SettingsState::load(&dir).unwrap();
        let widths = AccountTableColumnWidths {
            weekly_wins: 240,
            notes: 220,
            ..AccountTableColumnWidths::default()
        };
        assert_eq!(
            state
                .update_account_table_column_widths(widths.clone())
                .unwrap(),
            widths
        );
        let reloaded = SettingsState::load(&dir).unwrap().snapshot().unwrap();
        assert_eq!(reloaded.account_table_column_widths, widths);
        let invalid = AccountTableColumnWidths {
            weekly_wins: 47,
            ..AccountTableColumnWidths::default()
        };
        assert!(state.update_account_table_column_widths(invalid).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn validates_and_persists_appointment_table_column_widths_independently() {
        let dir = test_dir("appointment-table-widths");
        let state = SettingsState::load(&dir).unwrap();
        let account_widths = AccountTableColumnWidths {
            notes: 224,
            ..AccountTableColumnWidths::default()
        };
        state
            .update_account_table_column_widths(account_widths.clone())
            .unwrap();
        let widths = AppointmentTableColumnWidths {
            content: 220,
            account: 240,
            voice: 144,
            ..AppointmentTableColumnWidths::default()
        };
        assert_eq!(
            state
                .update_appointment_table_column_widths(widths.clone())
                .unwrap(),
            widths
        );
        let reloaded = SettingsState::load(&dir).unwrap().snapshot().unwrap();
        assert_eq!(reloaded.appointment_table_column_widths, widths);
        assert_eq!(reloaded.account_table_column_widths, account_widths);
        let invalid = AppointmentTableColumnWidths {
            voice: 47,
            ..AppointmentTableColumnWidths::default()
        };
        assert!(
            state
                .update_appointment_table_column_widths(invalid)
                .is_err()
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
