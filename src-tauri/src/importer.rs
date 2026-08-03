use std::{
    collections::{HashMap, HashSet},
    fmt,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration as StdDuration, Instant},
};

use calamine::{Data, DataType, Reader, open_workbook_auto};
use chrono::{
    DateTime, Datelike, Duration, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, TimeZone,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, Transaction};
use tauri::{AppHandle, Runtime, State};
use uuid::Uuid;

use crate::{
    accounts::insert_imported_account_profile,
    app_access::AppAccessState,
    appointments::{insert_imported_appointment, restore_notifications_for_ids},
    backup::BackupState,
    db::Database,
    models::VoicePlatform,
    notifications::NotificationState,
};

const PREVIEW_TTL: StdDuration = StdDuration::from_secs(30 * 60);
type ParsedTimeRange = (
    Option<DateTime<FixedOffset>>,
    Option<DateTime<FixedOffset>>,
    bool,
);

#[derive(Clone)]
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
    pub voice_platform: Option<VoicePlatform>,
    pub voice_channel: Option<String>,
    pub import_fingerprint: String,
}

impl fmt::Debug for LegacyAppointment {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LegacyAppointment")
            .field("service_date", &self.service_date)
            .field("contact_name", &self.contact_name)
            .field("account_name", &self.account_name)
            .field(
                "account_password",
                &self.account_password.as_ref().map(|_| "<redacted>"),
            )
            .field("import_fingerprint", &self.import_fingerprint)
            .finish_non_exhaustive()
    }
}

#[derive(Clone)]
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

impl fmt::Debug for LegacyAccountProfile {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LegacyAccountProfile")
            .field("account_name", &self.account_name)
            .field("password", &"<redacted>")
            .field("import_fingerprint", &self.import_fingerprint)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ParsedLegacyData {
    pub source_path: String,
    pub base_year: i32,
    pub appointments: Vec<LegacyAppointment>,
    pub profiles: Vec<LegacyAccountProfile>,
    pub unmatched_profiles: Vec<LegacyAccountProfile>,
    pub warnings: Vec<String>,
    pub account_sheet_present: bool,
    pub yy_channel_count: usize,
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
    yy_channel_count: usize,
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
    skipped_appointment_duplicates: usize,
    skipped_profile_duplicates: usize,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelImportSelection {
    appointments: bool,
    accounts: bool,
}

impl ExcelImportSelection {
    fn validate(self) -> Result<Self, String> {
        if !self.appointments && !self.accounts {
            return Err("请至少选择导入预约或账号".into());
        }
        Ok(self)
    }
}

#[tauri::command]
pub async fn preview_excel_import(
    path: String,
    base_year: i32,
    state: State<'_, ImportState>,
    access: State<'_, AppAccessState>,
) -> Result<ExcelImportPreview, String> {
    access.require_unlocked()?;
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
        yy_channel_count: parsed.yy_channel_count,
        password_conflict_count: parsed.password_conflict_count,
        skipped_count: parsed.skipped_count,
        warning_count: parsed.warnings.len(),
        warnings: parsed.warnings.clone(),
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
#[allow(clippy::too_many_arguments)]
pub async fn commit_excel_import<R: Runtime>(
    app: AppHandle<R>,
    preview_token: String,
    selection: ExcelImportSelection,
    imports: State<'_, ImportState>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
    access: State<'_, AppAccessState>,
) -> Result<ExcelImportResult, String> {
    access.require_unlocked()?;
    let selection = selection.validate()?;
    let operation_guard = backup.lock_data_operation().await;
    let parsed = imports.take(&preview_token)?;
    let mut outcome = commit_excel_import_to_sqlite(database.inner(), parsed, selection).await?;

    drop(operation_guard);
    if !outcome.imported_appointment_ids.is_empty()
        && let Err(error) = restore_notifications_for_ids(
            app,
            database.inner(),
            notifications.inner(),
            &outcome.imported_appointment_ids,
        )
        .await
    {
        outcome
            .result
            .warnings
            .push(format!("预约已导入，但通知调度失败：{error}"));
    }

    Ok(outcome.result)
}

#[derive(Debug)]
struct ImportCommitOutcome {
    result: ExcelImportResult,
    imported_appointment_ids: Vec<String>,
}

async fn commit_excel_import_to_sqlite(
    database: &Database,
    parsed: ParsedLegacyData,
    selection: ExcelImportSelection,
) -> Result<ImportCommitOutcome, String> {
    validate_import_selection_for_workbook(selection, &parsed)?;

    let mut transaction = database
        .pool()
        .begin()
        .await
        .map_err(|error| format!("无法开始导入事务：{error}"))?;
    let mut imported_profiles = 0;
    let mut imported_appointments = 0;
    let mut skipped_profile_duplicates = 0;
    let mut skipped_appointment_duplicates = 0;
    let mut imported_appointment_ids = Vec::new();

    if selection.accounts {
        for profile in &parsed.profiles {
            let write = match insert_imported_account_profile(&mut transaction, profile).await {
                Ok(write) => write,
                Err(error) => {
                    return Err(rollback_import(transaction, error).await);
                }
            };
            imported_profiles += write.inserted;
            skipped_profile_duplicates += write.skipped;

            if write.inserted > 0
                && !profile.password.is_empty()
                && let Err(error) = sqlx::query(
                    "INSERT INTO account_profile_credentials (profile_id, password) VALUES (?, ?)",
                )
                .bind(&write.record_id)
                .bind(&profile.password)
                .execute(&mut *transaction)
                .await
            {
                return Err(
                    rollback_import(transaction, format!("写入导入账号密码失败：{error}")).await,
                );
            }
        }
    }

    if selection.appointments {
        for appointment in &parsed.appointments {
            let write = match insert_imported_appointment(&mut transaction, appointment).await {
                Ok(write) => write,
                Err(error) => {
                    return Err(rollback_import(transaction, error).await);
                }
            };
            imported_appointments += write.inserted;
            skipped_appointment_duplicates += write.skipped;

            if write.inserted > 0 {
                imported_appointment_ids.push(write.record_id.clone());
                if appointment.account_name.is_some()
                    && let Some(password) = appointment
                        .account_password
                        .as_deref()
                        .filter(|password| !password.is_empty())
                    && let Err(error) = sqlx::query(
                        "INSERT INTO appointment_credentials (appointment_id, password) VALUES (?, ?)",
                    )
                    .bind(&write.record_id)
                    .bind(password)
                    .execute(&mut *transaction)
                    .await
                {
                    return Err(rollback_import(
                        transaction,
                        format!("写入导入预约密码失败：{error}"),
                    )
                    .await);
                }
            }
        }
    }

    transaction
        .commit()
        .await
        .map_err(|error| format!("提交 Excel 导入事务失败：{error}"))?;

    Ok(ImportCommitOutcome {
        result: ExcelImportResult {
            imported_appointments,
            imported_profiles,
            skipped_duplicates: skipped_appointment_duplicates + skipped_profile_duplicates,
            skipped_appointment_duplicates,
            skipped_profile_duplicates,
            warnings: parsed.warnings,
        },
        imported_appointment_ids,
    })
}

fn validate_import_selection_for_workbook(
    selection: ExcelImportSelection,
    parsed: &ParsedLegacyData,
) -> Result<(), String> {
    if selection.accounts && !selection.appointments && !parsed.account_sheet_present {
        return Err("Excel 缺少“account”工作表，无法仅导入账号档案".into());
    }
    Ok(())
}

async fn rollback_import(transaction: Transaction<'_, Sqlite>, primary_error: String) -> String {
    match transaction.rollback().await {
        Ok(()) => primary_error,
        Err(error) => format!("{primary_error}；回滚 Excel 导入事务失败：{error}"),
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
    let account_sheet_present = workbook.sheet_names().iter().any(|name| name == "account");
    let account_range = if account_sheet_present {
        Some(
            workbook
                .worksheet_range("account")
                .map_err(|error| format!("无法读取“account”工作表：{error}"))?,
        )
    } else {
        None
    };

    let mut warnings = Vec::new();
    if !account_sheet_present {
        warnings.push("未找到“account”工作表，将只导入预约记录".to_string());
    }
    let mut skipped_count = 0;
    let mut cross_midnight_count = 0;
    let mut yy_channel_count = 0;
    let mut appointments = Vec::new();
    let record_note_columns = note_column_indices(record_range.rows().next());

    for (index, row) in record_range.rows().skip(1).enumerate() {
        let excel_row = index + 2;
        if row.iter().all(DataType::is_empty) {
            continue;
        }
        if is_separator_row(row) {
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
        let (time_range_text, embedded_time_date) = split_legacy_time_text(&time_text, base_year);
        if let Some(embedded_date) = embedded_time_date
            && embedded_date != source_service_date
        {
            warnings.push(format!(
                "记录第 {excel_row} 行 A列日期 {source_service_date} 与时间列日期 {embedded_date} 不一致，按A列日期导入"
            ));
        }
        let (starts_at, ends_at, crossed) = if time_text.is_empty() {
            (None, None, false)
        } else {
            match parse_time_range(source_service_date, time_range_text) {
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
        let (service_status, mut settlement_status) = map_status(&raw_status);
        let payment_method = optional_text(text_at(row, 7)).filter(|value| value != "-");
        let account_name = optional_text(text_at(row, 8));
        let account_password = optional_text(text_at(row, 9));
        if let Some(warning) = appointment_password_warning(
            excel_row,
            account_name.as_deref(),
            account_password.as_deref(),
        ) {
            warnings.push(warning);
        }
        let (amount_minor, negative_amount_note) =
            normalize_import_amount(money_minor(row.get(12)));
        let mut note_values = text_values_at(row, &record_note_columns);
        if let Some(note) = negative_amount_note {
            settlement_status = "unsettled";
            warnings.push(format!(
                "记录第 {excel_row} 行金额为负数，不符合预约账单约束；原值已保留在备注，并按待结算导入"
            ));
            note_values.push(note);
        }
        let (notes, voice_platform, voice_channel, yy_warning) = extract_yy_channel(note_values);
        if let Some(warning) = yy_warning {
            warnings.push(format!("记录第 {excel_row} 行{warning}"));
        }
        if voice_channel.is_some() {
            yy_channel_count += 1;
        }

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
            voice_platform,
            voice_channel,
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
    if let Some(account_range) = account_range.as_ref() {
        let header = account_range.rows().next();
        let account_note_columns = note_column_indices(header);
        let score_updated_at_column = exact_header_column(header, "更新日期");
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
                score_updated_at: score_updated_at_column
                    .and_then(|column| row.get(column))
                    .and_then(|cell| parse_date_cell(cell, base_year)),
                notes: join_note_values(text_values_at(row, &account_note_columns)),
                needs_review,
                import_fingerprint: fingerprint(&[
                    "account",
                    &normalize_account(&account_name),
                    &text_at(row, 1),
                    &text_at(row, 2),
                ]),
            });
        }
    }

    let password_conflict_count = count_password_conflicts(&profiles, &appointments);
    if password_conflict_count > 0 {
        warnings.push(format!(
            "发现 {password_conflict_count} 个同名账号存在多个历史密码；账号档案和各预约将分别保留各自密码"
        ));
    }

    Ok(ParsedLegacyData {
        source_path: path.to_string_lossy().into_owned(),
        base_year,
        appointments,
        profiles,
        unmatched_profiles: Vec::new(),
        warnings,
        account_sheet_present,
        yy_channel_count,
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

fn text_values_at(row: &[Data], indices: &[usize]) -> Vec<String> {
    indices
        .iter()
        .map(|index| text_at(row, *index))
        .filter(|value| !value.is_empty())
        .collect()
}

fn note_column_indices(header: Option<&[Data]>) -> Vec<usize> {
    header
        .into_iter()
        .flat_map(|row| row.iter().enumerate())
        .filter_map(|(index, cell)| {
            cell.as_string()
                .is_some_and(|value| value.trim().starts_with("备注"))
                .then_some(index)
        })
        .collect()
}

fn exact_header_column(header: Option<&[Data]>, expected: &str) -> Option<usize> {
    header?.iter().position(|cell| {
        cell.as_string()
            .is_some_and(|value| value.trim() == expected)
    })
}

fn is_separator_row(row: &[Data]) -> bool {
    let values = row
        .iter()
        .filter_map(DataType::as_string)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    !values.is_empty()
        && values
            .iter()
            .all(|value| value.chars().all(|character| character == '-'))
}

fn optional_text(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn appointment_password_warning(
    excel_row: usize,
    account_name: Option<&str>,
    account_password: Option<&str>,
) -> Option<String> {
    match (account_name, account_password) {
        (Some(_), None) => Some(format!(
            "记录第 {excel_row} 行账号缺少密码，将按无密码预约导入，可在预约中补充"
        )),
        (None, Some(_)) => Some(format!(
            "记录第 {excel_row} 行填写了密码但缺少账号，密码将忽略"
        )),
        _ => None,
    }
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

fn join_note_values(values: Vec<String>) -> Option<String> {
    let joined = values
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    optional_text(joined)
}

fn extract_yy_channel(
    values: Vec<String>,
) -> (
    Option<String>,
    Option<VoicePlatform>,
    Option<String>,
    Option<String>,
) {
    let values = values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let channels = values
        .iter()
        .filter(|value| value.chars().all(|character| character.is_ascii_digit()))
        .cloned()
        .collect::<HashSet<_>>();

    if channels.len() == 1 {
        let channel = channels.into_iter().next().expect("one YY channel");
        let notes = join_note_values(
            values
                .into_iter()
                .filter(|value| value != &channel)
                .collect(),
        );
        return (notes, Some(VoicePlatform::Yy), Some(channel), None);
    }
    if channels.len() > 1 {
        return (
            join_note_values(values),
            None,
            None,
            Some("存在多个不同的纯数字备注，未自动设置 YY 频道".into()),
        );
    }

    (join_note_values(values), None, None, None)
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

fn normalize_import_amount(amount_minor: Option<i64>) -> (Option<i64>, Option<String>) {
    match amount_minor {
        Some(value) if value < 0 => {
            let absolute = i128::from(value).abs();
            (
                None,
                Some(format!(
                    "历史负数金额：-{}.{:02} 元（未计入账单）",
                    absolute / 100,
                    absolute % 100
                )),
            )
        }
        value => (value, None),
    }
}

fn parse_date_cell(cell: &Data, base_year: i32) -> Option<NaiveDate> {
    if let Data::Float(value) = cell
        && let Some(date) = parse_numeric_month_day(*value, base_year)
    {
        return Some(date);
    }
    if let Some(date) = cell.as_date() {
        if matches!(cell, Data::Float(_) | Data::Int(_)) && date.year() < 2000 {
            return None;
        }
        return Some(date);
    }
    let value = cell.as_string()?.trim().to_string();
    for format in ["%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"] {
        if let Ok(date) = NaiveDate::parse_from_str(&value, format) {
            return Some(date);
        }
    }
    parse_month_day_text(&value, base_year)
}

fn parse_numeric_month_day(value: f64, base_year: i32) -> Option<NaiveDate> {
    if !value.is_finite() || value.fract() == 0.0 {
        return None;
    }
    let value = format!("{value:.10}")
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string();
    parse_month_day_text(&value, base_year)
}

fn parse_month_day_text(value: &str, base_year: i32) -> Option<NaiveDate> {
    let (month, day) = value.trim().split_once('.')?;
    NaiveDate::from_ymd_opt(base_year, month.parse().ok()?, day.parse().ok()?)
}

fn split_legacy_time_text(value: &str, base_year: i32) -> (&str, Option<NaiveDate>) {
    let Some((date_text, time_text)) = value.split_once('|') else {
        return (value, None);
    };
    if time_text.contains('|') {
        return (value, None);
    }
    match parse_month_day_text(date_text, base_year) {
        Some(date) => (time_text.trim(), Some(date)),
        None => (value, None),
    }
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
    if !(0..60).contains(&minute) || !(0..=24).contains(&hour) {
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
    use calamine::{ExcelDateTime, ExcelDateTimeType};
    use std::path::PathBuf;

    struct TestDataDir(PathBuf);

    impl TestDataDir {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("timekeeper-import-{name}-{}", Uuid::now_v7()));
            std::fs::create_dir_all(&path).expect("create temporary import test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDataDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn imported_appointment(
        fingerprint: &str,
        account_name: &str,
        password: Option<&str>,
    ) -> LegacyAppointment {
        LegacyAppointment {
            service_date: NaiveDate::from_ymd_opt(2099, 8, 3).expect("valid test date"),
            starts_at: None,
            ends_at: None,
            contact_name: format!("导入联系人-{fingerprint}"),
            content: Some("真实保险库导入测试".into()),
            service_status: "scheduled".into(),
            settlement_status: "unsettled".into(),
            account_name: Some(account_name.into()),
            account_password: password.map(str::to_owned),
            server: Some("测试区服".into()),
            specialization: Some("测试职业".into()),
            gear_score: Some("12345".into()),
            rate_note: None,
            payment_method: None,
            amount_minor: None,
            notes: None,
            voice_platform: None,
            voice_channel: None,
            import_fingerprint: fingerprint.into(),
        }
    }

    fn parsed_appointments(appointments: Vec<LegacyAppointment>) -> ParsedLegacyData {
        ParsedLegacyData {
            source_path: "test-fixture.xlsx".into(),
            base_year: 2099,
            appointments,
            profiles: Vec::new(),
            unmatched_profiles: Vec::new(),
            warnings: Vec::new(),
            account_sheet_present: false,
            yy_channel_count: 0,
            cross_midnight_count: 0,
            password_conflict_count: 0,
            skipped_count: 0,
        }
    }

    fn appointments_only_selection() -> ExcelImportSelection {
        ExcelImportSelection {
            appointments: true,
            accounts: false,
        }
    }

    #[test]
    fn commit_writes_appointment_password_in_same_sqlite_transaction() {
        tauri::async_runtime::block_on(async {
            let data_dir = TestDataDir::new("appointment-passwords");
            let database = Database::initialize(data_dir.path().join("timekeeper.db"))
                .await
                .expect("initialize temporary database");
            let parsed = parsed_appointments(vec![
                imported_appointment(
                    "appointment-with-password",
                    "account-with-password",
                    Some("row-password"),
                ),
                imported_appointment(
                    "appointment-without-password",
                    "account-without-password",
                    None,
                ),
            ]);

            let outcome =
                commit_excel_import_to_sqlite(&database, parsed, appointments_only_selection())
                    .await
                    .expect("commit appointment import");
            assert_eq!(outcome.result.imported_appointments, 2);
            assert_eq!(outcome.imported_appointment_ids.len(), 2);

            let with_password_id = sqlx::query_scalar::<_, String>(
                "SELECT id FROM appointments
                 WHERE import_fingerprint = 'appointment-with-password'",
            )
            .fetch_one(database.pool())
            .await
            .expect("load imported appointment with password");
            assert_eq!(
                sqlx::query_scalar::<_, String>(
                    "SELECT password FROM appointment_credentials WHERE appointment_id = ?",
                )
                .bind(&with_password_id)
                .fetch_one(database.pool())
                .await
                .expect("appointment password should exist"),
                "row-password",
            );

            let without_password_id = sqlx::query_scalar::<_, String>(
                "SELECT id FROM appointments
                 WHERE import_fingerprint = 'appointment-without-password'",
            )
            .fetch_one(database.pool())
            .await
            .expect("load imported appointment without password");
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM appointment_credentials WHERE appointment_id = ?",
                )
                .bind(&without_password_id)
                .fetch_one(database.pool())
                .await
                .expect("count absent appointment password"),
                0,
            );

            database.pool().close().await;
            drop(database);
        });
    }

    #[test]
    fn credential_write_failure_rolls_back_imported_appointment() {
        tauri::async_runtime::block_on(async {
            let data_dir = TestDataDir::new("credential-rollback");
            let database = Database::initialize(data_dir.path().join("timekeeper.db"))
                .await
                .expect("initialize temporary database");
            sqlx::query(
                "CREATE TRIGGER reject_imported_credentials
                 BEFORE INSERT ON appointment_credentials
                 BEGIN SELECT RAISE(ABORT, 'simulated credential failure'); END",
            )
            .execute(database.pool())
            .await
            .expect("create rollback trigger");
            let parsed = parsed_appointments(vec![imported_appointment(
                "credential-rollback-appointment",
                "credential-rollback-account",
                Some("row-password"),
            )]);

            let error =
                commit_excel_import_to_sqlite(&database, parsed, appointments_only_selection())
                    .await
                    .expect_err("credential failure must reject the whole import");
            assert!(
                error.contains("写入导入预约密码失败"),
                "unexpected error: {error}"
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM appointments
                     WHERE import_fingerprint = 'credential-rollback-appointment'",
                )
                .fetch_one(database.pool())
                .await
                .expect("count rolled-back appointment"),
                0,
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM appointment_credentials")
                    .fetch_one(database.pool())
                    .await
                    .expect("count rolled-back credential"),
                0,
            );

            database.pool().close().await;
            drop(database);
        });
    }

    #[test]
    fn import_selection_requires_at_least_one_data_type() {
        assert!(
            ExcelImportSelection {
                appointments: false,
                accounts: false,
            }
            .validate()
            .is_err()
        );
        assert!(
            ExcelImportSelection {
                appointments: true,
                accounts: false,
            }
            .validate()
            .is_ok()
        );
        assert!(
            ExcelImportSelection {
                appointments: false,
                accounts: true,
            }
            .validate()
            .is_ok()
        );
    }

    #[test]
    fn parses_month_day_with_base_year() {
        let legacy_numeric_date = "3.14".parse::<f64>().unwrap();
        assert_eq!(
            parse_date_cell(&Data::String("7.17".to_string()), 2026),
            NaiveDate::from_ymd_opt(2026, 7, 17)
        );
        assert_eq!(
            parse_date_cell(&Data::Float(8.21), 2023),
            NaiveDate::from_ymd_opt(2023, 8, 21)
        );
        assert_eq!(
            parse_date_cell(&Data::Float(legacy_numeric_date), 2026),
            NaiveDate::from_ymd_opt(2026, 3, 14)
        );
        assert_ne!(
            parse_date_cell(&Data::Float(legacy_numeric_date), 2026),
            NaiveDate::from_ymd_opt(1900, 1, 3)
        );
        assert_eq!(parse_date_cell(&Data::Float(31.5), 2026), None);
        assert_eq!(parse_date_cell(&Data::Int(3), 2026), None);
    }

    #[test]
    fn keeps_real_excel_serial_dates() {
        let cell = Data::DateTime(ExcelDateTime::new(
            46_306.0,
            ExcelDateTimeType::DateTime,
            false,
        ));
        assert_eq!(
            parse_date_cell(&cell, 2026),
            NaiveDate::from_ymd_opt(2026, 10, 11)
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
    fn extracts_composite_time_but_keeps_source_date_authoritative() {
        let source_date = NaiveDate::from_ymd_opt(2021, 8, 2).unwrap();
        let (time_text, embedded_date) = split_legacy_time_text("8.3|23:00-01:00", 2021);
        assert_eq!(embedded_date, NaiveDate::from_ymd_opt(2021, 8, 3));
        let (start, end, crossed) = parse_time_range(source_date, time_text).unwrap();
        assert_eq!(start.unwrap().date_naive(), source_date);
        assert_eq!(end.unwrap().date_naive(), source_date + Duration::days(1));
        assert!(crossed);
        assert!(parse_time_range(source_date, "20:00-21:00 23:00-24:00").is_err());
        assert!(parse_time_range(source_date, "晚上安排").is_err());
        assert!(parse_clock("-1:00").is_none());
    }

    #[test]
    fn discovers_legacy_note_columns_and_exact_update_date_header() {
        let mut old_header = vec![Data::Empty; 12];
        old_header[10] = Data::String("本周情况".into());
        old_header[11] = Data::String("备注".into());
        assert_eq!(note_column_indices(Some(&old_header)), vec![11]);
        assert_eq!(exact_header_column(Some(&old_header), "更新日期"), None);

        let mut new_header = vec![Data::Empty; 14];
        new_header[10] = Data::String("更新日期".into());
        new_header[12] = Data::String("备注".into());
        new_header[13] = Data::String("备注2".into());
        assert_eq!(note_column_indices(Some(&new_header)), vec![12, 13]);
        assert_eq!(exact_header_column(Some(&new_header), "更新日期"), Some(10));
    }

    #[test]
    fn extracts_unique_ascii_digit_notes_as_yy_channels() {
        let (notes, platform, channel, warning) =
            extract_yy_channel(vec!["\u{2003}123456\u{00a0}".into(), "普通备注".into()]);
        assert_eq!(platform, Some(VoicePlatform::Yy));
        assert_eq!(channel.as_deref(), Some("123456"));
        assert_eq!(notes.as_deref(), Some("普通备注"));
        assert!(warning.is_none());

        let (notes, platform, channel, warning) =
            extract_yy_channel(vec!["88".into(), "88".into()]);
        assert_eq!(
            (platform, channel.as_deref()),
            (Some(VoicePlatform::Yy), Some("88"))
        );
        assert_eq!(notes, None);
        assert!(warning.is_none());

        let (notes, platform, channel, warning) =
            extract_yy_channel(vec!["88".into(), "99".into()]);
        assert_eq!((platform, channel), (None, None));
        assert_eq!(notes.as_deref(), Some("88\n99"));
        assert!(warning.is_some());
    }

    #[test]
    fn rejects_non_digit_channel_notes_and_supports_numeric_cells() {
        for value in ["QQ语音", "2300+", "12-34", "12 34"] {
            let (_, platform, channel, _) = extract_yy_channel(vec![value.into()]);
            assert_eq!((platform, channel), (None, None));
        }
        let row = vec![Data::Int(123456)];
        let (_, platform, channel, _) = extract_yy_channel(vec![text_at(&row, 0)]);
        assert_eq!(platform, Some(VoicePlatform::Yy));
        assert_eq!(channel.as_deref(), Some("123456"));
    }

    #[test]
    fn ignores_all_dash_separator_rows() {
        assert!(is_separator_row(&[
            Data::String("------".into()),
            Data::String("-".into()),
        ]));
        assert!(!is_separator_row(&[
            Data::String("-".into()),
            Data::String("业务".into()),
        ]));
    }

    #[test]
    fn accounts_only_selection_rejects_missing_account_sheet() {
        let parsed = parsed_appointments(Vec::new());
        let error = validate_import_selection_for_workbook(
            ExcelImportSelection {
                appointments: false,
                accounts: true,
            },
            &parsed,
        )
        .unwrap_err();
        assert!(error.contains("缺少“account”工作表"));
        assert!(
            validate_import_selection_for_workbook(
                ExcelImportSelection {
                    appointments: true,
                    accounts: true,
                },
                &parsed,
            )
            .is_ok()
        );
    }

    #[test]
    fn keeps_service_and_settlement_status_separate() {
        assert_eq!(map_status("待结"), ("completed", "unsettled"));
        assert_eq!(map_status("完成"), ("completed", "settled"));
        assert_eq!(map_status("周五晚上"), ("scheduled", "unsettled"));
    }

    #[test]
    fn preserves_negative_legacy_amount_as_note_without_persisting_negative_money() {
        assert_eq!(normalize_import_amount(Some(12_345)), (Some(12_345), None));
        assert_eq!(
            normalize_import_amount(Some(-3_500)),
            (None, Some("历史负数金额：-35.00 元（未计入账单）".into()))
        );
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
        assert!(parsed.unmatched_profiles.is_empty());
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
        assert!(parsed.unmatched_profiles.is_empty());
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
    fn missing_appointment_password_warns_without_skipping_the_row() {
        assert_eq!(
            appointment_password_warning(17, Some("legacy-account"), None).as_deref(),
            Some("记录第 17 行账号缺少密码，将按无密码预约导入，可在预约中补充")
        );
        assert_eq!(
            appointment_password_warning(18, None, Some("orphan-secret")).as_deref(),
            Some("记录第 18 行填写了密码但缺少账号，密码将忽略")
        );
        assert!(appointment_password_warning(19, None, None).is_none());
        assert!(appointment_password_warning(20, Some("account"), Some("secret")).is_none());
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
            voice_platform: None,
            voice_channel: None,
            import_fingerprint: "appointment-fingerprint".into(),
        };

        assert_eq!(count_password_conflicts(&[profile], &[appointment]), 1);
    }

    #[test]
    #[ignore = "set TIMEKEEPER_LEGACY_WORKBOOK for a manual local smoke test"]
    fn parses_external_workbook_from_environment() {
        let path = std::env::var("TIMEKEEPER_LEGACY_WORKBOOK")
            .expect("TIMEKEEPER_LEGACY_WORKBOOK must point to a workbook");
        let base_year = std::env::var("TIMEKEEPER_LEGACY_BASE_YEAR")
            .expect("TIMEKEEPER_LEGACY_BASE_YEAR must match the workbook")
            .parse()
            .expect("TIMEKEEPER_LEGACY_BASE_YEAR must be a year");
        let parsed =
            parse_legacy_workbook(Path::new(&path), base_year).expect("workbook should parse");
        println!(
            "appointments={} profiles={} yy_channels={} account_sheet={} unmatched={} cross_midnight={} password_conflicts={} skipped={}",
            parsed.appointments.len(),
            parsed.profiles.len(),
            parsed.yy_channel_count,
            parsed.account_sheet_present,
            parsed.unmatched_profiles.len(),
            parsed.cross_midnight_count,
            parsed.password_conflict_count,
            parsed.skipped_count
        );
        for warning in &parsed.warnings {
            println!("warning: {warning}");
        }
        assert!(!parsed.appointments.is_empty());
        assert!(
            parsed
                .appointments
                .iter()
                .all(|appointment| appointment.service_date.year() >= 2000)
        );
        if matches!(base_year, 2023 | 2024) {
            assert!(
                parsed
                    .profiles
                    .iter()
                    .all(|profile| profile.score_updated_at.is_none())
            );
        }
        if matches!(base_year, 2023..=2025) {
            assert!(
                parsed
                    .profiles
                    .iter()
                    .any(|profile| profile.notes.is_some())
            );
        }
    }

    #[test]
    #[ignore = "set TIMEKEEPER_LEGACY_WORKBOOK and TIMEKEEPER_LEGACY_BASE_YEAR for isolated commit acceptance"]
    fn commits_external_workbook_to_temporary_database() {
        tauri::async_runtime::block_on(async {
            let path = std::env::var("TIMEKEEPER_LEGACY_WORKBOOK")
                .expect("TIMEKEEPER_LEGACY_WORKBOOK must point to a workbook");
            let base_year = std::env::var("TIMEKEEPER_LEGACY_BASE_YEAR")
                .expect("TIMEKEEPER_LEGACY_BASE_YEAR must match the workbook")
                .parse()
                .expect("TIMEKEEPER_LEGACY_BASE_YEAR must be a year");
            let parsed = parse_legacy_workbook(Path::new(&path), base_year)
                .expect("external workbook should parse");
            let appointment_count = parsed.appointments.len();
            let profile_count = parsed.profiles.len();
            let yy_channel_count = parsed.yy_channel_count;
            let mut password_probe = None;
            for appointment in &parsed.appointments {
                if password_probe.is_none()
                    && let Some(password) = appointment.account_password.as_ref()
                {
                    password_probe =
                        Some((appointment.import_fingerprint.clone(), password.clone()));
                }
            }
            let profile_password_probe = parsed
                .profiles
                .first()
                .map(|profile| (profile.import_fingerprint.clone(), profile.password.clone()));

            let data_dir = TestDataDir::new(&format!("external-{base_year}"));
            let database = Database::initialize(data_dir.path().join("timekeeper.db"))
                .await
                .expect("initialize temporary database");
            let selection = ExcelImportSelection {
                appointments: true,
                accounts: true,
            };

            let first = commit_excel_import_to_sqlite(&database, parsed.clone(), selection)
                .await
                .expect("first external import should commit")
                .result;
            assert_eq!(first.imported_appointments, appointment_count);
            assert_eq!(first.imported_profiles, profile_count);
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM appointments WHERE voice_platform = 'yy'"
                )
                .fetch_one(database.pool())
                .await
                .unwrap() as usize,
                yy_channel_count
            );

            if let Some((fingerprint, password)) = password_probe {
                let appointment_id = sqlx::query_scalar::<_, String>(
                    "SELECT id FROM appointments WHERE import_fingerprint = ?",
                )
                .bind(fingerprint)
                .fetch_one(database.pool())
                .await
                .unwrap();
                assert_eq!(
                    sqlx::query_scalar::<_, String>(
                        "SELECT password FROM appointment_credentials WHERE appointment_id = ?",
                    )
                    .bind(appointment_id)
                    .fetch_one(database.pool())
                    .await
                    .unwrap(),
                    password,
                );
            }
            if let Some((fingerprint, password)) = profile_password_probe {
                let profile_id = sqlx::query_scalar::<_, String>(
                    "SELECT id FROM account_profiles WHERE import_fingerprint = ?",
                )
                .bind(fingerprint)
                .fetch_one(database.pool())
                .await
                .unwrap();
                assert_eq!(
                    sqlx::query_scalar::<_, String>(
                        "SELECT password FROM account_profile_credentials WHERE profile_id = ?",
                    )
                    .bind(profile_id)
                    .fetch_one(database.pool())
                    .await
                    .unwrap(),
                    password,
                );
            }

            let second = commit_excel_import_to_sqlite(&database, parsed, selection)
                .await
                .expect("repeat import should skip duplicates")
                .result;
            assert_eq!(second.imported_appointments, 0);
            assert_eq!(second.imported_profiles, 0);
            assert_eq!(second.skipped_appointment_duplicates, appointment_count);
            assert_eq!(second.skipped_profile_duplicates, profile_count);

            database.pool().close().await;
            drop(database);
        });
    }
}
