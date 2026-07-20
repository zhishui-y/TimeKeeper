use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration as StdDuration, Instant},
};

use calamine::{Data, DataType, Reader, open_workbook_auto};
use chrono::{DateTime, Duration, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, Transaction};
use tauri::{AppHandle, Manager, Runtime, State};
use uuid::Uuid;

use crate::{
    accounts::{find_imported_account_profile_id, insert_imported_account_profile},
    appointments::{insert_imported_appointment, restore_pending_notifications},
    backup::BackupState,
    db::Database,
    notifications::NotificationState,
    vault::{VaultState, run_blocking_vault_operation},
};

const PREVIEW_TTL: StdDuration = StdDuration::from_secs(30 * 60);
type ParsedTimeRange = (
    Option<DateTime<FixedOffset>>,
    Option<DateTime<FixedOffset>>,
    bool,
);

#[derive(Debug, Clone)]
pub(crate) struct LegacyAppointment {
    pub service_date: NaiveDate,
    pub starts_at: Option<DateTime<FixedOffset>>,
    pub ends_at: Option<DateTime<FixedOffset>>,
    pub contact_name: String,
    pub content: Option<String>,
    pub service_status: String,
    pub settlement_status: String,
    pub account_name: Option<String>,
    pub account_password: Option<String>,
    pub server: Option<String>,
    pub specialization: Option<String>,
    pub gear_score: Option<String>,
    pub rate_note: Option<String>,
    pub payment_method: Option<String>,
    pub amount_minor: Option<i64>,
    pub notes: Option<String>,
    pub import_fingerprint: String,
}

#[derive(Debug, Clone)]
pub(crate) struct LegacyAccountProfile {
    pub contact_name: Option<String>,
    pub server: Option<String>,
    pub character_name: Option<String>,
    pub specialization: Option<String>,
    pub gear_score: Option<String>,
    pub account_name: String,
    pub password: String,
    pub current_score: Option<i64>,
    pub highest_score: Option<i64>,
    pub score_updated_at: Option<NaiveDate>,
    pub notes: Option<String>,
    pub needs_review: bool,
    pub import_fingerprint: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ParsedLegacyData {
    pub source_path: String,
    pub base_year: i32,
    pub appointments: Vec<LegacyAppointment>,
    pub profiles: Vec<LegacyAccountProfile>,
    pub unmatched_profiles: Vec<LegacyAccountProfile>,
    pub warnings: Vec<String>,
    pub cross_midnight_count: usize,
    pub password_conflict_count: usize,
    pub skipped_count: usize,
}

struct PreviewEntry {
    created_at: Instant,
    parsed: ParsedLegacyData,
}

#[derive(Default)]
pub struct ImportState {
    previews: Arc<Mutex<HashMap<String, PreviewEntry>>>,
}

impl ImportState {
    pub(crate) fn take(&self, token: &str) -> Result<ParsedLegacyData, String> {
        let mut previews = self
            .previews
            .lock()
            .map_err(|_| "导入预览状态不可用".to_string())?;
        previews.retain(|_, entry| entry.created_at.elapsed() <= PREVIEW_TTL);
        previews
            .remove(token)
            .map(|entry| entry.parsed)
            .ok_or_else(|| "导入预览已过期，请重新预览".to_string())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelImportPreview {
    source_path: String,
    base_year: i32,
    appointment_count: usize,
    profile_count: usize,
    unmatched_profile_count: usize,
    cross_midnight_count: usize,
    password_conflict_count: usize,
    skipped_count: usize,
    warning_count: usize,
    warnings: Vec<String>,
    preview_token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelImportResult {
    imported_appointments: usize,
    imported_profiles: usize,
    skipped_duplicates: usize,
    warnings: Vec<String>,
}

#[tauri::command]
pub async fn preview_excel_import(
    path: String,
    base_year: i32,
    state: State<'_, ImportState>,
) -> Result<ExcelImportPreview, String> {
    if !(2000..=2100).contains(&base_year) {
        return Err("基准年份必须在 2000 到 2100 之间".to_string());
    }

    let parsed = parse_legacy_workbook_in_background(path, base_year).await?;
    let token = Uuid::now_v7().to_string();
    let preview = ExcelImportPreview {
        source_path: parsed.source_path.clone(),
        base_year: parsed.base_year,
        appointment_count: parsed.appointments.len(),
        profile_count: parsed.profiles.len(),
        unmatched_profile_count: parsed.unmatched_profiles.len(),
        cross_midnight_count: parsed.cross_midnight_count,
        password_conflict_count: parsed.password_conflict_count,
        skipped_count: parsed.skipped_count,
        warning_count: parsed.warnings.len(),
        warnings: parsed.warnings.iter().take(50).cloned().collect(),
        preview_token: token.clone(),
    };

    let mut previews = state
        .previews
        .lock()
        .map_err(|_| "导入预览状态不可用".to_string())?;
    previews.retain(|_, entry| entry.created_at.elapsed() <= PREVIEW_TTL);
    let created_at = Instant::now();
    previews.insert(token.clone(), PreviewEntry { created_at, parsed });
    drop(previews);
    tauri::async_runtime::spawn(expire_preview_after(
        state.previews.clone(),
        token,
        created_at,
        PREVIEW_TTL,
    ));
    Ok(preview)
}

async fn expire_preview_after(
    previews: Arc<Mutex<HashMap<String, PreviewEntry>>>,
    token: String,
    created_at: Instant,
    ttl: StdDuration,
) {
    tokio::time::sleep(ttl).await;
    let mut previews = previews
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if previews
        .get(&token)
        .is_some_and(|entry| entry.created_at == created_at)
    {
        previews.remove(&token);
    }
}

async fn parse_legacy_workbook_in_background(
    path: String,
    base_year: i32,
) -> Result<ParsedLegacyData, String> {
    tauri::async_runtime::spawn_blocking(move || parse_legacy_workbook(Path::new(&path), base_year))
        .await
        .map_err(|error| format!("Excel 预览后台任务执行失败：{error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn commit_excel_import<R: Runtime>(
    app: AppHandle<R>,
    preview_token: String,
    imports: State<'_, ImportState>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
) -> Result<ExcelImportResult, String> {
    let operation_guard = backup.lock_data_operation().await;
    let parsed = imports.take(&preview_token)?;
    let mut transaction = database
        .pool()
        .begin()
        .await
        .map_err(|error| format!("无法开始导入事务：{error}"))?;
    let mut secret_changes: Vec<(String, Option<String>)> = Vec::new();
    let mut imported_profiles = 0;
    let mut imported_appointments = 0;
    let mut skipped_duplicates = 0;

    for profile in parsed
        .profiles
        .iter()
        .chain(parsed.unmatched_profiles.iter())
    {
        let write = match insert_imported_account_profile(&mut transaction, profile).await {
            Ok(write) => write,
            Err(error) => {
                return Err(rollback_import(&app, transaction, secret_changes, error).await);
            }
        };
        imported_profiles += write.inserted;
        skipped_duplicates += write.skipped;

        if write.inserted > 0 {
            match set_imported_secret(&app, write.record_id.clone(), profile.password.clone()).await
            {
                Ok(previous) => secret_changes.push((write.record_id, previous)),
                Err(error) => {
                    return Err(rollback_import(
                        &app,
                        transaction,
                        secret_changes,
                        format!("写入导入账号密码失败：{error}"),
                    )
                    .await);
                }
            }
        }
    }

    for appointment in &parsed.appointments {
        let account_profile_id = match appointment.account_name.as_deref() {
            Some(account_name) => {
                match find_imported_account_profile_id(&mut transaction, account_name).await {
                    Ok(account_profile_id) => account_profile_id,
                    Err(error) => {
                        return Err(rollback_import(&app, transaction, secret_changes, error).await);
                    }
                }
            }
            None => None,
        };
        let write = match insert_imported_appointment(
            &mut transaction,
            appointment,
            account_profile_id.as_deref(),
        )
        .await
        {
            Ok(write) => write,
            Err(error) => {
                return Err(rollback_import(&app, transaction, secret_changes, error).await);
            }
        };
        imported_appointments += write.inserted;
        skipped_duplicates += write.skipped;
    }

    if let Err(error) = transaction.commit().await {
        let secret_safety_note = if secret_changes.is_empty() {
            ""
        } else {
            "；提交结果状态不确定，为避免可见账号缺少密码，已保留保险库中的密码"
        };
        return Err(format!(
            "提交 Excel 导入事务失败：{error}{secret_safety_note}"
        ));
    }

    drop(operation_guard);
    restore_pending_notifications(app, database.inner(), notifications.inner()).await?;

    Ok(ExcelImportResult {
        imported_appointments,
        imported_profiles,
        skipped_duplicates,
        warnings: parsed.warnings,
    })
}

async fn set_imported_secret<R: Runtime>(
    app: &AppHandle<R>,
    account_id: String,
    password: String,
) -> Result<Option<String>, String> {
    let worker_app = app.clone();
    run_blocking_vault_operation(move || {
        worker_app
            .state::<VaultState>()
            .set_secret(&account_id, password)
    })
    .await
}

async fn rollback_import<R: Runtime>(
    app: &AppHandle<R>,
    transaction: Transaction<'_, Sqlite>,
    secret_changes: Vec<(String, Option<String>)>,
    primary_error: String,
) -> String {
    if let Err(error) = transaction.rollback().await {
        let secret_safety_note = if secret_changes.is_empty() {
            ""
        } else {
            "；数据库状态不确定，为避免可见账号缺少密码，已保留保险库中的密码"
        };
        return format!("{primary_error}；回滚 Excel 导入事务失败：{error}{secret_safety_note}");
    }

    append_secret_restore_result(app, secret_changes, primary_error).await
}

async fn append_secret_restore_result<R: Runtime>(
    app: &AppHandle<R>,
    secret_changes: Vec<(String, Option<String>)>,
    primary_error: String,
) -> String {
    match restore_secret_changes(app, secret_changes).await {
        Ok(()) => primary_error,
        Err(restore_error) => format!("{primary_error}；{restore_error}"),
    }
}

async fn restore_secret_changes<R: Runtime>(
    app: &AppHandle<R>,
    changes: Vec<(String, Option<String>)>,
) -> Result<(), String> {
    let mut failures = Vec::new();
    for (index, (account_id, previous)) in changes.into_iter().rev().enumerate() {
        let worker_app = app.clone();
        let result = run_blocking_vault_operation(move || {
            let vault = worker_app.state::<VaultState>();
            match previous {
                Some(password) => vault.set_secret(&account_id, password),
                None => vault.remove_secret(&account_id),
            }
        })
        .await;
        if let Err(error) = result {
            failures.push(format!("第 {} 项账号密码补偿失败：{error}", index + 1));
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("；"))
    }
}

pub(crate) fn parse_legacy_workbook(
    path: &Path,
    base_year: i32,
) -> Result<ParsedLegacyData, String> {
    if !path.exists() {
        return Err("Excel 文件不存在".to_string());
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "xlsm" && extension != "xlsx" && extension != "xls" {
        return Err("仅支持 .xlsm、.xlsx 和 .xls 文件".to_string());
    }

    let mut workbook =
        open_workbook_auto(path).map_err(|error| format!("无法打开 Excel：{error}"))?;
    let record_range = workbook
        .worksheet_range("记录")
        .map_err(|error| format!("无法读取“记录”工作表：{error}"))?;
    let account_range = workbook
        .worksheet_range("account")
        .map_err(|error| format!("无法读取“account”工作表：{error}"))?;

    let mut warnings = Vec::new();
    let mut skipped_count = 0;
    let mut cross_midnight_count = 0;
    let mut appointments = Vec::new();

    for (index, row) in record_range.rows().skip(1).enumerate() {
        let excel_row = index + 2;
        if row.iter().all(DataType::is_empty) {
            continue;
        }

        let parsed_date = row
            .first()
            .and_then(|cell| parse_date_cell(cell, base_year));
        if parsed_date.is_none()
            && text_at(row, 4).is_empty()
            && text_at(row, 5).is_empty()
            && text_at(row, 8).is_empty()
            && text_at(row, 11).is_empty()
        {
            // Legacy section markers such as “新赛季” are not appointment rows.
            continue;
        }
        let Some(source_service_date) = parsed_date else {
            skipped_count += 1;
            warnings.push(format!("记录第 {excel_row} 行缺少可识别日期，已跳过"));
            continue;
        };

        let contact_name = text_at(row, 4);
        if contact_name.is_empty() {
            skipped_count += 1;
            warnings.push(format!("记录第 {excel_row} 行缺少联系人，已跳过"));
            continue;
        }

        let time_text = text_at(row, 11);
        let (starts_at, ends_at, crossed) = if time_text.is_empty() {
            (None, None, false)
        } else {
            match parse_time_range(source_service_date, &time_text) {
                Ok(result) => result,
                Err(()) => {
                    warnings.push(format!(
                        "记录第 {excel_row} 行时间格式无法识别，按待定时段导入"
                    ));
                    (None, None, false)
                }
            }
        };
        if crossed {
            cross_midnight_count += 1;
        }
        let service_date = starts_at
            .as_ref()
            .map(|value| value.date_naive())
            .unwrap_or(source_service_date);

        let raw_status = text_at(row, 10);
        let (service_status, settlement_status) = map_status(&raw_status);
        let payment_method = optional_text(text_at(row, 7)).filter(|value| value != "-");
        let account_name = optional_text(text_at(row, 8));
        let account_password = optional_text(text_at(row, 9));
        let amount_minor = money_minor(row.get(12));
        let notes = join_notes([text_at(row, 13), text_at(row, 14)]);

        appointments.push(LegacyAppointment {
            service_date,
            starts_at,
            ends_at,
            contact_name: contact_name.clone(),
            content: optional_text(text_at(row, 5)),
            service_status: service_status.to_string(),
            settlement_status: settlement_status.to_string(),
            account_name: account_name.clone(),
            account_password,
            server: optional_text(text_at(row, 3)),
            specialization: optional_text(text_at(row, 1)),
            gear_score: optional_text(text_at(row, 2)),
            rate_note: optional_text(text_at(row, 6)),
            payment_method,
            amount_minor,
            notes,
            import_fingerprint: fingerprint(&[
                "记录",
                &source_service_date.to_string(),
                &contact_name,
                &time_text,
                account_name.as_deref().unwrap_or_default(),
                &text_at(row, 5),
                &text_at(row, 12),
            ]),
        });
    }

    let mut profiles = Vec::new();
    for (index, row) in account_range.rows().skip(1).enumerate() {
        let excel_row = index + 2;
        if row.iter().all(DataType::is_empty) {
            continue;
        }

        let account_name = text_at(row, 5);
        let password = text_at(row, 6);
        if account_name.is_empty() || password.is_empty() {
            skipped_count += 1;
            warnings.push(format!("account 第 {excel_row} 行缺少账号或密码，已跳过"));
            continue;
        }

        let contact_name = optional_text(text_at(row, 0));
        let server = optional_text(text_at(row, 1));
        let character_name = optional_text(text_at(row, 2));
        let specialization = optional_text(text_at(row, 3));
        let gear_score = optional_text(text_at(row, 4));
        let needs_review = profile_metadata_needs_review(
            &contact_name,
            &server,
            &character_name,
            &specialization,
            &gear_score,
        );

        profiles.push(LegacyAccountProfile {
            contact_name,
            server,
            character_name,
            specialization,
            gear_score,
            account_name: account_name.clone(),
            password,
            current_score: integer_value(row.get(7)),
            highest_score: integer_value(row.get(8)),
            score_updated_at: row
                .get(10)
                .and_then(|cell| parse_date_cell(cell, base_year)),
            notes: join_notes([text_at(row, 12), text_at(row, 13)]),
            needs_review,
            import_fingerprint: fingerprint(&[
                "account",
                &normalize_account(&account_name),
                &text_at(row, 1),
                &text_at(row, 2),
            ]),
        });
    }

    let profile_accounts: HashSet<String> = profiles
        .iter()
        .map(|profile| normalize_account(&profile.account_name))
        .collect();
    let mut unmatched_by_account: HashMap<String, LegacyAccountProfile> = HashMap::new();
    for appointment in &appointments {
        let Some(account_name) = appointment.account_name.as_deref() else {
            continue;
        };
        let normalized = normalize_account(account_name);
        if profile_accounts.contains(&normalized) {
            continue;
        }
        let Some(password) = appointment.account_password.as_deref() else {
            warnings.push("存在未匹配且没有密码的流水账号，需要手动补充".to_string());
            continue;
        };

        unmatched_by_account.insert(
            normalized.clone(),
            LegacyAccountProfile {
                contact_name: Some(appointment.contact_name.clone()),
                server: appointment.server.clone(),
                character_name: None,
                specialization: appointment.specialization.clone(),
                gear_score: appointment.gear_score.clone(),
                account_name: account_name.to_string(),
                password: password.to_string(),
                current_score: None,
                highest_score: None,
                score_updated_at: None,
                notes: Some("由历史流水自动建立，请补充角色信息".to_string()),
                needs_review: true,
                import_fingerprint: fingerprint(&["unmatched-account", &normalized]),
            },
        );
    }

    let password_conflict_count = count_password_conflicts(&profiles, &appointments);
    if password_conflict_count > 0 {
        warnings.push(format!(
            "发现 {password_conflict_count} 个账号存在多个历史密码；账号档案优先，否则使用最后一条流水密码"
        ));
    }

    let mut unmatched_profiles: Vec<_> = unmatched_by_account.into_values().collect();
    unmatched_profiles.sort_by(|left, right| left.account_name.cmp(&right.account_name));

    Ok(ParsedLegacyData {
        source_path: path.to_string_lossy().into_owned(),
        base_year,
        appointments,
        profiles,
        unmatched_profiles,
        warnings,
        cross_midnight_count,
        password_conflict_count,
        skipped_count,
    })
}

fn text_at(row: &[Data], index: usize) -> String {
    row.get(index)
        .and_then(DataType::as_string)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn optional_text(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn profile_metadata_needs_review(
    contact_name: &Option<String>,
    server: &Option<String>,
    character_name: &Option<String>,
    specialization: &Option<String>,
    gear_score: &Option<String>,
) -> bool {
    [
        contact_name,
        server,
        character_name,
        specialization,
        gear_score,
    ]
    .into_iter()
    .any(Option::is_none)
}

fn count_password_conflicts(
    profiles: &[LegacyAccountProfile],
    appointments: &[LegacyAppointment],
) -> usize {
    let mut passwords_by_account: HashMap<String, HashSet<String>> = HashMap::new();
    for profile in profiles {
        passwords_by_account
            .entry(normalize_account(&profile.account_name))
            .or_default()
            .insert(profile.password.clone());
    }
    for appointment in appointments {
        if let (Some(account_name), Some(password)) = (
            appointment.account_name.as_deref(),
            appointment.account_password.as_deref(),
        ) {
            passwords_by_account
                .entry(normalize_account(account_name))
                .or_default()
                .insert(password.to_string());
        }
    }
    passwords_by_account
        .values()
        .filter(|passwords| passwords.len() > 1)
        .count()
}

fn normalize_account(value: &str) -> String {
    value.trim().to_lowercase()
}

fn join_notes<const N: usize>(values: [String; N]) -> Option<String> {
    let joined = values
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    optional_text(joined)
}

fn integer_value(cell: Option<&Data>) -> Option<i64> {
    cell.and_then(DataType::as_i64).or_else(|| {
        cell.and_then(DataType::as_f64)
            .map(|value| value.round() as i64)
    })
}

fn money_minor(cell: Option<&Data>) -> Option<i64> {
    let value = cell.and_then(DataType::as_f64).or_else(|| {
        cell.and_then(DataType::as_string).and_then(|value| {
            value
                .replace(['¥', '￥', ','], "")
                .trim()
                .parse::<f64>()
                .ok()
        })
    })?;
    Some((value * 100.0).round() as i64)
}

fn parse_date_cell(cell: &Data, base_year: i32) -> Option<NaiveDate> {
    if let Some(date) = cell.as_date() {
        return Some(date);
    }
    let value = cell.as_string()?.trim().to_string();
    for format in ["%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"] {
        if let Ok(date) = NaiveDate::parse_from_str(&value, format) {
            return Some(date);
        }
    }
    let (month, day) = value.split_once('.')?;
    NaiveDate::from_ymd_opt(base_year, month.parse().ok()?, day.parse().ok()?)
}

fn parse_time_range(service_date: NaiveDate, value: &str) -> Result<ParsedTimeRange, ()> {
    let (start_raw, end_raw) = value.split_once('-').ok_or(())?;
    let start_minutes = parse_clock(start_raw.trim()).ok_or(())?;
    let end_minutes = parse_clock(end_raw.trim()).ok_or(())?;
    let mut absolute_end = end_minutes;
    if absolute_end <= start_minutes {
        absolute_end += 24 * 60;
    }

    let start = datetime_from_minutes(service_date, start_minutes)?;
    let end = datetime_from_minutes(service_date, absolute_end)?;
    let crossed = start.date_naive() != service_date || end.date_naive() != service_date;
    Ok((Some(start), Some(end), crossed))
}

fn parse_clock(value: &str) -> Option<i64> {
    let (hour, minute) = value.split_once(':')?;
    let hour: i64 = hour.parse().ok()?;
    let minute: i64 = minute.parse().ok()?;
    // The legacy workbook uses values such as 24:35 for 00:35 on the next day.
    if minute >= 60 || hour > 24 {
        return None;
    }
    Some(hour * 60 + minute)
}

fn datetime_from_minutes(
    service_date: NaiveDate,
    minutes: i64,
) -> Result<DateTime<FixedOffset>, ()> {
    let date = service_date + Duration::days(minutes.div_euclid(24 * 60));
    let minute_of_day = minutes.rem_euclid(24 * 60);
    let time = NaiveTime::from_hms_opt((minute_of_day / 60) as u32, (minute_of_day % 60) as u32, 0)
        .ok_or(())?;
    let offset = FixedOffset::east_opt(8 * 60 * 60).ok_or(())?;
    offset
        .from_local_datetime(&NaiveDateTime::new(date, time))
        .single()
        .ok_or(())
}

fn map_status(value: &str) -> (&'static str, &'static str) {
    match value.trim() {
        "完成" => ("completed", "settled"),
        value if value.contains("待结") => ("completed", "unsettled"),
        _ => ("scheduled", "unsettled"),
    }
}

fn fingerprint(parts: &[&str]) -> String {
    let mut digest = Sha256::new();
    for part in parts {
        digest.update(part.trim().as_bytes());
        digest.update([0]);
    }
    hex::encode(digest.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_month_day_with_base_year() {
        assert_eq!(
            parse_date_cell(&Data::String("7.17".to_string()), 2026),
            NaiveDate::from_ymd_opt(2026, 7, 17)
        );
    }

    #[test]
    fn parses_cross_midnight_and_24_hour_start() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 13).expect("valid date");
        let (start, end, crossed) = parse_time_range(date, "24:00-01:00").expect("valid range");
        assert!(crossed);
        assert_eq!(start.expect("start").date_naive(), date + Duration::days(1));
        assert_eq!(end.expect("end").date_naive(), date + Duration::days(1));
    }

    #[test]
    fn keeps_service_and_settlement_status_separate() {
        assert_eq!(map_status("待结"), ("completed", "unsettled"));
        assert_eq!(map_status("完成"), ("completed", "settled"));
        assert_eq!(map_status("周五晚上"), ("scheduled", "unsettled"));
    }

    #[test]
    fn parses_sanitized_legacy_fixture() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("legacy_import.xlsx");
        let parsed = parse_legacy_workbook(&path, 2026).expect("fixture should parse");

        assert_eq!(parsed.appointments.len(), 3);
        assert_eq!(parsed.profiles.len(), 2);
        assert_eq!(parsed.unmatched_profiles.len(), 1);
        assert_eq!(parsed.cross_midnight_count, 1);
        assert_eq!(parsed.password_conflict_count, 1);
        assert_eq!(parsed.skipped_count, 0);
        let normalized_midnight = parsed
            .appointments
            .iter()
            .find(|appointment| {
                appointment
                    .starts_at
                    .as_ref()
                    .is_some_and(|start| start.time() == NaiveTime::MIN)
            })
            .expect("fixture should contain the 24:00 appointment");
        assert_eq!(
            normalized_midnight.service_date,
            NaiveDate::from_ymd_opt(2026, 3, 5).unwrap()
        );
        assert_eq!(
            normalized_midnight.starts_at.as_ref().unwrap().date_naive(),
            normalized_midnight.service_date
        );
        assert!(parsed.profiles.iter().all(|profile| !profile.needs_review));
    }

    #[test]
    fn parses_sanitized_legacy_fixture_on_background_worker() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("legacy_import.xlsx")
            .to_string_lossy()
            .into_owned();

        let parsed =
            tauri::async_runtime::block_on(parse_legacy_workbook_in_background(path, 2026))
                .expect("fixture should parse on a background worker");

        assert_eq!(parsed.appointments.len(), 3);
        assert_eq!(parsed.profiles.len(), 2);
        assert_eq!(parsed.unmatched_profiles.len(), 1);
    }

    #[test]
    fn preview_expiry_removes_only_the_matching_creation() {
        tauri::async_runtime::block_on(async {
            let path = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests")
                .join("fixtures")
                .join("legacy_import.xlsx");
            let parsed = parse_legacy_workbook(&path, 2026).expect("fixture should parse");
            let previews = Arc::new(Mutex::new(HashMap::new()));

            let reused_token = "reused-token".to_string();
            let original_created_at = Instant::now();
            previews.lock().unwrap().insert(
                reused_token.clone(),
                PreviewEntry {
                    created_at: original_created_at,
                    parsed: parsed.clone(),
                },
            );
            let replacement_created_at = original_created_at + StdDuration::from_secs(1);
            previews.lock().unwrap().insert(
                reused_token.clone(),
                PreviewEntry {
                    created_at: replacement_created_at,
                    parsed: parsed.clone(),
                },
            );

            expire_preview_after(
                previews.clone(),
                reused_token.clone(),
                original_created_at,
                StdDuration::from_millis(1),
            )
            .await;
            assert_eq!(
                previews
                    .lock()
                    .unwrap()
                    .get(&reused_token)
                    .expect("replacement preview must remain")
                    .created_at,
                replacement_created_at
            );

            let matching_token = "matching-token".to_string();
            let matching_created_at = Instant::now();
            previews.lock().unwrap().insert(
                matching_token.clone(),
                PreviewEntry {
                    created_at: matching_created_at,
                    parsed,
                },
            );
            expire_preview_after(
                previews.clone(),
                matching_token.clone(),
                matching_created_at,
                StdDuration::from_millis(1),
            )
            .await;
            assert!(!previews.lock().unwrap().contains_key(&matching_token));
        });
    }

    #[test]
    fn account_metadata_gaps_are_marked_for_review() {
        let complete = Some("完整".to_string());
        assert!(!profile_metadata_needs_review(
            &complete, &complete, &complete, &complete, &complete,
        ));
        assert!(profile_metadata_needs_review(
            &None, &complete, &complete, &complete, &complete,
        ));
        assert!(profile_metadata_needs_review(
            &complete, &complete, &None, &complete, &complete,
        ));
    }

    #[test]
    fn account_sheet_password_participates_in_conflict_detection() {
        let account_name = "shared-account";
        let profile = LegacyAccountProfile {
            contact_name: Some("联系人".into()),
            server: Some("服务器".into()),
            character_name: Some("角色".into()),
            specialization: Some("职业".into()),
            gear_score: Some("装分".into()),
            account_name: account_name.into(),
            password: "account-sheet-password".into(),
            current_score: None,
            highest_score: None,
            score_updated_at: None,
            notes: None,
            needs_review: false,
            import_fingerprint: "profile-fingerprint".into(),
        };
        let appointment = LegacyAppointment {
            service_date: NaiveDate::from_ymd_opt(2026, 3, 5).unwrap(),
            starts_at: None,
            ends_at: None,
            contact_name: "联系人".into(),
            content: None,
            service_status: "scheduled".into(),
            settlement_status: "unsettled".into(),
            account_name: Some(account_name.into()),
            account_password: Some("history-password".into()),
            server: None,
            specialization: None,
            gear_score: None,
            rate_note: None,
            payment_method: None,
            amount_minor: None,
            notes: None,
            import_fingerprint: "appointment-fingerprint".into(),
        };

        assert_eq!(count_password_conflicts(&[profile], &[appointment]), 1);
    }

    #[test]
    #[ignore = "set TIMEKEEPER_LEGACY_WORKBOOK for a manual local smoke test"]
    fn parses_external_workbook_from_environment() {
        let path = std::env::var("TIMEKEEPER_LEGACY_WORKBOOK")
            .expect("TIMEKEEPER_LEGACY_WORKBOOK must point to a workbook");
        let parsed = parse_legacy_workbook(Path::new(&path), 2026).expect("workbook should parse");
        println!(
            "appointments={} profiles={} unmatched={} cross_midnight={} password_conflicts={} skipped={}",
            parsed.appointments.len(),
            parsed.profiles.len(),
            parsed.unmatched_profiles.len(),
            parsed.cross_midnight_count,
            parsed.password_conflict_count,
            parsed.skipped_count
        );
        for warning in &parsed.warnings {
            println!("warning: {warning}");
        }
        assert!(!parsed.appointments.is_empty());
        assert!(!parsed.profiles.is_empty());
    }
}
