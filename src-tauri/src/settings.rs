use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

use serde::{Deserialize, Serialize};
use tauri::State;
use thiserror::Error;

use crate::{backup::BackupState, vault::VaultState};

const SETTINGS_FILE_NAME: &str = "settings.json";
const SETTINGS_RECOVERY_FILE_NAME: &str = "settings.previous.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub default_reminder_minutes: u32,
    pub auto_lock_minutes: u32,
    pub backup_retention: u32,
    pub last_automatic_backup_date: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_reminder_minutes: 30,
            auto_lock_minutes: 15,
            backup_retention: 30,
            last_automatic_backup_date: None,
        }
    }
}

impl AppSettings {
    pub(crate) fn validate(&self) -> Result<(), SettingsError> {
        if self.default_reminder_minutes > 7 * 24 * 60 {
            return Err(SettingsError::Validation("默认提醒时间不能超过7天".into()));
        }
        if self.auto_lock_minutes > 24 * 60 {
            return Err(SettingsError::Validation(
                "自动锁定时间必须为0（不自动锁定）或1到1440分钟".into(),
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
        let settings = load_with_recovery(&path, &recovery_path)?;
        settings.validate()?;

        if !path.exists() {
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

    fn update_from_frontend(
        &self,
        mut proposed: AppSettings,
    ) -> Result<AppSettings, SettingsError> {
        let mut current = self.lock()?;

        // This value is maintained only after a backup has actually succeeded.
        proposed.last_automatic_backup_date = current.last_automatic_backup_date.clone();
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

    fn lock(&self) -> Result<MutexGuard<'_, AppSettings>, SettingsError> {
        self.inner.lock().map_err(|_| SettingsError::StatePoisoned)
    }
}

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> Result<AppSettings, String> {
    state.snapshot().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_settings(
    settings: AppSettings,
    state: State<'_, SettingsState>,
    vault: State<'_, VaultState>,
    backup: State<'_, BackupState>,
) -> Result<AppSettings, String> {
    let _operation_guard = backup.lock_data_operation().await;
    settings.validate().map_err(|error| error.to_string())?;

    let previous_auto_lock = state
        .snapshot()
        .map_err(|error| error.to_string())?
        .auto_lock_minutes;
    vault
        .set_auto_lock_minutes(settings.auto_lock_minutes)
        .map_err(|error| error.to_string())?;

    match state.update_from_frontend(settings) {
        Ok(updated) => Ok(updated),
        Err(error) => {
            let _ = vault.set_auto_lock_minutes(previous_auto_lock);
            Err(error.to_string())
        }
    }
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
    fn accepts_disabled_auto_lock_and_rejects_unsafe_ranges() {
        let disabled = AppSettings {
            auto_lock_minutes: 0,
            ..AppSettings::default()
        };
        disabled.validate().unwrap();

        let invalid = AppSettings {
            auto_lock_minutes: 1441,
            ..AppSettings::default()
        };
        assert!(matches!(
            invalid.validate(),
            Err(SettingsError::Validation(_))
        ));
    }

    #[test]
    fn persists_disabled_auto_lock() {
        let dir = test_dir("disabled-auto-lock");
        let state = SettingsState::load(&dir).unwrap();
        let disabled = AppSettings {
            auto_lock_minutes: 0,
            ..AppSettings::default()
        };

        state.update_from_frontend(disabled.clone()).unwrap();

        assert_eq!(
            SettingsState::load(&dir).unwrap().snapshot().unwrap(),
            disabled
        );
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
}
