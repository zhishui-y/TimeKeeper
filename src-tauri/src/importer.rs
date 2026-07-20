use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::Mutex,
    time::{Duration as StdDuration, Instant},
};

use calamine::{Data, DataType, Reader, open_workbook_auto};
use chrono::{DateTime, Duration, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime, State};
use uuid::Uuid;

use crate::{
    accounts::{find_imported_account_profile_id, insert_imported_account_profile},
    appointments::{insert_imported_appointment, restore_pending_notifications},
    backup::BackupState,
    db::Database,
    notifications::NotificationState,
    vault::VaultState,
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
    previews: Mutex<HashMap<String, PreviewEntry>>,
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
pub fn preview_excel_import(
    path: String,
    base_year: i32,
    state: State<'_, ImportState>,
) -> Result<ExcelImportPreview, String> {
    if !(2000..=2100).contains(&base_year) {
        return Err("基准年份必须在 2000 到 2100 之间".to_string());
    }

    let parsed = parse_legacy_workbook(Path::new(&path), base_year)?;
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
    previews.insert(
        token,
        PreviewEntry {
            created_at: Instant::now(),
            parsed,
        },
    );
    Ok(preview)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn commit_excel_import<R: Runtime>(
    app: AppHandle<R>,
    preview_token: String,
    imports: State<'_, ImportState>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    vault: State<'_, VaultState>,
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
                let _ = transaction.rollback().await;
                restore_secret_changes(&vault, secret_changes);
                return Err(error);
            }
        };
        imported_profiles += write.inserted;
        skipped_duplicates += write.skipped;

        if write.inserted > 0 {
            match vault.set_secret(&write.record_id, profile.password.clone()) {
                Ok(previous) => secret_changes.push((write.record_id, previous)),
                Err(error) => {
                    let _ = transaction.rollback().await;
                    restore_secret_changes(&vault, secret_changes);
                    return Err(format!("写入导入账号密码失败：{error}"));
                }
            }
        }
    }

    for appointment in &parsed.appointments {
        let account_profile_id = match appointment.account_name.as_deref() {
            Some(account_name) => find_imported_account_profile_id(&mut transaction, account_name)
                .await
                .inspect_err(|_| {
                    restore_secret_changes(&vault, secret_changes.clone());
                })?,
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
                let _ = transaction.rollback().await;
                restore_secret_changes(&vault, secret_changes);
                return Err(error);
            }
        };
        imported_appointments += write.inserted;
        skipped_duplicates += write.skipped;
    }

    if let Err(error) = transaction.commit().await {
        restore_secret_changes(&vault, secret_changes);
        return Err(format!("提交 Excel 导入事务失败：{error}"));
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

fn restore_secret_changes(vault: &VaultState, changes: Vec<(String, Option<String>)>) {
    for (account_id, previous) in changes.into_iter().rev() {
        match previous {
            Some(password) => {
                let _ = vault.set_secret(&account_id, password);
            }
            None => {
                let _ = vault.remove_secret(&account_id);
            }
        }
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
        let Some(service_date) = parsed_date else {
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
            match parse_time_range(service_date, &time_text) {
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
                &service_date.to_string(),
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

        profiles.push(LegacyAccountProfile {
            contact_name: optional_text(text_at(row, 0)),
            server: optional_text(text_at(row, 1)),
            character_name: optional_text(text_at(row, 2)),
            specialization: optional_text(text_at(row, 3)),
            gear_score: optional_text(text_at(row, 4)),
            account_name: account_name.clone(),
            password,
            current_score: integer_value(row.get(7)),
            highest_score: integer_value(row.get(8)),
            score_updated_at: row
                .get(10)
                .and_then(|cell| parse_date_cell(cell, base_year)),
            notes: join_notes([text_at(row, 12), text_at(row, 13)]),
            needs_review: false,
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
    let mut passwords_by_account: HashMap<String, HashSet<String>> = HashMap::new();

    for appointment in &appointments {
        let Some(account_name) = appointment.account_name.as_deref() else {
            continue;
        };
        let normalized = normalize_account(account_name);
        if let Some(password) = appointment.account_password.as_deref() {
            passwords_by_account
                .entry(normalized.clone())
                .or_default()
                .insert(password.to_string());
        }
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

    let password_conflict_count = passwords_by_account
        .values()
        .filter(|passwords| passwords.len() > 1)
        .count();
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
