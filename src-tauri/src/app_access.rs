use std::{
    fmt,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use serde::{Deserialize, Serialize};
use sqlx::{Row, Sqlite, Transaction, sqlite::SqliteRow};
use tauri::State;
use zeroize::Zeroizing;

use crate::{
    backup::BackupState,
    db::Database,
    importer::ImportState,
    vault::{VaultState, run_blocking_vault_operation},
};

const MIN_PASSWORD_CHARACTERS: usize = 4;
const RESET_CONFIRMATION_TEXT: &str = "重置";
const MIN_RECOVERY_TEXT_CHARACTERS: usize = 2;
const MAX_RECOVERY_TEXT_CHARACTERS: usize = 100;

pub(crate) fn is_supported_access_verifier(verifier: &str) -> bool {
    fn is_canonical_32_byte_base64(value: &str) -> bool {
        const CANONICAL_LAST_CHARACTERS: &str = "AEIMQUYcgkosw048";
        value.len() == 43
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/')
            && value
                .chars()
                .last()
                .is_some_and(|last| CANONICAL_LAST_CHARACTERS.contains(last))
    }

    let parts = verifier.split('$').collect::<Vec<_>>();
    matches!(
        parts.as_slice(),
        ["", "argon2id", "v=19", "m=65536,t=3,p=1", salt, hash]
            if is_canonical_32_byte_base64(salt) && is_canonical_32_byte_base64(hash)
    )
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppAccessStatus {
    pub initialized: bool,
    pub unlocked: bool,
    pub legacy_migration_pending_count: usize,
    pub recovery_question: Option<String>,
    pub data_repair_issue_count: usize,
    pub data_repair_issues: Vec<DataRepairIssue>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DataRepairIssue {
    pub id: String,
    pub entity_kind: String,
    pub entity_id: String,
    pub display_name: String,
    pub field_name: String,
    pub original_value: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppAccessRecoverySetup {
    pub question: String,
    pub answer: String,
}

impl fmt::Debug for AppAccessRecoverySetup {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AppAccessRecoverySetup")
            .field("question", &self.question)
            .field("answer", &"<redacted>")
            .finish()
    }
}

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppAccessRecoveryProof {
    Answer { answer: String },
    LegacyEnrollment { recovery: AppAccessRecoverySetup },
}

impl fmt::Debug for AppAccessRecoveryProof {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Answer { .. } => formatter
                .debug_struct("Answer")
                .field("answer", &"<redacted>")
                .finish(),
            Self::LegacyEnrollment { recovery } => formatter
                .debug_struct("LegacyEnrollment")
                .field("recovery", recovery)
                .finish(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyCredentialMigrationResult {
    pub migrated_count: usize,
    pub missing_count: usize,
    pub pending_count: usize,
}

#[derive(Clone, Default)]
pub struct AppAccessState {
    unlocked: Arc<AtomicBool>,
    transition: Arc<tokio::sync::Mutex<()>>,
}

#[derive(Debug, Clone)]
struct AppAccessStatusSnapshot {
    initialized: bool,
    legacy_migration_pending_count: usize,
    recovery_question: Option<String>,
    data_repair_issue_count: usize,
    data_repair_issues: Vec<DataRepairIssue>,
}

impl AppAccessStatusSnapshot {
    fn with_state(self, unlocked: bool) -> AppAccessStatus {
        AppAccessStatus {
            initialized: self.initialized,
            unlocked: self.initialized && unlocked,
            legacy_migration_pending_count: self.legacy_migration_pending_count,
            recovery_question: self.recovery_question,
            data_repair_issue_count: self.data_repair_issue_count,
            data_repair_issues: if unlocked {
                self.data_repair_issues
            } else {
                Vec::new()
            },
        }
    }
}

impl AppAccessState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn require_unlocked(&self) -> Result<(), String> {
        self.unlocked
            .load(Ordering::Acquire)
            .then_some(())
            .ok_or_else(|| "应用已锁定，请先输入入口密码".to_string())
    }

    fn set_unlocked(&self, unlocked: bool) {
        self.unlocked.store(unlocked, Ordering::Release);
    }

    fn is_unlocked(&self) -> bool {
        self.unlocked.load(Ordering::Acquire)
    }

    #[cfg(test)]
    pub(crate) fn set_unlocked_for_test(&self, unlocked: bool) {
        self.set_unlocked(unlocked);
    }
}

#[derive(Debug, Clone)]
struct LegacyMigrationRow {
    target_kind: String,
    target_id: String,
    source_kind: String,
    source_id: String,
}

fn db_error(context: &str, error: sqlx::Error) -> String {
    format!("{context}：{error}")
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < MIN_PASSWORD_CHARACTERS {
        return Err("入口密码至少需要4个字符".into());
    }
    Ok(())
}

fn normalize_recovery_answer(answer: &str) -> String {
    answer
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn validate_recovery_setup(recovery: &AppAccessRecoverySetup) -> Result<String, String> {
    let question = recovery.question.trim();
    let answer = normalize_recovery_answer(&recovery.answer);
    let question_count = question.chars().count();
    let answer_count = answer.chars().count();
    if !(MIN_RECOVERY_TEXT_CHARACTERS..=MAX_RECOVERY_TEXT_CHARACTERS).contains(&question_count) {
        return Err("恢复问题需要2到100个字符".into());
    }
    if !(MIN_RECOVERY_TEXT_CHARACTERS..=MAX_RECOVERY_TEXT_CHARACTERS).contains(&answer_count) {
        return Err("恢复答案规范化后需要2到100个字符".into());
    }
    Ok(answer)
}

fn hash_password(password: String) -> Result<String, String> {
    validate_password(&password)?;
    let password = Zeroizing::new(password);
    let mut salt = [0_u8; 32];
    getrandom::fill(&mut salt).map_err(|error| format!("生成入口密码盐失败：{error}"))?;
    argon2::hash_encoded(
        password.as_bytes(),
        &salt,
        &argon2::Config::rfc9106_low_mem(),
    )
    .map_err(|error| format!("派生入口密码校验值失败：{error}"))
}

fn hash_recovery_answer(answer: String) -> Result<String, String> {
    let answer = normalize_recovery_answer(&answer);
    if !(MIN_RECOVERY_TEXT_CHARACTERS..=MAX_RECOVERY_TEXT_CHARACTERS)
        .contains(&answer.chars().count())
    {
        return Err("恢复答案规范化后需要2到100个字符".into());
    }
    let answer = Zeroizing::new(answer);
    let mut salt = [0_u8; 32];
    getrandom::fill(&mut salt).map_err(|error| format!("生成恢复答案盐失败：{error}"))?;
    argon2::hash_encoded(answer.as_bytes(), &salt, &argon2::Config::rfc9106_low_mem())
        .map_err(|error| format!("派生恢复答案校验值失败：{error}"))
}

fn verify_password(verifier: String, password: String) -> Result<bool, String> {
    let password = Zeroizing::new(password);
    argon2::verify_encoded(&verifier, password.as_bytes())
        .map_err(|_| "入口密码校验数据损坏".to_string())
}

fn verify_recovery_answer(verifier: String, answer: String) -> Result<bool, String> {
    let answer = Zeroizing::new(normalize_recovery_answer(&answer));
    argon2::verify_encoded(&verifier, answer.as_bytes())
        .map_err(|_| "恢复答案校验数据损坏".to_string())
}

async fn run_blocking_access_operation<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("入口密码后台任务执行失败：{error}"))?
}

async fn load_verifier(database: &Database) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>("SELECT password_verifier FROM app_access WHERE id = 1")
        .fetch_optional(database.pool())
        .await
        .map_err(|error| db_error("读取入口密码状态失败", error))
}

async fn pending_migration_count(database: &Database) -> Result<usize, String> {
    let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM legacy_credential_migration")
        .fetch_one(database.pool())
        .await
        .map_err(|error| db_error("读取旧密码迁移状态失败", error))?;
    Ok(count.max(0) as usize)
}

async fn load_recovery_question(database: &Database) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>("SELECT question FROM app_access_recovery WHERE id = 1")
        .fetch_optional(database.pool())
        .await
        .map_err(|error| db_error("读取恢复问题失败", error))
}

async fn load_recovery_verifier(database: &Database) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>("SELECT answer_verifier FROM app_access_recovery WHERE id = 1")
        .fetch_optional(database.pool())
        .await
        .map_err(|error| db_error("读取恢复答案状态失败", error))
}

async fn status_impl(
    database: &Database,
    access: &AppAccessState,
) -> Result<AppAccessStatus, String> {
    load_status_snapshot(database, access.is_unlocked())
        .await
        .map(|snapshot| snapshot.with_state(access.is_unlocked()))
}

async fn load_status_snapshot(
    database: &Database,
    include_issue_details: bool,
) -> Result<AppAccessStatusSnapshot, String> {
    let initialized = load_verifier(database).await?.is_some();
    let data_repair_issue_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM legacy_numeric_repair_issues WHERE resolved_at IS NULL",
    )
    .fetch_one(database.pool())
    .await
    .map_err(|error| db_error("读取旧数值修复状态失败", error))?
    .max(0) as usize;
    let data_repair_issues = if include_issue_details {
        sqlx::query(
            "SELECT issue.id, issue.entity_kind, issue.entity_id, issue.field_name,
                    issue.original_value,
                    COALESCE(profile.account_name, appointment.contact_name, issue.entity_id)
                        AS display_name
             FROM legacy_numeric_repair_issues AS issue
             LEFT JOIN account_profiles AS profile
               ON issue.entity_kind = 'account_profile' AND profile.id = issue.entity_id
             LEFT JOIN appointments AS appointment
               ON issue.entity_kind = 'appointment' AND appointment.id = issue.entity_id
             WHERE issue.resolved_at IS NULL
             ORDER BY issue.created_at, issue.id",
        )
        .fetch_all(database.pool())
        .await
        .map_err(|error| db_error("读取旧数值修复明细失败", error))?
        .into_iter()
        .map(|row| {
            Ok(DataRepairIssue {
                id: row
                    .try_get("id")
                    .map_err(|error| db_error("读取修复记录失败", error))?,
                entity_kind: row
                    .try_get("entity_kind")
                    .map_err(|error| db_error("读取修复记录失败", error))?,
                entity_id: row
                    .try_get("entity_id")
                    .map_err(|error| db_error("读取修复记录失败", error))?,
                display_name: row
                    .try_get("display_name")
                    .map_err(|error| db_error("读取修复记录失败", error))?,
                field_name: row
                    .try_get("field_name")
                    .map_err(|error| db_error("读取修复记录失败", error))?,
                original_value: row
                    .try_get("original_value")
                    .map_err(|error| db_error("读取修复记录失败", error))?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?
    } else {
        Vec::new()
    };
    Ok(AppAccessStatusSnapshot {
        initialized,
        legacy_migration_pending_count: pending_migration_count(database).await?,
        recovery_question: load_recovery_question(database).await?,
        data_repair_issue_count,
        data_repair_issues,
    })
}

#[tauri::command]
pub async fn app_access_status(
    database: State<'_, Database>,
    access: State<'_, AppAccessState>,
) -> Result<AppAccessStatus, String> {
    status_impl(database.inner(), access.inner()).await
}

async fn initialize_impl(
    database: &Database,
    access: &AppAccessState,
    password: String,
    recovery: AppAccessRecoverySetup,
) -> Result<AppAccessStatus, String> {
    let _transition = access.transition.lock().await;
    if load_verifier(database).await?.is_some() {
        return Err("入口密码已经初始化".into());
    }
    let normalized_answer = validate_recovery_setup(&recovery)?;
    let mut status = load_status_snapshot(database, true).await?;
    let answer_for_hash = normalized_answer.clone();
    let (verifier, answer_verifier) = run_blocking_access_operation(move || {
        Ok((
            hash_password(password)?,
            hash_recovery_answer(answer_for_hash)?,
        ))
    })
    .await?;
    let mut transaction = database
        .pool()
        .begin()
        .await
        .map_err(|error| db_error("开始初始化入口安全事务失败", error))?;
    let now = chrono::Utc::now().to_rfc3339();
    let result =
        sqlx::query("INSERT INTO app_access (id, password_verifier, updated_at) VALUES (1, ?, ?)")
            .bind(verifier)
            .bind(&now)
            .execute(&mut *transaction)
            .await
            .map_err(|error| db_error("保存入口密码失败", error))?;
    if result.rows_affected() != 1 {
        transaction.rollback().await.ok();
        return Err("入口密码已经初始化".into());
    }
    sqlx::query(
        "INSERT INTO app_access_recovery (id, question, answer_verifier, updated_at)
         VALUES (1, ?, ?, ?)",
    )
    .bind(recovery.question.trim())
    .bind(answer_verifier)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error("保存恢复问题失败", error))?;
    transaction
        .commit()
        .await
        .map_err(|error| db_error("提交入口安全初始化失败", error))?;
    access.set_unlocked(true);
    status.initialized = true;
    status.recovery_question = Some(recovery.question.trim().to_string());
    Ok(status.with_state(true))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn initialize_app_access(
    password: String,
    recovery: AppAccessRecoverySetup,
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    access: State<'_, AppAccessState>,
) -> Result<AppAccessStatus, String> {
    let _operation_guard = backup.lock_data_operation().await;
    initialize_impl(database.inner(), access.inner(), password, recovery).await
}

async fn unlock_impl(
    database: &Database,
    access: &AppAccessState,
    password: String,
) -> Result<AppAccessStatus, String> {
    let _transition = access.transition.lock().await;
    let verifier = load_verifier(database)
        .await?
        .ok_or_else(|| "入口密码尚未初始化".to_string())?;
    let verified =
        run_blocking_access_operation(move || verify_password(verifier, password)).await?;
    if !verified {
        return Err("入口密码错误".into());
    }
    let status = load_status_snapshot(database, true).await?;
    access.set_unlocked(true);
    Ok(status.with_state(true))
}

async fn lock_impl(
    database: &Database,
    access: &AppAccessState,
    imports: &ImportState,
) -> Result<AppAccessStatus, String> {
    let _transition = access.transition.lock().await;
    let status = load_status_snapshot(database, false).await?;
    access.set_unlocked(false);
    imports.clear();
    Ok(status.with_state(false))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn unlock_app_access(
    password: String,
    database: State<'_, Database>,
    access: State<'_, AppAccessState>,
) -> Result<AppAccessStatus, String> {
    unlock_impl(database.inner(), access.inner(), password).await
}

#[tauri::command]
pub async fn lock_app_access(
    database: State<'_, Database>,
    access: State<'_, AppAccessState>,
    imports: State<'_, ImportState>,
) -> Result<AppAccessStatus, String> {
    lock_impl(database.inner(), access.inner(), imports.inner()).await
}

async fn change_password_impl(
    database: &Database,
    access: &AppAccessState,
    current_password: String,
    new_password: String,
) -> Result<AppAccessStatus, String> {
    access.require_unlocked()?;
    validate_password(&new_password)?;
    if current_password == new_password {
        return Err("新入口密码不能与当前密码相同".into());
    }

    let verifier = load_verifier(database)
        .await?
        .ok_or_else(|| "入口密码尚未初始化".to_string())?;
    let verified =
        run_blocking_access_operation(move || verify_password(verifier, current_password)).await?;
    if !verified {
        return Err("当前入口密码不正确".into());
    }
    let status = load_status_snapshot(database, true).await?;

    let new_verifier = run_blocking_access_operation(move || hash_password(new_password)).await?;
    let result =
        sqlx::query("UPDATE app_access SET password_verifier = ?, updated_at = ? WHERE id = 1")
            .bind(new_verifier)
            .bind(chrono::Utc::now().to_rfc3339())
            .execute(database.pool())
            .await
            .map_err(|error| db_error("修改入口密码失败", error))?;
    if result.rows_affected() != 1 {
        return Err("入口密码尚未初始化".into());
    }
    Ok(status.with_state(true))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn change_app_access_password(
    current_password: String,
    new_password: String,
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    access: State<'_, AppAccessState>,
) -> Result<AppAccessStatus, String> {
    let _transition = access.transition.lock().await;
    let _operation_guard = backup.lock_data_operation().await;
    change_password_impl(
        database.inner(),
        access.inner(),
        current_password,
        new_password,
    )
    .await
}

async fn set_recovery_impl(
    database: &Database,
    access: &AppAccessState,
    current_password: String,
    recovery: AppAccessRecoverySetup,
) -> Result<AppAccessStatus, String> {
    access.require_unlocked()?;
    let normalized_answer = validate_recovery_setup(&recovery)?;
    let verifier = load_verifier(database)
        .await?
        .ok_or_else(|| "入口密码尚未初始化".to_string())?;
    let verified =
        run_blocking_access_operation(move || verify_password(verifier, current_password)).await?;
    if !verified {
        return Err("当前入口密码不正确".into());
    }
    let mut status = load_status_snapshot(database, true).await?;
    let answer_verifier =
        run_blocking_access_operation(move || hash_recovery_answer(normalized_answer)).await?;
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO app_access_recovery (id, question, answer_verifier, updated_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            question = excluded.question,
            answer_verifier = excluded.answer_verifier,
            updated_at = excluded.updated_at",
    )
    .bind(recovery.question.trim())
    .bind(answer_verifier)
    .bind(now)
    .execute(database.pool())
    .await
    .map_err(|error| db_error("保存恢复问题失败", error))?;
    status.recovery_question = Some(recovery.question.trim().to_string());
    Ok(status.with_state(true))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_app_access_recovery(
    current_password: String,
    recovery: AppAccessRecoverySetup,
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    access: State<'_, AppAccessState>,
) -> Result<AppAccessStatus, String> {
    let _transition = access.transition.lock().await;
    let _operation_guard = backup.lock_data_operation().await;
    set_recovery_impl(database.inner(), access.inner(), current_password, recovery).await
}

async fn reset_password_impl(
    database: &Database,
    access: &AppAccessState,
    new_password: String,
    confirmation_text: String,
    recovery_proof: AppAccessRecoveryProof,
) -> Result<AppAccessStatus, String> {
    if confirmation_text != RESET_CONFIRMATION_TEXT {
        return Err("请输入“重置”以确认无损重置入口密码".into());
    }
    let existing_recovery_verifier = load_recovery_verifier(database).await?;
    let enrollment = match (existing_recovery_verifier, recovery_proof) {
        (Some(verifier), AppAccessRecoveryProof::Answer { answer }) => {
            let verified =
                run_blocking_access_operation(move || verify_recovery_answer(verifier, answer))
                    .await?;
            if !verified {
                return Err("恢复答案错误".into());
            }
            None
        }
        (Some(_), AppAccessRecoveryProof::LegacyEnrollment { .. }) => {
            return Err("恢复问题已经存在，请先回答当前问题".into());
        }
        (None, AppAccessRecoveryProof::LegacyEnrollment { recovery }) => {
            let normalized_answer = validate_recovery_setup(&recovery)?;
            Some((recovery.question.trim().to_string(), normalized_answer))
        }
        (None, AppAccessRecoveryProof::Answer { .. }) => {
            return Err("旧用户需要先设置恢复问题".into());
        }
    };
    let answer_for_hash = enrollment.as_ref().map(|(_, answer)| answer.clone());
    let mut status = load_status_snapshot(database, true).await?;
    let (verifier, answer_verifier) = run_blocking_access_operation(move || {
        let answer_verifier = answer_for_hash.map(hash_recovery_answer).transpose()?;
        Ok((hash_password(new_password)?, answer_verifier))
    })
    .await?;
    let mut transaction = database
        .pool()
        .begin()
        .await
        .map_err(|error| db_error("开始重置入口安全事务失败", error))?;
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO app_access (id, password_verifier, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            password_verifier = excluded.password_verifier,
            updated_at = excluded.updated_at",
    )
    .bind(verifier)
    .bind(&now)
    .execute(&mut *transaction)
    .await
    .map_err(|error| db_error("重置入口密码失败", error))?;
    if let Some((question, _)) = enrollment {
        status.recovery_question = Some(question.clone());
        sqlx::query(
            "INSERT INTO app_access_recovery (id, question, answer_verifier, updated_at)
             VALUES (1, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                question = excluded.question,
                answer_verifier = excluded.answer_verifier,
                updated_at = excluded.updated_at",
        )
        .bind(question)
        .bind(answer_verifier.expect("旧用户兼容注册必须生成答案校验值"))
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| db_error("创建恢复问题失败", error))?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| db_error("提交入口密码重置失败", error))?;
    access.set_unlocked(true);
    status.initialized = true;
    Ok(status.with_state(true))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reset_app_access_password(
    new_password: String,
    confirmation_text: String,
    recovery_proof: AppAccessRecoveryProof,
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    access: State<'_, AppAccessState>,
) -> Result<AppAccessStatus, String> {
    let _operation_guard = backup.lock_data_operation().await;
    reset_password_impl(
        database.inner(),
        access.inner(),
        new_password,
        confirmation_text,
        recovery_proof,
    )
    .await
}

async fn load_migration_rows(database: &Database) -> Result<Vec<LegacyMigrationRow>, String> {
    sqlx::query(
        "SELECT target_kind, target_id, source_kind, source_id
         FROM legacy_credential_migration
         ORDER BY target_kind, target_id",
    )
    .fetch_all(database.pool())
    .await
    .map_err(|error| db_error("读取旧密码迁移清单失败", error))?
    .iter()
    .map(migration_row_from_sql)
    .collect()
}

fn migration_row_from_sql(row: &SqliteRow) -> Result<LegacyMigrationRow, String> {
    Ok(LegacyMigrationRow {
        target_kind: row
            .try_get("target_kind")
            .map_err(|error| db_error("读取旧密码迁移目标类型失败", error))?,
        target_id: row
            .try_get("target_id")
            .map_err(|error| db_error("读取旧密码迁移目标 ID 失败", error))?,
        source_kind: row
            .try_get("source_kind")
            .map_err(|error| db_error("读取旧密码迁移来源类型失败", error))?,
        source_id: row
            .try_get("source_id")
            .map_err(|error| db_error("读取旧密码迁移来源 ID 失败", error))?,
    })
}

async fn credential_exists(
    transaction: &mut Transaction<'_, Sqlite>,
    row: &LegacyMigrationRow,
) -> Result<bool, String> {
    let query = match row.target_kind.as_str() {
        "account_profile" => {
            "SELECT EXISTS(SELECT 1 FROM account_profile_credentials WHERE profile_id = ?)"
        }
        "appointment" => {
            "SELECT EXISTS(SELECT 1 FROM appointment_credentials WHERE appointment_id = ?)"
        }
        _ => return Err("旧密码迁移目标类型不合法".into()),
    };
    sqlx::query_scalar::<_, i64>(query)
        .bind(&row.target_id)
        .fetch_one(&mut **transaction)
        .await
        .map(|exists| exists != 0)
        .map_err(|error| db_error("检查现有密码失败", error))
}

async fn insert_credential(
    transaction: &mut Transaction<'_, Sqlite>,
    row: &LegacyMigrationRow,
    password: String,
) -> Result<u64, String> {
    let query = match row.target_kind.as_str() {
        "account_profile" => {
            "INSERT INTO account_profile_credentials (profile_id, password)
             VALUES (?, ?) ON CONFLICT(profile_id) DO NOTHING"
        }
        "appointment" => {
            "INSERT INTO appointment_credentials (appointment_id, password)
             VALUES (?, ?) ON CONFLICT(appointment_id) DO NOTHING"
        }
        _ => return Err("旧密码迁移目标类型不合法".into()),
    };
    sqlx::query(query)
        .bind(&row.target_id)
        .bind(password)
        .execute(&mut **transaction)
        .await
        .map(|result| result.rows_affected())
        .map_err(|error| db_error("写入迁移密码失败", error))
}

async fn finish_migration_row(
    transaction: &mut Transaction<'_, Sqlite>,
    row: &LegacyMigrationRow,
) -> Result<(), String> {
    sqlx::query(
        "DELETE FROM legacy_credential_migration
         WHERE target_kind = ? AND target_id = ?",
    )
    .bind(&row.target_kind)
    .bind(&row.target_id)
    .execute(&mut **transaction)
    .await
    .map_err(|error| db_error("完成旧密码迁移记录失败", error))?;
    Ok(())
}

async fn migrate_impl(
    database: &Database,
    access: &AppAccessState,
    vault: &VaultState,
    password: String,
    recovery: Option<AppAccessRecoverySetup>,
) -> Result<LegacyCredentialMigrationResult, String> {
    let _transition_guard = access.transition.lock().await;
    let rows = load_migration_rows(database).await?;
    if rows.is_empty() {
        return Ok(LegacyCredentialMigrationResult {
            migrated_count: 0,
            missing_count: 0,
            pending_count: 0,
        });
    }

    let initialized_before = load_verifier(database).await?.is_some();
    if initialized_before {
        access.require_unlocked()?;
    }
    let recovery_to_create = if initialized_before {
        None
    } else {
        Some(recovery.ok_or_else(|| "首次迁移入口密码时必须设置恢复问题".to_string())?)
    };
    let recovery_answer = recovery_to_create
        .as_ref()
        .map(validate_recovery_setup)
        .transpose()?;

    let sources = rows
        .iter()
        .map(|row| (row.source_kind.clone(), row.source_id.clone()))
        .collect::<Vec<_>>();
    let worker_vault = vault.clone();
    let legacy_password = password.clone();
    let passwords = run_blocking_vault_operation(move || {
        worker_vault.read_legacy_credentials(legacy_password, sources)
    })
    .await?;
    let (new_verifier, new_recovery_verifier) = if initialized_before {
        (None, None)
    } else {
        let recovery_answer = recovery_answer.clone().expect("恢复答案已经校验");
        let (verifier, answer_verifier) = run_blocking_access_operation(move || {
            Ok((
                hash_password(password)?,
                hash_recovery_answer(recovery_answer)?,
            ))
        })
        .await?;
        (Some(verifier), Some(answer_verifier))
    };

    let mut transaction = database
        .pool()
        .begin()
        .await
        .map_err(|error| db_error("开始旧密码迁移事务失败", error))?;
    if let Some(verifier) = new_verifier {
        let result = sqlx::query(
            "INSERT INTO app_access (id, password_verifier, updated_at)
             SELECT 1, ?, ?
             WHERE NOT EXISTS (SELECT 1 FROM app_access WHERE id = 1)",
        )
        .bind(verifier)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *transaction)
        .await
        .map_err(|error| db_error("保存迁移后的入口密码失败", error))?;
        if result.rows_affected() != 1 {
            transaction.rollback().await.ok();
            return Err("入口密码状态已变化，请重新操作".into());
        }
        let recovery = recovery_to_create.as_ref().expect("首次迁移必须带恢复设置");
        sqlx::query(
            "INSERT INTO app_access_recovery (id, question, answer_verifier, updated_at)
             VALUES (1, ?, ?, ?)",
        )
        .bind(recovery.question.trim())
        .bind(new_recovery_verifier.expect("首次迁移必须生成恢复答案校验值"))
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *transaction)
        .await
        .map_err(|error| db_error("保存迁移后的恢复问题失败", error))?;
    }

    let mut migrated_count = 0_usize;
    let mut missing_count = 0_usize;
    for (row, password) in rows.iter().zip(passwords) {
        if credential_exists(&mut transaction, row).await? {
            finish_migration_row(&mut transaction, row).await?;
            continue;
        }
        let Some(password) = password else {
            missing_count += 1;
            continue;
        };
        if insert_credential(&mut transaction, row, password).await? == 1 {
            migrated_count += 1;
        }
        finish_migration_row(&mut transaction, row).await?;
    }

    let pending_count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM legacy_credential_migration")
            .fetch_one(&mut *transaction)
            .await
            .map_err(|error| db_error("读取迁移剩余数量失败", error))?
            .max(0) as usize;
    transaction
        .commit()
        .await
        .map_err(|error| db_error("提交旧密码迁移失败", error))?;
    if !initialized_before {
        access.set_unlocked(true);
    }
    Ok(LegacyCredentialMigrationResult {
        migrated_count,
        missing_count,
        pending_count,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn migrate_legacy_credentials(
    password: String,
    recovery: Option<AppAccessRecoverySetup>,
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    access: State<'_, AppAccessState>,
    vault: State<'_, VaultState>,
) -> Result<LegacyCredentialMigrationResult, String> {
    let _operation_guard = backup.lock_data_operation().await;
    migrate_impl(
        database.inner(),
        access.inner(),
        vault.inner(),
        password,
        recovery,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::MIGRATOR;
    use sqlx::{
        migrate::Migrator,
        sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    };

    fn run_async<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(future)
    }

    fn test_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "timekeeper-app-access-{name}-{}",
            uuid::Uuid::now_v7()
        ))
    }

    #[test]
    fn unlock_command_delegates_to_the_single_serialized_transition() {
        let source = include_str!("app_access.rs");
        let command = source
            .split("pub async fn unlock_app_access")
            .nth(1)
            .and_then(|tail| tail.split("#[tauri::command]").next())
            .expect("unlock command source should be present");
        assert!(!command.contains("transition.lock()"));
        assert_eq!(command.matches("unlock_impl(").count(), 1);
    }

    #[test]
    fn accepts_only_the_canonical_access_verifier_profile() {
        let valid = argon2::hash_encoded(
            b"temporary password",
            &[7; 32],
            &argon2::Config::rfc9106_low_mem(),
        )
        .unwrap();
        assert!(is_supported_access_verifier(&valid));
        assert!(!is_supported_access_verifier("$argon2id$broken"));
        assert!(!is_supported_access_verifier(
            "$argon2id$v=19$m=8,t=1,p=1$c2FsdA$aGFzaA"
        ));
        assert!(!is_supported_access_verifier(
            "$argon2id$v=19$m=999999999,t=99,p=1$c2FsdA$aGFzaA"
        ));
    }

    #[test]
    fn recovery_debug_output_redacts_answers() {
        let setup = AppAccessRecoverySetup {
            question: "公开问题".into(),
            answer: "绝不能出现在日志里的答案".into(),
        };
        let proof = AppAccessRecoveryProof::LegacyEnrollment {
            recovery: setup.clone(),
        };
        let answer_proof = AppAccessRecoveryProof::Answer {
            answer: setup.answer.clone(),
        };

        for output in [
            format!("{setup:?}"),
            format!("{proof:?}"),
            format!("{answer_proof:?}"),
        ] {
            assert!(!output.contains("绝不能出现在日志里的答案"));
            assert!(output.contains("<redacted>"));
        }
    }

    #[test]
    fn migration_v5_preserves_v4_appointments_and_records_exact_legacy_sources() {
        run_async(async {
            let dir = test_dir("migration-v4-v5");
            let migration_dir = dir.join("migrations-v4");
            std::fs::create_dir_all(&migration_dir).unwrap();
            for (name, sql) in [
                (
                    "0001_initial.sql",
                    include_str!("../migrations/0001_initial.sql"),
                ),
                (
                    "0002_account_profile_sort_order.sql",
                    include_str!("../migrations/0002_account_profile_sort_order.sql"),
                ),
                (
                    "0003_account_profile_usage_info.sql",
                    include_str!("../migrations/0003_account_profile_usage_info.sql"),
                ),
                (
                    "0004_appointment_embedded_account_voice.sql",
                    include_str!("../migrations/0004_appointment_embedded_account_voice.sql"),
                ),
            ] {
                std::fs::write(migration_dir.join(name), sql).unwrap();
            }

            let database_path = dir.join("v4.db");
            let options = SqliteConnectOptions::new()
                .filename(&database_path)
                .create_if_missing(true)
                .foreign_keys(true);
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .unwrap();
            Migrator::new(migration_dir)
                .await
                .unwrap()
                .run(&pool)
                .await
                .unwrap();

            sqlx::query(
                "INSERT INTO account_profiles (
                    id, server, specialization, gear_score, account_name,
                    needs_review, sort_order, usage_info, created_at, updated_at
                 ) VALUES (
                    'profile-source', '梦江南', '冰心', '128000', 'profile-account',
                    0, 0, '本周占用', '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z')",
            )
            .execute(&pool)
            .await
            .unwrap();
            for (id, available, voice_channel, notes) in [
                ("pending-appointment", 0_i64, "123456", "pending-note"),
                ("direct-appointment", 1_i64, "654321", "direct-note"),
                ("direct-wins", 1_i64, "778899", "direct-wins-note"),
            ] {
                sqlx::query(
                    "INSERT INTO appointments (
                        id, service_date, starts_at, ends_at, contact_name, content, mode,
                        service_status, settlement_status,
                        account_specialization, account_gear_score, account_server, account_name,
                        account_password_available, voice_platform, voice_channel,
                        rate_note, amount_minor, reminder_minutes, notes, created_at, updated_at
                     ) VALUES (
                        ?, '2026-08-03', '2026-08-03T20:00:00+08:00',
                        '2026-08-03T22:00:00+08:00', '迁移联系人', '迁移内容', 'business',
                        'scheduled', 'unsettled', '冰心', '128000', '梦江南', 'legacy-account',
                        ?, 'yy', ?, '100/小时', 20000, 15, ?,
                        '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z')",
                )
                .bind(id)
                .bind(available)
                .bind(voice_channel)
                .bind(notes)
                .execute(&pool)
                .await
                .unwrap();
            }
            sqlx::query(
                "INSERT INTO appointment_password_backfill (
                    appointment_id, source_profile_id
                 ) VALUES
                    ('pending-appointment', 'profile-source'),
                    ('direct-wins', 'profile-source')",
            )
            .execute(&pool)
            .await
            .unwrap();

            MIGRATOR.run(&pool).await.unwrap();

            let columns = sqlx::query_scalar::<_, String>(
                "SELECT name FROM pragma_table_info('appointments') ORDER BY cid",
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            assert!(
                !columns
                    .iter()
                    .any(|name| name == "account_password_available")
            );
            for expected in [
                "account_specialization",
                "account_gear_score",
                "account_server",
                "account_name",
                "voice_platform",
                "voice_channel",
                "reminder_minutes",
            ] {
                assert!(columns.iter().any(|name| name == expected));
            }
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE type='table' AND name='appointment_password_backfill'",
                )
                .fetch_one(&pool)
                .await
                .unwrap(),
                0
            );

            let sources = sqlx::query(
                "SELECT target_kind, target_id, source_kind, source_id
                 FROM legacy_credential_migration
                 ORDER BY target_kind, target_id",
            )
            .fetch_all(&pool)
            .await
            .unwrap()
            .into_iter()
            .map(|row| {
                (
                    row.get::<String, _>("target_kind"),
                    row.get::<String, _>("target_id"),
                    row.get::<String, _>("source_kind"),
                    row.get::<String, _>("source_id"),
                )
            })
            .collect::<Vec<_>>();
            assert_eq!(
                sources,
                [
                    (
                        "account_profile".into(),
                        "profile-source".into(),
                        "account_profile".into(),
                        "profile-source".into(),
                    ),
                    (
                        "appointment".into(),
                        "direct-appointment".into(),
                        "appointment".into(),
                        "direct-appointment".into(),
                    ),
                    (
                        "appointment".into(),
                        "direct-wins".into(),
                        "appointment".into(),
                        "direct-wins".into(),
                    ),
                    (
                        "appointment".into(),
                        "pending-appointment".into(),
                        "account_profile".into(),
                        "profile-source".into(),
                    ),
                ]
            );

            let preserved = sqlx::query(
                "SELECT starts_at, ends_at, content, account_specialization,
                        account_gear_score, account_server, account_name,
                        voice_platform, voice_channel, rate_note, amount_minor,
                        reminder_minutes, notes
                 FROM appointments WHERE id = 'pending-appointment'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(
                preserved.get::<String, _>("starts_at"),
                "2026-08-03T20:00:00+08:00"
            );
            assert_eq!(preserved.get::<String, _>("voice_channel"), "123456");
            assert_eq!(preserved.get::<String, _>("notes"), "pending-note");
            assert_eq!(preserved.get::<i64, _>("amount_minor"), 20_000);
            assert_eq!(preserved.get::<i64, _>("reminder_minutes"), 15);

            let indexes = sqlx::query_scalar::<_, String>(
                "SELECT name FROM sqlite_master
                 WHERE type='index' AND tbl_name='appointments' ORDER BY name",
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            assert!(
                indexes
                    .iter()
                    .any(|name| name == "idx_appointments_history_sort")
            );
            assert!(
                indexes
                    .iter()
                    .any(|name| name == "idx_appointments_pending_notifications")
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM pragma_foreign_key_list('appointment_credentials')
                     WHERE \"table\" = 'appointments' AND \"on_delete\" = 'CASCADE'",
                )
                .fetch_one(&pool)
                .await
                .unwrap(),
                1
            );

            pool.close().await;
            std::fs::remove_dir_all(dir).unwrap();
        });
    }

    #[test]
    fn initializes_locks_unlocks_and_resets_without_touching_business_data() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let access = AppAccessState::new();
            let initialized = initialize_impl(
                &database,
                &access,
                "first password".into(),
                AppAccessRecoverySetup {
                    question: "常用角色".into(),
                    answer: "青瓷".into(),
                },
            )
            .await
            .unwrap();
            assert!(initialized.initialized);
            assert!(initialized.unlocked);

            access.set_unlocked(false);
            assert!(access.require_unlocked().is_err());
            assert!(
                unlock_impl(&database, &access, "wrong password".into())
                    .await
                    .is_err()
            );
            assert!(
                unlock_impl(&database, &access, "first password".into())
                    .await
                    .unwrap()
                    .unlocked
            );

            sqlx::query(
                "INSERT INTO account_profiles (
                    id, account_name, needs_review, sort_order, created_at, updated_at
                 ) VALUES ('kept-profile', 'kept', 0, 0, 'now', 'now')",
            )
            .execute(database.pool())
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO appointments (
                    id, service_date, contact_name, mode, service_status,
                    settlement_status, amount_minor, created_at, updated_at
                 ) VALUES (
                    'kept-appointment', '2026-08-05', 'kept-contact', 'business',
                    'completed', 'settled', 100, 'now', 'now'
                 )",
            )
            .execute(database.pool())
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO appointment_credentials (appointment_id, password)
                 VALUES ('kept-appointment', 'kept-secret')",
            )
            .execute(database.pool())
            .await
            .unwrap();
            assert!(
                reset_password_impl(
                    &database,
                    &access,
                    "new password".into(),
                    "错误".into(),
                    AppAccessRecoveryProof::Answer {
                        answer: "青瓷".into()
                    },
                )
                .await
                .is_err()
            );
            reset_password_impl(
                &database,
                &access,
                "new password".into(),
                "重置".into(),
                AppAccessRecoveryProof::Answer {
                    answer: "青瓷".into(),
                },
            )
            .await
            .unwrap();
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM account_profiles WHERE id = 'kept-profile'",
                )
                .fetch_one(database.pool())
                .await
                .unwrap(),
                1
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM appointments WHERE id = 'kept-appointment'",
                )
                .fetch_one(database.pool())
                .await
                .unwrap(),
                1
            );
            assert_eq!(
                sqlx::query_scalar::<_, String>(
                    "SELECT password FROM appointment_credentials
                     WHERE appointment_id = 'kept-appointment'",
                )
                .fetch_one(database.pool())
                .await
                .unwrap(),
                "kept-secret"
            );
            access.set_unlocked(false);
            assert!(
                unlock_impl(&database, &access, "first password".into())
                    .await
                    .is_err()
            );
            assert!(
                unlock_impl(&database, &access, "new password".into())
                    .await
                    .unwrap()
                    .unlocked
            );
        });
    }

    #[test]
    fn locking_clears_the_in_memory_excel_preview() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let access = AppAccessState::new();
            initialize_impl(
                &database,
                &access,
                "first password".into(),
                AppAccessRecoverySetup {
                    question: "常用角色".into(),
                    answer: "青瓷".into(),
                },
            )
            .await
            .unwrap();
            let imports = ImportState::default();
            imports.insert_for_test("preview-token");

            let status = lock_impl(&database, &access, &imports).await.unwrap();

            assert!(!status.unlocked);
            assert!(access.require_unlocked().is_err());
            assert!(!imports.contains("preview-token"));
        });
    }

    #[test]
    fn legacy_recovery_enrollment_is_atomic_and_can_only_happen_once() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let access = AppAccessState::new();
            initialize_impl(
                &database,
                &access,
                "legacy password".into(),
                AppAccessRecoverySetup {
                    question: "临时问题".into(),
                    answer: "临时答案".into(),
                },
            )
            .await
            .unwrap();
            sqlx::query("DELETE FROM app_access_recovery WHERE id = 1")
                .execute(database.pool())
                .await
                .unwrap();
            let verifier_before = load_verifier(&database).await.unwrap().unwrap();

            sqlx::raw_sql(
                "CREATE TRIGGER reject_recovery_insert
                 BEFORE INSERT ON app_access_recovery
                 BEGIN
                    SELECT RAISE(FAIL, 'forced recovery enrollment rollback');
                 END;",
            )
            .execute(database.pool())
            .await
            .unwrap();
            let recovery = AppAccessRecoverySetup {
                question: "首次设置的问题".into(),
                answer: "首次设置的答案".into(),
            };
            assert!(
                reset_password_impl(
                    &database,
                    &access,
                    "new password".into(),
                    "重置".into(),
                    AppAccessRecoveryProof::LegacyEnrollment {
                        recovery: recovery.clone(),
                    },
                )
                .await
                .is_err()
            );
            assert_eq!(
                load_verifier(&database).await.unwrap().unwrap(),
                verifier_before
            );
            assert!(load_recovery_verifier(&database).await.unwrap().is_none());

            sqlx::query("DROP TRIGGER reject_recovery_insert")
                .execute(database.pool())
                .await
                .unwrap();
            reset_password_impl(
                &database,
                &access,
                "new password".into(),
                "重置".into(),
                AppAccessRecoveryProof::LegacyEnrollment {
                    recovery: recovery.clone(),
                },
            )
            .await
            .unwrap();
            assert_eq!(
                load_recovery_question(&database).await.unwrap().as_deref(),
                Some("首次设置的问题")
            );

            assert!(
                reset_password_impl(
                    &database,
                    &access,
                    "another password".into(),
                    "重置".into(),
                    AppAccessRecoveryProof::LegacyEnrollment { recovery },
                )
                .await
                .is_err()
            );
            reset_password_impl(
                &database,
                &access,
                "another password".into(),
                "重置".into(),
                AppAccessRecoveryProof::Answer {
                    answer: "首次设置的答案".into(),
                },
            )
            .await
            .unwrap();
        });
    }

    #[test]
    fn recovery_answers_guard_reset_and_recovery_updates_are_transactional() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let access = AppAccessState::new();
            initialize_impl(
                &database,
                &access,
                "initial password".into(),
                AppAccessRecoverySetup {
                    question: "常用角色？".into(),
                    answer: "青 瓷".into(),
                },
            )
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO account_profiles (
                    id, account_name, needs_review, sort_order, created_at, updated_at
                 ) VALUES ('recovery-kept', 'kept', 0, 0, 'now', 'now')",
            )
            .execute(database.pool())
            .await
            .unwrap();

            assert!(
                set_recovery_impl(
                    &database,
                    &access,
                    "wrong password".into(),
                    AppAccessRecoverySetup {
                        question: "新问题".into(),
                        answer: "新答案".into(),
                    },
                )
                .await
                .is_err()
            );
            set_recovery_impl(
                &database,
                &access,
                "initial password".into(),
                AppAccessRecoverySetup {
                    question: "新问题".into(),
                    answer: "新答案".into(),
                },
            )
            .await
            .unwrap();
            assert_eq!(
                status_impl(&database, &access)
                    .await
                    .unwrap()
                    .recovery_question
                    .as_deref(),
                Some("新问题")
            );

            assert!(
                reset_password_impl(
                    &database,
                    &access,
                    "next password".into(),
                    "重置".into(),
                    AppAccessRecoveryProof::Answer {
                        answer: "错误答案".into(),
                    },
                )
                .await
                .is_err()
            );
            sqlx::raw_sql(
                "CREATE TRIGGER reject_recovery_update
                 BEFORE UPDATE ON app_access_recovery
                 BEGIN
                    SELECT RAISE(FAIL, 'forced recovery rollback');
                 END;",
            )
            .execute(database.pool())
            .await
            .unwrap();
            assert!(
                set_recovery_impl(
                    &database,
                    &access,
                    "initial password".into(),
                    AppAccessRecoverySetup {
                        question: "不会保存".into(),
                        answer: "答案".into(),
                    },
                )
                .await
                .is_err()
            );
            sqlx::query("DROP TRIGGER reject_recovery_update")
                .execute(database.pool())
                .await
                .unwrap();
            assert_eq!(
                sqlx::query_scalar::<_, String>(
                    "SELECT question FROM app_access_recovery WHERE id = 1",
                )
                .fetch_one(database.pool())
                .await
                .unwrap(),
                "新问题"
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM account_profiles WHERE id = 'recovery-kept'",
                )
                .fetch_one(database.pool())
                .await
                .unwrap(),
                1
            );
        });
    }

    #[test]
    fn migrates_real_legacy_stronghold_entries_without_overwriting_new_values() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let access = AppAccessState::new();
            let dir = test_dir("legacy");
            let vault = VaultState::new(&dir).unwrap();
            vault.initialize("legacy password".into()).unwrap();
            vault
                .set_secret("profile-1", "legacy-profile-secret".into())
                .unwrap();
            vault
                .set_appointment_secret("appointment-1", "legacy-appointment-secret".into())
                .unwrap();
            vault.lock().unwrap();
            let snapshot_before = std::fs::read(dir.join("vault.hold")).unwrap();

            sqlx::query(
                "INSERT INTO account_profiles (
                    id, account_name, needs_review, sort_order, created_at, updated_at
                 ) VALUES
                    ('profile-1', 'legacy-profile', 0, 0, 'now', 'now'),
                    ('profile-new', 'new-profile', 0, 1, 'now', 'now')",
            )
            .execute(database.pool())
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO appointments (
                    id, service_date, contact_name, mode, service_status,
                    settlement_status, account_name, created_at, updated_at
                 ) VALUES (
                    'appointment-1', '2026-08-03', '联系人', 'business', 'scheduled',
                    'unsettled', 'legacy-appointment', 'now', 'now')",
            )
            .execute(database.pool())
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO account_profile_credentials (profile_id, password)
                 VALUES ('profile-new', 'new-value')",
            )
            .execute(database.pool())
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO legacy_credential_migration (
                    target_kind, target_id, source_kind, source_id
                 ) VALUES
                    ('account_profile', 'profile-1', 'account_profile', 'profile-1'),
                    ('account_profile', 'profile-new', 'account_profile', 'missing-new-source'),
                    ('appointment', 'appointment-1', 'appointment', 'appointment-1')",
            )
            .execute(database.pool())
            .await
            .unwrap();

            assert!(
                migrate_impl(
                    &database,
                    &access,
                    &vault,
                    "wrong password".into(),
                    Some(AppAccessRecoverySetup {
                        question: "常用角色".into(),
                        answer: "青瓷".into()
                    }),
                )
                .await
                .is_err()
            );
            sqlx::raw_sql(
                "CREATE TRIGGER reject_legacy_appointment_credential
                 BEFORE INSERT ON appointment_credentials
                 BEGIN
                    SELECT RAISE(FAIL, 'forced migration rollback');
                 END;",
            )
            .execute(database.pool())
            .await
            .unwrap();
            assert!(
                migrate_impl(
                    &database,
                    &access,
                    &vault,
                    "legacy password".into(),
                    Some(AppAccessRecoverySetup {
                        question: "常用角色".into(),
                        answer: "青瓷".into()
                    }),
                )
                .await
                .is_err()
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM app_access")
                    .fetch_one(database.pool())
                    .await
                    .unwrap(),
                0
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM account_profile_credentials
                     WHERE profile_id = 'profile-1'",
                )
                .fetch_one(database.pool())
                .await
                .unwrap(),
                0
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM legacy_credential_migration",)
                    .fetch_one(database.pool())
                    .await
                    .unwrap(),
                3
            );
            sqlx::query("DROP TRIGGER reject_legacy_appointment_credential")
                .execute(database.pool())
                .await
                .unwrap();
            let migrated = migrate_impl(
                &database,
                &access,
                &vault,
                "legacy password".into(),
                Some(AppAccessRecoverySetup {
                    question: "常用角色".into(),
                    answer: "青瓷".into(),
                }),
            )
            .await
            .unwrap();
            assert_eq!(migrated.migrated_count, 2);
            assert_eq!(migrated.missing_count, 0);
            assert_eq!(migrated.pending_count, 0);
            assert_eq!(
                sqlx::query_scalar::<_, String>(
                    "SELECT password FROM account_profile_credentials WHERE profile_id='profile-1'",
                )
                .fetch_one(database.pool())
                .await
                .unwrap(),
                "legacy-profile-secret"
            );
            assert_eq!(
                sqlx::query_scalar::<_, String>(
                    "SELECT password FROM account_profile_credentials WHERE profile_id='profile-new'",
                )
                .fetch_one(database.pool())
                .await
                .unwrap(),
                "new-value"
            );
            assert_eq!(
                std::fs::read(dir.join("vault.hold")).unwrap(),
                snapshot_before
            );
            std::fs::remove_dir_all(dir).unwrap();
        });
    }

    #[test]
    fn missing_legacy_keys_remain_retryable() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let access = AppAccessState::new();
            let dir = test_dir("missing");
            let vault = VaultState::new(&dir).unwrap();
            vault.initialize("legacy password".into()).unwrap();
            vault.lock().unwrap();
            sqlx::query(
                "INSERT INTO account_profiles (
                    id, account_name, needs_review, sort_order, created_at, updated_at
                 ) VALUES ('missing-profile', 'missing', 0, 0, 'now', 'now')",
            )
            .execute(database.pool())
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO legacy_credential_migration (
                    target_kind, target_id, source_kind, source_id
                 ) VALUES ('account_profile', 'missing-profile', 'account_profile', 'missing-profile')",
            )
            .execute(database.pool())
            .await
            .unwrap();

            let result = migrate_impl(
                &database,
                &access,
                &vault,
                "legacy password".into(),
                Some(AppAccessRecoverySetup {
                    question: "常用角色".into(),
                    answer: "青瓷".into(),
                }),
            )
            .await
            .unwrap();
            assert_eq!(result.migrated_count, 0);
            assert_eq!(result.missing_count, 1);
            assert_eq!(result.pending_count, 1);
            assert!(access.require_unlocked().is_ok());
            std::fs::remove_dir_all(dir).unwrap();
        });
    }

    #[test]
    fn repair_issue_details_are_only_exposed_while_unlocked() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let access = AppAccessState::new();
            sqlx::query(
                "INSERT INTO account_profiles (
                    id, account_name, needs_review, sort_order, created_at, updated_at
                 ) VALUES ('repair-profile', '待修复账号', 0, 0, 'now', 'now')",
            )
            .execute(database.pool())
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO legacy_numeric_repair_issues (
                    id, entity_kind, entity_id, field_name, original_value, created_at
                 ) VALUES (1, 'account_profile', 'repair-profile', 'current_score',
                    '9007199254740992', 'now')",
            )
            .execute(database.pool())
            .await
            .unwrap();

            let locked = status_impl(&database, &access).await.unwrap();
            assert_eq!(locked.data_repair_issue_count, 1);
            assert!(locked.data_repair_issues.is_empty());

            access.set_unlocked(true);
            let unlocked = status_impl(&database, &access).await.unwrap();
            assert_eq!(unlocked.data_repair_issue_count, 1);
            assert_eq!(unlocked.data_repair_issues[0].display_name, "待修复账号");
            assert_eq!(
                unlocked.data_repair_issues[0].original_value,
                "9007199254740992"
            );
        });
    }
}
