use chrono::{DateTime, Datelike, Days, FixedOffset, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{QueryBuilder, Row, Sqlite, Transaction, sqlite::SqliteRow};
use tauri::{AppHandle, Manager, Runtime, State};
use uuid::Uuid;

use crate::{
    backup::BackupState,
    db::{Database, ImportWriteResult},
    importer::LegacyAccountProfile,
    models::{AccountProfile, AccountProfileInput},
    settings::SettingsState,
    vault::{VaultState, copy_text_to_clipboard, run_blocking_vault_operation},
};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountUsageWeekSyncResult {
    pub week_start: String,
    pub cleared_count: u64,
}

fn optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
}

fn validate_input(mut input: AccountProfileInput) -> Result<AccountProfileInput, String> {
    input.account_name = input.account_name.trim().to_owned();
    if input.account_name.is_empty() {
        return Err("账号不能为空".into());
    }

    if input
        .password
        .as_deref()
        .is_some_and(|value| !value.is_empty())
    {
        return Err("密码必须由 vault 安全层写入，不能写入 SQLite".into());
    }

    if input.current_score.is_some_and(|score| score < 0)
        || input.highest_score.is_some_and(|score| score < 0)
    {
        return Err("分数不能为负数".into());
    }

    input.contact_name = optional_text(input.contact_name);
    input.server = optional_text(input.server);
    input.character_name = optional_text(input.character_name);
    input.specialization = optional_text(input.specialization);
    input.gear_score = optional_text(input.gear_score);
    input.notes = optional_text(input.notes);
    input.password = None;
    input.score_updated_at = optional_text(input.score_updated_at);
    if let Some(date) = input.score_updated_at.as_deref() {
        NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| "分数更新日期必须使用 YYYY-MM-DD 格式".to_string())?;
    }

    Ok(input)
}

pub(crate) fn profile_from_row(row: &SqliteRow) -> Result<AccountProfile, String> {
    Ok(AccountProfile {
        id: row.try_get("id").map_err(db_error)?,
        contact_name: row.try_get("contact_name").map_err(db_error)?,
        server: row.try_get("server").map_err(db_error)?,
        character_name: row.try_get("character_name").map_err(db_error)?,
        specialization: row.try_get("specialization").map_err(db_error)?,
        gear_score: row.try_get("gear_score").map_err(db_error)?,
        account_name: row.try_get("account_name").map_err(db_error)?,
        current_score: row.try_get("current_score").map_err(db_error)?,
        highest_score: row.try_get("highest_score").map_err(db_error)?,
        score_updated_at: row.try_get("score_updated_at").map_err(db_error)?,
        usage_info: row.try_get("usage_info").map_err(db_error)?,
        notes: row.try_get("notes").map_err(db_error)?,
        needs_review: row.try_get::<i64, _>("needs_review").map_err(db_error)? != 0,
        import_fingerprint: row.try_get("import_fingerprint").map_err(db_error)?,
        created_at: row.try_get("created_at").map_err(db_error)?,
        updated_at: row.try_get("updated_at").map_err(db_error)?,
    })
}

fn db_error(error: sqlx::Error) -> String {
    format!("数据库操作失败: {error}")
}

async fn rollback_transaction(
    transaction: Transaction<'_, Sqlite>,
    primary_error: String,
    rollback_context: &str,
) -> String {
    match transaction.rollback().await {
        Ok(()) => primary_error,
        Err(error) => format!("{primary_error}；{rollback_context}: {error}"),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_account_profiles(
    database: State<'_, Database>,
    query: Option<String>,
    needs_review: Option<bool>,
) -> Result<Vec<AccountProfile>, String> {
    list_account_profiles_impl(database.inner(), query, needs_review).await
}

pub(crate) async fn list_account_profiles_impl(
    database: &Database,
    query: Option<String>,
    needs_review: Option<bool>,
) -> Result<Vec<AccountProfile>, String> {
    let mut builder = QueryBuilder::<Sqlite>::new("SELECT * FROM account_profiles WHERE 1 = 1");

    if let Some(query) = optional_text(query) {
        let pattern = format!("%{}%", query.to_lowercase());
        builder
            .push(" AND (lower(account_name) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(contact_name, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(server, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(character_name, '')) LIKE ")
            .push_bind(pattern)
            .push(")");
    }
    if let Some(needs_review) = needs_review {
        builder
            .push(" AND needs_review = ")
            .push_bind(if needs_review { 1_i64 } else { 0_i64 });
    }
    builder.push(" ORDER BY sort_order ASC, account_name COLLATE NOCASE");

    builder
        .build()
        .fetch_all(database.pool())
        .await
        .map_err(db_error)?
        .iter()
        .map(profile_from_row)
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_account_profile(
    database: State<'_, Database>,
    id: String,
) -> Result<AccountProfile, String> {
    get_account_profile_impl(database.inner(), &id).await
}

pub(crate) async fn get_account_profile_impl(
    database: &Database,
    id: &str,
) -> Result<AccountProfile, String> {
    let row = sqlx::query("SELECT * FROM account_profiles WHERE id = ?")
        .bind(id)
        .fetch_optional(database.pool())
        .await
        .map_err(db_error)?
        .ok_or_else(|| format!("账号档案不存在: {id}"))?;
    profile_from_row(&row)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_account_profile<R: Runtime>(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    app: AppHandle<R>,
    mut input: AccountProfileInput,
) -> Result<AccountProfile, String> {
    let _operation_guard = backup.lock_data_operation().await;
    let password = input
        .password
        .take()
        .filter(|password| !password.is_empty())
        .ok_or_else(|| "新建账号档案时密码不能为空".to_string())?;
    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let profile = match insert_account_profile(&mut transaction, input).await {
        Ok(profile) => profile,
        Err(error) => {
            return Err(
                rollback_transaction(transaction, error, "回滚未提交的账号元数据失败").await,
            );
        }
    };

    let worker_app = app.clone();
    let profile_id = profile.id.clone();
    if let Err(error) = run_blocking_vault_operation(move || {
        worker_app
            .state::<VaultState>()
            .set_secret(&profile_id, password)
    })
    .await
    {
        let error = format!("保存账号密码失败：{error}");
        return Err(rollback_transaction(transaction, error, "回滚未提交的账号元数据失败").await);
    }

    transaction.commit().await.map_err(|error| {
        format!("提交账号元数据失败：{error}；为避免出现可见账号但密码缺失，已保留保险库中的密码")
    })?;
    Ok(profile)
}

#[cfg(test)]
pub(crate) async fn create_account_profile_impl(
    database: &Database,
    input: AccountProfileInput,
) -> Result<AccountProfile, String> {
    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let profile = match insert_account_profile(&mut transaction, input).await {
        Ok(profile) => profile,
        Err(error) => {
            return Err(
                rollback_transaction(transaction, error, "回滚未提交的账号元数据失败").await,
            );
        }
    };
    transaction.commit().await.map_err(db_error)?;
    Ok(profile)
}

async fn insert_account_profile(
    transaction: &mut Transaction<'_, Sqlite>,
    input: AccountProfileInput,
) -> Result<AccountProfile, String> {
    let input = validate_input(input)?;
    let id = Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO account_profiles (
            id, contact_name, server, character_name, specialization, gear_score,
            account_name, current_score, highest_score, score_updated_at, notes,
            needs_review, sort_order, created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM account_profiles),
            ?, ?
        )",
    )
    .bind(&id)
    .bind(input.contact_name)
    .bind(input.server)
    .bind(input.character_name)
    .bind(input.specialization)
    .bind(input.gear_score)
    .bind(input.account_name)
    .bind(input.current_score)
    .bind(input.highest_score)
    .bind(input.score_updated_at)
    .bind(input.notes)
    .bind(if input.needs_review.unwrap_or(false) {
        1_i64
    } else {
        0_i64
    })
    .bind(&now)
    .bind(&now)
    .execute(&mut **transaction)
    .await
    .map_err(db_error)?;

    let row = sqlx::query("SELECT * FROM account_profiles WHERE id = ?")
        .bind(&id)
        .fetch_one(&mut **transaction)
        .await
        .map_err(db_error)?;
    profile_from_row(&row)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_account_profile<R: Runtime>(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    app: AppHandle<R>,
    id: String,
    mut input: AccountProfileInput,
) -> Result<AccountProfile, String> {
    let _operation_guard = backup.lock_data_operation().await;
    let password = input
        .password
        .take()
        .filter(|password| !password.is_empty());
    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let profile = match update_account_profile_in_transaction(&mut transaction, &id, input).await {
        Ok(profile) => profile,
        Err(error) => {
            return Err(rollback_transaction(transaction, error, "回滚未提交的账号更新失败").await);
        }
    };

    let Some(password) = password else {
        transaction.commit().await.map_err(db_error)?;
        return Ok(profile);
    };

    let worker_app = app.clone();
    let secret_id = id.clone();
    let previous = match run_blocking_vault_operation(move || {
        worker_app
            .state::<VaultState>()
            .set_secret(&secret_id, password)
    })
    .await
    {
        Ok(previous) => previous,
        Err(error) => {
            let error = format!("更新账号密码失败：{error}");
            return Err(rollback_transaction(transaction, error, "回滚未提交的账号更新失败").await);
        }
    };

    if let Err(error) = transaction.commit().await {
        let primary_error = format!("提交账号档案更新失败：{error}");
        if let Some(previous_password) = previous {
            let worker_app = app.clone();
            let secret_id = id.clone();
            if let Err(rollback_error) = run_blocking_vault_operation(move || {
                worker_app
                    .state::<VaultState>()
                    .set_secret(&secret_id, previous_password)
                    .map(|_| ())
            })
            .await
            {
                return Err(format!(
                    "{primary_error}；恢复原账号密码也失败：{rollback_error}"
                ));
            }
            return Err(primary_error);
        }
        return Err(format!(
            "{primary_error}；原保险库中没有旧密码，为避免可见账号缺少密码，已保留新密码"
        ));
    }

    Ok(profile)
}

#[cfg(test)]
pub(crate) async fn update_account_profile_impl(
    database: &Database,
    id: &str,
    input: AccountProfileInput,
) -> Result<AccountProfile, String> {
    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let profile = match update_account_profile_in_transaction(&mut transaction, id, input).await {
        Ok(profile) => profile,
        Err(error) => {
            return Err(rollback_transaction(transaction, error, "回滚未提交的账号更新失败").await);
        }
    };
    transaction.commit().await.map_err(db_error)?;
    Ok(profile)
}

async fn update_account_profile_in_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
    id: &str,
    input: AccountProfileInput,
) -> Result<AccountProfile, String> {
    let input = validate_input(input)?;
    let now = Utc::now().to_rfc3339();
    let result = sqlx::query(
        "UPDATE account_profiles SET
            contact_name = ?, server = ?, character_name = ?, specialization = ?,
            gear_score = ?, account_name = ?, current_score = ?, highest_score = ?,
            score_updated_at = ?, notes = ?, needs_review = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(input.contact_name)
    .bind(input.server)
    .bind(input.character_name)
    .bind(input.specialization)
    .bind(input.gear_score)
    .bind(input.account_name)
    .bind(input.current_score)
    .bind(input.highest_score)
    .bind(input.score_updated_at)
    .bind(input.notes)
    .bind(if input.needs_review.unwrap_or(false) {
        1_i64
    } else {
        0_i64
    })
    .bind(now)
    .bind(id)
    .execute(&mut **transaction)
    .await
    .map_err(db_error)?;

    if result.rows_affected() == 0 {
        return Err(format!("账号档案不存在: {id}"));
    }
    let row = sqlx::query("SELECT * FROM account_profiles WHERE id = ?")
        .bind(id)
        .fetch_one(&mut **transaction)
        .await
        .map_err(db_error)?;
    profile_from_row(&row)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_account_profile_usage(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    settings: State<'_, SettingsState>,
    id: String,
    usage_info: Option<String>,
) -> Result<AccountProfile, String> {
    let _operation_guard = backup.lock_data_operation().await;
    update_account_profile_usage_for_week_impl(
        database.inner(),
        settings.inner(),
        &id,
        usage_info,
        Utc::now(),
    )
    .await
}

pub(crate) async fn update_account_profile_usage_for_week_impl(
    database: &Database,
    settings: &SettingsState,
    id: &str,
    usage_info: Option<String>,
    now: DateTime<Utc>,
) -> Result<AccountProfile, String> {
    sync_account_profile_usage_week_impl(database, settings, now).await?;
    update_account_profile_usage_impl(database, id, usage_info).await
}

pub(crate) async fn update_account_profile_usage_impl(
    database: &Database,
    id: &str,
    usage_info: Option<String>,
) -> Result<AccountProfile, String> {
    let usage_info = optional_text(usage_info);
    let now = Utc::now().to_rfc3339();
    let result =
        sqlx::query("UPDATE account_profiles SET usage_info = ?, updated_at = ? WHERE id = ?")
            .bind(usage_info)
            .bind(now)
            .bind(id)
            .execute(database.pool())
            .await
            .map_err(db_error)?;

    if result.rows_affected() == 0 {
        return Err(format!("账号档案不存在: {id}"));
    }
    get_account_profile_impl(database, id).await
}

fn china_week_start(now: DateTime<Utc>) -> Result<NaiveDate, String> {
    let offset = FixedOffset::east_opt(8 * 60 * 60).ok_or("无法创建东八区时区")?;
    let local_date = now.with_timezone(&offset).date_naive();
    local_date
        .checked_sub_days(Days::new(
            local_date.weekday().num_days_from_monday().into(),
        ))
        .ok_or_else(|| "无法计算账号本周起始日期".to_string())
}

pub(crate) async fn clear_account_profile_usage_impl(database: &Database) -> Result<u64, String> {
    sqlx::query(
        "UPDATE account_profiles SET usage_info = NULL, updated_at = ? WHERE usage_info IS NOT NULL",
    )
    .bind(Utc::now().to_rfc3339())
    .execute(database.pool())
    .await
    .map(|result| result.rows_affected())
    .map_err(db_error)
}

pub(crate) async fn sync_account_profile_usage_week_impl(
    database: &Database,
    settings: &SettingsState,
    now: DateTime<Utc>,
) -> Result<AccountUsageWeekSyncResult, String> {
    let week_start = china_week_start(now)?;
    let snapshot = settings.snapshot().map_err(|error| error.to_string())?;
    let previous_week_start = snapshot
        .last_account_usage_week_start
        .as_deref()
        .map(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d"))
        .transpose()
        .map_err(|_| "账号本周起始日期格式无效".to_string())?;

    if previous_week_start.is_some_and(|previous| previous >= week_start) {
        return Ok(AccountUsageWeekSyncResult {
            week_start: week_start.format("%Y-%m-%d").to_string(),
            cleared_count: 0,
        });
    }

    let cleared_count = if previous_week_start.is_some() {
        clear_account_profile_usage_impl(database).await?
    } else {
        0
    };
    settings
        .record_account_usage_week_start(week_start)
        .map_err(|error| error.to_string())?;
    Ok(AccountUsageWeekSyncResult {
        week_start: week_start.format("%Y-%m-%d").to_string(),
        cleared_count,
    })
}

#[tauri::command]
pub async fn clear_account_profile_usage(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
) -> Result<u64, String> {
    let _operation_guard = backup.lock_data_operation().await;
    clear_account_profile_usage_impl(database.inner()).await
}

#[tauri::command]
pub async fn sync_account_profile_usage_week(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    settings: State<'_, SettingsState>,
) -> Result<AccountUsageWeekSyncResult, String> {
    let _operation_guard = backup.lock_data_operation().await;
    sync_account_profile_usage_week_impl(database.inner(), settings.inner(), Utc::now()).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_account_profile<R: Runtime>(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    app: AppHandle<R>,
    id: String,
) -> Result<(), String> {
    let _operation_guard = backup.lock_data_operation().await;
    let deleted =
        delete_account_profiles_with_vault(database.inner(), &app, std::slice::from_ref(&id))
            .await?;
    if deleted == 0 {
        return Err(format!("账号档案不存在: {id}"));
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_account_profiles<R: Runtime>(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    app: AppHandle<R>,
    ids: Vec<String>,
) -> Result<usize, String> {
    let _operation_guard = backup.lock_data_operation().await;
    delete_account_profiles_with_vault(database.inner(), &app, &ids).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reorder_account_profiles(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    ids: Vec<String>,
) -> Result<(), String> {
    let _operation_guard = backup.lock_data_operation().await;
    reorder_account_profiles_impl(database.inner(), &ids).await
}

pub(crate) async fn reorder_account_profiles_impl(
    database: &Database,
    ids: &[String],
) -> Result<(), String> {
    let normalized = ids
        .iter()
        .map(|id| id.trim().to_owned())
        .collect::<Vec<_>>();
    if normalized.iter().any(String::is_empty) {
        return Err("账号排序包含空白 ID".into());
    }
    let unique = normalized
        .iter()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    if unique.len() != normalized.len() {
        return Err("账号排序包含重复 ID".into());
    }

    let existing = sqlx::query_scalar::<_, String>("SELECT id FROM account_profiles ORDER BY id")
        .fetch_all(database.pool())
        .await
        .map_err(db_error)?;
    if existing.len() != normalized.len() || existing.iter().any(|id| !unique.contains(id.as_str()))
    {
        return Err("账号排序必须包含当前全部账号档案".into());
    }

    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    for (position, id) in normalized.iter().enumerate() {
        sqlx::query("UPDATE account_profiles SET sort_order = ? WHERE id = ?")
            .bind(position as i64)
            .bind(id)
            .execute(&mut *transaction)
            .await
            .map_err(db_error)?;
    }
    transaction.commit().await.map_err(db_error)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn copy_account_name(database: State<'_, Database>, id: String) -> Result<(), String> {
    let account_name =
        sqlx::query_scalar::<_, String>("SELECT account_name FROM account_profiles WHERE id = ?")
            .bind(&id)
            .fetch_optional(database.pool())
            .await
            .map_err(db_error)?
            .ok_or_else(|| format!("账号档案不存在: {id}"))?;
    copy_text_to_clipboard(account_name).await
}

#[cfg(test)]
pub(crate) async fn delete_account_profile_impl(
    database: &Database,
    id: &str,
) -> Result<(), String> {
    if delete_account_profiles_impl(database, &[id.to_owned()]).await? == 0 {
        return Err(format!("账号档案不存在: {id}"));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) async fn delete_account_profiles_impl(
    database: &Database,
    ids: &[String],
) -> Result<usize, String> {
    let ids = normalize_account_ids(ids);
    if ids.is_empty() {
        return Ok(0);
    }

    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let deleted_ids = match delete_account_profiles_in_transaction(&mut transaction, &ids).await {
        Ok(deleted_ids) => deleted_ids,
        Err(error) => {
            return Err(
                rollback_transaction(transaction, error, "回滚未提交的账号批量删除失败").await,
            );
        }
    };
    transaction.commit().await.map_err(db_error)?;
    Ok(deleted_ids.len())
}

fn normalize_account_ids(ids: &[String]) -> Vec<String> {
    let mut ids: Vec<String> = ids
        .iter()
        .filter_map(|id| {
            let id = id.trim();
            (!id.is_empty()).then_some(id.to_owned())
        })
        .collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}

async fn delete_account_profiles_in_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
    ids: &[String],
) -> Result<Vec<String>, String> {
    let mut select_builder =
        QueryBuilder::<Sqlite>::new("SELECT id FROM account_profiles WHERE id IN (");
    {
        let mut separated = select_builder.separated(", ");
        for id in ids {
            separated.push_bind(id);
        }
    }
    select_builder.push(")");
    let rows = select_builder
        .build()
        .fetch_all(&mut **transaction)
        .await
        .map_err(db_error)?;

    let mut existing_ids = rows
        .iter()
        .map(|row| row.try_get::<String, _>("id").map_err(db_error))
        .collect::<Result<Vec<_>, _>>()?;
    if existing_ids.is_empty() {
        return Ok(existing_ids);
    }
    existing_ids.sort_unstable();

    let mut delete_builder =
        QueryBuilder::<Sqlite>::new("DELETE FROM account_profiles WHERE id IN (");
    {
        let mut separated = delete_builder.separated(", ");
        for id in &existing_ids {
            separated.push_bind(id);
        }
    }
    delete_builder.push(")");
    let result = delete_builder
        .build()
        .execute(&mut **transaction)
        .await
        .map_err(db_error)?;
    if result.rows_affected() as usize != existing_ids.len() {
        return Err("账号批量删除数量与预期不一致，操作已取消".into());
    }
    Ok(existing_ids)
}

async fn remove_account_secrets<R: Runtime>(
    app: &AppHandle<R>,
    ids: &[String],
) -> Result<Vec<(String, String)>, String> {
    let worker_app = app.clone();
    let ids = ids.to_vec();
    run_blocking_vault_operation(move || {
        let vault = worker_app.state::<VaultState>();
        let mut removed = Vec::new();

        for id in ids {
            match vault.remove_secret(&id) {
                Ok(Some(password)) => removed.push((id, password)),
                Ok(None) => {}
                Err(error) => {
                    let primary_error = error.to_string();
                    let mut rollback_errors = Vec::new();
                    for (removed_id, password) in removed.drain(..).rev() {
                        if let Err(rollback_error) = vault.set_secret(&removed_id, password) {
                            rollback_errors.push(rollback_error.to_string());
                        }
                    }
                    let message = if rollback_errors.is_empty() {
                        format!("清理账号密码失败，已恢复此前清理的密码：{primary_error}")
                    } else {
                        format!(
                            "清理账号密码失败，且恢复此前密码时发生错误：{primary_error}；{}",
                            rollback_errors.join("；")
                        )
                    };
                    return Err(crate::vault::VaultError::Operation(message));
                }
            }
        }

        Ok(removed)
    })
    .await
}

async fn restore_account_secrets<R: Runtime>(
    app: &AppHandle<R>,
    secrets: Vec<(String, String)>,
) -> Result<(), String> {
    if secrets.is_empty() {
        return Ok(());
    }

    let worker_app = app.clone();
    run_blocking_vault_operation(move || {
        let vault = worker_app.state::<VaultState>();
        let mut errors = Vec::new();
        for (id, password) in secrets {
            if let Err(error) = vault.set_secret(&id, password) {
                errors.push(error.to_string());
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(crate::vault::VaultError::Operation(errors.join("；")))
        }
    })
    .await
}

async fn delete_account_profiles_with_vault<R: Runtime>(
    database: &Database,
    app: &AppHandle<R>,
    ids: &[String],
) -> Result<usize, String> {
    let ids = normalize_account_ids(ids);
    if ids.is_empty() {
        return Ok(0);
    }

    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let deleted_ids = match delete_account_profiles_in_transaction(&mut transaction, &ids).await {
        Ok(deleted_ids) => deleted_ids,
        Err(error) => {
            return Err(
                rollback_transaction(transaction, error, "回滚未提交的账号批量删除失败").await,
            );
        }
    };
    if deleted_ids.is_empty() {
        transaction.rollback().await.map_err(db_error)?;
        return Ok(0);
    }

    let removed_secrets = match remove_account_secrets(app, &deleted_ids).await {
        Ok(secrets) => secrets,
        Err(error) => {
            return Err(
                rollback_transaction(transaction, error, "回滚未提交的账号批量删除失败").await,
            );
        }
    };

    if let Err(error) = transaction.commit().await {
        let primary_error = format!("提交账号批量删除失败：{error}");
        return match restore_account_secrets(app, removed_secrets).await {
            Ok(()) => Err(format!("{primary_error}；已恢复保险库中的账号密码")),
            Err(restore_error) => Err(format!(
                "{primary_error}；恢复保险库中的账号密码也失败：{restore_error}"
            )),
        };
    }

    Ok(deleted_ids.len())
}

pub(crate) async fn insert_imported_account_profile(
    transaction: &mut Transaction<'_, Sqlite>,
    profile: &LegacyAccountProfile,
) -> Result<ImportWriteResult, String> {
    if profile.import_fingerprint.trim().is_empty() {
        return Err("导入账号缺少 fingerprint".into());
    }
    if profile.account_name.trim().is_empty() {
        return Err("导入账号名称不能为空".into());
    }

    if let Some(row) = sqlx::query("SELECT id FROM account_profiles WHERE import_fingerprint = ?")
        .bind(&profile.import_fingerprint)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(db_error)?
    {
        return Ok(ImportWriteResult {
            record_id: row.try_get("id").map_err(db_error)?,
            inserted: 0,
            skipped: 1,
        });
    }

    if profile.current_score.is_some_and(|score| score < 0)
        || profile.highest_score.is_some_and(|score| score < 0)
    {
        return Err(format!("账号 {} 的分数不能为负数", profile.account_name));
    }

    let id = Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO account_profiles (
            id, contact_name, server, character_name, specialization, gear_score,
            account_name, current_score, highest_score, score_updated_at, notes,
            needs_review, import_fingerprint, sort_order, created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM account_profiles),
            ?, ?
        )",
    )
    .bind(&id)
    .bind(profile.contact_name.as_deref())
    .bind(profile.server.as_deref())
    .bind(profile.character_name.as_deref())
    .bind(profile.specialization.as_deref())
    .bind(profile.gear_score.as_deref())
    .bind(profile.account_name.trim())
    .bind(profile.current_score)
    .bind(profile.highest_score)
    .bind(profile.score_updated_at.map(|date| date.to_string()))
    .bind(profile.notes.as_deref())
    .bind(if profile.needs_review { 1_i64 } else { 0_i64 })
    .bind(&profile.import_fingerprint)
    .bind(&now)
    .bind(&now)
    .execute(&mut **transaction)
    .await
    .map_err(db_error)?;

    Ok(ImportWriteResult {
        record_id: id,
        inserted: 1,
        skipped: 0,
    })
}

pub(crate) async fn find_imported_account_profile_id(
    transaction: &mut Transaction<'_, Sqlite>,
    account_name: &str,
) -> Result<Option<String>, String> {
    let row = sqlx::query(
        "SELECT id FROM account_profiles
         WHERE lower(trim(account_name)) = lower(trim(?))
         ORDER BY needs_review ASC, updated_at DESC
         LIMIT 1",
    )
    .bind(account_name)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(db_error)?;
    row.map(|row| row.try_get("id").map_err(db_error))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::importer::LegacyAccountProfile;
    use chrono::{NaiveDate, TimeZone};

    fn run_async<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(future)
    }

    fn input(name: &str) -> AccountProfileInput {
        AccountProfileInput {
            contact_name: Some("小林".into()),
            server: Some("梦江南".into()),
            character_name: None,
            specialization: Some("冰心".into()),
            gear_score: Some("128000".into()),
            account_name: name.into(),
            password: None,
            current_score: Some(2100),
            highest_score: Some(2300),
            score_updated_at: Some("2026-07-13".into()),
            notes: None,
            needs_review: Some(false),
        }
    }

    fn test_settings(name: &str) -> (std::path::PathBuf, SettingsState) {
        let dir = std::env::temp_dir().join(format!(
            "timekeeper-account-week-{name}-{}",
            uuid::Uuid::now_v7()
        ));
        let settings = SettingsState::load(&dir).unwrap();
        (dir, settings)
    }

    #[test]
    fn creates_filters_updates_and_deletes_profiles() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let created = create_account_profile_impl(&database, input("account-a"))
                .await
                .unwrap();
            assert_eq!(created.account_name, "account-a");

            let found = list_account_profiles_impl(&database, Some("小林".into()), None)
                .await
                .unwrap();
            assert_eq!(found.len(), 1);

            let mut changed = input("account-b");
            changed.needs_review = Some(true);
            let updated = update_account_profile_impl(&database, &created.id, changed)
                .await
                .unwrap();
            assert!(updated.needs_review);

            delete_account_profile_impl(&database, &created.id)
                .await
                .unwrap();
            assert!(
                get_account_profile_impl(&database, &created.id)
                    .await
                    .is_err()
            );
        });
    }

    #[test]
    fn updates_only_normalized_usage_info() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let first = create_account_profile_impl(&database, input("usage-account-a"))
                .await
                .unwrap();
            let second = create_account_profile_impl(&database, input("usage-account-b"))
                .await
                .unwrap();

            let updated = update_account_profile_usage_impl(
                &database,
                &first.id,
                Some("  今晚朋友使用  ".into()),
            )
            .await
            .unwrap();
            assert_eq!(updated.usage_info.as_deref(), Some("今晚朋友使用"));
            assert_eq!(updated.account_name, first.account_name);
            assert_eq!(updated.contact_name, first.contact_name);
            assert_eq!(
                get_account_profile_impl(&database, &second.id)
                    .await
                    .unwrap()
                    .usage_info,
                None
            );

            let cleared =
                update_account_profile_usage_impl(&database, &first.id, Some("   ".into()))
                    .await
                    .unwrap();
            assert_eq!(cleared.usage_info, None);
            assert!(
                update_account_profile_usage_impl(&database, "missing-account", None)
                    .await
                    .unwrap_err()
                    .contains("不存在")
            );
        });
    }

    #[test]
    fn supports_batch_account_profile_deletion() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let first = create_account_profile_impl(&database, input("batch-account-a"))
                .await
                .unwrap();
            let second = create_account_profile_impl(&database, input("batch-account-b"))
                .await
                .unwrap();
            let remaining = create_account_profile_impl(&database, input("batch-account-c"))
                .await
                .unwrap();

            let deleted = delete_account_profiles_impl(
                &database,
                &[
                    first.id.clone(),
                    second.id.clone(),
                    first.id.clone(),
                    "  ".into(),
                    "unknown-account".into(),
                ],
            )
            .await
            .unwrap();

            assert_eq!(deleted, 2);
            assert!(
                get_account_profile_impl(&database, &first.id)
                    .await
                    .is_err()
            );
            assert!(
                get_account_profile_impl(&database, &second.id)
                    .await
                    .is_err()
            );
            assert_eq!(
                get_account_profile_impl(&database, &remaining.id)
                    .await
                    .unwrap()
                    .account_name,
                "batch-account-c"
            );
            assert_eq!(
                delete_account_profiles_impl(&database, &["unknown-account".into()])
                    .await
                    .unwrap(),
                0
            );
        });
    }

    #[test]
    fn persists_complete_manual_account_profile_order() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let first = create_account_profile_impl(&database, input("manual-order-a"))
                .await
                .unwrap();
            let second = create_account_profile_impl(&database, input("manual-order-b"))
                .await
                .unwrap();
            let third = create_account_profile_impl(&database, input("manual-order-c"))
                .await
                .unwrap();

            reorder_account_profiles_impl(
                &database,
                &[third.id.clone(), first.id.clone(), second.id.clone()],
            )
            .await
            .unwrap();
            let reordered = list_account_profiles_impl(&database, None, None)
                .await
                .unwrap();
            assert_eq!(
                reordered
                    .iter()
                    .map(|profile| profile.id.as_str())
                    .collect::<Vec<_>>(),
                [third.id.as_str(), first.id.as_str(), second.id.as_str()]
            );

            let error =
                reorder_account_profiles_impl(&database, &[third.id.clone(), first.id.clone()])
                    .await
                    .unwrap_err();
            assert!(error.contains("全部账号档案"));
        });
    }

    #[test]
    fn refuses_to_silently_discard_passwords() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let mut profile = input("secure-account");
            profile.password = Some("secret".into());
            let error = create_account_profile_impl(&database, profile)
                .await
                .unwrap_err();
            assert!(error.contains("vault"));
        });
    }

    #[test]
    fn rolled_back_profile_insert_never_becomes_visible() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let mut transaction = database.pool().begin().await.unwrap();
            let profile = insert_account_profile(&mut transaction, input("rolled-back-account"))
                .await
                .unwrap();

            transaction.rollback().await.unwrap();

            let error = get_account_profile_impl(&database, &profile.id)
                .await
                .unwrap_err();
            assert!(error.contains("不存在"));
        });
    }

    #[test]
    fn missing_profile_update_is_rejected_inside_the_transaction() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let mut transaction = database.pool().begin().await.unwrap();

            let error = update_account_profile_in_transaction(
                &mut transaction,
                "missing-account",
                input("must-not-be-written"),
            )
            .await
            .unwrap_err();

            assert!(error.contains("账号档案不存在"));
            transaction.rollback().await.unwrap();
            assert!(
                list_account_profiles_impl(&database, None, None)
                    .await
                    .unwrap()
                    .is_empty()
            );
        });
    }

    #[test]
    fn deleting_profile_clears_live_link_and_keeps_non_secret_snapshot() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let profile = create_account_profile_impl(&database, input("linked-account"))
                .await
                .unwrap();
            let now = Utc::now().to_rfc3339();
            let snapshot = r#"{"accountName":"linked-account"}"#;
            sqlx::query(
                "INSERT INTO appointments (
                    id, service_date, contact_name, mode, service_status,
                    settlement_status, account_profile_id, account_snapshot_json,
                    created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind("linked-appointment")
            .bind("2026-07-20")
            .bind("测试联系人")
            .bind("business")
            .bind("scheduled")
            .bind("unsettled")
            .bind(&profile.id)
            .bind(snapshot)
            .bind(&now)
            .bind(&now)
            .execute(database.pool())
            .await
            .unwrap();

            delete_account_profile_impl(&database, &profile.id)
                .await
                .unwrap();

            let row = sqlx::query(
                "SELECT account_profile_id, account_snapshot_json
                 FROM appointments WHERE id = ?",
            )
            .bind("linked-appointment")
            .fetch_one(database.pool())
            .await
            .unwrap();
            assert_eq!(
                row.try_get::<Option<String>, _>("account_profile_id")
                    .unwrap(),
                None
            );
            assert_eq!(
                row.try_get::<Option<String>, _>("account_snapshot_json")
                    .unwrap()
                    .as_deref(),
                Some(snapshot)
            );
        });
    }

    #[test]
    fn import_profile_is_idempotent_by_fingerprint() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let profile = LegacyAccountProfile {
                contact_name: Some("导入联系人".into()),
                server: Some("梦江南".into()),
                character_name: None,
                specialization: None,
                gear_score: None,
                account_name: "legacy-account".into(),
                password: "vault-only".into(),
                current_score: Some(2_000),
                highest_score: Some(2_100),
                score_updated_at: NaiveDate::from_ymd_opt(2026, 7, 13),
                notes: None,
                needs_review: false,
                import_fingerprint: "profile-fingerprint".into(),
            };
            let mut transaction = database.pool().begin().await.unwrap();
            let first = insert_imported_account_profile(&mut transaction, &profile)
                .await
                .unwrap();
            let second = insert_imported_account_profile(&mut transaction, &profile)
                .await
                .unwrap();
            assert_eq!((first.inserted, first.skipped), (1, 0));
            assert_eq!((second.inserted, second.skipped), (0, 1));
            assert_eq!(first.record_id, second.record_id);
            transaction.commit().await.unwrap();
        });
    }

    #[test]
    fn weekly_usage_sync_preserves_the_first_week_and_clears_at_the_next_china_monday() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let (settings_dir, settings) = test_settings("rollover");
            let first = create_account_profile_impl(&database, input("weekly-account-a"))
                .await
                .unwrap();
            let second = create_account_profile_impl(&database, input("weekly-account-b"))
                .await
                .unwrap();
            update_account_profile_usage_impl(&database, &first.id, Some("本周占用".into()))
                .await
                .unwrap();
            update_account_profile_usage_impl(&database, &second.id, Some("朋友使用".into()))
                .await
                .unwrap();

            let sunday = Utc.with_ymd_and_hms(2026, 8, 2, 3, 0, 0).unwrap();
            let initialized = sync_account_profile_usage_week_impl(&database, &settings, sunday)
                .await
                .unwrap();
            assert_eq!(initialized.week_start, "2026-07-27");
            assert_eq!(initialized.cleared_count, 0);
            assert_eq!(
                get_account_profile_impl(&database, &first.id)
                    .await
                    .unwrap()
                    .usage_info
                    .as_deref(),
                Some("本周占用")
            );

            let monday = Utc.with_ymd_and_hms(2026, 8, 2, 16, 1, 0).unwrap();
            let cleared = sync_account_profile_usage_week_impl(&database, &settings, monday)
                .await
                .unwrap();
            assert_eq!(cleared.week_start, "2026-08-03");
            assert_eq!(cleared.cleared_count, 2);
            assert_eq!(
                sync_account_profile_usage_week_impl(&database, &settings, monday)
                    .await
                    .unwrap()
                    .cleared_count,
                0
            );
            assert_eq!(
                get_account_profile_impl(&database, &first.id)
                    .await
                    .unwrap()
                    .usage_info,
                None
            );
            std::fs::remove_dir_all(settings_dir).unwrap();
        });
    }

    #[test]
    fn saving_after_a_week_boundary_clears_stale_rows_before_writing_the_new_value() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let (settings_dir, settings) = test_settings("save-after-rollover");
            settings
                .record_account_usage_week_start(NaiveDate::from_ymd_opt(2026, 8, 3).unwrap())
                .unwrap();
            let first = create_account_profile_impl(&database, input("new-week-account-a"))
                .await
                .unwrap();
            let second = create_account_profile_impl(&database, input("new-week-account-b"))
                .await
                .unwrap();
            update_account_profile_usage_impl(&database, &first.id, Some("旧内容".into()))
                .await
                .unwrap();
            update_account_profile_usage_impl(&database, &second.id, Some("旧内容".into()))
                .await
                .unwrap();

            let next_monday = Utc.with_ymd_and_hms(2026, 8, 9, 16, 1, 0).unwrap();
            let updated = update_account_profile_usage_for_week_impl(
                &database,
                &settings,
                &first.id,
                Some("新一周内容".into()),
                next_monday,
            )
            .await
            .unwrap();
            assert_eq!(updated.usage_info.as_deref(), Some("新一周内容"));
            assert_eq!(
                get_account_profile_impl(&database, &second.id)
                    .await
                    .unwrap()
                    .usage_info,
                None
            );
            assert_eq!(
                settings
                    .snapshot()
                    .unwrap()
                    .last_account_usage_week_start
                    .as_deref(),
                Some("2026-08-10")
            );
            std::fs::remove_dir_all(settings_dir).unwrap();
        });
    }

    #[test]
    fn manual_weekly_usage_clear_updates_every_populated_profile_in_one_statement() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let first = create_account_profile_impl(&database, input("manual-clear-a"))
                .await
                .unwrap();
            let second = create_account_profile_impl(&database, input("manual-clear-b"))
                .await
                .unwrap();
            create_account_profile_impl(&database, input("manual-clear-empty"))
                .await
                .unwrap();
            update_account_profile_usage_impl(&database, &first.id, Some("占用".into()))
                .await
                .unwrap();
            update_account_profile_usage_impl(&database, &second.id, Some("备用".into()))
                .await
                .unwrap();

            assert_eq!(
                clear_account_profile_usage_impl(&database).await.unwrap(),
                2
            );
            assert_eq!(
                clear_account_profile_usage_impl(&database).await.unwrap(),
                0
            );
            assert_eq!(
                get_account_profile_impl(&database, &first.id)
                    .await
                    .unwrap()
                    .usage_info,
                None
            );
            assert_eq!(
                get_account_profile_impl(&database, &second.id)
                    .await
                    .unwrap()
                    .usage_info,
                None
            );
        });
    }
}
