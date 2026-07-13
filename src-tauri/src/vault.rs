use std::{
    fmt::Display,
    path::{Path, PathBuf},
    str,
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant},
};

use arboard::Clipboard;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_stronghold::{
    kdf::KeyDerivation,
    stronghold::{Error as StrongholdError, Stronghold},
};
use thiserror::Error;

use crate::{backup, backup::BackupState, settings::SettingsState};

const VAULT_FILE_NAME: &str = "vault.hold";
const SALT_FILE_NAME: &str = "vault.salt";
const CLIENT_ID: &[u8] = b"timekeeper-accounts-v1";
const VERIFIER_KEY: &[u8] = b"timekeeper:vault-verifier";
const VERIFIER_VALUE: &[u8] = b"timekeeper-vault-v1";
const PASSWORD_KEY_PREFIX: &str = "account-password:";
const DEFAULT_AUTO_LOCK_MINUTES: u32 = 15;
const CLIPBOARD_CLEAR_AFTER: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub initialized: bool,
    pub unlocked: bool,
    pub auto_lock_minutes: u32,
}

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("主密码至少需要8个字符")]
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
    #[error("保险库盐文件丢失或损坏")]
    InvalidSalt,
    #[error("账号 ID 不合法")]
    InvalidAccountId,
    #[error("该账号尚未保存密码")]
    PasswordNotFound,
    #[error("密码不是有效的 UTF-8 文本")]
    InvalidPasswordEncoding,
    #[error("保险库状态不可用")]
    StatePoisoned,
    #[error("自动锁定时间必须在1到1440分钟之间")]
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
    auto_lock_after: Duration,
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
                auto_lock_after: Duration::from_secs(u64::from(DEFAULT_AUTO_LOCK_MINUTES) * 60),
            }),
        })
    }

    pub fn initialize(&self, password: String) -> Result<VaultStatus, VaultError> {
        if self.snapshot_path.exists() {
            return Err(VaultError::AlreadyInitialized);
        }
        if password.chars().count() < 8 {
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
        let stronghold =
            Stronghold::new(&self.snapshot_path, key).map_err(|_| VaultError::UnlockFailed)?;
        let client = stronghold
            .load_client(CLIENT_ID)
            .map_err(|_| VaultError::UnlockFailed)?;
        let verifier = client
            .store()
            .get(VERIFIER_KEY)
            .map_err(|_| VaultError::UnlockFailed)?;
        if verifier.as_deref() != Some(VERIFIER_VALUE) {
            return Err(VaultError::UnlockFailed);
        }

        let mut session = self.lock_session()?;
        session.stronghold = Some(stronghold);
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
        if !(1..=24 * 60).contains(&minutes) {
            return Err(VaultError::InvalidAutoLock);
        }
        let mut session = self.lock_session()?;
        session.auto_lock_after = Duration::from_secs(u64::from(minutes) * 60);
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
        self.session.lock().unwrap().auto_lock_after = duration;
    }
}

#[tauri::command]
pub fn vault_status(state: State<'_, VaultState>) -> Result<VaultStatus, String> {
    state.status().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn initialize_vault<R: Runtime>(
    password: String,
    app: AppHandle<R>,
) -> Result<VaultStatus, String> {
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
) -> Result<VaultStatus, String> {
    let worker_app = app.clone();
    let status =
        run_blocking_vault_operation(move || worker_app.state::<VaultState>().unlock(password))
            .await?;
    schedule_daily_backup(&app);
    Ok(status)
}

async fn run_blocking_vault_operation<F>(operation: F) -> Result<VaultStatus, String>
where
    F: FnOnce() -> Result<VaultStatus, VaultError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("保险库后台任务执行失败：{error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn lock_vault(state: State<'_, VaultState>) -> Result<VaultStatus, String> {
    state.lock().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reveal_account_password(id: String, state: State<'_, VaultState>) -> Result<String, String> {
    state.get_secret(&id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn copy_account_password(id: String, state: State<'_, VaultState>) -> Result<(), String> {
    let password = state.get_secret(&id).map_err(|error| error.to_string())?;
    let password_hash = Sha256::digest(password.as_bytes());
    Clipboard::new()
        .and_then(|mut clipboard| clipboard.set_text(password))
        .map_err(|error| VaultError::Clipboard(error.to_string()).to_string())?;

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(CLIPBOARD_CLEAR_AFTER).await;
        let Ok(mut clipboard) = Clipboard::new() else {
            return;
        };
        let Ok(current) = clipboard.get_text() else {
            return;
        };
        if Sha256::digest(current.as_bytes()).as_slice() == password_hash.as_slice() {
            let _ = clipboard.set_text(String::new());
        }
    });
    Ok(())
}

pub fn spawn_auto_lock_task<R: Runtime>(app: AppHandle<R>) {
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

fn enforce_idle_lock(session: &mut VaultSession) {
    if session.stronghold.is_none() {
        return;
    }
    if session
        .last_activity
        .is_some_and(|last| last.elapsed() >= session.auto_lock_after)
    {
        session.stronghold = None;
        session.last_activity = None;
    }
}

fn status_from_session(initialized: bool, session: &VaultSession) -> VaultStatus {
    VaultStatus {
        initialized,
        unlocked: session.stronghold.is_some(),
        auto_lock_minutes: (session.auto_lock_after.as_secs() / 60) as u32,
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
    fn refuses_short_initial_password() {
        let dir = test_dir("weak");
        let state = VaultState::new(&dir).unwrap();
        assert!(matches!(
            state.initialize("short".into()),
            Err(VaultError::WeakPassword)
        ));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
