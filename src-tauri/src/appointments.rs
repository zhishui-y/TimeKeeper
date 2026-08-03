use std::{collections::HashSet, str::FromStr};

use chrono::{
    DateTime, Days, Duration, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc,
};
use sqlx::{QueryBuilder, Row, Sqlite, Transaction, sqlite::SqliteRow};
use tauri::{AppHandle, Manager, Runtime, State};
use uuid::Uuid;

use crate::{
    backup::BackupState,
    db::{Database, ImportWriteResult},
    importer::LegacyAppointment,
    models::{
        Appointment, AppointmentAccount, AppointmentAccountCredentialInput,
        AppointmentAccountDetails, AppointmentAccountInput, AppointmentConflict,
        AppointmentFilters, AppointmentInput, AppointmentMode, AppointmentMutationResult,
        ContactPreset, ServiceStatus, SettlementStatus, VoicePlatform,
    },
    notifications::{
        NotificationState, cancel_appointment_notification, schedule_appointment_notification,
    },
    vault::{VaultState, run_blocking_vault_operation},
};

const DATE_FORMAT: &str = "%Y-%m-%d";
const DATE_TIME_FORMAT: &str = "%Y-%m-%dT%H:%M:%S";

fn sync_notification<R: Runtime>(
    app: &AppHandle<R>,
    notifications: &NotificationState,
    appointment: &Appointment,
) {
    let _ = cancel_appointment_notification(notifications, &appointment.id);
    if matches!(
        appointment.service_status,
        ServiceStatus::Completed | ServiceStatus::Cancelled
    ) {
        return;
    }
    let (Some(starts_at), Some(reminder_minutes)) = (
        appointment.starts_at.as_deref(),
        appointment.reminder_minutes,
    ) else {
        return;
    };
    let Ok(naive) = NaiveDateTime::parse_from_str(starts_at, DATE_TIME_FORMAT) else {
        return;
    };
    let Some(offset) = FixedOffset::east_opt(8 * 60 * 60) else {
        return;
    };
    let Some(local_start) = offset.from_local_datetime(&naive).single() else {
        return;
    };
    if local_start.with_timezone(&Utc) <= Utc::now() {
        return;
    }
    let notify_at = (local_start - Duration::minutes(reminder_minutes)).with_timezone(&Utc);
    let body = match appointment.content.as_deref() {
        Some(content) if !content.trim().is_empty() => {
            format!("{} · {}", appointment.contact_name, content.trim())
        }
        _ => appointment.contact_name.clone(),
    };
    let _ = schedule_appointment_notification(
        notifications,
        app.clone(),
        &appointment.id,
        notify_at,
        "预约即将开始",
        &body,
    );
}

pub(crate) async fn restore_pending_notifications<R: Runtime>(
    app: AppHandle<R>,
    database: &Database,
    notifications: &NotificationState,
) -> Result<(), String> {
    let offset = FixedOffset::east_opt(8 * 60 * 60).ok_or("无法创建东八区时区")?;
    let today = Utc::now()
        .with_timezone(&offset)
        .date_naive()
        .format(DATE_FORMAT)
        .to_string();
    let appointments = list_appointments_impl(
        database,
        AppointmentFilters {
            from: Some(today),
            ..AppointmentFilters::default()
        },
    )
    .await?;

    for appointment in appointments {
        sync_notification(&app, notifications, &appointment);
    }
    Ok(())
}

#[derive(Debug)]
struct NormalizedAppointment {
    service_date: String,
    starts_at: Option<String>,
    ends_at: Option<String>,
    contact_name: String,
    content: Option<String>,
    mode: AppointmentMode,
    service_status: ServiceStatus,
    settlement_status: SettlementStatus,
    account: Option<AppointmentAccountInput>,
    voice_platform: Option<VoicePlatform>,
    voice_channel: Option<String>,
    rate_note: Option<String>,
    payment_method: Option<String>,
    amount_minor: Option<i64>,
    reminder_minutes: Option<i64>,
    notes: Option<String>,
}

#[derive(Debug)]
enum SecretAction {
    None,
    Keep,
    Set(String),
    CopyFromAppointment(String),
}

#[derive(Debug)]
struct PreparedAccount {
    account: Option<AppointmentAccount>,
    secret_action: SecretAction,
}

fn optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
}

fn normalize_account_details(
    details: AppointmentAccountDetails,
) -> Result<AppointmentAccountDetails, String> {
    let account_name = details.account_name.trim().to_owned();
    if account_name.is_empty() {
        return Err("临时账号不能为空".into());
    }
    Ok(AppointmentAccountDetails {
        specialization: optional_text(details.specialization),
        gear_score: optional_text(details.gear_score),
        server: optional_text(details.server),
        account_name,
    })
}

fn normalize_account_input(
    account: Option<AppointmentAccountInput>,
) -> Result<Option<AppointmentAccountInput>, String> {
    account
        .map(|account| match account {
            AppointmentAccountInput::Profile { profile_id } => {
                let profile_id = profile_id.trim().to_owned();
                if profile_id.is_empty() {
                    return Err("账号档案 ID 不能为空".into());
                }
                Ok(AppointmentAccountInput::Profile { profile_id })
            }
            AppointmentAccountInput::Embedded {
                details,
                credential,
            } => {
                let details = normalize_account_details(details)?;
                let credential = match credential {
                    AppointmentAccountCredentialInput::Keep => {
                        AppointmentAccountCredentialInput::Keep
                    }
                    AppointmentAccountCredentialInput::Replace { password } => {
                        if password.is_empty() {
                            return Err("临时账号密码不能为空".into());
                        }
                        AppointmentAccountCredentialInput::Replace { password }
                    }
                    AppointmentAccountCredentialInput::CopyFromAppointment {
                        source_appointment_id,
                    } => {
                        let source_appointment_id = source_appointment_id.trim().to_owned();
                        if source_appointment_id.is_empty() {
                            return Err("密码来源预约 ID 不能为空".into());
                        }
                        AppointmentAccountCredentialInput::CopyFromAppointment {
                            source_appointment_id,
                        }
                    }
                };
                Ok(AppointmentAccountInput::Embedded {
                    details,
                    credential,
                })
            }
        })
        .transpose()
}

fn parse_date(value: &str, field: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value.trim(), DATE_FORMAT)
        .map_err(|_| format!("{field}必须使用 YYYY-MM-DD 格式"))
}

fn parse_time(value: &str, field: &str) -> Result<NaiveTime, String> {
    let value = value.trim();
    NaiveTime::parse_from_str(value, "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(value, "%H:%M:%S"))
        .map_err(|_| format!("{field}必须使用 HH:mm 或 HH:mm:ss 格式"))
}

pub fn resolve_time_range(
    service_date: &str,
    start_time: Option<&str>,
    end_time: Option<&str>,
) -> Result<(Option<String>, Option<String>), String> {
    let date = parse_date(service_date, "服务日期")?;
    let start_time = start_time.filter(|value| !value.trim().is_empty());
    let end_time = end_time.filter(|value| !value.trim().is_empty());

    match (start_time, end_time) {
        (None, None) => Ok((None, None)),
        (None, Some(_)) => Err("填写结束时间前必须先填写开始时间".into()),
        (Some(start), None) => {
            let starts_at = date.and_time(parse_time(start, "开始时间")?);
            Ok((Some(starts_at.format(DATE_TIME_FORMAT).to_string()), None))
        }
        (Some(start), Some(end)) => {
            let start = parse_time(start, "开始时间")?;
            let end = parse_time(end, "结束时间")?;
            if start == end {
                return Err("开始时间和结束时间不能相同".into());
            }

            let starts_at = date.and_time(start);
            let end_date = if end < start {
                date.checked_add_days(Days::new(1))
                    .ok_or_else(|| "跨天结束日期超出支持范围".to_string())?
            } else {
                date
            };
            let ends_at = end_date.and_time(end);
            Ok((
                Some(starts_at.format(DATE_TIME_FORMAT).to_string()),
                Some(ends_at.format(DATE_TIME_FORMAT).to_string()),
            ))
        }
    }
}

fn normalize_input(input: AppointmentInput) -> Result<NormalizedAppointment, String> {
    let date = parse_date(&input.service_date, "服务日期")?;
    let contact_name = input.contact_name.trim().to_owned();
    if contact_name.is_empty() {
        return Err("联系人不能为空".into());
    }

    if input.amount_minor.is_some_and(|amount| amount < 0) {
        return Err("金额不能为负数".into());
    }
    if input.reminder_minutes.is_some_and(|minutes| minutes < 0) {
        return Err("提醒分钟数不能为负数".into());
    }

    let (starts_at, ends_at) = resolve_time_range(
        &date.format(DATE_FORMAT).to_string(),
        input.start_time.as_deref(),
        input.end_time.as_deref(),
    )?;

    let (settlement_status, rate_note, payment_method, amount_minor) = match input.mode {
        AppointmentMode::Entertainment => (SettlementStatus::NotApplicable, None, None, None),
        AppointmentMode::Business => {
            if input.settlement_status == SettlementStatus::NotApplicable {
                return Err("业务预约的结算状态必须是未结算或已结算".into());
            }
            if input.settlement_status == SettlementStatus::Settled && input.amount_minor.is_none()
            {
                return Err("已结算预约必须填写金额".into());
            }
            (
                input.settlement_status,
                optional_text(input.rate_note),
                optional_text(input.payment_method),
                input.amount_minor,
            )
        }
    };

    let voice_channel = optional_text(input.voice_channel);
    let (voice_platform, voice_channel) = match input.voice_platform {
        None => (None, None),
        Some(VoicePlatform::Qq) => (Some(VoicePlatform::Qq), None),
        Some(VoicePlatform::Yy) => {
            if voice_channel
                .as_deref()
                .is_some_and(|channel| !channel.chars().all(|character| character.is_ascii_digit()))
            {
                return Err("YY 频道号码只能包含数字".into());
            }
            (Some(VoicePlatform::Yy), voice_channel)
        }
    };

    Ok(NormalizedAppointment {
        service_date: date.format(DATE_FORMAT).to_string(),
        starts_at,
        ends_at,
        contact_name,
        content: optional_text(input.content),
        mode: input.mode,
        service_status: input.service_status,
        settlement_status,
        account: normalize_account_input(input.account)?,
        voice_platform,
        voice_channel,
        rate_note,
        payment_method,
        amount_minor,
        reminder_minutes: input.reminder_minutes,
        notes: optional_text(input.notes),
    })
}

fn db_error(error: sqlx::Error) -> String {
    format!("数据库操作失败: {error}")
}

pub(crate) fn appointment_from_row(row: &SqliteRow) -> Result<Appointment, String> {
    let mode = AppointmentMode::from_str(&row.try_get::<String, _>("mode").map_err(db_error)?)?;
    let service_status = ServiceStatus::from_str(
        &row.try_get::<String, _>("service_status")
            .map_err(db_error)?,
    )?;
    let settlement_status = SettlementStatus::from_str(
        &row.try_get::<String, _>("settlement_status")
            .map_err(db_error)?,
    )?;
    let account_name: Option<String> = row.try_get("account_name").map_err(db_error)?;
    let account = account_name
        .map(|account_name| {
            Ok::<AppointmentAccount, String>(AppointmentAccount {
                specialization: row.try_get("account_specialization").map_err(db_error)?,
                gear_score: row.try_get("account_gear_score").map_err(db_error)?,
                server: row.try_get("account_server").map_err(db_error)?,
                account_name,
                password_available: row
                    .try_get::<i64, _>("account_password_available")
                    .map_err(db_error)?
                    != 0,
            })
        })
        .transpose()?;
    let voice_platform = row
        .try_get::<Option<String>, _>("voice_platform")
        .map_err(db_error)?
        .map(|value| VoicePlatform::from_str(&value))
        .transpose()?;

    Ok(Appointment {
        id: row.try_get("id").map_err(db_error)?,
        service_date: row.try_get("service_date").map_err(db_error)?,
        starts_at: row.try_get("starts_at").map_err(db_error)?,
        ends_at: row.try_get("ends_at").map_err(db_error)?,
        contact_name: row.try_get("contact_name").map_err(db_error)?,
        content: row.try_get("content").map_err(db_error)?,
        mode,
        service_status,
        settlement_status,
        account,
        voice_platform,
        voice_channel: row.try_get("voice_channel").map_err(db_error)?,
        rate_note: row.try_get("rate_note").map_err(db_error)?,
        payment_method: row.try_get("payment_method").map_err(db_error)?,
        amount_minor: row.try_get("amount_minor").map_err(db_error)?,
        reminder_minutes: row.try_get("reminder_minutes").map_err(db_error)?,
        notes: row.try_get("notes").map_err(db_error)?,
        import_fingerprint: row.try_get("import_fingerprint").map_err(db_error)?,
        created_at: row.try_get("created_at").map_err(db_error)?,
        updated_at: row.try_get("updated_at").map_err(db_error)?,
    })
}

async fn load_profile_account_details(
    database: &Database,
    account_profile_id: &str,
) -> Result<AppointmentAccountDetails, String> {
    let row = sqlx::query(
        "SELECT account_name, server, specialization, gear_score
         FROM account_profiles WHERE id = ?",
    )
    .bind(account_profile_id)
    .fetch_optional(database.pool())
    .await
    .map_err(db_error)?
    .ok_or_else(|| format!("关联的账号档案不存在: {account_profile_id}"))?;

    Ok(AppointmentAccountDetails {
        specialization: row.try_get("specialization").map_err(db_error)?,
        gear_score: row.try_get("gear_score").map_err(db_error)?,
        server: row.try_get("server").map_err(db_error)?,
        account_name: row.try_get("account_name").map_err(db_error)?,
    })
}

async fn find_conflicts(
    database: &Database,
    starts_at: Option<&str>,
    ends_at: Option<&str>,
    excluded_id: Option<&str>,
) -> Result<Vec<AppointmentConflict>, String> {
    let (Some(starts_at), Some(ends_at)) = (starts_at, ends_at) else {
        return Ok(Vec::new());
    };

    let rows = sqlx::query(
        "SELECT id, contact_name, starts_at, ends_at
         FROM appointments
         WHERE service_status != 'cancelled'
           AND starts_at IS NOT NULL
           AND ends_at IS NOT NULL
           AND starts_at < ?
           AND ends_at > ?
           AND (? IS NULL OR id != ?)
         ORDER BY starts_at, id",
    )
    .bind(ends_at)
    .bind(starts_at)
    .bind(excluded_id)
    .bind(excluded_id)
    .fetch_all(database.pool())
    .await
    .map_err(db_error)?;

    rows.iter()
        .map(|row| {
            Ok(AppointmentConflict {
                id: row.try_get("id").map_err(db_error)?,
                contact_name: row.try_get("contact_name").map_err(db_error)?,
                starts_at: row.try_get("starts_at").map_err(db_error)?,
                ends_at: row.try_get("ends_at").map_err(db_error)?,
            })
        })
        .collect()
}

fn validate_filter_date(value: Option<&String>, field: &str) -> Result<(), String> {
    if let Some(value) = value {
        parse_date(value, field)?;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_appointments(
    database: State<'_, Database>,
    filters: AppointmentFilters,
) -> Result<Vec<Appointment>, String> {
    list_appointments_impl(database.inner(), filters).await
}

pub(crate) async fn list_appointments_impl(
    database: &Database,
    filters: AppointmentFilters,
) -> Result<Vec<Appointment>, String> {
    validate_filter_date(filters.from.as_ref(), "开始日期")?;
    validate_filter_date(filters.to.as_ref(), "结束日期")?;
    if let (Some(from), Some(to)) = (&filters.from, &filters.to)
        && from > to
    {
        return Err("开始日期不能晚于结束日期".into());
    }

    let mut builder = QueryBuilder::<Sqlite>::new("SELECT * FROM appointments WHERE 1 = 1");
    if let Some(from) = filters.from {
        builder.push(" AND service_date >= ").push_bind(from);
    }
    if let Some(to) = filters.to {
        builder.push(" AND service_date <= ").push_bind(to);
    }
    if let Some(query) = optional_text(filters.query) {
        let pattern = format!("%{}%", query.to_lowercase());
        builder
            .push(" AND (lower(contact_name) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(content, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(notes, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(account_name, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(account_server, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(account_specialization, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(account_gear_score, '')) LIKE ")
            .push_bind(pattern)
            .push(")");
    }
    if let Some(mode) = filters.mode {
        builder.push(" AND mode = ").push_bind(mode.as_str());
    }
    if let Some(status) = filters.service_status {
        builder
            .push(" AND service_status = ")
            .push_bind(status.as_str());
    }
    if let Some(status) = filters.settlement_status {
        builder
            .push(" AND settlement_status = ")
            .push_bind(status.as_str());
    }
    builder.push(
        " ORDER BY service_date DESC,
          CASE WHEN starts_at IS NULL THEN 1 ELSE 0 END,
          starts_at DESC, created_at DESC",
    );

    builder
        .build()
        .fetch_all(database.pool())
        .await
        .map_err(db_error)?
        .iter()
        .map(appointment_from_row)
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_contact_presets(
    database: State<'_, Database>,
    query: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ContactPreset>, String> {
    list_contact_presets_impl(database.inner(), query, limit).await
}

pub(crate) async fn list_contact_presets_impl(
    database: &Database,
    query: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ContactPreset>, String> {
    let limit = limit.unwrap_or(10);
    if !(1..=50).contains(&limit) {
        return Err("联系人模板数量必须在 1 到 50 之间".into());
    }
    let query = optional_text(query);
    let pattern = query.as_ref().map(|query| format!("%{query}%"));
    let rows = sqlx::query(
        "WITH ranked AS (
            SELECT appointments.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY contact_name COLLATE NOCASE
                       ORDER BY service_date DESC,
                                CASE WHEN starts_at IS NULL THEN 1 ELSE 0 END,
                                starts_at DESC,
                                created_at DESC,
                                id DESC
                   ) AS contact_rank
            FROM appointments
            WHERE service_status != 'cancelled'
              AND (? IS NULL OR contact_name LIKE ?)
         )
         SELECT * FROM ranked
         WHERE contact_rank = 1
         ORDER BY service_date DESC,
                  CASE WHEN starts_at IS NULL THEN 1 ELSE 0 END,
                  starts_at DESC,
                  created_at DESC,
                  id DESC
         LIMIT ?",
    )
    .bind(pattern.as_deref())
    .bind(pattern.as_deref())
    .bind(limit)
    .fetch_all(database.pool())
    .await
    .map_err(db_error)?;

    rows.iter()
        .map(|row| {
            let appointment = appointment_from_row(row)?;
            Ok(ContactPreset {
                source_appointment_id: appointment.id,
                contact_name: appointment.contact_name,
                start_time: appointment
                    .starts_at
                    .as_deref()
                    .map(time_component)
                    .transpose()?,
                end_time: appointment
                    .ends_at
                    .as_deref()
                    .map(time_component)
                    .transpose()?,
                content: appointment.content,
                mode: appointment.mode,
                account: appointment.account,
                rate_note: appointment.rate_note,
                payment_method: appointment.payment_method,
                amount_minor: appointment.amount_minor,
                reminder_minutes: appointment.reminder_minutes,
                notes: appointment.notes,
                voice_platform: appointment.voice_platform,
                voice_channel: appointment.voice_channel,
            })
        })
        .collect()
}

fn time_component(value: &str) -> Result<String, String> {
    Ok(parse_date_time(value)?
        .time()
        .format("%H:%M:%S")
        .to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_appointment(
    database: State<'_, Database>,
    id: String,
) -> Result<Appointment, String> {
    get_appointment_impl(database.inner(), &id).await
}

pub(crate) async fn get_appointment_impl(
    database: &Database,
    id: &str,
) -> Result<Appointment, String> {
    let row = sqlx::query("SELECT * FROM appointments WHERE id = ?")
        .bind(id)
        .fetch_optional(database.pool())
        .await
        .map_err(db_error)?
        .ok_or_else(|| format!("预约不存在: {id}"))?;
    appointment_from_row(&row)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_appointment<R: Runtime>(
    app: AppHandle<R>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
    input: AppointmentInput,
) -> Result<AppointmentMutationResult, String> {
    let _operation_guard = backup.lock_data_operation().await;
    let vault = app.state::<VaultState>().inner().clone();
    let result = create_appointment_with_vault(&vault, database.inner(), input).await?;
    sync_notification(&app, notifications.inner(), &result.appointment);
    Ok(result)
}

async fn prepare_account(
    vault: &VaultState,
    database: &Database,
    input: Option<AppointmentAccountInput>,
    existing: Option<&AppointmentAccount>,
) -> Result<PreparedAccount, String> {
    match input {
        None => Ok(PreparedAccount {
            account: None,
            secret_action: SecretAction::None,
        }),
        Some(AppointmentAccountInput::Profile { profile_id }) => {
            let details = normalize_account_details(
                load_profile_account_details(database, &profile_id).await?,
            )?;
            let worker_vault = vault.clone();
            let secret_id = profile_id.clone();
            let password =
                run_blocking_vault_operation(move || worker_vault.get_secret(&secret_id)).await?;
            Ok(PreparedAccount {
                account: Some(AppointmentAccount {
                    specialization: details.specialization,
                    gear_score: details.gear_score,
                    server: details.server,
                    account_name: details.account_name,
                    password_available: true,
                }),
                secret_action: SecretAction::Set(password),
            })
        }
        Some(AppointmentAccountInput::Embedded {
            details,
            credential,
        }) => {
            let (password_available, secret_action) = match credential {
                AppointmentAccountCredentialInput::Keep => {
                    let existing =
                        existing.ok_or("新建预约或原预约没有账号时，临时账号必须填写密码")?;
                    (existing.password_available, SecretAction::Keep)
                }
                AppointmentAccountCredentialInput::Replace { password } => {
                    (true, SecretAction::Set(password))
                }
                AppointmentAccountCredentialInput::CopyFromAppointment {
                    source_appointment_id,
                } => {
                    let source = get_appointment_impl(database, &source_appointment_id).await?;
                    if !source
                        .account
                        .as_ref()
                        .is_some_and(|account| account.password_available)
                    {
                        return Err("来源预约没有可沿用的账号密码".into());
                    }
                    (
                        true,
                        SecretAction::CopyFromAppointment(source_appointment_id),
                    )
                }
            };
            Ok(PreparedAccount {
                account: Some(AppointmentAccount {
                    specialization: details.specialization,
                    gear_score: details.gear_score,
                    server: details.server,
                    account_name: details.account_name,
                    password_available,
                }),
                secret_action,
            })
        }
    }
}

async fn apply_secret_action(
    vault: &VaultState,
    appointment_id: &str,
    action: &SecretAction,
    existing_password_available: bool,
) -> Result<Option<Option<String>>, String> {
    match action {
        SecretAction::Keep => Ok(None),
        SecretAction::None if !existing_password_available => Ok(None),
        SecretAction::None => {
            let worker_vault = vault.clone();
            let appointment_id = appointment_id.to_owned();
            run_blocking_vault_operation(move || {
                worker_vault
                    .remove_appointment_secret(&appointment_id)
                    .map(Some)
            })
            .await
        }
        SecretAction::Set(password) => {
            let worker_vault = vault.clone();
            let appointment_id = appointment_id.to_owned();
            let password = password.clone();
            run_blocking_vault_operation(move || {
                worker_vault
                    .set_appointment_secret(&appointment_id, password)
                    .map(Some)
            })
            .await
        }
        SecretAction::CopyFromAppointment(source_id) => {
            let worker_vault = vault.clone();
            let appointment_id = appointment_id.to_owned();
            let source_id = source_id.clone();
            run_blocking_vault_operation(move || {
                worker_vault
                    .copy_appointment_secret(&source_id, &appointment_id)
                    .map(Some)
            })
            .await
        }
    }
}

async fn restore_secret_action(
    vault: &VaultState,
    appointment_id: String,
    change: Option<Option<String>>,
) -> Result<(), String> {
    let Some(previous) = change else {
        return Ok(());
    };
    let worker_vault = vault.clone();
    run_blocking_vault_operation(move || match previous {
        Some(password) => worker_vault
            .set_appointment_secret(&appointment_id, password)
            .map(|_| ()),
        None => worker_vault
            .remove_appointment_secret(&appointment_id)
            .map(|_| ()),
    })
    .await
}

fn should_clear_password_backfill(prepared: &PreparedAccount) -> bool {
    !matches!(prepared.secret_action, SecretAction::Keep)
        || prepared
            .account
            .as_ref()
            .is_some_and(|account| account.password_available)
}

async fn insert_normalized_appointment(
    transaction: &mut Transaction<'_, Sqlite>,
    id: &str,
    input: &NormalizedAppointment,
    account: Option<&AppointmentAccount>,
    now: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO appointments (
            id, service_date, starts_at, ends_at, contact_name, content, mode,
            service_status, settlement_status,
            account_specialization, account_gear_score, account_server, account_name,
            account_password_available, voice_platform, voice_channel,
            rate_note, payment_method, amount_minor, reminder_minutes, notes,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(&input.service_date)
    .bind(&input.starts_at)
    .bind(&input.ends_at)
    .bind(&input.contact_name)
    .bind(&input.content)
    .bind(input.mode.as_str())
    .bind(input.service_status.as_str())
    .bind(input.settlement_status.as_str())
    .bind(account.and_then(|account| account.specialization.as_deref()))
    .bind(account.and_then(|account| account.gear_score.as_deref()))
    .bind(account.and_then(|account| account.server.as_deref()))
    .bind(account.map(|account| account.account_name.as_str()))
    .bind(i64::from(
        account.is_some_and(|account| account.password_available),
    ))
    .bind(input.voice_platform.map(VoicePlatform::as_str))
    .bind(&input.voice_channel)
    .bind(&input.rate_note)
    .bind(&input.payment_method)
    .bind(input.amount_minor)
    .bind(input.reminder_minutes)
    .bind(&input.notes)
    .bind(now)
    .bind(now)
    .execute(&mut **transaction)
    .await
    .map_err(db_error)?;
    Ok(())
}

async fn finish_mutation_result(
    database: &Database,
    id: &str,
) -> Result<AppointmentMutationResult, String> {
    let appointment = get_appointment_impl(database, id).await?;
    let conflicts = find_conflicts(
        database,
        appointment.starts_at.as_deref(),
        appointment.ends_at.as_deref(),
        Some(id),
    )
    .await?;
    Ok(AppointmentMutationResult {
        appointment,
        conflicts,
    })
}

fn next_unique_updated_at(previous: &str) -> String {
    let now = Utc::now();
    let candidate = DateTime::parse_from_rfc3339(previous)
        .ok()
        .map(|value| value.with_timezone(&Utc))
        .filter(|value| *value >= now)
        .and_then(|value| value.checked_add_signed(Duration::nanoseconds(1)))
        .unwrap_or(now);
    candidate.to_rfc3339()
}

fn appointment_matches_update(
    appointment: &Appointment,
    input: &NormalizedAppointment,
    account: Option<&AppointmentAccount>,
    updated_at: &str,
) -> bool {
    appointment.service_date == input.service_date
        && appointment.starts_at == input.starts_at
        && appointment.ends_at == input.ends_at
        && appointment.contact_name == input.contact_name
        && appointment.content == input.content
        && appointment.mode == input.mode
        && appointment.service_status == input.service_status
        && appointment.settlement_status == input.settlement_status
        && appointment.account.as_ref() == account
        && appointment.voice_platform == input.voice_platform
        && appointment.voice_channel == input.voice_channel
        && appointment.rate_note == input.rate_note
        && appointment.payment_method == input.payment_method
        && appointment.amount_minor == input.amount_minor
        && appointment.reminder_minutes == input.reminder_minutes
        && appointment.notes == input.notes
        && appointment.updated_at == updated_at
}

async fn appointment_exists_after_commit(database: &Database, id: &str) -> Result<bool, String> {
    let mut connection = database
        .pool()
        .acquire()
        .await
        .map_err(|error| format!("获取预约提交对账连接失败：{error}"))?;
    sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM appointments WHERE id = ?)")
        .bind(id)
        .fetch_one(&mut *connection)
        .await
        .map(|exists| exists != 0)
        .map_err(|error| format!("查询预约提交状态失败：{error}"))
}

async fn appointment_after_commit(
    database: &Database,
    id: &str,
) -> Result<Option<Appointment>, String> {
    let mut connection = database
        .pool()
        .acquire()
        .await
        .map_err(|error| format!("获取预约提交对账连接失败：{error}"))?;
    let row = sqlx::query("SELECT * FROM appointments WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *connection)
        .await
        .map_err(|error| format!("查询预约提交状态失败：{error}"))?;
    row.as_ref().map(appointment_from_row).transpose()
}

async fn existing_appointment_ids_after_commit(
    database: &Database,
    ids: &[String],
) -> Result<HashSet<String>, String> {
    let mut connection = database
        .pool()
        .acquire()
        .await
        .map_err(|error| format!("获取预约删除对账连接失败：{error}"))?;
    let mut existing = HashSet::new();
    for id in ids {
        let exists =
            sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM appointments WHERE id = ?)")
                .bind(id)
                .fetch_one(&mut *connection)
                .await
                .map_err(|error| format!("查询预约 {id} 的删除状态失败：{error}"))?;
        if exists != 0 {
            existing.insert(id.clone());
        }
    }
    Ok(existing)
}

async fn reconcile_create_commit_error(
    vault: &VaultState,
    database: &Database,
    id: &str,
    secret_change: Option<Option<String>>,
    commit_error: sqlx::Error,
) -> Result<AppointmentMutationResult, String> {
    let primary = format!("提交预约创建事务失败：{commit_error}");
    match appointment_exists_after_commit(database, id).await {
        Ok(true) => finish_mutation_result(database, id).await.map_err(|error| {
            format!("{primary}；已确认预约实际写入并保留预约密码，但读取预约结果失败：{error}")
        }),
        Ok(false) => {
            let restore_error = restore_secret_action(vault, id.to_owned(), secret_change)
                .await
                .err();
            Err(compensation_error(
                format!("{primary}；已确认预约未写入，已按未提交状态恢复预约密码"),
                None,
                restore_error,
            ))
        }
        Err(reconcile_error) => Err(format!(
            "{primary}；通过新连接确认创建结果失败：{reconcile_error}；数据库与预约密码状态不确定"
        )),
    }
}

struct ExpectedAppointmentUpdate<'a> {
    input: &'a NormalizedAppointment,
    account: Option<&'a AppointmentAccount>,
    updated_at: &'a str,
}

async fn reconcile_update_commit_error(
    vault: &VaultState,
    database: &Database,
    id: &str,
    expected: ExpectedAppointmentUpdate<'_>,
    secret_change: Option<Option<String>>,
    commit_error: sqlx::Error,
) -> Result<AppointmentMutationResult, String> {
    let primary = format!("提交预约更新事务失败：{commit_error}");
    match appointment_after_commit(database, id).await {
        Ok(Some(appointment))
            if appointment_matches_update(
                &appointment,
                expected.input,
                expected.account,
                expected.updated_at,
            ) =>
        {
            finish_mutation_result(database, id).await.map_err(|error| {
                format!(
                    "{primary}；已通过唯一更新时间及完整状态确认更新实际写入并保留预约密码，但读取预约结果失败：{error}"
                )
            })
        }
        Ok(_) => {
            let restore_error = restore_secret_action(vault, id.to_owned(), secret_change)
                .await
                .err();
            Err(compensation_error(
                format!(
                    "{primary}；完整状态对账确认本次更新未提交，已恢复更新前的预约密码"
                ),
                None,
                restore_error,
            ))
        }
        Err(reconcile_error) => Err(format!(
            "{primary}；通过新连接确认更新结果失败：{reconcile_error}；数据库与预约密码状态不确定"
        )),
    }
}

fn removed_secrets_for_existing_appointments(
    removed: Vec<(String, Option<String>)>,
    existing_ids: &HashSet<String>,
) -> Vec<(String, Option<String>)> {
    removed
        .into_iter()
        .filter(|(id, _)| existing_ids.contains(id))
        .collect()
}

async fn reconcile_delete_commit_error(
    vault: &VaultState,
    database: &Database,
    affected_ids: &[String],
    removed_secrets: Vec<(String, Option<String>)>,
    deleted: usize,
    commit_error: sqlx::Error,
) -> Result<usize, String> {
    let primary = format!("提交预约删除事务失败：{commit_error}");
    let existing_ids = existing_appointment_ids_after_commit(database, affected_ids)
        .await
        .map_err(|reconcile_error| {
            format!(
                "{primary}；通过新连接逐项确认删除结果失败：{reconcile_error}；数据库与预约密码状态不确定"
            )
        })?;
    if existing_ids.is_empty() {
        return Ok(deleted);
    }

    let confirmed_deleted = affected_ids.len().saturating_sub(existing_ids.len());
    let secrets_to_restore =
        removed_secrets_for_existing_appointments(removed_secrets, &existing_ids);
    let restore_error = restore_removed_secrets(vault, secrets_to_restore)
        .await
        .err();
    Err(compensation_error(
        format!(
            "{primary}；逐项对账确认 {confirmed_deleted} 条已删除、{} 条仍存在，已恢复仍存在预约的密码",
            existing_ids.len()
        ),
        None,
        restore_error,
    ))
}

pub(crate) async fn create_appointment_with_vault(
    vault: &VaultState,
    database: &Database,
    input: AppointmentInput,
) -> Result<AppointmentMutationResult, String> {
    let mut input = normalize_input(input)?;
    let prepared = prepare_account(vault, database, input.account.take(), None).await?;
    create_prepared_appointment(vault, database, input, prepared).await
}

async fn create_prepared_appointment(
    vault: &VaultState,
    database: &Database,
    input: NormalizedAppointment,
    prepared: PreparedAccount,
) -> Result<AppointmentMutationResult, String> {
    let id = Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339();
    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let secret_change = match apply_secret_action(vault, &id, &prepared.secret_action, false).await
    {
        Ok(change) => change,
        Err(error) => {
            let _ = transaction.rollback().await;
            return Err(error);
        }
    };
    if let Err(error) = insert_normalized_appointment(
        &mut transaction,
        &id,
        &input,
        prepared.account.as_ref(),
        &now,
    )
    .await
    {
        let rollback_error = transaction.rollback().await.err();
        let restore_error = restore_secret_action(vault, id.clone(), secret_change)
            .await
            .err();
        return Err(compensation_error(error, rollback_error, restore_error));
    }
    if let Err(error) = transaction.commit().await {
        return reconcile_create_commit_error(vault, database, &id, secret_change, error).await;
    }
    finish_mutation_result(database, &id).await
}

#[cfg(test)]
pub(crate) async fn create_appointment_impl(
    database: &Database,
    input: AppointmentInput,
) -> Result<AppointmentMutationResult, String> {
    let input = normalize_input(input)?;
    if input.account.is_some() {
        return Err("该内部调用不支持账号密码，请使用保险库预约写入流程".into());
    }
    let id = Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339();
    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    insert_normalized_appointment(&mut transaction, &id, &input, None, &now).await?;
    transaction.commit().await.map_err(db_error)?;
    finish_mutation_result(database, &id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_appointment<R: Runtime>(
    app: AppHandle<R>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
    id: String,
    input: AppointmentInput,
) -> Result<AppointmentMutationResult, String> {
    let _operation_guard = backup.lock_data_operation().await;
    let vault = app.state::<VaultState>().inner().clone();
    let result = update_appointment_with_vault(&vault, database.inner(), &id, input).await?;
    sync_notification(&app, notifications.inner(), &result.appointment);
    Ok(result)
}

pub(crate) async fn update_appointment_with_vault(
    vault: &VaultState,
    database: &Database,
    id: &str,
    input: AppointmentInput,
) -> Result<AppointmentMutationResult, String> {
    let existing = get_appointment_impl(database, id).await?;
    let mut input = normalize_input(input)?;
    let prepared = prepare_account(
        vault,
        database,
        input.account.take(),
        existing.account.as_ref(),
    )
    .await?;
    let now = next_unique_updated_at(&existing.updated_at);
    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let secret_change = match apply_secret_action(
        vault,
        id,
        &prepared.secret_action,
        existing
            .account
            .as_ref()
            .is_some_and(|account| account.password_available),
    )
    .await
    {
        Ok(change) => change,
        Err(error) => {
            let _ = transaction.rollback().await;
            return Err(error);
        }
    };
    let account = prepared.account.as_ref();
    let result = sqlx::query(
        "UPDATE appointments SET
            service_date = ?, starts_at = ?, ends_at = ?, contact_name = ?, content = ?,
            mode = ?, service_status = ?, settlement_status = ?,
            account_specialization = ?, account_gear_score = ?, account_server = ?,
            account_name = ?, account_password_available = ?,
            voice_platform = ?, voice_channel = ?, rate_note = ?, payment_method = ?,
            amount_minor = ?, reminder_minutes = ?, notes = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(&input.service_date)
    .bind(&input.starts_at)
    .bind(&input.ends_at)
    .bind(&input.contact_name)
    .bind(&input.content)
    .bind(input.mode.as_str())
    .bind(input.service_status.as_str())
    .bind(input.settlement_status.as_str())
    .bind(account.and_then(|account| account.specialization.as_deref()))
    .bind(account.and_then(|account| account.gear_score.as_deref()))
    .bind(account.and_then(|account| account.server.as_deref()))
    .bind(account.map(|account| account.account_name.as_str()))
    .bind(i64::from(
        account.is_some_and(|account| account.password_available),
    ))
    .bind(input.voice_platform.map(VoicePlatform::as_str))
    .bind(&input.voice_channel)
    .bind(&input.rate_note)
    .bind(&input.payment_method)
    .bind(input.amount_minor)
    .bind(input.reminder_minutes)
    .bind(&input.notes)
    .bind(&now)
    .bind(id)
    .execute(&mut *transaction)
    .await;
    let result = match result {
        Ok(result) if result.rows_affected() == 1 => result,
        Ok(_) => {
            let _ = transaction.rollback().await;
            let restore_error = restore_secret_action(vault, id.to_owned(), secret_change)
                .await
                .err();
            return Err(compensation_error(
                format!("预约不存在: {id}"),
                None,
                restore_error,
            ));
        }
        Err(error) => {
            let primary = db_error(error);
            let rollback_error = transaction.rollback().await.err();
            let restore_error = restore_secret_action(vault, id.to_owned(), secret_change)
                .await
                .err();
            return Err(compensation_error(primary, rollback_error, restore_error));
        }
    };
    debug_assert_eq!(result.rows_affected(), 1);
    if should_clear_password_backfill(&prepared)
        && let Err(error) =
            sqlx::query("DELETE FROM appointment_password_backfill WHERE appointment_id = ?")
                .bind(id)
                .execute(&mut *transaction)
                .await
    {
        let primary = format!("清理预约密码迁移记录失败：{error}");
        let rollback_error = transaction.rollback().await.err();
        let restore_error = restore_secret_action(vault, id.to_owned(), secret_change)
            .await
            .err();
        return Err(compensation_error(primary, rollback_error, restore_error));
    }
    if let Err(error) = transaction.commit().await {
        return reconcile_update_commit_error(
            vault,
            database,
            id,
            ExpectedAppointmentUpdate {
                input: &input,
                account: prepared.account.as_ref(),
                updated_at: &now,
            },
            secret_change,
            error,
        )
        .await;
    }
    finish_mutation_result(database, id).await
}

#[cfg(test)]
pub(crate) async fn update_appointment_impl(
    database: &Database,
    id: &str,
    input: AppointmentInput,
) -> Result<AppointmentMutationResult, String> {
    let existing = get_appointment_impl(database, id).await?;
    if existing.account.is_some() {
        return Err("带账号的预约必须通过保险库更新流程修改".into());
    }
    let input = normalize_input(input)?;
    if input.account.is_some() {
        return Err("该测试辅助调用不支持账号密码".into());
    }
    let now = Utc::now().to_rfc3339();
    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let result = sqlx::query(
        "UPDATE appointments SET
            service_date = ?, starts_at = ?, ends_at = ?, contact_name = ?, content = ?,
            mode = ?, service_status = ?, settlement_status = ?,
            voice_platform = ?, voice_channel = ?, rate_note = ?, payment_method = ?,
            amount_minor = ?, reminder_minutes = ?, notes = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(&input.service_date)
    .bind(&input.starts_at)
    .bind(&input.ends_at)
    .bind(&input.contact_name)
    .bind(&input.content)
    .bind(input.mode.as_str())
    .bind(input.service_status.as_str())
    .bind(input.settlement_status.as_str())
    .bind(input.voice_platform.map(VoicePlatform::as_str))
    .bind(&input.voice_channel)
    .bind(&input.rate_note)
    .bind(&input.payment_method)
    .bind(input.amount_minor)
    .bind(input.reminder_minutes)
    .bind(&input.notes)
    .bind(now)
    .bind(id)
    .execute(&mut *transaction)
    .await
    .map_err(db_error)?;
    if result.rows_affected() == 0 {
        return Err(format!("预约不存在: {id}"));
    }
    sqlx::query("DELETE FROM appointment_password_backfill WHERE appointment_id = ?")
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(db_error)?;
    transaction.commit().await.map_err(db_error)?;
    finish_mutation_result(database, id).await
}

fn compensation_error(
    primary: String,
    rollback_error: Option<sqlx::Error>,
    restore_error: Option<String>,
) -> String {
    let mut error = primary;
    if let Some(rollback_error) = rollback_error {
        error.push_str(&format!("；回滚数据库事务失败：{rollback_error}"));
    }
    if let Some(restore_error) = restore_error {
        error.push_str(&format!("；恢复预约密码失败：{restore_error}"));
    }
    error
}

#[tauri::command(rename_all = "camelCase")]
pub async fn duplicate_appointment<R: Runtime>(
    app: AppHandle<R>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
    id: String,
    service_date: Option<String>,
) -> Result<AppointmentMutationResult, String> {
    let _operation_guard = backup.lock_data_operation().await;
    let vault = app.state::<VaultState>().inner().clone();
    let result =
        duplicate_appointment_with_vault(&vault, database.inner(), &id, service_date).await?;
    sync_notification(&app, notifications.inner(), &result.appointment);
    Ok(result)
}

pub(crate) async fn duplicate_appointment_with_vault(
    vault: &VaultState,
    database: &Database,
    id: &str,
    service_date: Option<String>,
) -> Result<AppointmentMutationResult, String> {
    let source = get_appointment_impl(database, id).await?;
    ensure_password_backfill_complete(database, id).await?;
    let input = normalize_input(duplicate_input(&source, service_date)?)?;
    let prepared = match source.account {
        Some(account) => {
            let secret_action = if account.password_available {
                SecretAction::CopyFromAppointment(source.id)
            } else {
                SecretAction::None
            };
            PreparedAccount {
                account: Some(account),
                secret_action,
            }
        }
        None => PreparedAccount {
            account: None,
            secret_action: SecretAction::None,
        },
    };
    create_prepared_appointment(vault, database, input, prepared).await
}

async fn ensure_password_backfill_complete(
    database: &Database,
    appointment_id: &str,
) -> Result<(), String> {
    let password_backfill_pending = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM appointment_password_backfill WHERE appointment_id = ?",
    )
    .bind(appointment_id)
    .fetch_one(database.pool())
    .await
    .map_err(db_error)?
        > 0;
    if password_backfill_pending {
        return Err("该预约的历史账号密码尚待迁移，请先解锁保险库后再重复预约".into());
    }
    Ok(())
}

fn duplicate_input(
    source: &Appointment,
    service_date: Option<String>,
) -> Result<AppointmentInput, String> {
    let start_time = source
        .starts_at
        .as_deref()
        .map(|value| {
            parse_date_time(value).map(|value| value.time().format("%H:%M:%S").to_string())
        })
        .transpose()?;
    let end_time = source
        .ends_at
        .as_deref()
        .map(|value| {
            parse_date_time(value).map(|value| value.time().format("%H:%M:%S").to_string())
        })
        .transpose()?;
    let settlement_status = match source.mode {
        AppointmentMode::Entertainment => SettlementStatus::NotApplicable,
        AppointmentMode::Business => SettlementStatus::Unsettled,
    };

    Ok(AppointmentInput {
        service_date: service_date.unwrap_or_else(|| source.service_date.clone()),
        start_time,
        end_time,
        contact_name: source.contact_name.clone(),
        content: source.content.clone(),
        mode: source.mode,
        service_status: ServiceStatus::Scheduled,
        settlement_status,
        account: None,
        voice_platform: source.voice_platform,
        voice_channel: source.voice_channel.clone(),
        rate_note: source.rate_note.clone(),
        payment_method: source.payment_method.clone(),
        amount_minor: source.amount_minor,
        reminder_minutes: source.reminder_minutes,
        notes: source.notes.clone(),
    })
}

#[cfg(test)]
pub(crate) async fn duplicate_appointment_impl(
    database: &Database,
    id: &str,
    service_date: Option<String>,
) -> Result<AppointmentMutationResult, String> {
    let source = get_appointment_impl(database, id).await?;
    ensure_password_backfill_complete(database, id).await?;
    let input = normalize_input(duplicate_input(&source, service_date)?)?;
    let account = source.account.map(|mut account| {
        account.password_available = false;
        account
    });
    let id = Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339();
    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    insert_normalized_appointment(&mut transaction, &id, &input, account.as_ref(), &now).await?;
    transaction.commit().await.map_err(db_error)?;
    finish_mutation_result(database, &id).await
}

fn parse_date_time(value: &str) -> Result<NaiveDateTime, String> {
    NaiveDateTime::parse_from_str(value, DATE_TIME_FORMAT)
        .map_err(|_| format!("预约时间数据损坏: {value}"))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_appointment<R: Runtime>(
    app: AppHandle<R>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
    id: String,
) -> Result<(), String> {
    let _operation_guard = backup.lock_data_operation().await;
    let vault = app.state::<VaultState>().inner().clone();
    let deleted =
        delete_appointments_with_vault(&vault, database.inner(), std::slice::from_ref(&id)).await?;
    if deleted == 0 {
        return Err(format!("预约不存在: {id}"));
    }
    let _ = cancel_appointment_notification(notifications.inner(), &id);
    Ok(())
}

#[cfg(test)]
pub(crate) async fn delete_appointment_impl(database: &Database, id: &str) -> Result<(), String> {
    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    sqlx::query("DELETE FROM appointment_password_backfill WHERE appointment_id = ?")
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(db_error)?;
    let result = sqlx::query("DELETE FROM appointments WHERE id = ?")
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(db_error)?;
    if result.rows_affected() == 0 {
        return Err(format!("预约不存在: {id}"));
    }
    transaction.commit().await.map_err(db_error)?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_appointments<R: Runtime>(
    app: AppHandle<R>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
    ids: Vec<String>,
) -> Result<usize, String> {
    let _operation_guard = backup.lock_data_operation().await;
    let vault = app.state::<VaultState>().inner().clone();
    let deleted = delete_appointments_with_vault(&vault, database.inner(), &ids).await?;
    for id in ids {
        let _ = cancel_appointment_notification(notifications.inner(), &id);
    }
    Ok(deleted)
}

pub(crate) async fn delete_appointments_with_vault(
    vault: &VaultState,
    database: &Database,
    ids: &[String],
) -> Result<usize, String> {
    let mut unique_ids: Vec<String> = ids
        .iter()
        .filter_map(|id| {
            let id = id.trim();
            (!id.is_empty()).then_some(id.to_owned())
        })
        .collect();
    unique_ids.sort_unstable();
    unique_ids.dedup();
    if unique_ids.is_empty() {
        return Ok(0);
    }

    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let mut select = QueryBuilder::<Sqlite>::new(
        "SELECT id, account_password_available FROM appointments WHERE id IN (",
    );
    {
        let mut separated = select.separated(", ");
        for id in &unique_ids {
            separated.push_bind(id);
        }
    }
    select.push(") ORDER BY id");
    let rows = match select.build().fetch_all(&mut *transaction).await {
        Ok(rows) => rows,
        Err(error) => {
            let _ = transaction.rollback().await;
            return Err(db_error(error));
        }
    };

    let affected_ids: Result<Vec<String>, String> = rows
        .iter()
        .map(|row| row.try_get("id").map_err(db_error))
        .collect();
    let affected_ids = match affected_ids {
        Ok(ids) => ids,
        Err(error) => {
            let _ = transaction.rollback().await;
            return Err(error);
        }
    };

    let secret_ids: Result<Vec<String>, String> = rows
        .iter()
        .filter_map(
            |row| match row.try_get::<i64, _>("account_password_available") {
                Ok(0) => None,
                Ok(_) => Some(row.try_get("id").map_err(db_error)),
                Err(error) => Some(Err(db_error(error))),
            },
        )
        .collect();
    let secret_ids = match secret_ids {
        Ok(secret_ids) => secret_ids,
        Err(error) => {
            let _ = transaction.rollback().await;
            return Err(error);
        }
    };

    let mut removed_secrets = Vec::new();
    for secret_id in secret_ids {
        let worker_vault = vault.clone();
        let worker_id = secret_id.clone();
        match run_blocking_vault_operation(move || {
            worker_vault.remove_appointment_secret(&worker_id)
        })
        .await
        {
            Ok(previous) => removed_secrets.push((secret_id, previous)),
            Err(error) => {
                let _ = transaction.rollback().await;
                let restore_error = restore_removed_secrets(vault, removed_secrets).await.err();
                return Err(compensation_error(error, None, restore_error));
            }
        }
    }

    let mut delete_backfill = QueryBuilder::<Sqlite>::new(
        "DELETE FROM appointment_password_backfill WHERE appointment_id IN (",
    );
    {
        let mut separated = delete_backfill.separated(", ");
        for id in &unique_ids {
            separated.push_bind(id);
        }
    }
    delete_backfill.push(")");
    if let Err(error) = delete_backfill.build().execute(&mut *transaction).await {
        let primary = format!("清理预约密码迁移记录失败：{error}");
        let rollback_error = transaction.rollback().await.err();
        let restore_error = restore_removed_secrets(vault, removed_secrets).await.err();
        return Err(compensation_error(primary, rollback_error, restore_error));
    }

    let mut delete = QueryBuilder::<Sqlite>::new("DELETE FROM appointments WHERE id IN (");
    {
        let mut separated = delete.separated(", ");
        for id in &unique_ids {
            separated.push_bind(id);
        }
    }
    delete.push(")");
    let deleted = match delete.build().execute(&mut *transaction).await {
        Ok(result) => result.rows_affected() as usize,
        Err(error) => {
            let primary = db_error(error);
            let rollback_error = transaction.rollback().await.err();
            let restore_error = restore_removed_secrets(vault, removed_secrets).await.err();
            return Err(compensation_error(primary, rollback_error, restore_error));
        }
    };
    if let Err(error) = transaction.commit().await {
        return reconcile_delete_commit_error(
            vault,
            database,
            &affected_ids,
            removed_secrets,
            deleted,
            error,
        )
        .await;
    }
    Ok(deleted)
}

async fn restore_removed_secrets(
    vault: &VaultState,
    removed: Vec<(String, Option<String>)>,
) -> Result<(), String> {
    let worker_vault = vault.clone();
    run_blocking_vault_operation(move || {
        let mut errors = Vec::new();
        for (id, password) in removed.into_iter().rev() {
            let result = match password {
                Some(password) => worker_vault
                    .set_appointment_secret(&id, password)
                    .map(|_| ()),
                None => worker_vault.remove_appointment_secret(&id).map(|_| ()),
            };
            if let Err(error) = result {
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

#[cfg(test)]
pub(crate) async fn delete_appointments_impl(
    database: &Database,
    ids: &[String],
) -> Result<usize, String> {
    let mut unique_ids: Vec<String> = ids
        .iter()
        .filter_map(|id| {
            let id = id.trim();
            (!id.is_empty()).then_some(id.to_owned())
        })
        .collect();

    if unique_ids.is_empty() {
        return Ok(0);
    }

    unique_ids.sort_unstable();
    unique_ids.dedup();

    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let mut backfill_builder = QueryBuilder::<Sqlite>::new(
        "DELETE FROM appointment_password_backfill WHERE appointment_id IN (",
    );
    for (index, id) in unique_ids.iter().enumerate() {
        if index > 0 {
            backfill_builder.push(", ");
        }
        backfill_builder.push_bind(id);
    }
    backfill_builder.push(")");
    backfill_builder
        .build()
        .execute(&mut *transaction)
        .await
        .map_err(db_error)?;

    let mut builder = QueryBuilder::<Sqlite>::new("DELETE FROM appointments WHERE id IN (");
    for (index, id) in unique_ids.iter().enumerate() {
        if index > 0 {
            builder.push(", ");
        }
        builder.push_bind(id);
    }
    builder.push(")");

    let result = builder
        .build()
        .execute(&mut *transaction)
        .await
        .map_err(db_error)?;
    transaction.commit().await.map_err(db_error)?;
    Ok(result.rows_affected() as usize)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_appointment_service_status<R: Runtime>(
    app: AppHandle<R>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
    id: String,
    status: ServiceStatus,
) -> Result<Appointment, String> {
    let _operation_guard = backup.lock_data_operation().await;
    let appointment = set_appointment_service_status_impl(database.inner(), &id, status).await?;
    sync_notification(&app, notifications.inner(), &appointment);
    Ok(appointment)
}

pub(crate) async fn set_appointment_service_status_impl(
    database: &Database,
    id: &str,
    status: ServiceStatus,
) -> Result<Appointment, String> {
    let result =
        sqlx::query("UPDATE appointments SET service_status = ?, updated_at = ? WHERE id = ?")
            .bind(status.as_str())
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(database.pool())
            .await
            .map_err(db_error)?;
    if result.rows_affected() == 0 {
        return Err(format!("预约不存在: {id}"));
    }
    get_appointment_impl(database, id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn sync_appointment_service_statuses<R: Runtime>(
    app: AppHandle<R>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
) -> Result<usize, String> {
    let _operation_guard = backup.lock_data_operation().await;
    let offset = FixedOffset::east_opt(8 * 60 * 60).ok_or("无法创建东八区时区")?;
    let now = Utc::now().with_timezone(&offset).naive_local();
    let changed = sync_appointment_service_statuses_impl(database.inner(), now).await?;
    for appointment in &changed {
        sync_notification(&app, notifications.inner(), appointment);
    }
    Ok(changed.len())
}

pub(crate) async fn sync_appointment_service_statuses_impl(
    database: &Database,
    now: NaiveDateTime,
) -> Result<Vec<Appointment>, String> {
    let local_time = now.format(DATE_TIME_FORMAT).to_string();
    let rows = sqlx::query(
        "UPDATE appointments
         SET service_status = CASE
               WHEN ends_at IS NOT NULL AND ends_at <= ? THEN 'completed'
               ELSE 'in_progress'
             END,
             updated_at = ?
         WHERE service_status IN ('scheduled', 'in_progress')
           AND starts_at IS NOT NULL
           AND starts_at <= ?
           AND (
             service_status = 'scheduled'
             OR (service_status = 'in_progress' AND ends_at IS NOT NULL AND ends_at <= ?)
           )
         RETURNING *",
    )
    .bind(&local_time)
    .bind(Utc::now().to_rfc3339())
    .bind(&local_time)
    .bind(&local_time)
    .fetch_all(database.pool())
    .await
    .map_err(db_error)?;

    rows.iter().map(appointment_from_row).collect()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn settle_appointment(
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    id: String,
    amount_minor: i64,
    payment_method: Option<String>,
) -> Result<Appointment, String> {
    let _operation_guard = backup.lock_data_operation().await;
    settle_appointment_impl(database.inner(), &id, amount_minor, payment_method).await
}

pub(crate) async fn settle_appointment_impl(
    database: &Database,
    id: &str,
    amount_minor: i64,
    payment_method: Option<String>,
) -> Result<Appointment, String> {
    if amount_minor < 0 {
        return Err("结算金额不能为负数".into());
    }
    let appointment = get_appointment_impl(database, id).await?;
    if appointment.mode != AppointmentMode::Business {
        return Err("娱乐预约不参与结算".into());
    }

    sqlx::query(
        "UPDATE appointments
         SET settlement_status = 'settled', amount_minor = ?, payment_method = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(amount_minor)
    .bind(optional_text(payment_method))
    .bind(Utc::now().to_rfc3339())
    .bind(id)
    .execute(database.pool())
    .await
    .map_err(db_error)?;
    get_appointment_impl(database, id).await
}

pub(crate) async fn insert_imported_appointment(
    transaction: &mut Transaction<'_, Sqlite>,
    appointment: &LegacyAppointment,
) -> Result<ImportWriteResult, String> {
    if appointment.import_fingerprint.trim().is_empty() {
        return Err("导入预约缺少 fingerprint".into());
    }
    if appointment.contact_name.trim().is_empty() {
        return Err("导入预约联系人不能为空".into());
    }

    if let Some(row) = sqlx::query("SELECT id FROM appointments WHERE import_fingerprint = ?")
        .bind(&appointment.import_fingerprint)
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

    if appointment.amount_minor.is_some_and(|amount| amount < 0) {
        return Err(format!(
            "联系人 {} 的导入金额不能为负数",
            appointment.contact_name
        ));
    }
    let service_status = ServiceStatus::from_str(&appointment.service_status)?;
    let mut settlement_status = SettlementStatus::from_str(&appointment.settlement_status)?;
    if settlement_status == SettlementStatus::NotApplicable {
        return Err("历史预约默认按业务模式导入，结算状态不能是不适用".into());
    }
    if settlement_status == SettlementStatus::Settled && appointment.amount_minor.is_none() {
        settlement_status = SettlementStatus::Unsettled;
    }

    let starts_at = appointment
        .starts_at
        .map(|value| value.naive_local().format(DATE_TIME_FORMAT).to_string());
    let ends_at = appointment
        .ends_at
        .map(|value| value.naive_local().format(DATE_TIME_FORMAT).to_string());
    if ends_at.is_some() && starts_at.is_none() {
        return Err("导入预约存在结束时间但缺少开始时间".into());
    }
    if let (Some(start), Some(end)) = (&starts_at, &ends_at)
        && end <= start
    {
        return Err("导入预约结束时间必须晚于开始时间".into());
    }

    let account_name = appointment
        .account_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let id = Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO appointments (
            id, service_date, starts_at, ends_at, contact_name, content, mode,
            service_status, settlement_status,
            account_specialization, account_gear_score, account_server, account_name,
            account_password_available, voice_platform, voice_channel,
            rate_note, payment_method, amount_minor, reminder_minutes, notes,
            import_fingerprint, created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, ?, ?, 'business', ?, ?, ?, ?, ?, ?, ?, NULL, NULL,
            ?, ?, ?, NULL, ?, ?, ?, ?
        )",
    )
    .bind(&id)
    .bind(appointment.service_date.to_string())
    .bind(starts_at)
    .bind(ends_at)
    .bind(appointment.contact_name.trim())
    .bind(appointment.content.as_deref())
    .bind(service_status.as_str())
    .bind(settlement_status.as_str())
    .bind(account_name.and(appointment.specialization.as_deref()))
    .bind(account_name.and(appointment.gear_score.as_deref()))
    .bind(account_name.and(appointment.server.as_deref()))
    .bind(account_name)
    .bind(i64::from(
        account_name.is_some() && appointment.account_password.is_some(),
    ))
    .bind(appointment.rate_note.as_deref())
    .bind(appointment.payment_method.as_deref())
    .bind(appointment.amount_minor)
    .bind(appointment.notes.as_deref())
    .bind(&appointment.import_fingerprint)
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
    use crate::importer::LegacyAppointment;
    use crate::vault::VaultError;
    use chrono::{FixedOffset, TimeZone};

    fn run_async<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(future)
    }

    fn business_input(date: &str, start: &str, end: &str) -> AppointmentInput {
        AppointmentInput {
            service_date: date.into(),
            start_time: Some(start.into()),
            end_time: Some(end.into()),
            contact_name: "小林".into(),
            content: Some("竞技场".into()),
            mode: AppointmentMode::Business,
            service_status: ServiceStatus::Scheduled,
            settlement_status: SettlementStatus::Unsettled,
            account: None,
            voice_platform: None,
            voice_channel: None,
            rate_note: Some("80/小时".into()),
            payment_method: None,
            amount_minor: Some(8_000),
            reminder_minutes: Some(30),
            notes: None,
        }
    }

    fn embedded_account_input(
        account_name: &str,
        credential: AppointmentAccountCredentialInput,
    ) -> AppointmentAccountInput {
        AppointmentAccountInput::Embedded {
            details: AppointmentAccountDetails {
                specialization: Some("治疗".into()),
                gear_score: Some("8888".into()),
                server: Some("测试区".into()),
                account_name: account_name.into(),
            },
            credential,
        }
    }

    #[test]
    fn resolves_cross_midnight_range() {
        let (start, end) = resolve_time_range("2026-07-13", Some("23:30"), Some("01:00")).unwrap();
        assert_eq!(start.as_deref(), Some("2026-07-13T23:30:00"));
        assert_eq!(end.as_deref(), Some("2026-07-14T01:00:00"));
    }

    #[test]
    fn validates_voice_platform_and_normalizes_channel() {
        let mut yy = business_input("2026-08-03", "10:00", "11:00");
        yy.voice_platform = Some(VoicePlatform::Yy);
        yy.voice_channel = Some(" 123456 ".into());
        let normalized = normalize_input(yy).unwrap();
        assert_eq!(normalized.voice_platform, Some(VoicePlatform::Yy));
        assert_eq!(normalized.voice_channel.as_deref(), Some("123456"));

        let mut qq = business_input("2026-08-03", "10:00", "11:00");
        qq.voice_platform = Some(VoicePlatform::Qq);
        qq.voice_channel = Some("123456".into());
        let normalized = normalize_input(qq).unwrap();
        assert_eq!(normalized.voice_platform, Some(VoicePlatform::Qq));
        assert_eq!(normalized.voice_channel, None);

        let mut invalid = business_input("2026-08-03", "10:00", "11:00");
        invalid.voice_platform = Some(VoicePlatform::Yy);
        invalid.voice_channel = Some("12A34".into());
        assert!(
            normalize_input(invalid)
                .unwrap_err()
                .contains("只能包含数字")
        );
    }

    #[test]
    fn password_backfill_is_kept_only_for_embedded_keep() {
        let account = |password_available| {
            Some(AppointmentAccount {
                specialization: None,
                gear_score: None,
                server: None,
                account_name: "account".into(),
                password_available,
            })
        };
        assert!(!should_clear_password_backfill(&PreparedAccount {
            account: account(false),
            secret_action: SecretAction::Keep,
        }));
        assert!(should_clear_password_backfill(&PreparedAccount {
            account: account(true),
            secret_action: SecretAction::Keep,
        }));
        for secret_action in [
            SecretAction::None,
            SecretAction::Set("replacement".into()),
            SecretAction::CopyFromAppointment("source".into()),
        ] {
            assert!(should_clear_password_backfill(&PreparedAccount {
                account: account(false),
                secret_action,
            }));
        }
    }

    #[test]
    fn appointment_account_flow_owns_independent_stronghold_secrets() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let vault_dir = std::env::temp_dir().join(format!(
                "timekeeper-appointment-account-flow-{}",
                Uuid::now_v7()
            ));
            let vault = VaultState::new(&vault_dir).unwrap();

            let without_account = create_appointment_with_vault(
                &vault,
                &database,
                business_input("2026-08-03", "08:00", "09:00"),
            )
            .await
            .unwrap()
            .appointment;
            assert!(without_account.account.is_none());

            vault
                .initialize("test master password only".into())
                .unwrap();
            sqlx::query(
                "INSERT INTO account_profiles (
                    id, server, specialization, gear_score, account_name,
                    needs_review, sort_order, created_at, updated_at
                 ) VALUES ('profile-1', '档案区', '输出', '9999', 'profile-account',
                           0, 0, '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z')",
            )
            .execute(database.pool())
            .await
            .unwrap();
            vault
                .set_secret("profile-1", "profile password for test".into())
                .unwrap();

            let mut profile_input = business_input("2026-08-03", "10:00", "11:00");
            profile_input.account = Some(AppointmentAccountInput::Profile {
                profile_id: "profile-1".into(),
            });
            let profile_appointment =
                create_appointment_with_vault(&vault, &database, profile_input)
                    .await
                    .unwrap()
                    .appointment;
            assert_eq!(
                profile_appointment
                    .account
                    .as_ref()
                    .map(|account| account.account_name.as_str()),
                Some("profile-account")
            );
            assert_eq!(
                vault
                    .get_appointment_secret(&profile_appointment.id)
                    .unwrap(),
                "profile password for test"
            );
            vault
                .set_secret("profile-1", "changed profile password".into())
                .unwrap();
            assert_eq!(
                vault
                    .get_appointment_secret(&profile_appointment.id)
                    .unwrap(),
                "profile password for test"
            );

            let mut embedded_input = business_input("2026-08-03", "12:00", "13:00");
            embedded_input.account = Some(embedded_account_input(
                "embedded-account",
                AppointmentAccountCredentialInput::Replace {
                    password: "embedded password v1".into(),
                },
            ));
            let embedded = create_appointment_with_vault(&vault, &database, embedded_input)
                .await
                .unwrap()
                .appointment;

            let mut keep_input = business_input("2026-08-04", "12:00", "13:00");
            keep_input.account = Some(embedded_account_input(
                "embedded-account-renamed",
                AppointmentAccountCredentialInput::Keep,
            ));
            let kept = update_appointment_with_vault(&vault, &database, &embedded.id, keep_input)
                .await
                .unwrap()
                .appointment;
            assert_eq!(
                kept.account
                    .as_ref()
                    .map(|account| account.account_name.as_str()),
                Some("embedded-account-renamed")
            );
            assert_eq!(
                vault.get_appointment_secret(&embedded.id).unwrap(),
                "embedded password v1"
            );

            let mut source_input = business_input("2026-08-04", "14:00", "15:00");
            source_input.account = Some(embedded_account_input(
                "password-source",
                AppointmentAccountCredentialInput::Replace {
                    password: "source appointment password".into(),
                },
            ));
            let source = create_appointment_with_vault(&vault, &database, source_input)
                .await
                .unwrap()
                .appointment;

            let mut copy_input = business_input("2026-08-05", "12:00", "13:00");
            copy_input.account = Some(embedded_account_input(
                "copied-password-account",
                AppointmentAccountCredentialInput::CopyFromAppointment {
                    source_appointment_id: source.id.clone(),
                },
            ));
            update_appointment_with_vault(&vault, &database, &embedded.id, copy_input)
                .await
                .unwrap();
            assert_eq!(
                vault.get_appointment_secret(&embedded.id).unwrap(),
                "source appointment password"
            );

            let duplicate = duplicate_appointment_with_vault(
                &vault,
                &database,
                &embedded.id,
                Some("2026-08-06".into()),
            )
            .await
            .unwrap()
            .appointment;
            assert_eq!(
                vault.get_appointment_secret(&duplicate.id).unwrap(),
                "source appointment password"
            );

            let mut replace_input = business_input("2026-08-05", "12:00", "13:00");
            replace_input.account = Some(embedded_account_input(
                "copied-password-account",
                AppointmentAccountCredentialInput::Replace {
                    password: "source changed after duplicate".into(),
                },
            ));
            update_appointment_with_vault(&vault, &database, &embedded.id, replace_input)
                .await
                .unwrap();
            assert_eq!(
                vault.get_appointment_secret(&duplicate.id).unwrap(),
                "source appointment password"
            );

            update_appointment_with_vault(
                &vault,
                &database,
                &embedded.id,
                business_input("2026-08-05", "12:00", "13:00"),
            )
            .await
            .unwrap();
            assert!(matches!(
                vault.get_appointment_secret(&embedded.id),
                Err(VaultError::PasswordNotFound)
            ));
            assert!(
                get_appointment_impl(&database, &embedded.id)
                    .await
                    .unwrap()
                    .account
                    .is_none()
            );

            assert_eq!(
                delete_appointments_with_vault(
                    &vault,
                    &database,
                    std::slice::from_ref(&duplicate.id),
                )
                .await
                .unwrap(),
                1
            );
            assert!(matches!(
                vault.get_appointment_secret(&duplicate.id),
                Err(VaultError::PasswordNotFound)
            ));

            vault.lock().unwrap();
            drop(vault);
            std::fs::remove_dir_all(vault_dir).unwrap();
        });
    }

    #[test]
    fn commit_error_reconciliation_aligns_secrets_with_observed_database_state() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let vault_dir = std::env::temp_dir().join(format!(
                "timekeeper-appointment-commit-reconciliation-{}",
                Uuid::now_v7()
            ));
            let vault = VaultState::new(&vault_dir).unwrap();
            vault
                .initialize("test reconciliation password".into())
                .unwrap();

            let mut create_input = business_input("2026-08-07", "10:00", "11:00");
            create_input.account = Some(embedded_account_input(
                "reconciliation-account",
                AppointmentAccountCredentialInput::Replace {
                    password: "password before update".into(),
                },
            ));
            let created = create_appointment_with_vault(&vault, &database, create_input)
                .await
                .unwrap()
                .appointment;

            let confirmed_create = reconcile_create_commit_error(
                &vault,
                &database,
                &created.id,
                Some(None),
                sqlx::Error::Protocol("simulated create commit error".into()),
            )
            .await
            .unwrap();
            assert_eq!(confirmed_create.appointment.id, created.id);
            assert_eq!(
                vault.get_appointment_secret(&created.id).unwrap(),
                "password before update"
            );

            vault
                .set_appointment_secret("orphan-create", "temporary orphan".into())
                .unwrap();
            let rejected_create = reconcile_create_commit_error(
                &vault,
                &database,
                "orphan-create",
                Some(None),
                sqlx::Error::Protocol("simulated create rollback".into()),
            )
            .await
            .unwrap_err();
            assert!(rejected_create.contains("已确认预约未写入"));
            assert!(matches!(
                vault.get_appointment_secret("orphan-create"),
                Err(VaultError::PasswordNotFound)
            ));

            let mut update_input = business_input("2026-08-08", "12:00", "13:00");
            update_input.notes = Some("完整状态标记".into());
            update_input.account = Some(embedded_account_input(
                "reconciliation-account-updated",
                AppointmentAccountCredentialInput::Replace {
                    password: "password after update".into(),
                },
            ));
            let normalized_update = normalize_input(update_input.clone()).unwrap();
            let updated =
                update_appointment_with_vault(&vault, &database, &created.id, update_input)
                    .await
                    .unwrap()
                    .appointment;
            assert_ne!(updated.updated_at, created.updated_at);
            assert!(appointment_matches_update(
                &updated,
                &normalized_update,
                updated.account.as_ref(),
                &updated.updated_at,
            ));
            let mut incomplete = updated.clone();
            incomplete.notes = Some("不同内容".into());
            assert!(!appointment_matches_update(
                &incomplete,
                &normalized_update,
                updated.account.as_ref(),
                &updated.updated_at,
            ));

            let confirmed_update = reconcile_update_commit_error(
                &vault,
                &database,
                &created.id,
                ExpectedAppointmentUpdate {
                    input: &normalized_update,
                    account: updated.account.as_ref(),
                    updated_at: &updated.updated_at,
                },
                Some(Some("password before update".into())),
                sqlx::Error::Protocol("simulated update commit error".into()),
            )
            .await
            .unwrap();
            assert_eq!(confirmed_update.appointment.updated_at, updated.updated_at);
            assert_eq!(
                vault.get_appointment_secret(&created.id).unwrap(),
                "password after update"
            );

            let uncommitted_marker = next_unique_updated_at(&updated.updated_at);
            let rejected_update = reconcile_update_commit_error(
                &vault,
                &database,
                &created.id,
                ExpectedAppointmentUpdate {
                    input: &normalized_update,
                    account: updated.account.as_ref(),
                    updated_at: &uncommitted_marker,
                },
                Some(Some("password before update".into())),
                sqlx::Error::Protocol("simulated update rollback".into()),
            )
            .await
            .unwrap_err();
            assert!(rejected_update.contains("完整状态对账确认本次更新未提交"));
            assert_eq!(
                vault.get_appointment_secret(&created.id).unwrap(),
                "password before update"
            );

            let mut deleted_input = business_input("2026-08-09", "14:00", "15:00");
            deleted_input.account = Some(embedded_account_input(
                "deleted-during-reconciliation",
                AppointmentAccountCredentialInput::Replace {
                    password: "password for deleted row".into(),
                },
            ));
            let deleted = create_appointment_with_vault(&vault, &database, deleted_input)
                .await
                .unwrap()
                .appointment;
            sqlx::query("DELETE FROM appointments WHERE id = ?")
                .bind(&deleted.id)
                .execute(database.pool())
                .await
                .unwrap();
            let removed_secrets = vec![
                (
                    created.id.clone(),
                    vault.remove_appointment_secret(&created.id).unwrap(),
                ),
                (
                    deleted.id.clone(),
                    vault.remove_appointment_secret(&deleted.id).unwrap(),
                ),
            ];
            let affected_ids = vec![created.id.clone(), deleted.id.clone()];
            let delete_error = reconcile_delete_commit_error(
                &vault,
                &database,
                &affected_ids,
                removed_secrets,
                2,
                sqlx::Error::Protocol("simulated batch delete commit error".into()),
            )
            .await
            .unwrap_err();
            assert!(delete_error.contains("1 条已删除、1 条仍存在"));
            assert_eq!(
                vault.get_appointment_secret(&created.id).unwrap(),
                "password before update"
            );
            assert!(matches!(
                vault.get_appointment_secret(&deleted.id),
                Err(VaultError::PasswordNotFound)
            ));

            vault
                .set_appointment_secret("uncertain-create", "uncertain password".into())
                .unwrap();
            database.pool().close().await;
            let uncertain = reconcile_create_commit_error(
                &vault,
                &database,
                "uncertain-create",
                Some(None),
                sqlx::Error::Protocol("simulated unknown commit result".into()),
            )
            .await
            .unwrap_err();
            assert!(uncertain.contains("simulated unknown commit result"));
            assert!(uncertain.contains("确认创建结果失败"));
            assert!(uncertain.contains("状态不确定"));
            assert_eq!(
                vault.get_appointment_secret("uncertain-create").unwrap(),
                "uncertain password"
            );

            vault.lock().unwrap();
            drop(vault);
            std::fs::remove_dir_all(vault_dir).unwrap();
        });
    }

    #[test]
    fn automatically_starts_and_completes_timed_appointments() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let current =
                create_appointment_impl(&database, business_input("2026-07-13", "10:00", "11:00"))
                    .await
                    .unwrap()
                    .appointment;
            let missed =
                create_appointment_impl(&database, business_input("2026-07-13", "08:00", "09:00"))
                    .await
                    .unwrap()
                    .appointment;
            let mut open_ended_input = business_input("2026-07-13", "10:00", "11:00");
            open_ended_input.end_time = None;
            let open_ended = create_appointment_impl(&database, open_ended_input)
                .await
                .unwrap()
                .appointment;

            let at_start =
                NaiveDateTime::parse_from_str("2026-07-13T10:00:00", DATE_TIME_FORMAT).unwrap();
            let changed = sync_appointment_service_statuses_impl(&database, at_start)
                .await
                .unwrap();
            assert_eq!(changed.len(), 3);
            assert_eq!(
                get_appointment_impl(&database, &current.id)
                    .await
                    .unwrap()
                    .service_status,
                ServiceStatus::InProgress
            );
            assert_eq!(
                get_appointment_impl(&database, &missed.id)
                    .await
                    .unwrap()
                    .service_status,
                ServiceStatus::Completed
            );
            assert_eq!(
                get_appointment_impl(&database, &open_ended.id)
                    .await
                    .unwrap()
                    .service_status,
                ServiceStatus::InProgress
            );

            let at_end =
                NaiveDateTime::parse_from_str("2026-07-13T11:00:00", DATE_TIME_FORMAT).unwrap();
            let changed = sync_appointment_service_statuses_impl(&database, at_end)
                .await
                .unwrap();
            assert_eq!(changed.len(), 1);
            assert_eq!(
                get_appointment_impl(&database, &current.id)
                    .await
                    .unwrap()
                    .service_status,
                ServiceStatus::Completed
            );
            assert_eq!(
                get_appointment_impl(&database, &open_ended.id)
                    .await
                    .unwrap()
                    .service_status,
                ServiceStatus::InProgress
            );
            assert!(
                sync_appointment_service_statuses_impl(&database, at_end)
                    .await
                    .unwrap()
                    .is_empty()
            );
        });
    }

    #[test]
    fn warns_on_conflicts_but_still_creates_appointments() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let first =
                create_appointment_impl(&database, business_input("2026-07-13", "23:00", "01:00"))
                    .await
                    .unwrap();
            assert!(first.conflicts.is_empty());

            let second =
                create_appointment_impl(&database, business_input("2026-07-14", "00:30", "02:00"))
                    .await
                    .unwrap();
            assert_eq!(second.conflicts.len(), 1);
            assert_eq!(second.conflicts[0].id, first.appointment.id);

            set_appointment_service_status_impl(
                &database,
                &first.appointment.id,
                ServiceStatus::Cancelled,
            )
            .await
            .unwrap();
            let third =
                create_appointment_impl(&database, business_input("2026-07-14", "00:45", "01:30"))
                    .await
                    .unwrap();
            assert_eq!(third.conflicts.len(), 1);
            assert_eq!(third.conflicts[0].id, second.appointment.id);
        });
    }

    #[test]
    fn entertainment_mode_discards_billing_and_cannot_be_settled() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let mut input = business_input("2026-07-13", "18:00", "19:00");
            input.mode = AppointmentMode::Entertainment;
            input.settlement_status = SettlementStatus::Settled;
            let created = create_appointment_impl(&database, input).await.unwrap();
            assert_eq!(
                created.appointment.settlement_status,
                SettlementStatus::NotApplicable
            );
            assert_eq!(created.appointment.amount_minor, None);
            assert!(
                settle_appointment_impl(&database, &created.appointment.id, 100, None)
                    .await
                    .is_err()
            );
        });
    }

    #[test]
    fn import_appointment_is_idempotent_by_fingerprint() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let offset = FixedOffset::east_opt(8 * 60 * 60).unwrap();
            let appointment = LegacyAppointment {
                service_date: NaiveDate::from_ymd_opt(2026, 7, 13).unwrap(),
                starts_at: Some(
                    offset
                        .with_ymd_and_hms(2026, 7, 13, 23, 0, 0)
                        .single()
                        .unwrap(),
                ),
                ends_at: Some(
                    offset
                        .with_ymd_and_hms(2026, 7, 14, 1, 0, 0)
                        .single()
                        .unwrap(),
                ),
                contact_name: "导入联系人".into(),
                content: Some("跨天预约".into()),
                service_status: "completed".into(),
                settlement_status: "settled".into(),
                account_name: None,
                account_password: None,
                server: None,
                specialization: None,
                gear_score: None,
                rate_note: None,
                payment_method: Some("微信".into()),
                amount_minor: Some(10_000),
                notes: None,
                import_fingerprint: "appointment-fingerprint".into(),
            };
            let mut transaction = database.pool().begin().await.unwrap();
            let first = insert_imported_appointment(&mut transaction, &appointment)
                .await
                .unwrap();
            let second = insert_imported_appointment(&mut transaction, &appointment)
                .await
                .unwrap();
            assert_eq!((first.inserted, first.skipped), (1, 0));
            assert_eq!((second.inserted, second.skipped), (0, 1));
            assert_eq!(first.record_id, second.record_id);
            transaction.commit().await.unwrap();
        });
    }

    #[test]
    fn imported_appointment_owns_embedded_account_metadata() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let appointment = LegacyAppointment {
                service_date: NaiveDate::from_ymd_opt(2026, 8, 3).unwrap(),
                starts_at: None,
                ends_at: None,
                contact_name: "导入联系人".into(),
                content: None,
                service_status: "scheduled".into(),
                settlement_status: "unsettled".into(),
                account_name: Some("one-shot-account".into()),
                account_password: Some("vault-only".into()),
                server: Some("梦江南".into()),
                specialization: Some("冰心".into()),
                gear_score: Some("12345".into()),
                rate_note: None,
                payment_method: None,
                amount_minor: None,
                notes: None,
                import_fingerprint: "embedded-account-import".into(),
            };
            let mut transaction = database.pool().begin().await.unwrap();
            let write = insert_imported_appointment(&mut transaction, &appointment)
                .await
                .unwrap();
            transaction.commit().await.unwrap();

            let stored = get_appointment_impl(&database, &write.record_id)
                .await
                .unwrap();
            assert_eq!(
                stored.account,
                Some(AppointmentAccount {
                    specialization: Some("冰心".into()),
                    gear_score: Some("12345".into()),
                    server: Some("梦江南".into()),
                    account_name: "one-shot-account".into(),
                    password_available: true,
                })
            );
            let matched = list_appointments_impl(
                &database,
                AppointmentFilters {
                    query: Some("one-shot-account".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            assert_eq!(matched.len(), 1);
        });
    }

    #[test]
    fn contact_presets_keep_only_each_contacts_latest_non_cancelled_appointment() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let mut older = business_input("2026-08-01", "10:00", "11:00");
            older.contact_name = "最近联系人".into();
            older.content = Some("旧内容".into());
            create_appointment_impl(&database, older).await.unwrap();

            let mut latest = business_input("2026-08-03", "20:00", "21:00");
            latest.contact_name = "最近联系人".into();
            latest.content = Some("新内容".into());
            latest.voice_platform = Some(VoicePlatform::Yy);
            latest.voice_channel = Some("123456".into());
            let latest = create_appointment_impl(&database, latest)
                .await
                .unwrap()
                .appointment;

            let mut cancelled = business_input("2026-08-04", "20:00", "21:00");
            cancelled.contact_name = "已取消联系人".into();
            cancelled.service_status = ServiceStatus::Cancelled;
            create_appointment_impl(&database, cancelled).await.unwrap();

            let presets = list_contact_presets_impl(&database, None, None)
                .await
                .unwrap();
            assert_eq!(presets.len(), 1);
            assert_eq!(presets[0].source_appointment_id, latest.id);
            assert_eq!(presets[0].content.as_deref(), Some("新内容"));
            assert_eq!(presets[0].start_time.as_deref(), Some("20:00:00"));
            assert_eq!(presets[0].voice_platform, Some(VoicePlatform::Yy));
            assert_eq!(presets[0].voice_channel.as_deref(), Some("123456"));

            let searched = list_contact_presets_impl(&database, Some("最近".into()), Some(10))
                .await
                .unwrap();
            assert_eq!(searched.len(), 1);
            assert!(
                list_contact_presets_impl(&database, None, Some(0))
                    .await
                    .unwrap_err()
                    .contains("1 到 50")
            );
        });
    }

    #[test]
    fn supports_the_full_appointment_command_flow() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let created =
                create_appointment_impl(&database, business_input("2026-07-13", "20:00", "21:00"))
                    .await
                    .unwrap();
            sqlx::query(
                "INSERT INTO appointment_password_backfill (
                    appointment_id, source_profile_id
                 ) VALUES (?, 'legacy-profile')",
            )
            .bind(&created.appointment.id)
            .execute(database.pool())
            .await
            .unwrap();
            assert!(
                duplicate_appointment_impl(&database, &created.appointment.id, None)
                    .await
                    .unwrap_err()
                    .contains("先解锁保险库")
            );

            let mut changed = business_input("2026-07-13", "20:30", "22:00");
            changed.service_status = ServiceStatus::Completed;
            let updated = update_appointment_impl(&database, &created.appointment.id, changed)
                .await
                .unwrap();
            assert_eq!(updated.appointment.service_status, ServiceStatus::Completed);
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM appointment_password_backfill
                     WHERE appointment_id = ?",
                )
                .bind(&created.appointment.id)
                .fetch_one(database.pool())
                .await
                .unwrap(),
                0
            );
            assert_eq!(
                updated.appointment.starts_at.as_deref(),
                Some("2026-07-13T20:30:00")
            );

            let settled = settle_appointment_impl(
                &database,
                &created.appointment.id,
                12_000,
                Some("支付宝".into()),
            )
            .await
            .unwrap();
            assert_eq!(settled.settlement_status, SettlementStatus::Settled);

            let duplicate = duplicate_appointment_impl(
                &database,
                &created.appointment.id,
                Some("2026-07-20".into()),
            )
            .await
            .unwrap();
            assert_eq!(
                duplicate.appointment.service_status,
                ServiceStatus::Scheduled
            );
            assert_eq!(
                duplicate.appointment.settlement_status,
                SettlementStatus::Unsettled
            );

            let listed = list_appointments_impl(
                &database,
                AppointmentFilters {
                    from: Some("2026-07-20".into()),
                    to: Some("2026-07-20".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
            assert_eq!(listed.len(), 1);
            assert_eq!(listed[0].id, duplicate.appointment.id);

            sqlx::query(
                "INSERT INTO appointment_password_backfill (
                    appointment_id, source_profile_id
                 ) VALUES (?, 'legacy-profile')",
            )
            .bind(&duplicate.appointment.id)
            .execute(database.pool())
            .await
            .unwrap();

            delete_appointment_impl(&database, &duplicate.appointment.id)
                .await
                .unwrap();
            assert!(
                get_appointment_impl(&database, &duplicate.appointment.id)
                    .await
                    .is_err()
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM appointment_password_backfill
                     WHERE appointment_id = ?",
                )
                .bind(&duplicate.appointment.id)
                .fetch_one(database.pool())
                .await
                .unwrap(),
                0
            );
        });
    }

    #[test]
    fn supports_batch_appointment_deletion() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let first =
                create_appointment_impl(&database, business_input("2026-07-20", "10:00", "11:00"))
                    .await
                    .unwrap();
            let second =
                create_appointment_impl(&database, business_input("2026-07-20", "11:30", "12:30"))
                    .await
                    .unwrap();
            let third =
                create_appointment_impl(&database, business_input("2026-07-20", "13:00", "14:00"))
                    .await
                    .unwrap();
            for id in [&first.appointment.id, &second.appointment.id] {
                sqlx::query(
                    "INSERT INTO appointment_password_backfill (
                        appointment_id, source_profile_id
                     ) VALUES (?, 'legacy-profile')",
                )
                .bind(id)
                .execute(database.pool())
                .await
                .unwrap();
            }

            let deleted = delete_appointments_impl(
                &database,
                &[
                    first.appointment.id.clone(),
                    second.appointment.id.clone(),
                    third.appointment.id.clone(),
                ],
            )
            .await
            .unwrap();
            assert_eq!(deleted, 3);
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM appointment_password_backfill",)
                    .fetch_one(database.pool())
                    .await
                    .unwrap(),
                0
            );
            assert!(
                get_appointment_impl(&database, &first.appointment.id)
                    .await
                    .is_err()
            );
            assert_eq!(
                list_appointments_impl(
                    &database,
                    AppointmentFilters {
                        from: Some("2026-07-20".into()),
                        to: Some("2026-07-20".into()),
                        ..Default::default()
                    }
                )
                .await
                .unwrap()
                .len(),
                0,
            );
        });
    }

    #[test]
    fn deleting_unknown_appointments_keeps_idempotence() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let unknown =
                delete_appointments_impl(&database, &["unknown-appointment-id".to_string()])
                    .await
                    .unwrap();
            assert_eq!(unknown, 0);
        });
    }
}
