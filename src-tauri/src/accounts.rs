use chrono::{NaiveDate, Utc};
use sqlx::{QueryBuilder, Row, Sqlite, Transaction, sqlite::SqliteRow};
use tauri::State;
use uuid::Uuid;

use crate::{
    accounts_remote::{
        AccountRoleDataRefreshResult, AccountRoleDataRefreshState,
        commit_account_role_data_refresh, prepare_account_role_data_refresh,
    },
    app_access::AppAccessState,
    backup::BackupState,
    db::{Database, ImportWriteResult},
    importer::LegacyAccountProfile,
    models::{AccountProfile, AccountProfileInput},
    settings::SettingsState,
    vault::{copy_sensitive_text_to_clipboard, copy_text_to_clipboard},
};

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
    input.password = input.password.filter(|password| !password.is_empty());
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
        password: row.try_get::<Option<String>, _>("password").unwrap_or(None),
        current_score: row.try_get("current_score").map_err(db_error)?,
        highest_score: row.try_get("highest_score").map_err(db_error)?,
        score_updated_at: row.try_get("score_updated_at").map_err(db_error)?,
        weekly_wins: row.try_get("weekly_wins").map_err(db_error)?,
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
    access: State<'_, AppAccessState>,
    query: Option<String>,
    needs_review: Option<bool>,
) -> Result<Vec<AccountProfile>, String> {
    access.require_unlocked()?;
    list_account_profiles_impl(database.inner(), query, needs_review).await
}

pub(crate) async fn list_account_profiles_impl(
    database: &Database,
    query: Option<String>,
    needs_review: Option<bool>,
) -> Result<Vec<AccountProfile>, String> {
    let mut builder = QueryBuilder::<Sqlite>::new(
        "SELECT profile.*, credential.password AS password
         FROM account_profiles AS profile
         LEFT JOIN account_profile_credentials AS credential
           ON credential.profile_id = profile.id
         WHERE 1 = 1",
    );

    if let Some(query) = optional_text(query) {
        let pattern = format!("%{}%", query.to_lowercase());
        builder
            .push(" AND (lower(profile.account_name) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(profile.contact_name, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(profile.server, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(profile.character_name, '')) LIKE ")
            .push_bind(pattern)
            .push(")");
    }
    if let Some(needs_review) = needs_review {
        builder
            .push(" AND profile.needs_review = ")
            .push_bind(if needs_review { 1_i64 } else { 0_i64 });
    }
    builder.push(" ORDER BY profile.sort_order ASC, profile.account_name COLLATE NOCASE");

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
    access: State<'_, AppAccessState>,
    id: String,
) -> Result<AccountProfile, String> {
    access.require_unlocked()?;
    get_account_profile_impl(database.inner(), &id).await
}

pub(crate) async fn get_account_profile_impl(
    database: &Database,
    id: &str,
) -> Result<AccountProfile, String> {
    let row = sqlx::query(
        "SELECT profile.*, credential.password AS password
         FROM account_profiles AS profile
         LEFT JOIN account_profile_credentials AS credential
           ON credential.profile_id = profile.id
         WHERE profile.id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await
    .map_err(db_error)?
    .ok_or_else(|| format!("账号档案不存在: {id}"))?;
    profile_from_row(&row)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_account_profile(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    access: State<'_, AppAccessState>,
    input: AccountProfileInput,
) -> Result<AccountProfile, String> {
    access.require_unlocked()?;
    let _operation_guard = backup.lock_data_operation().await;
    if input.password.as_deref().is_none_or(str::is_empty) {
        return Err("新建账号档案时密码不能为空".into());
    }
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
    let mut input = validate_input(input)?;
    let password = input.password.take();
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

    if let Some(password) = password {
        sqlx::query("INSERT INTO account_profile_credentials (profile_id, password) VALUES (?, ?)")
            .bind(&id)
            .bind(password)
            .execute(&mut **transaction)
            .await
            .map_err(db_error)?;
    }

    let row = sqlx::query(
        "SELECT profile.*, credential.password AS password
         FROM account_profiles AS profile
         LEFT JOIN account_profile_credentials AS credential
           ON credential.profile_id = profile.id
         WHERE profile.id = ?",
    )
    .bind(&id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(db_error)?;
    profile_from_row(&row)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_account_profile(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    access: State<'_, AppAccessState>,
    id: String,
    input: AccountProfileInput,
) -> Result<AccountProfile, String> {
    access.require_unlocked()?;
    let _operation_guard = backup.lock_data_operation().await;
    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let profile = match update_account_profile_in_transaction(&mut transaction, &id, input).await {
        Ok(profile) => profile,
        Err(error) => {
            return Err(rollback_transaction(transaction, error, "回滚未提交的账号更新失败").await);
        }
    };

    transaction.commit().await.map_err(db_error)?;
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
    let mut input = validate_input(input)?;
    let password = input.password.take();
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
    if let Some(password) = password {
        sqlx::query(
            "INSERT INTO account_profile_credentials (profile_id, password)
             VALUES (?, ?)
             ON CONFLICT(profile_id) DO UPDATE SET password = excluded.password",
        )
        .bind(id)
        .bind(password)
        .execute(&mut **transaction)
        .await
        .map_err(db_error)?;
        sqlx::query(
            "DELETE FROM legacy_credential_migration
             WHERE target_kind = 'account_profile' AND target_id = ?",
        )
        .bind(id)
        .execute(&mut **transaction)
        .await
        .map_err(db_error)?;
    }
    let row = sqlx::query(
        "SELECT profile.*, credential.password AS password
         FROM account_profiles AS profile
         LEFT JOIN account_profile_credentials AS credential
           ON credential.profile_id = profile.id
         WHERE profile.id = ?",
    )
    .bind(id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(db_error)?;
    profile_from_row(&row)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_account_profile(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    access: State<'_, AppAccessState>,
    id: String,
) -> Result<(), String> {
    access.require_unlocked()?;
    let _operation_guard = backup.lock_data_operation().await;
    let deleted = delete_account_profiles_impl(database.inner(), std::slice::from_ref(&id)).await?;
    if deleted == 0 {
        return Err(format!("账号档案不存在: {id}"));
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_account_profiles(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    access: State<'_, AppAccessState>,
    ids: Vec<String>,
) -> Result<usize, String> {
    access.require_unlocked()?;
    let _operation_guard = backup.lock_data_operation().await;
    delete_account_profiles_impl(database.inner(), &ids).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn reorder_account_profiles(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    access: State<'_, AppAccessState>,
    ids: Vec<String>,
) -> Result<(), String> {
    access.require_unlocked()?;
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
pub async fn copy_account_name(
    database: State<'_, Database>,
    access: State<'_, AppAccessState>,
    id: String,
) -> Result<(), String> {
    access.require_unlocked()?;
    let account_name =
        sqlx::query_scalar::<_, String>("SELECT account_name FROM account_profiles WHERE id = ?")
            .bind(&id)
            .fetch_optional(database.pool())
            .await
            .map_err(db_error)?
            .ok_or_else(|| format!("账号档案不存在: {id}"))?;
    copy_text_to_clipboard(account_name).await
}

pub(crate) async fn get_account_character_name_impl(
    database: &Database,
    id: &str,
) -> Result<String, String> {
    let character_name = sqlx::query_scalar::<_, Option<String>>(
        "SELECT character_name FROM account_profiles WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await
    .map_err(db_error)?
    .ok_or_else(|| format!("账号档案不存在: {id}"))?;

    character_name
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "角色名未填写".to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn copy_account_character_name(
    database: State<'_, Database>,
    access: State<'_, AppAccessState>,
    id: String,
) -> Result<(), String> {
    access.require_unlocked()?;
    let character_name = get_account_character_name_impl(&database, &id).await?;
    copy_text_to_clipboard(character_name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn copy_account_password(
    database: State<'_, Database>,
    access: State<'_, AppAccessState>,
    id: String,
) -> Result<(), String> {
    access.require_unlocked()?;
    let password = sqlx::query_scalar::<_, String>(
        "SELECT credential.password
         FROM account_profiles AS profile
         JOIN account_profile_credentials AS credential
           ON credential.profile_id = profile.id
         WHERE profile.id = ?",
    )
    .bind(&id)
    .fetch_optional(database.pool())
    .await
    .map_err(db_error)?
    .ok_or_else(|| format!("账号档案不存在或尚未保存密码: {id}"))?;
    copy_sensitive_text_to_clipboard(password).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn refresh_account_profile_role_data(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    settings: State<'_, SettingsState>,
    refresh: State<'_, AccountRoleDataRefreshState>,
    access: State<'_, AppAccessState>,
    ids: Vec<String>,
) -> Result<AccountRoleDataRefreshResult, String> {
    access.require_unlocked()?;
    let _refresh_guard = refresh.try_start()?;
    let settings = settings.snapshot().map_err(|error| error.to_string())?;
    let prepared = prepare_account_role_data_refresh(
        database.pool(),
        refresh.client(),
        &settings.account_role_data_server_url,
        &settings.account_role_data_api_key,
        ids,
    )
    .await?;

    let _operation_guard = backup.lock_data_operation().await;
    commit_account_role_data_refresh(database.pool(), prepared).await
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

    let mut migration_builder = QueryBuilder::<Sqlite>::new(
        "DELETE FROM legacy_credential_migration
         WHERE target_kind = 'account_profile' AND target_id IN (",
    );
    {
        let mut separated = migration_builder.separated(", ");
        for id in &existing_ids {
            separated.push_bind(id);
        }
    }
    migration_builder.push(")");
    migration_builder
        .build()
        .execute(&mut **transaction)
        .await
        .map_err(db_error)?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::importer::LegacyAccountProfile;
    use chrono::NaiveDate;

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
    fn reads_character_name_for_clipboard_copy() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let mut with_character = input("character-copy-account");
            with_character.character_name = Some("  清心  ".into());
            let created = create_account_profile_impl(&database, with_character)
                .await
                .unwrap();

            assert_eq!(
                get_account_character_name_impl(&database, &created.id)
                    .await
                    .unwrap(),
                "清心"
            );

            let without_character = create_account_profile_impl(&database, input("no-character"))
                .await
                .unwrap();
            assert_eq!(
                get_account_character_name_impl(&database, &without_character.id)
                    .await
                    .unwrap_err(),
                "角色名未填写"
            );
            assert!(
                get_account_character_name_impl(&database, "missing-account")
                    .await
                    .unwrap_err()
                    .contains("账号档案不存在")
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
    fn stores_profile_passwords_in_the_same_sqlite_transaction() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let mut profile_input = input("secure-account");
            profile_input.password = Some("secret".into());
            let profile = create_account_profile_impl(&database, profile_input)
                .await
                .unwrap();
            assert_eq!(profile.password.as_deref(), Some("secret"));
            assert_eq!(
                sqlx::query_scalar::<_, String>(
                    "SELECT password FROM account_profile_credentials WHERE profile_id = ?",
                )
                .bind(&profile.id)
                .fetch_one(database.pool())
                .await
                .unwrap(),
                "secret"
            );
        });
    }

    #[test]
    fn deleting_a_profile_cascades_its_credential_and_clears_legacy_queue() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let mut profile_input = input("delete-secret-account");
            profile_input.password = Some("secret".into());
            let profile = create_account_profile_impl(&database, profile_input)
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO legacy_credential_migration (
                    target_kind, target_id, source_kind, source_id
                 ) VALUES ('account_profile', ?, 'account_profile', ?)",
            )
            .bind(&profile.id)
            .bind(&profile.id)
            .execute(database.pool())
            .await
            .unwrap();

            assert_eq!(
                delete_account_profiles_impl(&database, std::slice::from_ref(&profile.id))
                    .await
                    .unwrap(),
                1
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM account_profile_credentials WHERE profile_id = ?",
                )
                .bind(&profile.id)
                .fetch_one(database.pool())
                .await
                .unwrap(),
                0
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM legacy_credential_migration
                     WHERE target_kind = 'account_profile' AND target_id = ?",
                )
                .bind(&profile.id)
                .fetch_one(database.pool())
                .await
                .unwrap(),
                0
            );
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
    fn deleting_profile_does_not_modify_embedded_appointment_account() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let profile = create_account_profile_impl(&database, input("linked-account"))
                .await
                .unwrap();
            let now = Utc::now().to_rfc3339();
            sqlx::query(
                "INSERT INTO appointments (
                    id, service_date, contact_name, mode, service_status,
                    settlement_status, account_name, account_server,
                    created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind("linked-appointment")
            .bind("2026-07-20")
            .bind("测试联系人")
            .bind("business")
            .bind("scheduled")
            .bind("unsettled")
            .bind("linked-account")
            .bind("梦江南")
            .bind(&now)
            .bind(&now)
            .execute(database.pool())
            .await
            .unwrap();

            delete_account_profile_impl(&database, &profile.id)
                .await
                .unwrap();

            let row = sqlx::query(
                "SELECT account_name, account_server
                 FROM appointments WHERE id = ?",
            )
            .bind("linked-appointment")
            .fetch_one(database.pool())
            .await
            .unwrap();
            assert_eq!(
                row.try_get::<String, _>("account_name").unwrap(),
                "linked-account"
            );
            assert_eq!(
                row.try_get::<String, _>("account_server").unwrap(),
                "梦江南"
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
}
