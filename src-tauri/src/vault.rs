use std::{
    fmt::Display,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    str,
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant},
};

use arboard::Clipboard;
use iota_stronghold::{KeyProvider, SnapshotPath};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_stronghold::{
    kdf::KeyDerivation,
    stronghold::{Error as StrongholdError, Stronghold},
};
use thiserror::Error;
use zeroize::Zeroizing;

use crate::{backup, backup::BackupState, settings::SettingsState};

const VAULT_FILE_NAME: &str = "vault.hold";
const SALT_FILE_NAME: &str = "vault.salt";
const CLIENT_ID: &[u8] = b"timekeeper-accounts-v1";
const VERIFIER_KEY: &[u8] = b"timekeeper:vault-verifier";
const VERIFIER_VALUE: &[u8] = b"timekeeper-vault-v1";
const PASSWORD_KEY_PREFIX: &str = "account-password:";
const MIN_MASTER_PASSWORD_CHARACTERS: usize = 4;
const DEFAULT_AUTO_LOCK_MINUTES: u32 = 15;
const CLIPBOARD_CLEAR_AFTER: Duration = Duration::from_secs(30);
// Stronghold v3 的密文头和最小封装长度可在无主密码时检查；密文真实性仍只能在解锁时验证。
const STRONGHOLD_SNAPSHOT_HEADER: [u8; 7] = [0x50, 0x41, 0x52, 0x54, 0x49, 0x03, 0x00];
const STRONGHOLD_MIN_SNAPSHOT_BYTES: u64 = 173;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub initialized: bool,
    pub unlocked: bool,
    pub auto_lock_minutes: u32,
}

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("主密码至少需要4个字符")]
    WeakPassword,
    #[error("主密码不能为空")]
    EmptyPassword,
    #[error("保险库尚未初始化")]
    NotInitialized,
    #[error("保险库已经初始化")]
    AlreadyInitialized,
    #[error("保险库已锁定，请先解锁")]
    Locked,
    #[error("主密码错误或保险库已经损坏")]
    UnlockFailed,
    #[error("当前主密码不正确")]
    CurrentPasswordIncorrect,
    #[error("新主密码不能与当前主密码相同")]
    SamePassword,
    #[error("保险库盐文件丢失或损坏")]
    InvalidSalt,
    #[error("Stronghold 快照文件格式无效")]
    InvalidSnapshot,
    #[error("账号 ID 不合法")]
    InvalidAccountId,
    #[error("该账号尚未保存密码")]
    PasswordNotFound,
    #[error("密码不是有效的 UTF-8 文本")]
    InvalidPasswordEncoding,
    #[error("保险库状态不可用")]
    StatePoisoned,
    #[error("自动锁定时间必须为0（不自动锁定）或1到1440分钟")]
    InvalidAutoLock,
    #[error("保险库操作失败：{0}")]
    Stronghold(#[from] StrongholdError),
    #[error("保险库内部操作失败：{0}")]
    Operation(String),
    #[error("无法访问保险库文件：{0}")]
    Io(#[from] std::io::Error),
    #[error("无法访问系统剪贴板：{0}")]
    Clipboard(String),
}

struct VaultSession {
    stronghold: Option<Stronghold>,
    last_activity: Option<Instant>,
    auto_lock_after: Option<Duration>,
}

pub struct VaultState {
    snapshot_path: PathBuf,
    salt_path: PathBuf,
    session: Mutex<VaultSession>,
}

impl VaultState {
    pub fn new(data_dir: impl AsRef<Path>) -> Result<Self, VaultError> {
        let data_dir = data_dir.as_ref();
        std::fs::create_dir_all(data_dir)?;
        Ok(Self {
            snapshot_path: data_dir.join(VAULT_FILE_NAME),
            salt_path: data_dir.join(SALT_FILE_NAME),
            session: Mutex::new(VaultSession {
                stronghold: None,
                last_activity: None,
                auto_lock_after: Some(Duration::from_secs(
                    u64::from(DEFAULT_AUTO_LOCK_MINUTES) * 60,
                )),
            }),
        })
    }

    pub fn initialize(&self, password: String) -> Result<VaultStatus, VaultError> {
        if self.snapshot_path.exists() {
            return Err(VaultError::AlreadyInitialized);
        }
        if password.chars().count() < MIN_MASTER_PASSWORD_CHARACTERS {
            return Err(VaultError::WeakPassword);
        }

        let key = derive_key(password, &self.salt_path, false)?;
        let stronghold = Stronghold::new(&self.snapshot_path, key)?;
        let client = stronghold
            .create_client(CLIENT_ID)
            .map_err(operation_error)?;
        client
            .store()
            .insert(VERIFIER_KEY.to_vec(), VERIFIER_VALUE.to_vec(), None)
            .map_err(operation_error)?;
        stronghold.save()?;

        let mut session = self.lock_session()?;
        session.stronghold = Some(stronghold);
        session.last_activity = Some(Instant::now());
        Ok(status_from_session(true, &session))
    }

    pub fn unlock(&self, password: String) -> Result<VaultStatus, VaultError> {
        if !self.snapshot_path.exists() {
            return Err(VaultError::NotInitialized);
        }
        if password.is_empty() {
            return Err(VaultError::EmptyPassword);
        }

        let key = derive_key(password, &self.salt_path, true)?;
        let stronghold = load_verified_stronghold(&self.snapshot_path, key)
            .map_err(|_| VaultError::UnlockFailed)?;

        let mut session = self.lock_session()?;
        session.stronghold = Some(stronghold);
        session.last_activity = Some(Instant::now());
        Ok(status_from_session(true, &session))
    }

    pub fn change_password(
        &self,
        current_password: String,
        new_password: String,
    ) -> Result<VaultStatus, VaultError> {
        if current_password.is_empty() {
            return Err(VaultError::EmptyPassword);
        }
        if new_password.chars().count() < MIN_MASTER_PASSWORD_CHARACTERS {
            return Err(VaultError::WeakPassword);
        }
        if current_password == new_password {
            return Err(VaultError::SamePassword);
        }

        let mut session = self.active_session()?;
        let current_key = derive_key(current_password, &self.salt_path, true)?;
        load_verified_stronghold(&self.snapshot_path, current_key)
            .map_err(|_| VaultError::CurrentPasswordIncorrect)?;

        let new_key = derive_key(new_password, &self.salt_path, true)?;
        let new_key_provider =
            KeyProvider::try_from(Zeroizing::new(new_key.clone())).map_err(operation_error)?;
        let candidate_dir = self.snapshot_path.parent().ok_or_else(|| {
            VaultError::Operation("保险库路径缺少父目录，无法创建换密候选文件".into())
        })?;
        let candidate_dir =
            candidate_dir.join(format!(".vault-rekey-{}", uuid::Uuid::now_v7().simple()));
        std::fs::create_dir_all(&candidate_dir)?;
        let candidate_path = candidate_dir.join(VAULT_FILE_NAME);

        let candidate_result: Result<(), VaultError> = (|| {
            let active = session.stronghold.as_ref().ok_or(VaultError::Locked)?;
            active
                .inner()
                .commit_with_keyprovider(
                    &SnapshotPath::from_path(&candidate_path),
                    &new_key_provider,
                )
                .map_err(operation_error)?;
            let candidate = load_verified_stronghold(&candidate_path, new_key.clone())
                .map_err(operation_error)?;
            drop(candidate);
            Ok(())
        })();
        let cleanup_result = std::fs::remove_dir_all(&candidate_dir);
        candidate_result?;
        cleanup_result?;

        let replacement = {
            let active = session.stronghold.as_ref().ok_or(VaultError::Locked)?;
            active
                .inner()
                .commit_with_keyprovider(
                    &SnapshotPath::from_path(&self.snapshot_path),
                    &new_key_provider,
                )
                .map_err(operation_error)?;

            match load_verified_stronghold(&self.snapshot_path, new_key) {
                Ok(replacement) => replacement,
                Err(reload_error) => {
                    let rollback_result = active.save();
                    if let Err(rollback_error) = rollback_result {
                        session.stronghold = None;
                        session.last_activity = None;
                        return Err(VaultError::Operation(format!(
                            "修改主密码后无法重新加载保险库，且恢复原密码失败：{reload_error}；{rollback_error}"
                        )));
                    }
                    return Err(VaultError::Operation(format!(
                        "修改主密码后无法重新加载保险库，已恢复原密码：{reload_error}"
                    )));
                }
            }
        };

        session.stronghold = Some(replacement);
        session.last_activity = Some(Instant::now());
        Ok(status_from_session(true, &session))
    }

    pub fn lock(&self) -> Result<VaultStatus, VaultError> {
        let mut session = self.lock_session()?;
        session.stronghold = None;
        session.last_activity = None;
        Ok(status_from_session(self.snapshot_path.exists(), &session))
    }

    pub fn status(&self) -> Result<VaultStatus, VaultError> {
        let mut session = self.lock_session()?;
        enforce_idle_lock(&mut session);
        Ok(status_from_session(self.snapshot_path.exists(), &session))
    }

    pub fn set_auto_lock_minutes(&self, minutes: u32) -> Result<(), VaultError> {
        if minutes > 24 * 60 {
            return Err(VaultError::InvalidAutoLock);
        }
        let mut session = self.lock_session()?;
        session.auto_lock_after =
            (minutes > 0).then(|| Duration::from_secs(u64::from(minutes) * 60));
        enforce_idle_lock(&mut session);
        Ok(())
    }

    pub(crate) fn lock_if_idle(&self) -> Result<bool, VaultError> {
        let mut session = self.lock_session()?;
        let was_unlocked = session.stronghold.is_some();
        enforce_idle_lock(&mut session);
        Ok(was_unlocked && session.stronghold.is_none())
    }

    pub(crate) fn set_secret(
        &self,
        account_id: &str,
        password: String,
    ) -> Result<Option<String>, VaultError> {
        let key = password_key(account_id)?;
        let mut session = self.active_session()?;
        let stronghold = session.stronghold.as_ref().ok_or(VaultError::Locked)?;
        let client = stronghold.get_client(CLIENT_ID).map_err(operation_error)?;
        let previous = client
            .store()
            .insert(key.clone(), password.into_bytes(), None)
            .map_err(operation_error)?;

        if let Err(error) = stronghold.save() {
            match &previous {
                Some(value) => {
                    let _ = client.store().insert(key, value.clone(), None);
                }
                None => {
                    let _ = client.store().delete(&key);
                }
            }
            return Err(error.into());
        }
        session.last_activity = Some(Instant::now());
        decode_optional_password(previous)
    }

    pub(crate) fn remove_secret(&self, account_id: &str) -> Result<Option<String>, VaultError> {
        let key = password_key(account_id)?;
        let mut session = self.active_session()?;
        let stronghold = session.stronghold.as_ref().ok_or(VaultError::Locked)?;
        let client = stronghold.get_client(CLIENT_ID).map_err(operation_error)?;
        let previous = client.store().delete(&key).map_err(operation_error)?;

        if let Err(error) = stronghold.save() {
            if let Some(value) = &previous {
                let _ = client.store().insert(key, value.clone(), None);
            }
            return Err(error.into());
        }
        session.last_activity = Some(Instant::now());
        decode_optional_password(previous)
    }

    pub(crate) fn get_secret(&self, account_id: &str) -> Result<String, VaultError> {
        let key = password_key(account_id)?;
        let mut session = self.active_session()?;
        let stronghold = session.stronghold.as_ref().ok_or(VaultError::Locked)?;
        let client = stronghold.get_client(CLIENT_ID).map_err(operation_error)?;
        let bytes = client
            .store()
            .get(&key)
            .map_err(operation_error)?
            .ok_or(VaultError::PasswordNotFound)?;
        session.last_activity = Some(Instant::now());
        String::from_utf8(bytes).map_err(|_| VaultError::InvalidPasswordEncoding)
    }

    fn active_session(&self) -> Result<MutexGuard<'_, VaultSession>, VaultError> {
        let mut session = self.lock_session()?;
        enforce_idle_lock(&mut session);
        if session.stronghold.is_none() {
            return Err(VaultError::Locked);
        }
        Ok(session)
    }

    fn lock_session(&self) -> Result<MutexGuard<'_, VaultSession>, VaultError> {
        self.session.lock().map_err(|_| VaultError::StatePoisoned)
    }

    #[cfg(test)]
    fn set_auto_lock_duration(&self, duration: Duration) {
        self.session.lock().unwrap().auto_lock_after = Some(duration);
    }
}

pub(crate) fn validate_backup_files(
    snapshot_path: &Path,
    salt_path: &Path,
) -> Result<(), VaultError> {
    let salt_metadata = std::fs::metadata(salt_path)?;
    if !salt_metadata.is_file() || salt_metadata.len() != 32 {
        return Err(VaultError::InvalidSalt);
    }

    let snapshot_metadata = std::fs::metadata(snapshot_path)?;
    if !snapshot_metadata.is_file() || snapshot_metadata.len() < STRONGHOLD_MIN_SNAPSHOT_BYTES {
        return Err(VaultError::InvalidSnapshot);
    }

    let mut header = [0_u8; STRONGHOLD_SNAPSHOT_HEADER.len()];
    File::open(snapshot_path)?.read_exact(&mut header)?;
    if header != STRONGHOLD_SNAPSHOT_HEADER {
        return Err(VaultError::InvalidSnapshot);
    }
    Ok(())
}

#[tauri::command]
pub fn vault_status(state: State<'_, VaultState>) -> Result<VaultStatus, String> {
    state.status().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn initialize_vault<R: Runtime>(
    password: String,
    app: AppHandle<R>,
    backup: State<'_, BackupState>,
) -> Result<VaultStatus, String> {
    let backup = backup.inner().clone();
    let _operation_guard = backup.lock_data_operation().await;
    let worker_app = app.clone();
    let status =
        run_blocking_vault_operation(move || worker_app.state::<VaultState>().initialize(password))
            .await?;
    schedule_daily_backup(&app);
    Ok(status)
}

#[tauri::command]
pub async fn unlock_vault<R: Runtime>(
    password: String,
    app: AppHandle<R>,
    backup: State<'_, BackupState>,
) -> Result<VaultStatus, String> {
    let backup = backup.inner().clone();
    let _operation_guard = backup.lock_data_operation().await;
    let worker_app = app.clone();
    let status =
        run_blocking_vault_operation(move || worker_app.state::<VaultState>().unlock(password))
            .await?;
    schedule_daily_backup(&app);
    Ok(status)
}

#[tauri::command]
pub async fn change_vault_password<R: Runtime>(
    current_password: String,
    new_password: String,
    app: AppHandle<R>,
    backup: State<'_, BackupState>,
) -> Result<VaultStatus, String> {
    let backup = backup.inner().clone();
    let _operation_guard = backup.lock_data_operation().await;
    let worker_app = app.clone();
    run_blocking_vault_operation(move || {
        worker_app
            .state::<VaultState>()
            .change_password(current_password, new_password)
    })
    .await
}

pub(crate) async fn run_blocking_vault_operation<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, VaultError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("保险库后台任务执行失败：{error}"))?
        .map_err(|error| error.to_string())
}

pub(crate) async fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    run_blocking_vault_operation(move || {
        Clipboard::new()
            .and_then(|mut clipboard| clipboard.set_text(text))
            .map_err(|error| VaultError::Clipboard(error.to_string()))
    })
    .await
}

#[tauri::command]
pub fn lock_vault(state: State<'_, VaultState>) -> Result<VaultStatus, String> {
    state.lock().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn reveal_account_password<R: Runtime>(
    id: String,
    app: AppHandle<R>,
) -> Result<String, String> {
    let worker_app = app.clone();
    run_blocking_vault_operation(move || worker_app.state::<VaultState>().get_secret(&id)).await
}

#[tauri::command]
pub async fn copy_account_password<R: Runtime>(
    id: String,
    app: AppHandle<R>,
) -> Result<(), String> {
    let worker_app = app.clone();
    let password_hash = run_blocking_vault_operation(move || {
        let password = worker_app.state::<VaultState>().get_secret(&id)?;
        let password_hash = Sha256::digest(password.as_bytes()).to_vec();
        Clipboard::new()
            .and_then(|mut clipboard| clipboard.set_text(password))
            .map_err(|error| VaultError::Clipboard(error.to_string()))?;
        Ok(password_hash)
    })
    .await?;

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(CLIPBOARD_CLEAR_AFTER).await;
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let Ok(mut clipboard) = Clipboard::new() else {
                return;
            };
            let Ok(current) = clipboard.get_text() else {
                return;
            };
            if Sha256::digest(current.as_bytes()).as_slice() == password_hash.as_slice() {
                let _ = clipboard.set_text(String::new());
            }
        })
        .await;
    });
    Ok(())
}

pub fn spawn_auto_lock_task<R: Runtime>(app: AppHandle<R>) {
    let backup_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            let Some(state) = app.try_state::<VaultState>() else {
                return;
            };
            let _ = state.lock_if_idle();
        }
    });

    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            let Some(state) = backup_app.try_state::<VaultState>() else {
                return;
            };
            let should_check_backup = state.status().is_ok_and(|status| status.initialized);
            if !should_check_backup {
                continue;
            }
            let Some(backup_state) = backup_app.try_state::<BackupState>() else {
                return;
            };
            let Some(settings_state) = backup_app.try_state::<SettingsState>() else {
                return;
            };
            let backup_state = backup_state.inner().clone();
            let settings_state = settings_state.inner().clone();
            if let Err(error) =
                backup::create_automatic_backup_if_due(&backup_state, &settings_state).await
            {
                eprintln!("automatic backup failed: {error}");
            }
        }
    });
}

fn schedule_daily_backup<R: Runtime>(app: &AppHandle<R>) {
    let Some(backup_state) = app.try_state::<BackupState>() else {
        return;
    };
    let Some(settings_state) = app.try_state::<SettingsState>() else {
        return;
    };
    let backup_state = backup_state.inner().clone();
    let settings_state = settings_state.inner().clone();

    tauri::async_runtime::spawn(async move {
        if let Err(error) =
            backup::create_automatic_backup_if_due(&backup_state, &settings_state).await
        {
            eprintln!("automatic backup failed: {error}");
        }
    });
}

fn derive_key(
    password: String,
    salt_path: &Path,
    require_existing_salt: bool,
) -> Result<Vec<u8>, VaultError> {
    if require_existing_salt && !salt_path.is_file() {
        return Err(VaultError::InvalidSalt);
    }
    if salt_path.exists() && std::fs::metadata(salt_path)?.len() != 32 {
        return Err(VaultError::InvalidSalt);
    }

    let mut password_bytes = password.into_bytes();
    let password_text =
        str::from_utf8(&password_bytes).expect("a Rust String is always valid UTF-8");
    let derived = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        KeyDerivation::argon2(password_text, salt_path)
    }));
    password_bytes.fill(0);

    let key = derived.map_err(|_| VaultError::InvalidSalt)?;
    if key.len() != 32 {
        return Err(VaultError::InvalidSalt);
    }
    Ok(key)
}

fn password_key(account_id: &str) -> Result<Vec<u8>, VaultError> {
    let account_id = account_id.trim();
    if account_id.is_empty() || account_id.len() > 256 {
        return Err(VaultError::InvalidAccountId);
    }
    Ok(format!("{PASSWORD_KEY_PREFIX}{account_id}").into_bytes())
}

fn decode_optional_password(value: Option<Vec<u8>>) -> Result<Option<String>, VaultError> {
    value
        .map(|bytes| String::from_utf8(bytes).map_err(|_| VaultError::InvalidPasswordEncoding))
        .transpose()
}

fn operation_error(error: impl Display) -> VaultError {
    VaultError::Operation(error.to_string())
}

fn load_verified_stronghold(
    snapshot_path: &Path,
    key: Vec<u8>,
) -> Result<Stronghold, StrongholdError> {
    let stronghold = Stronghold::new(snapshot_path, key)?;
    let client = stronghold.load_client(CLIENT_ID)?;
    let verifier = client.store().get(VERIFIER_KEY)?;
    if verifier.as_deref() != Some(VERIFIER_VALUE) {
        return Err(StrongholdError::StrongholdNotInitialized);
    }
    Ok(stronghold)
}

fn enforce_idle_lock(session: &mut VaultSession) {
    if session.stronghold.is_none() {
        return;
    }
    let Some(auto_lock_after) = session.auto_lock_after else {
        return;
    };
    if session
        .last_activity
        .is_some_and(|last| last.elapsed() >= auto_lock_after)
    {
        session.stronghold = None;
        session.last_activity = None;
    }
}

fn status_from_session(initialized: bool, session: &VaultSession) -> VaultStatus {
    VaultStatus {
        initialized,
        unlocked: session.stronghold.is_some(),
        auto_lock_minutes: session
            .auto_lock_after
            .map_or(0, |duration| (duration.as_secs() / 60) as u32),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("timekeeper-vault-{name}-{}", uuid::Uuid::now_v7()))
    }

    #[test]
    fn initializes_locks_and_unlocks_with_the_same_password() {
        let dir = test_dir("round-trip");
        let state = VaultState::new(&dir).unwrap();
        let status = state
            .initialize("correct horse battery staple".into())
            .unwrap();
        assert!(status.initialized);
        assert!(status.unlocked);

        assert!(!state.lock().unwrap().unlocked);
        assert!(state.unlock("wrong password".into()).is_err());
        assert!(
            state
                .unlock("correct horse battery staple".into())
                .unwrap()
                .unlocked
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn stores_replaces_and_removes_account_passwords() {
        let dir = test_dir("passwords");
        let state = VaultState::new(&dir).unwrap();
        state
            .initialize("a sufficiently long password".into())
            .unwrap();

        assert_eq!(state.set_secret("account-1", "first".into()).unwrap(), None);
        assert_eq!(state.get_secret("account-1").unwrap(), "first");
        assert_eq!(
            state
                .set_secret("account-1", "second".into())
                .unwrap()
                .as_deref(),
            Some("first")
        );
        assert_eq!(
            state.remove_secret("account-1").unwrap().as_deref(),
            Some("second")
        );
        assert!(matches!(
            state.get_secret("account-1"),
            Err(VaultError::PasswordNotFound)
        ));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn idle_timeout_drops_the_in_memory_stronghold() {
        let dir = test_dir("idle");
        let state = VaultState::new(&dir).unwrap();
        state
            .initialize("a sufficiently long password".into())
            .unwrap();
        state.set_auto_lock_duration(Duration::from_millis(1));
        std::thread::sleep(Duration::from_millis(5));

        assert!(state.lock_if_idle().unwrap());
        assert!(!state.status().unwrap().unlocked);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn disabled_auto_lock_keeps_the_vault_unlocked() {
        let dir = test_dir("disabled-auto-lock");
        let state = VaultState::new(&dir).unwrap();
        state
            .initialize("a sufficiently long password".into())
            .unwrap();
        state.set_auto_lock_minutes(0).unwrap();
        state.session.lock().unwrap().last_activity =
            Some(Instant::now() - Duration::from_secs(24 * 60 * 60));

        assert!(!state.lock_if_idle().unwrap());
        let status = state.status().unwrap();
        assert!(status.unlocked);
        assert_eq!(status.auto_lock_minutes, 0);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn changes_master_password_without_losing_account_passwords() {
        let dir = test_dir("change-password");
        let state = VaultState::new(&dir).unwrap();
        state.initialize("old password".into()).unwrap();
        state
            .set_secret("account-1", "saved account password".into())
            .unwrap();
        {
            let session = state.active_session().unwrap();
            let stronghold = session.stronghold.as_ref().unwrap();
            let extra_client = stronghold
                .create_client(b"timekeeper-extra-client")
                .unwrap();
            extra_client
                .store()
                .insert(b"extra-key".to_vec(), b"extra-value".to_vec(), None)
                .unwrap();
            stronghold.save().unwrap();
        }
        let salt_before = std::fs::read(&state.salt_path).unwrap();

        assert!(
            state
                .change_password("old password".into(), "1234".into())
                .unwrap()
                .unlocked
        );
        assert_eq!(std::fs::read(&state.salt_path).unwrap(), salt_before);
        assert!(std::fs::read_dir(&dir).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".vault-rekey-")
        }));
        state.lock().unwrap();
        assert!(state.unlock("old password".into()).is_err());
        assert!(state.unlock("1234".into()).unwrap().unlocked);
        assert_eq!(
            state.get_secret("account-1").unwrap(),
            "saved account password"
        );
        {
            let session = state.active_session().unwrap();
            let stronghold = session.stronghold.as_ref().unwrap();
            let extra_client = stronghold.load_client(b"timekeeper-extra-client").unwrap();
            assert_eq!(
                extra_client.store().get(b"extra-key").unwrap().as_deref(),
                Some(b"extra-value".as_slice())
            );
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_password_change_keeps_the_existing_password() {
        let dir = test_dir("change-password-failure");
        let state = VaultState::new(&dir).unwrap();
        state.initialize("old password".into()).unwrap();
        state
            .set_secret("account-1", "saved account password".into())
            .unwrap();
        let snapshot_before = std::fs::read(&state.snapshot_path).unwrap();

        assert!(matches!(
            state.change_password("wrong password".into(), "new secure password".into()),
            Err(VaultError::CurrentPasswordIncorrect)
        ));
        assert!(matches!(
            state.change_password("old password".into(), "123".into()),
            Err(VaultError::WeakPassword)
        ));
        assert!(matches!(
            state.change_password("old password".into(), "old password".into()),
            Err(VaultError::SamePassword)
        ));
        assert_eq!(
            std::fs::read(&state.snapshot_path).unwrap(),
            snapshot_before
        );
        assert_eq!(
            state.get_secret("account-1").unwrap(),
            "saved account password"
        );

        state.lock().unwrap();
        assert!(state.unlock("old password".into()).unwrap().unlocked);
        assert!(state.unlock("new secure password".into()).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn enforces_four_character_initial_password_minimum() {
        let dir = test_dir("weak");
        let state = VaultState::new(&dir).unwrap();
        assert!(matches!(
            state.initialize("123".into()),
            Err(VaultError::WeakPassword)
        ));
        assert!(state.initialize("1234".into()).unwrap().unlocked);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
