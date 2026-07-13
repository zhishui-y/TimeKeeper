use chrono::{NaiveDate, Utc};
use sqlx::{QueryBuilder, Row, Sqlite, Transaction, sqlite::SqliteRow};
use tauri::State;
use uuid::Uuid;

use crate::{
    db::{Database, ImportWriteResult},
    importer::LegacyAccountProfile,
    models::{AccountProfile, AccountProfileInput},
    vault::VaultState,
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

fn profile_from_row(row: &SqliteRow) -> Result<AccountProfile, String> {
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
    builder.push(" ORDER BY needs_review DESC, updated_at DESC, account_name COLLATE NOCASE");

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
pub async fn create_account_profile(
    database: State<'_, Database>,
    vault: State<'_, VaultState>,
    mut input: AccountProfileInput,
) -> Result<AccountProfile, String> {
    let password = input
        .password
        .take()
        .filter(|password| !password.is_empty())
        .ok_or_else(|| "新建账号档案时密码不能为空".to_string())?;
    let profile = create_account_profile_impl(database.inner(), input).await?;
    if let Err(error) = vault.set_secret(&profile.id, password) {
        let _ = delete_account_profile_impl(database.inner(), &profile.id).await;
        return Err(format!("保存账号密码失败：{error}"));
    }
    Ok(profile)
}

pub(crate) async fn create_account_profile_impl(
    database: &Database,
    input: AccountProfileInput,
) -> Result<AccountProfile, String> {
    let input = validate_input(input)?;
    let id = Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO account_profiles (
            id, contact_name, server, character_name, specialization, gear_score,
            account_name, current_score, highest_score, score_updated_at, notes,
            needs_review, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
    .execute(database.pool())
    .await
    .map_err(db_error)?;

    get_account_profile_impl(database, &id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_account_profile(
    database: State<'_, Database>,
    vault: State<'_, VaultState>,
    id: String,
    mut input: AccountProfileInput,
) -> Result<AccountProfile, String> {
    let password = input
        .password
        .take()
        .filter(|password| !password.is_empty());
    let previous = match password {
        Some(password) => Some(
            vault
                .set_secret(&id, password)
                .map_err(|error| format!("更新账号密码失败：{error}"))?,
        ),
        None => None,
    };

    match update_account_profile_impl(database.inner(), &id, input).await {
        Ok(profile) => Ok(profile),
        Err(error) => {
            if let Some(previous) = previous {
                match previous {
                    Some(password) => {
                        let _ = vault.set_secret(&id, password);
                    }
                    None => {
                        let _ = vault.remove_secret(&id);
                    }
                }
            }
            Err(error)
        }
    }
}

pub(crate) async fn update_account_profile_impl(
    database: &Database,
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
    .execute(database.pool())
    .await
    .map_err(db_error)?;

    if result.rows_affected() == 0 {
        return Err(format!("账号档案不存在: {id}"));
    }
    get_account_profile_impl(database, id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_account_profile(
    database: State<'_, Database>,
    vault: State<'_, VaultState>,
    id: String,
) -> Result<(), String> {
    let previous = vault
        .remove_secret(&id)
        .map_err(|error| format!("删除账号密码失败：{error}"))?;
    match delete_account_profile_impl(database.inner(), &id).await {
        Ok(()) => Ok(()),
        Err(error) => {
            if let Some(password) = previous {
                let _ = vault.set_secret(&id, password);
            }
            Err(error)
        }
    }
}

pub(crate) async fn delete_account_profile_impl(
    database: &Database,
    id: &str,
) -> Result<(), String> {
    let result = sqlx::query("DELETE FROM account_profiles WHERE id = ?")
        .bind(id)
        .execute(database.pool())
        .await
        .map_err(db_error)?;
    if result.rows_affected() == 0 {
        return Err(format!("账号档案不存在: {id}"));
    }
    Ok(())
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
            needs_review, import_fingerprint, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
