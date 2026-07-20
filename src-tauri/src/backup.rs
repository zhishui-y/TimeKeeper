use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};

use chrono::{Days, Local, NaiveDate, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Connection, Row, SqliteConnection, sqlite::SqliteConnectOptions};
use tauri::{AppHandle, Runtime, State};
use thiserror::Error;
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::{
    accounts::profile_from_row,
    appointments::appointment_from_row,
    db::MIGRATOR,
    models::{AppointmentMode, SettlementStatus},
    settings::{AppSettings, SettingsError, SettingsState},
    vault,
};

const BACKUP_FORMAT_VERSION: u32 = 1;
const DATABASE_ARCHIVE_NAME: &str = "database.sqlite3";
const VAULT_ARCHIVE_NAME: &str = "vault.hold";
const SALT_ARCHIVE_NAME: &str = "vault.salt";
const SETTINGS_ARCHIVE_NAME: &str = "settings.json";
const MANIFEST_ARCHIVE_NAME: &str = "manifest.json";
const REQUIRED_ARCHIVE_FILES: [&str; 4] = [
    DATABASE_ARCHIVE_NAME,
    SETTINGS_ARCHIVE_NAME,
    VAULT_ARCHIVE_NAME,
    SALT_ARCHIVE_NAME,
];
const REQUIRED_DATABASE_TABLES: [&str; 3] =
    ["account_profiles", "appointments", "_sqlx_migrations"];
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_ENTRY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Clone, Copy)]
struct RequiredColumn {
    name: &'static str,
    declared_type: &'static str,
    not_null: bool,
    default_value: Option<&'static str>,
    primary_key: i64,
}

const ACCOUNT_PROFILE_COLUMNS: [RequiredColumn; 15] = [
    required_column("id", "TEXT", true, None, 1),
    required_column("contact_name", "TEXT", false, None, 0),
    required_column("server", "TEXT", false, None, 0),
    required_column("character_name", "TEXT", false, None, 0),
    required_column("specialization", "TEXT", false, None, 0),
    required_column("gear_score", "TEXT", false, None, 0),
    required_column("account_name", "TEXT", true, None, 0),
    required_column("current_score", "INTEGER", false, None, 0),
    required_column("highest_score", "INTEGER", false, None, 0),
    required_column("score_updated_at", "TEXT", false, None, 0),
    required_column("notes", "TEXT", false, None, 0),
    required_column("needs_review", "INTEGER", true, Some("0"), 0),
    required_column("import_fingerprint", "TEXT", false, None, 0),
    required_column("created_at", "TEXT", true, None, 0),
    required_column("updated_at", "TEXT", true, None, 0),
];

const APPOINTMENT_COLUMNS: [RequiredColumn; 19] = [
    required_column("id", "TEXT", true, None, 1),
    required_column("service_date", "TEXT", true, None, 0),
    required_column("starts_at", "TEXT", false, None, 0),
    required_column("ends_at", "TEXT", false, None, 0),
    required_column("contact_name", "TEXT", true, None, 0),
    required_column("content", "TEXT", false, None, 0),
    required_column("mode", "TEXT", true, None, 0),
    required_column("service_status", "TEXT", true, None, 0),
    required_column("settlement_status", "TEXT", true, None, 0),
    required_column("account_profile_id", "TEXT", false, None, 0),
    required_column("account_snapshot_json", "TEXT", false, None, 0),
    required_column("rate_note", "TEXT", false, None, 0),
    required_column("payment_method", "TEXT", false, None, 0),
    required_column("amount_minor", "INTEGER", false, None, 0),
    required_column("reminder_minutes", "INTEGER", false, None, 0),
    required_column("notes", "TEXT", false, None, 0),
    required_column("import_fingerprint", "TEXT", false, None, 0),
    required_column("created_at", "TEXT", true, None, 0),
    required_column("updated_at", "TEXT", true, None, 0),
];

const MIGRATION_COLUMNS: [RequiredColumn; 6] = [
    required_column("version", "BIGINT", false, None, 1),
    required_column("description", "TEXT", true, None, 0),
    required_column(
        "installed_on",
        "TIMESTAMP",
        true,
        Some("CURRENT_TIMESTAMP"),
        0,
    ),
    required_column("success", "BOOLEAN", true, None, 0),
    required_column("checksum", "BLOB", true, None, 0),
    required_column("execution_time", "BIGINT", true, None, 0),
];

const fn required_column(
    name: &'static str,
    declared_type: &'static str,
    not_null: bool,
    default_value: Option<&'static str>,
    primary_key: i64,
) -> RequiredColumn {
    RequiredColumn {
        name,
        declared_type,
        not_null,
        default_value,
        primary_key,
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub path: String,
    pub created_at: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    format_version: u32,
    created_at: String,
    files: Vec<ManifestFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    name: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreRollback {
    original_files: Vec<String>,
}

#[derive(Debug, Error)]
pub enum BackupError {
    #[error("无法读写备份文件：{0}")]
    Io(#[from] std::io::Error),
    #[error("备份清单格式无效：{0}")]
    Json(#[from] serde_json::Error),
    #[error("备份压缩包无效：{0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("无法创建一致性数据库快照：{0}")]
    Database(#[from] sqlx::Error),
    #[error("设置更新失败：{0}")]
    Settings(#[from] SettingsError),
    #[error("备份校验失败：{0}")]
    InvalidBackup(String),
}

#[derive(Clone)]
pub struct BackupState {
    data_dir: PathBuf,
    database_path: PathBuf,
    backups_dir: PathBuf,
    pending_dir: PathBuf,
    pending_marker: PathBuf,
    rollback_dir: PathBuf,
    operation_lock: Arc<tokio::sync::Mutex<()>>,
}

#[derive(Clone, Copy)]
enum BackupKind {
    Manual,
    Automatic,
    PreRestore,
}

struct BackupSource {
    archive_name: &'static str,
    path: PathBuf,
}

impl BackupState {
    pub fn new(
        data_dir: impl AsRef<Path>,
        database_path: impl AsRef<Path>,
    ) -> Result<Self, BackupError> {
        let data_dir = data_dir.as_ref().to_path_buf();
        fs::create_dir_all(&data_dir)?;
        let backups_dir = data_dir.join("backups");
        fs::create_dir_all(&backups_dir)?;

        Ok(Self {
            database_path: database_path.as_ref().to_path_buf(),
            backups_dir,
            pending_dir: data_dir.join("restore-pending"),
            pending_marker: data_dir.join("restore-pending.json"),
            rollback_dir: data_dir.join("restore-rollback"),
            operation_lock: Arc::new(tokio::sync::Mutex::new(())),
            data_dir,
        })
    }

    pub(crate) async fn lock_data_operation(&self) -> tokio::sync::OwnedMutexGuard<()> {
        self.operation_lock.clone().lock_owned().await
    }

    pub fn apply_pending_restore(&self) -> Result<bool, BackupError> {
        self.recover_interrupted_restore()?;
        if !self.pending_marker.exists() {
            return Ok(false);
        }

        let manifest: BackupManifest = serde_json::from_slice(&fs::read(&self.pending_marker)?)?;
        validate_manifest(&manifest)?;
        self.validate_staged_files(&manifest)?;

        fs::create_dir_all(&self.rollback_dir)?;
        let original_files = manifest
            .files
            .iter()
            .filter_map(|entry| {
                self.target_for(&entry.name)
                    .filter(|path| path.exists())
                    .map(|_| entry.name.clone())
            })
            .collect::<Vec<_>>();
        let rollback = RestoreRollback { original_files };
        write_json_synced(&self.rollback_dir.join("rollback.json"), &rollback)?;

        let apply_result = self.apply_staged_files(&manifest, &rollback);
        if let Err(error) = apply_result {
            let _ = self.restore_rollback(&manifest, &rollback);
            return Err(error);
        }

        fs::remove_dir_all(&self.rollback_dir)?;
        fs::remove_file(&self.pending_marker)?;
        fs::remove_dir_all(&self.pending_dir)?;
        Ok(true)
    }

    async fn create_backup_internal(
        &self,
        destination: Option<&Path>,
        kind: BackupKind,
    ) -> Result<BackupResult, BackupError> {
        let now = Utc::now();
        let default_name = format!(
            "{}-{}.tkbackup",
            match kind {
                BackupKind::Manual => "manual",
                BackupKind::Automatic => "auto",
                BackupKind::PreRestore => "pre-restore",
            },
            now.format("%Y%m%d-%H%M%S-%3f")
        );
        let output_path = resolve_destination(destination, &self.backups_dir, &default_name)?;
        if output_path.exists() {
            return Err(BackupError::InvalidBackup(
                "目标备份文件已经存在，不会覆盖".into(),
            ));
        }
        let parent = output_path
            .parent()
            .ok_or_else(|| BackupError::InvalidBackup("目标备份路径缺少父目录".into()))?;
        fs::create_dir_all(parent)?;

        let work_dir = self.data_dir.join(".backup-work");
        fs::create_dir_all(&work_dir)?;
        let database_snapshot = work_dir.join(format!(
            "database-{}.sqlite3",
            uuid::Uuid::now_v7().simple()
        ));
        let database_snapshot = if self.database_path.is_file() {
            create_database_snapshot(&self.database_path, &database_snapshot).await?;
            Some(database_snapshot)
        } else {
            None
        };

        let result = self
            .write_backup_package(&output_path, database_snapshot.as_deref(), now.to_rfc3339())
            .await;
        if let Some(snapshot) = database_snapshot {
            let _ = fs::remove_file(snapshot);
        }
        let _ = remove_dir_if_empty(&work_dir);
        result
    }

    async fn write_backup_package(
        &self,
        output_path: &Path,
        database_snapshot: Option<&Path>,
        created_at: String,
    ) -> Result<BackupResult, BackupError> {
        let sources = self.backup_sources(database_snapshot);
        let mut manifest = BackupManifest {
            format_version: BACKUP_FORMAT_VERSION,
            created_at: created_at.clone(),
            files: Vec::with_capacity(sources.len()),
        };
        let parent = output_path
            .parent()
            .ok_or_else(|| BackupError::InvalidBackup("目标备份路径缺少父目录".into()))?;
        let partial_path =
            parent.join(format!(".backup-{}.partial", uuid::Uuid::now_v7().simple()));
        let write_result = (|| -> Result<(), BackupError> {
            let partial = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&partial_path)?;
            let mut archive = ZipWriter::new(partial);
            let options = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Deflated)
                .unix_permissions(0o600);
            for source in &sources {
                reject_symlink(&source.path)?;
                archive.start_file(source.archive_name, options)?;
                let mut input = File::open(&source.path)?;
                let (size_bytes, sha256) = copy_and_hash(&mut input, &mut archive)?;
                manifest.files.push(ManifestFile {
                    name: source.archive_name.to_string(),
                    size_bytes,
                    sha256,
                });
            }
            validate_manifest(&manifest)?;
            archive.start_file(MANIFEST_ARCHIVE_NAME, options)?;
            archive.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
            let completed = archive.finish()?;
            completed.sync_all()?;
            Ok(())
        })();

        if let Err(error) = write_result {
            let _ = fs::remove_file(&partial_path);
            return Err(error);
        }

        let validation_dir = self.data_dir.join(format!(
            ".backup-validate-{}",
            uuid::Uuid::now_v7().simple()
        ));
        if let Err(error) = fs::create_dir(&validation_dir) {
            let _ = fs::remove_file(&partial_path);
            return Err(error.into());
        }
        let validation_result = async {
            let manifest = extract_and_validate(&partial_path, &validation_dir)?;
            validate_staged_contents(&validation_dir, &manifest).await
        }
        .await;
        let cleanup_result = fs::remove_dir_all(&validation_dir);
        if let Err(error) = validation_result {
            let _ = fs::remove_file(&partial_path);
            return Err(error);
        }
        if let Err(error) = cleanup_result {
            let _ = fs::remove_file(&partial_path);
            return Err(error.into());
        }

        let size_bytes = match fs::metadata(&partial_path) {
            Ok(metadata) => metadata.len(),
            Err(error) => {
                let _ = fs::remove_file(&partial_path);
                return Err(error.into());
            }
        };
        if let Err(error) = fs::rename(&partial_path, output_path) {
            let _ = fs::remove_file(&partial_path);
            return Err(error.into());
        }
        Ok(BackupResult {
            path: output_path.to_string_lossy().into_owned(),
            created_at,
            size_bytes,
        })
    }

    fn backup_sources(&self, database_snapshot: Option<&Path>) -> Vec<BackupSource> {
        let mut sources = Vec::new();
        if let Some(path) = database_snapshot {
            sources.push(BackupSource {
                archive_name: DATABASE_ARCHIVE_NAME,
                path: path.to_path_buf(),
            });
        }
        for (archive_name, path) in [
            (VAULT_ARCHIVE_NAME, self.data_dir.join(VAULT_ARCHIVE_NAME)),
            (SALT_ARCHIVE_NAME, self.data_dir.join(SALT_ARCHIVE_NAME)),
            (
                SETTINGS_ARCHIVE_NAME,
                self.data_dir.join(SETTINGS_ARCHIVE_NAME),
            ),
        ] {
            if path.is_file() {
                sources.push(BackupSource { archive_name, path });
            }
        }
        sources
    }

    #[cfg(test)]
    async fn stage_restore(&self, backup_path: &Path) -> Result<(), BackupError> {
        let _operation_guard = self.lock_data_operation().await;
        self.stage_restore_internal(backup_path).await
    }

    async fn stage_restore_internal(&self, backup_path: &Path) -> Result<(), BackupError> {
        if self.pending_marker.exists() || self.pending_dir.exists() {
            return Err(BackupError::InvalidBackup(
                "已经存在等待应用的恢复任务，请先重启应用".into(),
            ));
        }
        reject_symlink(backup_path)?;

        let staging_dir = self
            .data_dir
            .join(format!(".restore-stage-{}", uuid::Uuid::now_v7().simple()));
        fs::create_dir_all(&staging_dir)?;
        let manifest = match extract_and_validate(backup_path, &staging_dir) {
            Ok(manifest) => manifest,
            Err(error) => {
                let _ = fs::remove_dir_all(&staging_dir);
                return Err(error);
            }
        };
        if let Err(error) = validate_staged_contents(&staging_dir, &manifest).await {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(error);
        }

        if let Err(error) = self
            .create_backup_internal(None, BackupKind::PreRestore)
            .await
        {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(error);
        }

        if let Err(error) = fs::rename(&staging_dir, &self.pending_dir) {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(error.into());
        }
        if let Err(error) = write_json_synced(&self.pending_marker, &manifest) {
            let _ = fs::remove_dir_all(&self.pending_dir);
            return Err(error);
        }
        Ok(())
    }

    fn validate_staged_files(&self, manifest: &BackupManifest) -> Result<(), BackupError> {
        for entry in &manifest.files {
            let path = self.pending_dir.join(&entry.name);
            reject_symlink(&path)?;
            let metadata = fs::metadata(&path).map_err(|_| {
                BackupError::InvalidBackup(format!("恢复暂存文件缺失：{}", entry.name))
            })?;
            if metadata.len() != entry.size_bytes || hash_file(&path)? != entry.sha256 {
                return Err(BackupError::InvalidBackup(format!(
                    "恢复暂存文件校验失败：{}",
                    entry.name
                )));
            }
        }
        Ok(())
    }

    fn apply_staged_files(
        &self,
        manifest: &BackupManifest,
        rollback: &RestoreRollback,
    ) -> Result<(), BackupError> {
        for entry in &manifest.files {
            let target = self.target_for(&entry.name).ok_or_else(|| {
                BackupError::InvalidBackup(format!("不支持的恢复文件：{}", entry.name))
            })?;
            reject_target_symlink(&target)?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            if rollback.original_files.contains(&entry.name) {
                fs::rename(&target, self.rollback_dir.join(&entry.name))?;
            }

            let next_path =
                target.with_extension(format!("restore-next-{}", uuid::Uuid::now_v7().simple()));
            if let Err(error) = copy_file_synced(&self.pending_dir.join(&entry.name), &next_path) {
                let _ = fs::remove_file(&next_path);
                return Err(error);
            }
            if let Err(error) = fs::rename(&next_path, &target) {
                let _ = fs::remove_file(&next_path);
                return Err(error.into());
            }
        }
        Ok(())
    }

    fn recover_interrupted_restore(&self) -> Result<(), BackupError> {
        if !self.rollback_dir.exists() {
            if self.pending_dir.exists() && !self.pending_marker.exists() {
                fs::remove_dir_all(&self.pending_dir)?;
            }
            return Ok(());
        }
        let metadata_path = self.rollback_dir.join("rollback.json");
        if !metadata_path.exists() {
            fs::remove_dir_all(&self.rollback_dir)?;
            return Ok(());
        }

        let rollback: RestoreRollback = serde_json::from_slice(&fs::read(metadata_path)?)?;
        let manifest = if self.pending_marker.exists() {
            serde_json::from_slice::<BackupManifest>(&fs::read(&self.pending_marker)?)?
        } else {
            BackupManifest {
                format_version: BACKUP_FORMAT_VERSION,
                created_at: String::new(),
                files: rollback
                    .original_files
                    .iter()
                    .map(|name| ManifestFile {
                        name: name.clone(),
                        size_bytes: 0,
                        sha256: String::new(),
                    })
                    .collect(),
            }
        };
        self.restore_rollback(&manifest, &rollback)?;
        Ok(())
    }

    fn restore_rollback(
        &self,
        manifest: &BackupManifest,
        rollback: &RestoreRollback,
    ) -> Result<(), BackupError> {
        for entry in &manifest.files {
            let Some(target) = self.target_for(&entry.name) else {
                continue;
            };
            if rollback.original_files.contains(&entry.name) {
                let original = self.rollback_dir.join(&entry.name);
                if original.exists() {
                    if target.exists() {
                        fs::remove_file(&target)?;
                    }
                    fs::rename(original, target)?;
                }
            } else if target.exists() {
                fs::remove_file(&target)?;
            }
        }
        fs::remove_dir_all(&self.rollback_dir)?;
        Ok(())
    }

    fn target_for(&self, archive_name: &str) -> Option<PathBuf> {
        match archive_name {
            DATABASE_ARCHIVE_NAME => Some(self.database_path.clone()),
            VAULT_ARCHIVE_NAME => Some(self.data_dir.join(VAULT_ARCHIVE_NAME)),
            SALT_ARCHIVE_NAME => Some(self.data_dir.join(SALT_ARCHIVE_NAME)),
            SETTINGS_ARCHIVE_NAME => Some(self.data_dir.join(SETTINGS_ARCHIVE_NAME)),
            _ => None,
        }
    }
}

#[tauri::command]
pub async fn create_backup(
    destination: Option<String>,
    state: State<'_, BackupState>,
) -> Result<BackupResult, String> {
    let state = state.inner().clone();
    let destination = destination.map(PathBuf::from);
    let _operation_guard = state.lock_data_operation().await;
    state
        .create_backup_internal(destination.as_deref(), BackupKind::Manual)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn restore_backup<R: Runtime>(
    path: String,
    app: AppHandle<R>,
    state: State<'_, BackupState>,
) -> Result<(), String> {
    let state = state.inner().clone();
    let _operation_guard = state.lock_data_operation().await;
    state
        .stage_restore_internal(Path::new(&path))
        .await
        .map_err(|error| error.to_string())?;
    app.restart()
}

pub(crate) async fn create_automatic_backup_if_due(
    backup: &BackupState,
    settings: &SettingsState,
) -> Result<Option<BackupResult>, BackupError> {
    let _operation_guard = backup.lock_data_operation().await;
    let today = Local::now().date_naive();
    let today_text = today.format("%Y-%m-%d").to_string();
    let snapshot = settings.snapshot()?;
    if snapshot.last_automatic_backup_date.as_deref() == Some(today_text.as_str()) {
        return Ok(None);
    }

    let result = backup
        .create_backup_internal(None, BackupKind::Automatic)
        .await?;
    prune_automatic_backups(&backup.backups_dir, snapshot.backup_retention as usize)?;
    settings.record_automatic_backup_date(today)?;
    Ok(Some(result))
}

async fn create_database_snapshot(
    database_path: &Path,
    snapshot_path: &Path,
) -> Result<(), BackupError> {
    if snapshot_path.exists() {
        fs::remove_file(snapshot_path)?;
    }
    let options = SqliteConnectOptions::new()
        .filename(database_path)
        .create_if_missing(false);
    let mut connection = SqliteConnection::connect_with(&options).await?;
    sqlx::query("VACUUM INTO ?")
        .bind(snapshot_path.to_string_lossy().into_owned())
        .execute(&mut connection)
        .await?;
    connection.close().await?;
    Ok(())
}

fn resolve_destination(
    destination: Option<&Path>,
    default_dir: &Path,
    default_name: &str,
) -> Result<PathBuf, BackupError> {
    match destination {
        None => Ok(default_dir.join(default_name)),
        Some(path) if path.is_dir() => Ok(path.join(default_name)),
        Some(path) if path.extension().is_none() => {
            fs::create_dir_all(path)?;
            Ok(path.join(default_name))
        }
        Some(path) => Ok(path.to_path_buf()),
    }
}

fn extract_and_validate(
    backup_path: &Path,
    staging_dir: &Path,
) -> Result<BackupManifest, BackupError> {
    let file = File::open(backup_path)?;
    let mut archive = ZipArchive::new(file)?;
    let manifest = {
        let mut manifest_file = archive.by_name(MANIFEST_ARCHIVE_NAME)?;
        if manifest_file.size() > MAX_MANIFEST_BYTES {
            return Err(BackupError::InvalidBackup("备份清单过大".into()));
        }
        let mut bytes = Vec::with_capacity(manifest_file.size() as usize);
        manifest_file.read_to_end(&mut bytes)?;
        serde_json::from_slice::<BackupManifest>(&bytes)?
    };
    validate_manifest(&manifest)?;

    let mut archive_names = HashSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        let name = entry.name().to_string();
        if !archive_names.insert(name.clone()) {
            return Err(BackupError::InvalidBackup(format!(
                "压缩包包含重复文件：{name}"
            )));
        }
        if name != MANIFEST_ARCHIVE_NAME && !is_allowed_archive_name(&name) {
            return Err(BackupError::InvalidBackup(format!(
                "压缩包包含未知文件：{name}"
            )));
        }
    }
    if archive_names.len() != manifest.files.len() + 1 {
        return Err(BackupError::InvalidBackup(
            "压缩包文件数量与清单不一致".into(),
        ));
    }

    for expected in &manifest.files {
        let mut entry = archive.by_name(&expected.name)?;
        if entry.enclosed_name().as_deref() != Some(Path::new(&expected.name)) {
            return Err(BackupError::InvalidBackup("压缩包路径不安全".into()));
        }
        if entry.size() != expected.size_bytes {
            return Err(BackupError::InvalidBackup(format!(
                "文件大小与清单不一致：{}",
                expected.name
            )));
        }
        let output_path = staging_dir.join(&expected.name);
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output_path)?;
        let (copied, digest) = copy_and_hash(&mut entry, &mut output)?;
        output.sync_all()?;
        if copied != expected.size_bytes || digest != expected.sha256 {
            return Err(BackupError::InvalidBackup(format!(
                "文件哈希校验失败：{}",
                expected.name
            )));
        }
    }
    Ok(manifest)
}

fn validate_manifest(manifest: &BackupManifest) -> Result<(), BackupError> {
    if manifest.format_version != BACKUP_FORMAT_VERSION {
        return Err(BackupError::InvalidBackup(format!(
            "不支持的备份版本：{}",
            manifest.format_version
        )));
    }
    chrono::DateTime::parse_from_rfc3339(&manifest.created_at)
        .map_err(|_| BackupError::InvalidBackup("备份时间格式无效".into()))?;
    if manifest.files.is_empty() {
        return Err(BackupError::InvalidBackup("备份包不包含任何数据".into()));
    }

    let mut names = HashSet::new();
    let mut total = 0_u64;
    for entry in &manifest.files {
        if !is_allowed_archive_name(&entry.name) || !names.insert(entry.name.clone()) {
            return Err(BackupError::InvalidBackup(format!(
                "清单包含未知或重复文件：{}",
                entry.name
            )));
        }
        if entry.size_bytes > MAX_ENTRY_BYTES {
            return Err(BackupError::InvalidBackup(format!(
                "备份条目过大：{}",
                entry.name
            )));
        }
        total = total
            .checked_add(entry.size_bytes)
            .ok_or_else(|| BackupError::InvalidBackup("备份总大小溢出".into()))?;
        if entry.sha256.len() != 64 || !entry.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(BackupError::InvalidBackup(format!(
                "文件哈希格式无效：{}",
                entry.name
            )));
        }
    }
    if total > MAX_TOTAL_BYTES {
        return Err(BackupError::InvalidBackup("备份解压后过大".into()));
    }
    if names.contains(VAULT_ARCHIVE_NAME) != names.contains(SALT_ARCHIVE_NAME) {
        return Err(BackupError::InvalidBackup(
            "Stronghold 快照与盐文件必须同时存在".into(),
        ));
    }
    for required in REQUIRED_ARCHIVE_FILES {
        if !names.contains(required) {
            return Err(BackupError::InvalidBackup(format!(
                "备份缺少必要文件：{required}"
            )));
        }
    }
    Ok(())
}

async fn validate_staged_contents(
    staging_dir: &Path,
    _manifest: &BackupManifest,
) -> Result<(), BackupError> {
    validate_staged_database(&staging_dir.join(DATABASE_ARCHIVE_NAME)).await?;
    validate_staged_settings(&staging_dir.join(SETTINGS_ARCHIVE_NAME))?;
    vault::validate_backup_files(
        &staging_dir.join(VAULT_ARCHIVE_NAME),
        &staging_dir.join(SALT_ARCHIVE_NAME),
    )
    .map_err(|error| BackupError::InvalidBackup(error.to_string()))?;
    Ok(())
}

async fn validate_staged_database(path: &Path) -> Result<(), BackupError> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .read_only(true)
        .foreign_keys(true);
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| BackupError::InvalidBackup(format!("数据库文件无法打开：{error}")))?;
    let validation_result = validate_database_contract(&mut connection).await;
    let close_result = connection.close().await;
    validation_result?;
    close_result
        .map_err(|error| BackupError::InvalidBackup(format!("关闭暂存数据库失败：{error}")))?;
    Ok(())
}

async fn validate_database_contract(connection: &mut SqliteConnection) -> Result<(), BackupError> {
    let integrity = sqlx::query_scalar::<_, String>("PRAGMA integrity_check")
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| BackupError::InvalidBackup(format!("数据库完整性检查失败：{error}")))?;
    if integrity.as_slice() != ["ok"] {
        return Err(BackupError::InvalidBackup(format!(
            "数据库完整性检查未通过：{}",
            integrity.join("；")
        )));
    }

    let foreign_key_errors = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| BackupError::InvalidBackup(format!("数据库外键检查失败：{error}")))?;
    if !foreign_key_errors.is_empty() {
        return Err(BackupError::InvalidBackup(format!(
            "数据库存在 {} 条外键错误",
            foreign_key_errors.len()
        )));
    }

    let tables = sqlx::query_scalar::<_, String>(
        "SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(&mut *connection)
    .await
    .map_err(|error| BackupError::InvalidBackup(format!("读取数据库表结构失败：{error}")))?
    .into_iter()
    .collect::<HashSet<_>>();
    let expected_tables = REQUIRED_DATABASE_TABLES.into_iter().collect::<HashSet<_>>();
    let missing = expected_tables
        .iter()
        .filter(|name| !tables.contains(**name))
        .copied()
        .collect::<Vec<_>>();
    let unexpected = tables
        .iter()
        .filter(|name| !expected_tables.contains(name.as_str()))
        .map(String::as_str)
        .collect::<Vec<_>>();
    if !missing.is_empty() || !unexpected.is_empty() {
        return Err(BackupError::InvalidBackup(format!(
            "数据库不是受支持的 TimeKeeper 结构；缺少表：{}；未知表：{}",
            missing.join("、"),
            unexpected.join("、")
        )));
    }

    let executable_objects = sqlx::query_scalar::<_, String>(
        "SELECT type || ':' || name FROM sqlite_master
         WHERE type IN ('trigger', 'view') ORDER BY type, name",
    )
    .fetch_all(&mut *connection)
    .await
    .map_err(|error| BackupError::InvalidBackup(format!("读取数据库对象失败：{error}")))?;
    if !executable_objects.is_empty() {
        return Err(BackupError::InvalidBackup(format!(
            "数据库包含不受支持的触发器或视图：{}",
            executable_objects.join("、")
        )));
    }

    validate_table_columns(connection, "account_profiles", &ACCOUNT_PROFILE_COLUMNS).await?;
    validate_table_columns(connection, "appointments", &APPOINTMENT_COLUMNS).await?;
    validate_table_columns(connection, "_sqlx_migrations", &MIGRATION_COLUMNS).await?;
    validate_migration_records(connection).await?;
    validate_database_constraints(connection).await?;
    validate_database_rows(connection).await
}

async fn validate_table_columns(
    connection: &mut SqliteConnection,
    table: &str,
    expected: &[RequiredColumn],
) -> Result<(), BackupError> {
    let rows = sqlx::query(
        "SELECT name, type AS declared_type, \"notnull\" AS not_null,
                dflt_value, pk, hidden
         FROM pragma_table_xinfo(?) ORDER BY cid",
    )
    .bind(table)
    .fetch_all(&mut *connection)
    .await
    .map_err(|error| BackupError::InvalidBackup(format!("读取表 {table} 的列结构失败：{error}")))?;
    if rows.len() != expected.len() {
        return Err(BackupError::InvalidBackup(format!(
            "表 {table} 的列数量不符合当前 TimeKeeper 契约：期望 {}，实际 {}",
            expected.len(),
            rows.len()
        )));
    }

    for (row, expected) in rows.iter().zip(expected) {
        let name: String = row.try_get("name").map_err(database_schema_error)?;
        let declared_type: String = row
            .try_get("declared_type")
            .map_err(database_schema_error)?;
        let not_null: i64 = row.try_get("not_null").map_err(database_schema_error)?;
        let default_value: Option<String> =
            row.try_get("dflt_value").map_err(database_schema_error)?;
        let primary_key: i64 = row.try_get("pk").map_err(database_schema_error)?;
        let hidden: i64 = row.try_get("hidden").map_err(database_schema_error)?;
        if name != expected.name
            || !declared_type.eq_ignore_ascii_case(expected.declared_type)
            || (not_null != 0) != expected.not_null
            || default_value.as_deref() != expected.default_value
            || primary_key != expected.primary_key
            || hidden != 0
        {
            return Err(BackupError::InvalidBackup(format!(
                "表 {table} 的列 {name} 不符合当前 TimeKeeper 契约"
            )));
        }
    }
    Ok(())
}

fn database_schema_error(error: sqlx::Error) -> BackupError {
    BackupError::InvalidBackup(format!("数据库表结构无法读取：{error}"))
}

async fn validate_migration_records(connection: &mut SqliteConnection) -> Result<(), BackupError> {
    let rows =
        sqlx::query("SELECT version, success, checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&mut *connection)
            .await
            .map_err(|error| {
                BackupError::InvalidBackup(format!("读取数据库迁移记录失败：{error}"))
            })?;
    let expected = MIGRATOR.iter().collect::<Vec<_>>();
    if rows.len() != expected.len() {
        return Err(BackupError::InvalidBackup(format!(
            "数据库迁移记录数量不符：期望 {}，实际 {}",
            expected.len(),
            rows.len()
        )));
    }
    for (row, migration) in rows.iter().zip(expected) {
        let version: i64 = row.try_get("version").map_err(database_schema_error)?;
        let success: bool = row.try_get("success").map_err(database_schema_error)?;
        let checksum: Vec<u8> = row.try_get("checksum").map_err(database_schema_error)?;
        if version != migration.version
            || !success
            || checksum.as_slice() != migration.checksum.as_ref()
        {
            return Err(BackupError::InvalidBackup(format!(
                "数据库迁移记录 {version} 与当前 TimeKeeper 不一致"
            )));
        }
    }
    Ok(())
}

async fn validate_database_constraints(
    connection: &mut SqliteConnection,
) -> Result<(), BackupError> {
    validate_unique_column(connection, "account_profiles", "import_fingerprint").await?;
    validate_unique_column(connection, "appointments", "import_fingerprint").await?;
    validate_foreign_key(connection).await?;

    validate_named_index(
        connection,
        "account_profiles",
        "idx_account_profiles_account_name",
        &[("account_name", "NOCASE")],
        false,
    )
    .await?;
    validate_named_index(
        connection,
        "appointments",
        "idx_appointments_service_date",
        &[("service_date", "BINARY")],
        false,
    )
    .await?;
    validate_named_index(
        connection,
        "appointments",
        "idx_appointments_time_range",
        &[("starts_at", "BINARY"), ("ends_at", "BINARY")],
        true,
    )
    .await?;
    validate_named_index(
        connection,
        "appointments",
        "idx_appointments_status",
        &[
            ("service_status", "BINARY"),
            ("settlement_status", "BINARY"),
        ],
        false,
    )
    .await?;
    validate_named_index(
        connection,
        "appointments",
        "idx_appointments_account_profile",
        &[("account_profile_id", "BINARY")],
        false,
    )
    .await?;

    validate_check_constraints(
        connection,
        "account_profiles",
        &[
            "check(needs_reviewin(0,1))",
            "check(length(trim(account_name))>0)",
            "check(current_scoreisnullorcurrent_score>=0)",
            "check(highest_scoreisnullorhighest_score>=0)",
        ],
    )
    .await?;
    validate_check_constraints(
        connection,
        "appointments",
        &[
            "check(modein('entertainment','business'))",
            "check(service_statusin('scheduled','in_progress','completed','cancelled'))",
            "check(settlement_statusin('not_applicable','unsettled','settled'))",
            "check(length(trim(contact_name))>0)",
            "check(ends_atisnullorstarts_atisnotnull)",
            "check(ends_atisnullorends_at>starts_at)",
            "check(amount_minorisnulloramount_minor>=0)",
            "check(reminder_minutesisnullorreminder_minutes>=0)",
            "mode='entertainment'andsettlement_status='not_applicable'andrate_noteisnullandpayment_methodisnullandamount_minorisnull",
            "mode='business'andsettlement_statusin('unsettled','settled')",
            "check(settlement_status!='settled'oramount_minorisnotnull)",
        ],
    )
    .await
}

async fn validate_unique_column(
    connection: &mut SqliteConnection,
    table: &str,
    column: &str,
) -> Result<(), BackupError> {
    let indexes = sqlx::query_scalar::<_, String>(
        "SELECT name FROM pragma_index_list(?) WHERE \"unique\" = 1 ORDER BY name",
    )
    .bind(table)
    .fetch_all(&mut *connection)
    .await
    .map_err(|error| {
        BackupError::InvalidBackup(format!("读取表 {table} 的唯一索引失败：{error}"))
    })?;
    for index in indexes {
        let columns =
            sqlx::query_scalar::<_, String>("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
                .bind(index)
                .fetch_all(&mut *connection)
                .await
                .map_err(|error| {
                    BackupError::InvalidBackup(format!("读取表 {table} 的唯一索引列失败：{error}"))
                })?;
        if columns.as_slice() == [column] {
            return Ok(());
        }
    }
    Err(BackupError::InvalidBackup(format!(
        "表 {table} 缺少字段 {column} 的唯一约束"
    )))
}

async fn validate_foreign_key(connection: &mut SqliteConnection) -> Result<(), BackupError> {
    let rows = sqlx::query(
        "SELECT \"table\" AS target_table, \"from\" AS source_column,
                \"to\" AS target_column, on_delete
         FROM pragma_foreign_key_list('appointments') ORDER BY id, seq",
    )
    .fetch_all(&mut *connection)
    .await
    .map_err(|error| BackupError::InvalidBackup(format!("读取预约外键结构失败：{error}")))?;
    if rows.len() != 1 {
        return Err(BackupError::InvalidBackup(
            "appointments 的账号档案外键结构无效".into(),
        ));
    }
    let row = &rows[0];
    let target_table: String = row.try_get("target_table").map_err(database_schema_error)?;
    let source_column: String = row
        .try_get("source_column")
        .map_err(database_schema_error)?;
    let target_column: String = row
        .try_get("target_column")
        .map_err(database_schema_error)?;
    let on_delete: String = row.try_get("on_delete").map_err(database_schema_error)?;
    if target_table != "account_profiles"
        || source_column != "account_profile_id"
        || target_column != "id"
        || !on_delete.eq_ignore_ascii_case("SET NULL")
    {
        return Err(BackupError::InvalidBackup(
            "appointments 的账号档案外键结构无效".into(),
        ));
    }
    Ok(())
}

async fn validate_named_index(
    connection: &mut SqliteConnection,
    table: &str,
    index: &str,
    expected_columns: &[(&str, &str)],
    partial: bool,
) -> Result<(), BackupError> {
    let index_row = sqlx::query(
        "SELECT \"unique\" AS is_unique, partial
         FROM pragma_index_list(?) WHERE name = ?",
    )
    .bind(table)
    .bind(index)
    .fetch_optional(&mut *connection)
    .await
    .map_err(|error| BackupError::InvalidBackup(format!("读取索引 {index} 失败：{error}")))?
    .ok_or_else(|| BackupError::InvalidBackup(format!("数据库缺少必要索引：{index}")))?;
    let is_unique: bool = index_row
        .try_get("is_unique")
        .map_err(database_schema_error)?;
    let is_partial: bool = index_row
        .try_get("partial")
        .map_err(database_schema_error)?;
    if is_unique || is_partial != partial {
        return Err(BackupError::InvalidBackup(format!(
            "索引 {index} 的属性不符合当前 TimeKeeper 契约"
        )));
    }

    let rows = sqlx::query(
        "SELECT name, coll FROM pragma_index_xinfo(?)
         WHERE key = 1 ORDER BY seqno",
    )
    .bind(index)
    .fetch_all(&mut *connection)
    .await
    .map_err(|error| BackupError::InvalidBackup(format!("读取索引 {index} 的列失败：{error}")))?;
    if rows.len() != expected_columns.len() {
        return Err(BackupError::InvalidBackup(format!(
            "索引 {index} 的列结构不符合当前 TimeKeeper 契约"
        )));
    }
    for (row, (expected_name, expected_collation)) in rows.iter().zip(expected_columns) {
        let name: Option<String> = row.try_get("name").map_err(database_schema_error)?;
        let collation: Option<String> = row.try_get("coll").map_err(database_schema_error)?;
        if name.as_deref() != Some(*expected_name)
            || !collation
                .as_deref()
                .is_some_and(|value| value.eq_ignore_ascii_case(expected_collation))
        {
            return Err(BackupError::InvalidBackup(format!(
                "索引 {index} 的列结构不符合当前 TimeKeeper 契约"
            )));
        }
    }

    if partial {
        let sql = sqlx::query_scalar::<_, String>(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
        )
        .bind(index)
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| {
            BackupError::InvalidBackup(format!("读取索引 {index} 定义失败：{error}"))
        })?;
        if !normalize_schema_sql(&sql).contains("wherestarts_atisnotnullandends_atisnotnull") {
            return Err(BackupError::InvalidBackup(format!(
                "索引 {index} 的条件不符合当前 TimeKeeper 契约"
            )));
        }
    }
    Ok(())
}

async fn validate_check_constraints(
    connection: &mut SqliteConnection,
    table: &str,
    required_fragments: &[&str],
) -> Result<(), BackupError> {
    let sql = sqlx::query_scalar::<_, String>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(table)
    .fetch_one(&mut *connection)
    .await
    .map_err(|error| BackupError::InvalidBackup(format!("读取表 {table} 定义失败：{error}")))?;
    let normalized = normalize_schema_sql(&sql);
    if let Some(missing) = required_fragments
        .iter()
        .find(|fragment| !normalized.contains(*fragment))
    {
        return Err(BackupError::InvalidBackup(format!(
            "表 {table} 缺少必要约束：{missing}"
        )));
    }
    Ok(())
}

fn normalize_schema_sql(sql: &str) -> String {
    sql.chars()
        .filter(|character| !character.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

async fn validate_database_rows(connection: &mut SqliteConnection) -> Result<(), BackupError> {
    let profile_rows = sqlx::query("SELECT * FROM account_profiles ORDER BY id")
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| BackupError::InvalidBackup(format!("读取账号档案失败：{error}")))?;
    for row in &profile_rows {
        let profile = profile_from_row(row).map_err(|error| {
            BackupError::InvalidBackup(format!("账号档案记录无法读取：{error}"))
        })?;
        let needs_review: i64 = row.try_get("needs_review").map_err(database_schema_error)?;
        if profile.id.trim().is_empty()
            || profile.account_name.trim().is_empty()
            || !matches!(needs_review, 0 | 1)
            || profile.current_score.is_some_and(|value| value < 0)
            || profile.highest_score.is_some_and(|value| value < 0)
        {
            return Err(BackupError::InvalidBackup(format!(
                "账号档案 {} 的字段值不符合当前 TimeKeeper 契约",
                profile.id
            )));
        }
        if let Some(date) = profile.score_updated_at.as_deref() {
            NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| {
                BackupError::InvalidBackup(format!("账号档案 {} 的分数更新日期无效", profile.id))
            })?;
        }
        validate_rfc3339(&profile.created_at, "账号档案创建时间", &profile.id)?;
        validate_rfc3339(&profile.updated_at, "账号档案更新时间", &profile.id)?;
    }

    let appointment_rows = sqlx::query("SELECT * FROM appointments ORDER BY id")
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| BackupError::InvalidBackup(format!("读取预约记录失败：{error}")))?;
    for row in &appointment_rows {
        let appointment = appointment_from_row(row)
            .map_err(|error| BackupError::InvalidBackup(format!("预约记录无法读取：{error}")))?;
        let service_date = NaiveDate::parse_from_str(&appointment.service_date, "%Y-%m-%d")
            .map_err(|_| {
                BackupError::InvalidBackup(format!("预约 {} 的服务日期无效", appointment.id))
            })?;
        let starts_at = appointment
            .starts_at
            .as_deref()
            .map(|value| parse_appointment_datetime(value, "开始时间", &appointment.id))
            .transpose()?;
        let ends_at = appointment
            .ends_at
            .as_deref()
            .map(|value| parse_appointment_datetime(value, "结束时间", &appointment.id))
            .transpose()?;
        let next_service_date = service_date.checked_add_days(Days::new(1));
        let invalid_time_range = match (starts_at, ends_at) {
            (None, Some(_)) => true,
            (Some(start), Some(end)) => {
                end <= start
                    || end - start >= chrono::Duration::days(1)
                    || (end.date() != service_date && Some(end.date()) != next_service_date)
            }
            _ => false,
        };
        if starts_at.is_some_and(|value| value.date() != service_date)
            || invalid_time_range
            || appointment.id.trim().is_empty()
            || appointment.contact_name.trim().is_empty()
            || appointment.amount_minor.is_some_and(|value| value < 0)
            || appointment.reminder_minutes.is_some_and(|value| value < 0)
        {
            return Err(BackupError::InvalidBackup(format!(
                "预约 {} 的字段值不符合当前 TimeKeeper 契约",
                appointment.id
            )));
        }
        match appointment.mode {
            AppointmentMode::Entertainment
                if appointment.settlement_status != SettlementStatus::NotApplicable
                    || appointment.rate_note.is_some()
                    || appointment.payment_method.is_some()
                    || appointment.amount_minor.is_some() =>
            {
                return Err(BackupError::InvalidBackup(format!(
                    "娱乐预约 {} 包含不允许的账单数据",
                    appointment.id
                )));
            }
            AppointmentMode::Business
                if appointment.settlement_status == SettlementStatus::NotApplicable =>
            {
                return Err(BackupError::InvalidBackup(format!(
                    "业务预约 {} 的结算状态无效",
                    appointment.id
                )));
            }
            _ => {}
        }
        if appointment.settlement_status == SettlementStatus::Settled
            && appointment.amount_minor.is_none()
        {
            return Err(BackupError::InvalidBackup(format!(
                "已结算预约 {} 缺少金额",
                appointment.id
            )));
        }
        validate_snapshot_json(row, &appointment.id)?;
        validate_rfc3339(&appointment.created_at, "预约创建时间", &appointment.id)?;
        validate_rfc3339(&appointment.updated_at, "预约更新时间", &appointment.id)?;
    }
    Ok(())
}

fn parse_appointment_datetime(
    value: &str,
    field: &str,
    appointment_id: &str,
) -> Result<NaiveDateTime, BackupError> {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S")
        .map_err(|_| BackupError::InvalidBackup(format!("预约 {appointment_id} 的{field}无效")))
}

fn validate_rfc3339(value: &str, field: &str, record_id: &str) -> Result<(), BackupError> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|_| BackupError::InvalidBackup(format!("{field}无效：{record_id}")))
}

fn validate_snapshot_json(row: &sqlx::sqlite::SqliteRow, id: &str) -> Result<(), BackupError> {
    let raw: Option<String> = row
        .try_get("account_snapshot_json")
        .map_err(database_schema_error)?;
    let Some(raw) = raw else {
        return Ok(());
    };
    let value = serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| {
        BackupError::InvalidBackup(format!("预约 {id} 的账号快照数据损坏：{error}"))
    })?;
    let object = value
        .as_object()
        .ok_or_else(|| BackupError::InvalidBackup(format!("预约 {id} 的账号快照必须是对象")))?;
    const ALLOWED_KEYS: [&str; 6] = [
        "accountName",
        "contactName",
        "server",
        "characterName",
        "specialization",
        "gearScore",
    ];
    if let Some(key) = object
        .keys()
        .find(|key| !ALLOWED_KEYS.contains(&key.as_str()))
    {
        return Err(BackupError::InvalidBackup(format!(
            "预约 {id} 的账号快照包含不允许的字段：{key}"
        )));
    }
    Ok(())
}

fn validate_staged_settings(path: &Path) -> Result<(), BackupError> {
    let bytes = fs::read(path)?;
    let settings = serde_json::from_slice::<AppSettings>(&bytes)
        .map_err(|error| BackupError::InvalidBackup(format!("设置文件格式无效：{error}")))?;
    settings
        .validate()
        .map_err(|error| BackupError::InvalidBackup(error.to_string()))
}

fn is_allowed_archive_name(name: &str) -> bool {
    matches!(
        name,
        DATABASE_ARCHIVE_NAME | VAULT_ARCHIVE_NAME | SALT_ARCHIVE_NAME | SETTINGS_ARCHIVE_NAME
    )
}

fn hash_file(path: &Path) -> Result<String, BackupError> {
    let mut file = File::open(path)?;
    let mut sink = std::io::sink();
    let (_, digest) = copy_and_hash(&mut file, &mut sink)?;
    Ok(digest)
}

fn copy_and_hash(
    input: &mut impl Read,
    output: &mut impl Write,
) -> Result<(u64, String), BackupError> {
    let mut hasher = Sha256::new();
    let mut copied = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        output.write_all(&buffer[..read])?;
        hasher.update(&buffer[..read]);
        copied += read as u64;
    }
    Ok((copied, hex::encode(hasher.finalize())))
}

fn copy_file_synced(source: &Path, destination: &Path) -> Result<(), BackupError> {
    let mut input = File::open(source)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    std::io::copy(&mut input, &mut output)?;
    output.sync_all()?;
    Ok(())
}

fn write_json_synced(path: &Path, value: &impl Serialize) -> Result<(), BackupError> {
    let mut output = OpenOptions::new().write(true).create_new(true).open(path)?;
    output.write_all(&serde_json::to_vec_pretty(value)?)?;
    output.sync_all()?;
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<(), BackupError> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(BackupError::InvalidBackup(format!(
            "不接受符号链接或非普通文件：{}",
            path.display()
        )));
    }
    Ok(())
}

fn reject_target_symlink(path: &Path) -> Result<(), BackupError> {
    if path.exists() && fs::symlink_metadata(path)?.file_type().is_symlink() {
        return Err(BackupError::InvalidBackup(format!(
            "恢复目标不能是符号链接：{}",
            path.display()
        )));
    }
    Ok(())
}

fn remove_dir_if_empty(path: &Path) -> Result<(), std::io::Error> {
    if path.is_dir() && fs::read_dir(path)?.next().is_none() {
        fs::remove_dir(path)?;
    }
    Ok(())
}

fn prune_automatic_backups(directory: &Path, retention: usize) -> Result<(), BackupError> {
    let mut backups = fs::read_dir(directory)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("auto-") && name.ends_with(".tkbackup"))
        })
        .collect::<Vec<_>>();
    backups.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
    for expired in backups.into_iter().skip(retention) {
        fs::remove_file(expired)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        appointments::{
            create_appointment_impl, get_appointment_impl, set_appointment_service_status_impl,
            settle_appointment_impl,
        },
        db::Database,
        models::{
            AppointmentInput, AppointmentMode, ReportGranularity, ServiceStatus, SettlementStatus,
        },
        reports::get_revenue_summary_impl,
        vault::VaultState,
    };

    fn test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("timekeeper-backup-{name}-{}", uuid::Uuid::now_v7()))
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    fn create_timekeeper_database(path: &Path) {
        runtime().block_on(async {
            let database = Database::initialize(path).await.unwrap();
            database.pool().close().await;
        });
    }

    fn create_wrong_schema_database(path: &Path) {
        runtime().block_on(async {
            let options = SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(true);
            let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
            sqlx::query("CREATE TABLE sample (value TEXT NOT NULL)")
                .execute(&mut connection)
                .await
                .unwrap();
            sqlx::query("INSERT INTO sample (value) VALUES ('original')")
                .execute(&mut connection)
                .await
                .unwrap();
            connection.close().await.unwrap();
        });
    }

    fn create_same_named_wrong_schema_database(path: &Path) {
        runtime().block_on(async {
            let options = SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(true);
            let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
            for statement in [
                "CREATE TABLE account_profiles (id TEXT)",
                "CREATE TABLE appointments (id TEXT)",
                "CREATE TABLE _sqlx_migrations (version BIGINT)",
            ] {
                sqlx::query(statement)
                    .execute(&mut connection)
                    .await
                    .unwrap();
            }
            connection.close().await.unwrap();
        });
    }

    fn create_database_with_invalid_appointment(
        path: &Path,
        service_date: &str,
        starts_at: Option<&str>,
        ends_at: Option<&str>,
        snapshot_json: Option<&str>,
    ) {
        runtime().block_on(async {
            let database = Database::initialize(path).await.unwrap();
            let now = Utc::now().to_rfc3339();
            sqlx::query(
                "INSERT INTO appointments (
                    id, service_date, starts_at, ends_at, contact_name, mode,
                    service_status, settlement_status, account_snapshot_json, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, 'entertainment', 'scheduled', 'not_applicable', ?, ?, ?)",
            )
            .bind("invalid-future-appointment")
            .bind(service_date)
            .bind(starts_at)
            .bind(ends_at)
            .bind("损坏数据测试")
            .bind(snapshot_json)
            .bind(&now)
            .bind(&now)
            .execute(database.pool())
            .await
            .unwrap();
            sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
                .fetch_all(database.pool())
                .await
                .unwrap();
            database.pool().close().await;
        });
    }

    fn create_vault_files(dir: &Path) -> (Vec<u8>, Vec<u8>) {
        let vault = VaultState::new(dir).unwrap();
        vault
            .initialize("temporary backup test password".into())
            .unwrap();
        drop(vault);
        (
            fs::read(dir.join(VAULT_ARCHIVE_NAME)).unwrap(),
            fs::read(dir.join(SALT_ARCHIVE_NAME)).unwrap(),
        )
    }

    fn business_input(date: &str, start: &str, end: &str, amount_minor: i64) -> AppointmentInput {
        AppointmentInput {
            service_date: date.into(),
            start_time: Some(start.into()),
            end_time: Some(end.into()),
            contact_name: "闭环测试联系人".into(),
            content: Some("业务预约".into()),
            mode: AppointmentMode::Business,
            service_status: ServiceStatus::Scheduled,
            settlement_status: SettlementStatus::Unsettled,
            account_profile_id: None,
            rate_note: Some("测试计费".into()),
            payment_method: None,
            amount_minor: Some(amount_minor),
            reminder_minutes: None,
            notes: None,
        }
    }

    fn write_test_backup(path: &Path, files: &[(&str, &[u8])]) {
        let manifest = BackupManifest {
            format_version: BACKUP_FORMAT_VERSION,
            created_at: Utc::now().to_rfc3339(),
            files: files
                .iter()
                .map(|(name, bytes)| ManifestFile {
                    name: (*name).to_string(),
                    size_bytes: bytes.len() as u64,
                    sha256: hex::encode(Sha256::digest(bytes)),
                })
                .collect(),
        };
        let output = File::create(path).unwrap();
        let mut archive = ZipWriter::new(output);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o600);
        for (name, bytes) in files {
            archive.start_file(*name, options).unwrap();
            archive.write_all(bytes).unwrap();
        }
        archive.start_file(MANIFEST_ARCHIVE_NAME, options).unwrap();
        archive
            .write_all(&serde_json::to_vec_pretty(&manifest).unwrap())
            .unwrap();
        archive.finish().unwrap();
    }

    fn pre_restore_backup_count(state: &BackupState) -> usize {
        fs::read_dir(&state.backups_dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.starts_with("pre-restore-"))
            })
            .count()
    }

    fn remove_test_dir_after_sqlite_shutdown(dir: PathBuf) {
        let temp_dir = std::env::temp_dir();
        assert_eq!(dir.parent(), Some(temp_dir.as_path()));
        assert!(
            dir.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("timekeeper-backup-"))
        );

        let mut last_error = None;
        for _ in 0..20 {
            match fs::remove_dir_all(&dir) {
                Ok(()) => return,
                Err(error) => {
                    last_error = Some(error);
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
            }
        }
        panic!("清理测试目录失败: {}", last_error.unwrap());
    }

    #[test]
    fn package_is_verified_staged_and_applied() {
        let dir = test_dir("round-trip");
        fs::create_dir_all(&dir).unwrap();
        let database = dir.join("timekeeper.db");
        create_timekeeper_database(&database);
        let original_settings = serde_json::to_vec_pretty(&AppSettings::default()).unwrap();
        fs::write(dir.join(SETTINGS_ARCHIVE_NAME), &original_settings).unwrap();
        create_vault_files(&dir);
        let state = BackupState::new(&dir, &database).unwrap();

        let backup = runtime()
            .block_on(state.create_backup_internal(None, BackupKind::Manual))
            .unwrap();
        let verify_dir = dir.join("verify-created-package");
        fs::create_dir(&verify_dir).unwrap();
        let manifest = extract_and_validate(Path::new(&backup.path), &verify_dir).unwrap();
        runtime()
            .block_on(validate_staged_contents(&verify_dir, &manifest))
            .unwrap();
        fs::remove_dir_all(verify_dir).unwrap();
        let changed_settings = AppSettings {
            auto_lock_minutes: 30,
            ..AppSettings::default()
        };
        fs::write(
            dir.join(SETTINGS_ARCHIVE_NAME),
            serde_json::to_vec_pretty(&changed_settings).unwrap(),
        )
        .unwrap();
        runtime()
            .block_on(state.stage_restore(Path::new(&backup.path)))
            .unwrap();
        assert!(state.apply_pending_restore().unwrap());
        assert_eq!(
            fs::read(dir.join(SETTINGS_ARCHIVE_NAME)).unwrap(),
            original_settings
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn backup_creation_requires_an_initialized_vault() {
        let dir = test_dir("create-without-vault");
        fs::create_dir_all(&dir).unwrap();
        let database = dir.join("timekeeper.db");
        create_timekeeper_database(&database);
        fs::write(
            dir.join(SETTINGS_ARCHIVE_NAME),
            serde_json::to_vec_pretty(&AppSettings::default()).unwrap(),
        )
        .unwrap();
        let state = BackupState::new(&dir, &database).unwrap();

        let error = runtime()
            .block_on(state.create_backup_internal(None, BackupKind::Manual))
            .unwrap_err();
        assert!(error.to_string().contains(VAULT_ARCHIVE_NAME));
        assert!(
            fs::read_dir(&state.backups_dir)
                .unwrap()
                .filter_map(Result::ok)
                .all(|entry| !entry.file_name().to_string_lossy().ends_with(".tkbackup"))
        );
        assert!(
            fs::read_dir(&state.backups_dir)
                .unwrap()
                .filter_map(Result::ok)
                .all(|entry| !entry.file_name().to_string_lossy().ends_with(".partial"))
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn removes_orphaned_pending_directory_before_accepting_new_restore() {
        let dir = test_dir("orphaned-pending");
        fs::create_dir_all(&dir).unwrap();
        let database = dir.join("timekeeper.db");
        create_timekeeper_database(&database);
        fs::write(
            dir.join(SETTINGS_ARCHIVE_NAME),
            serde_json::to_vec_pretty(&AppSettings::default()).unwrap(),
        )
        .unwrap();
        let state = BackupState::new(&dir, &database).unwrap();
        fs::create_dir_all(&state.pending_dir).unwrap();
        fs::write(state.pending_dir.join("partial"), b"stale").unwrap();

        assert!(!state.apply_pending_restore().unwrap());
        assert!(!state.pending_dir.exists());
        assert!(!state.pending_marker.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn cloned_states_wait_on_the_same_data_operation_lock() {
        let dir = test_dir("shared-operation-lock");
        fs::create_dir_all(&dir).unwrap();
        let state = BackupState::new(&dir, dir.join("timekeeper.db")).unwrap();
        let cloned = state.clone();

        runtime().block_on(async {
            let guard = state.lock_data_operation().await;
            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (acquired_tx, mut acquired_rx) = tokio::sync::oneshot::channel();
            let waiter = tokio::spawn(async move {
                let _ = started_tx.send(());
                let _waiter_guard = cloned.lock_data_operation().await;
                let _ = acquired_tx.send(());
            });

            started_rx.await.unwrap();
            assert!(
                tokio::time::timeout(std::time::Duration::from_millis(25), &mut acquired_rx)
                    .await
                    .is_err()
            );
            drop(guard);
            tokio::time::timeout(std::time::Duration::from_secs(1), &mut acquired_rx)
                .await
                .unwrap()
                .unwrap();
            waiter.await.unwrap();
        });

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_invalid_staged_contents_before_creating_restore_state() {
        let dir = test_dir("invalid-staged-content");
        fs::create_dir_all(&dir).unwrap();
        let database = dir.join("timekeeper.db");
        create_timekeeper_database(&database);
        let settings = serde_json::to_vec_pretty(&AppSettings::default()).unwrap();
        fs::write(dir.join(SETTINGS_ARCHIVE_NAME), &settings).unwrap();
        let (vault_bytes, salt_bytes) = create_vault_files(&dir);
        let original_database = fs::read(&database).unwrap();
        let state = BackupState::new(&dir, &database).unwrap();

        let invalid_database_backup = dir.join("invalid-database.tkbackup");
        write_test_backup(
            &invalid_database_backup,
            &[
                (DATABASE_ARCHIVE_NAME, b"not a sqlite database"),
                (SETTINGS_ARCHIVE_NAME, settings.as_slice()),
                (VAULT_ARCHIVE_NAME, vault_bytes.as_slice()),
                (SALT_ARCHIVE_NAME, salt_bytes.as_slice()),
            ],
        );
        let error = runtime()
            .block_on(state.stage_restore(&invalid_database_backup))
            .unwrap_err();
        assert!(error.to_string().contains("数据库"));

        let wrong_schema_database = dir.join("wrong-schema.sqlite3");
        create_wrong_schema_database(&wrong_schema_database);
        let wrong_schema_backup = dir.join("wrong-schema.tkbackup");
        let wrong_schema_bytes = fs::read(&wrong_schema_database).unwrap();
        write_test_backup(
            &wrong_schema_backup,
            &[
                (DATABASE_ARCHIVE_NAME, wrong_schema_bytes.as_slice()),
                (SETTINGS_ARCHIVE_NAME, settings.as_slice()),
                (VAULT_ARCHIVE_NAME, vault_bytes.as_slice()),
                (SALT_ARCHIVE_NAME, salt_bytes.as_slice()),
            ],
        );
        let error = runtime()
            .block_on(state.stage_restore(&wrong_schema_backup))
            .unwrap_err();
        assert!(error.to_string().contains("缺少表"));

        let same_named_wrong_schema_database = dir.join("same-named-wrong-schema.sqlite3");
        create_same_named_wrong_schema_database(&same_named_wrong_schema_database);
        let same_named_wrong_schema_backup = dir.join("same-named-wrong-schema.tkbackup");
        let same_named_wrong_schema_bytes = fs::read(&same_named_wrong_schema_database).unwrap();
        write_test_backup(
            &same_named_wrong_schema_backup,
            &[
                (
                    DATABASE_ARCHIVE_NAME,
                    same_named_wrong_schema_bytes.as_slice(),
                ),
                (SETTINGS_ARCHIVE_NAME, settings.as_slice()),
                (VAULT_ARCHIVE_NAME, vault_bytes.as_slice()),
                (SALT_ARCHIVE_NAME, salt_bytes.as_slice()),
            ],
        );
        let error = runtime()
            .block_on(state.stage_restore(&same_named_wrong_schema_backup))
            .unwrap_err();
        assert!(error.to_string().contains("列"));

        let invalid_snapshot_database = dir.join("invalid-snapshot.sqlite3");
        create_database_with_invalid_appointment(
            &invalid_snapshot_database,
            "2099-01-01",
            None,
            None,
            Some("not-json"),
        );
        let invalid_snapshot_backup = dir.join("invalid-snapshot.tkbackup");
        let invalid_snapshot_bytes = fs::read(&invalid_snapshot_database).unwrap();
        write_test_backup(
            &invalid_snapshot_backup,
            &[
                (DATABASE_ARCHIVE_NAME, invalid_snapshot_bytes.as_slice()),
                (SETTINGS_ARCHIVE_NAME, settings.as_slice()),
                (VAULT_ARCHIVE_NAME, vault_bytes.as_slice()),
                (SALT_ARCHIVE_NAME, salt_bytes.as_slice()),
            ],
        );
        let error = runtime()
            .block_on(state.stage_restore(&invalid_snapshot_backup))
            .unwrap_err();
        assert!(error.to_string().contains("账号快照"));

        let invalid_date_database = dir.join("invalid-date.sqlite3");
        create_database_with_invalid_appointment(
            &invalid_date_database,
            "not-a-date",
            None,
            None,
            None,
        );
        let invalid_date_backup = dir.join("invalid-date.tkbackup");
        let invalid_date_bytes = fs::read(&invalid_date_database).unwrap();
        write_test_backup(
            &invalid_date_backup,
            &[
                (DATABASE_ARCHIVE_NAME, invalid_date_bytes.as_slice()),
                (SETTINGS_ARCHIVE_NAME, settings.as_slice()),
                (VAULT_ARCHIVE_NAME, vault_bytes.as_slice()),
                (SALT_ARCHIVE_NAME, salt_bytes.as_slice()),
            ],
        );
        let error = runtime()
            .block_on(state.stage_restore(&invalid_date_backup))
            .unwrap_err();
        assert!(error.to_string().contains("服务日期"));

        let invalid_duration_database = dir.join("invalid-duration.sqlite3");
        create_database_with_invalid_appointment(
            &invalid_duration_database,
            "2099-01-01",
            Some("2099-01-01T10:00:00"),
            Some("2099-01-02T10:00:00"),
            None,
        );
        let invalid_duration_backup = dir.join("invalid-duration.tkbackup");
        let invalid_duration_bytes = fs::read(&invalid_duration_database).unwrap();
        write_test_backup(
            &invalid_duration_backup,
            &[
                (DATABASE_ARCHIVE_NAME, invalid_duration_bytes.as_slice()),
                (SETTINGS_ARCHIVE_NAME, settings.as_slice()),
                (VAULT_ARCHIVE_NAME, vault_bytes.as_slice()),
                (SALT_ARCHIVE_NAME, salt_bytes.as_slice()),
            ],
        );
        let error = runtime()
            .block_on(state.stage_restore(&invalid_duration_backup))
            .unwrap_err();
        assert!(error.to_string().contains("字段值"));

        let missing_vault_backup = dir.join("missing-vault.tkbackup");
        write_test_backup(
            &missing_vault_backup,
            &[
                (DATABASE_ARCHIVE_NAME, original_database.as_slice()),
                (SETTINGS_ARCHIVE_NAME, settings.as_slice()),
            ],
        );
        let error = runtime()
            .block_on(state.stage_restore(&missing_vault_backup))
            .unwrap_err();
        assert!(error.to_string().contains(VAULT_ARCHIVE_NAME));

        let invalid_settings_backup = dir.join("invalid-settings.tkbackup");
        write_test_backup(
            &invalid_settings_backup,
            &[
                (DATABASE_ARCHIVE_NAME, original_database.as_slice()),
                (SETTINGS_ARCHIVE_NAME, b"{}"),
                (VAULT_ARCHIVE_NAME, vault_bytes.as_slice()),
                (SALT_ARCHIVE_NAME, salt_bytes.as_slice()),
            ],
        );
        let error = runtime()
            .block_on(state.stage_restore(&invalid_settings_backup))
            .unwrap_err();
        assert!(error.to_string().contains("设置"));

        let invalid_vault = vec![0_u8; 173];
        let salt = [0_u8; 32];
        let invalid_vault_backup = dir.join("invalid-vault.tkbackup");
        write_test_backup(
            &invalid_vault_backup,
            &[
                (DATABASE_ARCHIVE_NAME, original_database.as_slice()),
                (SETTINGS_ARCHIVE_NAME, settings.as_slice()),
                (VAULT_ARCHIVE_NAME, invalid_vault.as_slice()),
                (SALT_ARCHIVE_NAME, salt.as_slice()),
            ],
        );
        let error = runtime()
            .block_on(state.stage_restore(&invalid_vault_backup))
            .unwrap_err();
        assert!(error.to_string().contains("Stronghold"));

        let mut structural_vault = vec![0_u8; 173];
        structural_vault[..7].copy_from_slice(b"PARTI\x03\x00");
        let short_salt = [0_u8; 31];
        let invalid_salt_backup = dir.join("invalid-salt.tkbackup");
        write_test_backup(
            &invalid_salt_backup,
            &[
                (DATABASE_ARCHIVE_NAME, original_database.as_slice()),
                (SETTINGS_ARCHIVE_NAME, settings.as_slice()),
                (VAULT_ARCHIVE_NAME, structural_vault.as_slice()),
                (SALT_ARCHIVE_NAME, short_salt.as_slice()),
            ],
        );
        let error = runtime()
            .block_on(state.stage_restore(&invalid_salt_backup))
            .unwrap_err();
        assert!(error.to_string().contains("盐"));

        assert_eq!(fs::read(&database).unwrap(), original_database);
        assert!(!state.pending_dir.exists());
        assert!(!state.pending_marker.exists());
        assert_eq!(pre_restore_backup_count(&state), 0);
        assert!(
            fs::read_dir(&dir)
                .unwrap()
                .filter_map(Result::ok)
                .all(|entry| !entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".restore-stage-"))
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn full_business_flow_survives_backup_and_restore() {
        let dir = test_dir("full-business-flow");
        fs::create_dir_all(&dir).unwrap();
        let database_path = dir.join("timekeeper.db");
        let state = BackupState::new(&dir, &database_path).unwrap();
        let runtime = runtime();
        let password = "correct horse battery staple";

        let (backup, target_id) = runtime.block_on(async {
            let settings = SettingsState::load(&dir).unwrap();
            let vault = VaultState::new(&dir).unwrap();
            assert!(vault.initialize(password.into()).unwrap().unlocked);
            vault
                .set_secret("workflow-account", "original-secret".into())
                .unwrap();
            assert!(!vault.lock().unwrap().unlocked);
            assert!(vault.unlock(password.into()).unwrap().unlocked);

            let database = Database::initialize(&database_path).await.unwrap();
            let mut existing = business_input("2026-07-13", "19:00", "21:00", 0);
            existing.mode = AppointmentMode::Entertainment;
            existing.settlement_status = SettlementStatus::NotApplicable;
            existing.rate_note = None;
            existing.amount_minor = None;
            create_appointment_impl(&database, existing).await.unwrap();

            let target = create_appointment_impl(
                &database,
                business_input("2026-07-13", "20:00", "22:00", 12_000),
            )
            .await
            .unwrap();
            assert_eq!(target.conflicts.len(), 1);

            let completed = set_appointment_service_status_impl(
                &database,
                &target.appointment.id,
                ServiceStatus::Completed,
            )
            .await
            .unwrap();
            assert_eq!(completed.service_status, ServiceStatus::Completed);
            assert_eq!(completed.settlement_status, SettlementStatus::Unsettled);

            let pending = get_revenue_summary_impl(
                &database,
                "2026-07-13",
                "2026-07-13",
                ReportGranularity::Day,
            )
            .await
            .unwrap();
            assert_eq!(pending.settled_minor, 0);
            assert_eq!(pending.unsettled_minor, 12_000);

            settle_appointment_impl(
                &database,
                &target.appointment.id,
                12_000,
                Some("微信".into()),
            )
            .await
            .unwrap();
            let settled = get_revenue_summary_impl(
                &database,
                "2026-07-13",
                "2026-07-13",
                ReportGranularity::Day,
            )
            .await
            .unwrap();
            assert_eq!(settled.settled_minor, 12_000);
            assert_eq!(settled.unsettled_minor, 0);

            let backup = state
                .create_backup_internal(None, BackupKind::Manual)
                .await
                .unwrap();
            settle_appointment_impl(&database, &target.appointment.id, 99_000, None)
                .await
                .unwrap();
            vault
                .set_secret("workflow-account", "changed-secret".into())
                .unwrap();

            state.stage_restore(Path::new(&backup.path)).await.unwrap();
            assert_eq!(pre_restore_backup_count(&state), 1);
            database.pool().close().await;
            drop(database);
            drop(vault);
            drop(settings);
            (backup, target.appointment.id)
        });

        assert!(Path::new(&backup.path).is_file());
        assert!(state.apply_pending_restore().unwrap());
        runtime.block_on(async {
            let restored_database = Database::initialize(&database_path).await.unwrap();
            let restored = get_appointment_impl(&restored_database, &target_id)
                .await
                .unwrap();
            assert_eq!(restored.service_status, ServiceStatus::Completed);
            assert_eq!(restored.settlement_status, SettlementStatus::Settled);
            assert_eq!(restored.amount_minor, Some(12_000));

            let revenue = get_revenue_summary_impl(
                &restored_database,
                "2026-07-13",
                "2026-07-13",
                ReportGranularity::Day,
            )
            .await
            .unwrap();
            assert_eq!(revenue.settled_minor, 12_000);
            assert_eq!(revenue.unsettled_minor, 0);

            let restored_vault = VaultState::new(&dir).unwrap();
            assert!(!restored_vault.status().unwrap().unlocked);
            assert!(restored_vault.unlock(password.into()).unwrap().unlocked);
            assert_eq!(
                restored_vault.get_secret("workflow-account").unwrap(),
                "original-secret"
            );
            restored_database.pool().close().await;
        });
        assert!(!state.pending_dir.exists());
        assert!(!state.pending_marker.exists());
        drop(runtime);
        drop(state);
        remove_test_dir_after_sqlite_shutdown(dir);
    }

    #[test]
    fn manifest_rejects_unpaired_stronghold_files() {
        let manifest = BackupManifest {
            format_version: BACKUP_FORMAT_VERSION,
            created_at: Utc::now().to_rfc3339(),
            files: vec![ManifestFile {
                name: VAULT_ARCHIVE_NAME.into(),
                size_bytes: 1,
                sha256: "0".repeat(64),
            }],
        };
        assert!(matches!(
            validate_manifest(&manifest),
            Err(BackupError::InvalidBackup(_))
        ));
    }

    #[test]
    fn retention_only_prunes_automatic_backups() {
        let dir = test_dir("retention");
        fs::create_dir_all(&dir).unwrap();
        for name in [
            "auto-20260710-100000-000.tkbackup",
            "auto-20260711-100000-000.tkbackup",
            "auto-20260712-100000-000.tkbackup",
            "manual-20260701-100000-000.tkbackup",
        ] {
            fs::write(dir.join(name), b"backup").unwrap();
        }

        prune_automatic_backups(&dir, 2).unwrap();
        assert!(!dir.join("auto-20260710-100000-000.tkbackup").exists());
        assert!(dir.join("auto-20260712-100000-000.tkbackup").exists());
        assert!(dir.join("manual-20260701-100000-000.tkbackup").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
