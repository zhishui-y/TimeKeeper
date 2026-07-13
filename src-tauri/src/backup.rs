use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use chrono::{Local, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Connection, SqliteConnection, sqlite::SqliteConnectOptions};
use tauri::{AppHandle, Runtime, State};
use thiserror::Error;
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::settings::{SettingsError, SettingsState};

const BACKUP_FORMAT_VERSION: u32 = 1;
const DATABASE_ARCHIVE_NAME: &str = "database.sqlite3";
const VAULT_ARCHIVE_NAME: &str = "vault.hold";
const SALT_ARCHIVE_NAME: &str = "vault.salt";
const SETTINGS_ARCHIVE_NAME: &str = "settings.json";
const MANIFEST_ARCHIVE_NAME: &str = "manifest.json";
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_ENTRY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;

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
            data_dir,
        })
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
        fs::remove_dir_all(&self.pending_dir)?;
        fs::remove_file(&self.pending_marker)?;
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

        let result =
            self.write_backup_package(&output_path, database_snapshot.as_deref(), now.to_rfc3339());
        if let Some(snapshot) = database_snapshot {
            let _ = fs::remove_file(snapshot);
        }
        let _ = remove_dir_if_empty(&work_dir);
        result
    }

    fn write_backup_package(
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
        for source in &sources {
            reject_symlink(&source.path)?;
            manifest.files.push(ManifestFile {
                name: source.archive_name.to_string(),
                size_bytes: fs::metadata(&source.path)?.len(),
                sha256: hash_file(&source.path)?,
            });
        }

        let parent = output_path
            .parent()
            .ok_or_else(|| BackupError::InvalidBackup("目标备份路径缺少父目录".into()))?;
        let partial_path =
            parent.join(format!(".backup-{}.partial", uuid::Uuid::now_v7().simple()));
        let partial = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial_path)?;
        let mut archive = ZipWriter::new(partial);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o600);

        let write_result = (|| -> Result<(), BackupError> {
            for source in &sources {
                archive.start_file(source.archive_name, options)?;
                let mut input = File::open(&source.path)?;
                std::io::copy(&mut input, &mut archive)?;
            }
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
        fs::rename(&partial_path, output_path)?;
        let size_bytes = fs::metadata(output_path)?.len();
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

    async fn stage_restore(&self, backup_path: &Path) -> Result<(), BackupError> {
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

        if let Err(error) = self
            .create_backup_internal(None, BackupKind::PreRestore)
            .await
        {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(error);
        }

        fs::rename(&staging_dir, &self.pending_dir)?;
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
            copy_file_synced(&self.pending_dir.join(&entry.name), &next_path)?;
            fs::rename(&next_path, &target)?;
        }
        Ok(())
    }

    fn recover_interrupted_restore(&self) -> Result<(), BackupError> {
        if !self.rollback_dir.exists() {
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
    state
        .stage_restore(Path::new(&path))
        .await
        .map_err(|error| error.to_string())?;
    app.restart()
}

pub(crate) async fn create_automatic_backup_if_due(
    backup: &BackupState,
    settings: &SettingsState,
) -> Result<Option<BackupResult>, BackupError> {
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
    Ok(())
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

    fn test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("timekeeper-backup-{name}-{}", uuid::Uuid::now_v7()))
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    fn create_database(path: &Path) {
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

    #[test]
    fn package_is_verified_staged_and_applied() {
        let dir = test_dir("round-trip");
        fs::create_dir_all(&dir).unwrap();
        let database = dir.join("timekeeper.db");
        create_database(&database);
        fs::write(dir.join(SETTINGS_ARCHIVE_NAME), b"original-settings").unwrap();
        let state = BackupState::new(&dir, &database).unwrap();

        let backup = runtime()
            .block_on(state.create_backup_internal(None, BackupKind::Manual))
            .unwrap();
        fs::write(dir.join(SETTINGS_ARCHIVE_NAME), b"changed-settings").unwrap();
        runtime()
            .block_on(state.stage_restore(Path::new(&backup.path)))
            .unwrap();
        assert!(state.apply_pending_restore().unwrap());
        assert_eq!(
            fs::read(dir.join(SETTINGS_ARCHIVE_NAME)).unwrap(),
            b"original-settings"
        );
        fs::remove_dir_all(dir).unwrap();
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
