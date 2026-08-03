use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
    sync::{LazyLock, Mutex},
};

use chrono::{
    DateTime, Days, Duration, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc,
};
use futures_util::TryStreamExt;
use sqlx::{QueryBuilder, Row, Sqlite, Transaction, sqlite::SqliteRow};
use tauri::{AppHandle, Runtime, State};
use uuid::Uuid;

use crate::{
    app_access::AppAccessState,
    backup::BackupState,
    db::{Database, ImportWriteResult},
    importer::LegacyAppointment,
    models::{
        Appointment, AppointmentAccount, AppointmentAccountCredentialInput,
        AppointmentAccountDetails, AppointmentAccountInput, AppointmentConflict,
        AppointmentDeleteResult, AppointmentDeleteSelection, AppointmentFilters, AppointmentInput,
        AppointmentMode, AppointmentMutationResult, AppointmentPage, AppointmentProgressStatus,
        AppointmentSelectionSnapshot, ContactPreset, ServiceStatus, SettlementStatus,
        VoicePlatform,
    },
    notifications::{
        NotificationState, cancel_appointment_notification, cancel_appointment_notifications,
        schedule_appointment_notification,
    },
    vault::{copy_sensitive_text_to_clipboard, copy_text_to_clipboard},
};

const DATE_FORMAT: &str = "%Y-%m-%d";
const DATE_TIME_FORMAT: &str = "%Y-%m-%dT%H:%M:%S";
const DEFAULT_PAGE_SIZE: i64 = 100;
const MAX_PAGE_SIZE: i64 = 200;
const DELETE_CHUNK_SIZE: usize = 500;
const SELECTION_TTL_MINUTES: i64 = 10;
const APPOINTMENT_WITH_CREDENTIAL_SELECT: &str =
    "SELECT a.id, a.service_date, a.starts_at, a.ends_at, a.contact_name, a.content,
            a.mode, a.service_status, a.settlement_status,
            a.account_specialization, a.account_gear_score, a.account_server, a.account_name,
            a.voice_platform, a.voice_channel, a.rate_note, a.payment_method,
            a.amount_minor, a.reminder_minutes, a.notes, a.import_fingerprint,
            a.created_at, a.updated_at, c.password AS account_password
     FROM appointments a
     LEFT JOIN appointment_credentials c ON c.appointment_id = a.id";

#[derive(Debug, Clone)]
struct StoredAppointmentSelection {
    ids: Vec<String>,
    expires_at: DateTime<Utc>,
}

type ConsumedAppointmentSelection = (String, StoredAppointmentSelection);
type ResolvedAppointmentSelection = (Vec<String>, Option<ConsumedAppointmentSelection>);

static APPOINTMENT_SELECTIONS: LazyLock<Mutex<HashMap<String, StoredAppointmentSelection>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

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
    schedule_reminder(
        app,
        notifications,
        &appointment.id,
        starts_at,
        reminder_minutes,
        &appointment.contact_name,
        appointment.content.as_deref(),
    );
}

fn schedule_reminder<R: Runtime>(
    app: &AppHandle<R>,
    notifications: &NotificationState,
    appointment_id: &str,
    starts_at: &str,
    reminder_minutes: i64,
    contact_name: &str,
    content: Option<&str>,
) {
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
    let body = match content {
        Some(content) if !content.trim().is_empty() => {
            format!("{} · {}", contact_name, content.trim())
        }
        _ => contact_name.to_owned(),
    };
    let _ = schedule_appointment_notification(
        notifications,
        app.clone(),
        appointment_id,
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
    let local_now = Utc::now().with_timezone(&offset).naive_local();
    let today = local_now.date().format(DATE_FORMAT).to_string();
    let rows = sqlx::query(
        "SELECT a.id, a.starts_at, a.reminder_minutes, a.contact_name, a.content
         FROM appointments a
         WHERE a.service_status != 'cancelled'
           AND a.service_status != 'completed'
           AND a.service_date >= ?
           AND a.reminder_minutes IS NOT NULL
           AND a.starts_at IS NOT NULL
           AND a.starts_at > ?
         ORDER BY a.starts_at, a.id",
    )
    .bind(today)
    .bind(local_now.format(DATE_TIME_FORMAT).to_string())
    .fetch_all(database.pool())
    .await
    .map_err(db_error)?;
    for row in rows {
        let starts_at: String = row.try_get("starts_at").map_err(db_error)?;
        schedule_reminder(
            &app,
            notifications,
            &row.try_get::<String, _>("id").map_err(db_error)?,
            &starts_at,
            row.try_get("reminder_minutes").map_err(db_error)?,
            &row.try_get::<String, _>("contact_name").map_err(db_error)?,
            row.try_get::<Option<String>, _>("content")
                .map_err(db_error)?
                .as_deref(),
        );
    }
    Ok(())
}

pub(crate) async fn restore_notifications_for_ids<R: Runtime>(
    app: AppHandle<R>,
    database: &Database,
    notifications: &NotificationState,
    ids: &[String],
) -> Result<(), String> {
    let ids = normalized_ids(ids);
    if ids.is_empty() {
        return Ok(());
    }
    let _ = cancel_appointment_notifications(notifications, &ids);
    let offset = FixedOffset::east_opt(8 * 60 * 60).ok_or("无法创建东八区时区")?;
    let local_now = Utc::now()
        .with_timezone(&offset)
        .naive_local()
        .format(DATE_TIME_FORMAT)
        .to_string();
    let today = Utc::now()
        .with_timezone(&offset)
        .date_naive()
        .format(DATE_FORMAT)
        .to_string();

    for chunk in ids.chunks(DELETE_CHUNK_SIZE) {
        let mut query = QueryBuilder::<Sqlite>::new(
            "SELECT a.id, a.starts_at, a.reminder_minutes, a.contact_name, a.content
             FROM appointments a
             WHERE a.service_status != 'cancelled'
               AND a.service_status != 'completed'
               AND a.service_date >= ",
        );
        query.push_bind(today.clone()).push(
            " AND a.reminder_minutes IS NOT NULL
               AND a.starts_at IS NOT NULL
               AND a.starts_at > ",
        );
        query.push_bind(local_now.clone()).push(" AND a.id IN (");
        {
            let mut separated = query.separated(", ");
            for id in chunk {
                separated.push_bind(id);
            }
        }
        query.push(") ORDER BY a.id");
        let rows = query
            .build()
            .fetch_all(database.pool())
            .await
            .map_err(db_error)?;
        for row in rows {
            let starts_at: String = row.try_get("starts_at").map_err(db_error)?;
            schedule_reminder(
                &app,
                notifications,
                &row.try_get::<String, _>("id").map_err(db_error)?,
                &starts_at,
                row.try_get("reminder_minutes").map_err(db_error)?,
                &row.try_get::<String, _>("contact_name").map_err(db_error)?,
                row.try_get::<Option<String>, _>("content")
                    .map_err(db_error)?
                    .as_deref(),
            );
        }
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

    let (service_status, settlement_status, rate_note, payment_method, amount_minor) = match input
        .mode
    {
        AppointmentMode::Entertainment => (
            input.service_status,
            SettlementStatus::NotApplicable,
            None,
            None,
            None,
        ),
        AppointmentMode::Business => {
            if input.settlement_status == SettlementStatus::NotApplicable {
                return Err("业务预约的结算状态必须是未结算或已结算".into());
            }
            if input.settlement_status == SettlementStatus::Settled && input.amount_minor.is_none()
            {
                return Err("已完成预约必须填写金额".into());
            }
            (
                if input.settlement_status == SettlementStatus::Settled
                    && input.service_status != ServiceStatus::Cancelled
                {
                    ServiceStatus::Completed
                } else {
                    input.service_status
                },
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
        service_status,
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
                password: row
                    .try_get::<Option<String>, _>("account_password")
                    .unwrap_or(None),
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

// This positional decoder is paired with APPOINTMENT_WITH_CREDENTIAL_SELECT. Range reads can
// return thousands of rows, so avoiding repeated column-name lookup and temporary enum strings
// materially reduces both latency and allocation pressure.
fn appointment_from_selected_row(row: &SqliteRow) -> Result<Appointment, String> {
    let mode = AppointmentMode::from_str(row.try_get::<&str, _>(6).map_err(db_error)?)?;
    let service_status = ServiceStatus::from_str(row.try_get::<&str, _>(7).map_err(db_error)?)?;
    let settlement_status =
        SettlementStatus::from_str(row.try_get::<&str, _>(8).map_err(db_error)?)?;
    let account_name: Option<String> = row.try_get(12).map_err(db_error)?;
    let account = account_name
        .map(|account_name| {
            Ok::<AppointmentAccount, String>(AppointmentAccount {
                specialization: row.try_get(9).map_err(db_error)?,
                gear_score: row.try_get(10).map_err(db_error)?,
                server: row.try_get(11).map_err(db_error)?,
                account_name,
                password: row.try_get(23).map_err(db_error)?,
            })
        })
        .transpose()?;
    let voice_platform = row
        .try_get::<Option<&str>, _>(13)
        .map_err(db_error)?
        .map(VoicePlatform::from_str)
        .transpose()?;

    Ok(Appointment {
        id: row.try_get(0).map_err(db_error)?,
        service_date: row.try_get(1).map_err(db_error)?,
        starts_at: row.try_get(2).map_err(db_error)?,
        ends_at: row.try_get(3).map_err(db_error)?,
        contact_name: row.try_get(4).map_err(db_error)?,
        content: row.try_get(5).map_err(db_error)?,
        mode,
        service_status,
        settlement_status,
        account,
        voice_platform,
        voice_channel: row.try_get(14).map_err(db_error)?,
        rate_note: row.try_get(15).map_err(db_error)?,
        payment_method: row.try_get(16).map_err(db_error)?,
        amount_minor: row.try_get(17).map_err(db_error)?,
        reminder_minutes: row.try_get(18).map_err(db_error)?,
        notes: row.try_get(19).map_err(db_error)?,
        import_fingerprint: row.try_get(20).map_err(db_error)?,
        created_at: row.try_get(21).map_err(db_error)?,
        updated_at: row.try_get(22).map_err(db_error)?,
    })
}

async fn load_profile_account_details(
    database: &Database,
    account_profile_id: &str,
) -> Result<(AppointmentAccountDetails, Option<String>), String> {
    let row = sqlx::query(
        "SELECT p.account_name, p.server, p.specialization, p.gear_score,
                c.password AS account_password
         FROM account_profiles p
         LEFT JOIN account_profile_credentials c ON c.profile_id = p.id
         WHERE p.id = ?",
    )
    .bind(account_profile_id)
    .fetch_optional(database.pool())
    .await
    .map_err(db_error)?
    .ok_or_else(|| format!("关联的账号档案不存在: {account_profile_id}"))?;

    Ok((
        AppointmentAccountDetails {
            specialization: row.try_get("specialization").map_err(db_error)?,
            gear_score: row.try_get("gear_score").map_err(db_error)?,
            server: row.try_get("server").map_err(db_error)?,
            account_name: row.try_get("account_name").map_err(db_error)?,
        },
        row.try_get("account_password").map_err(db_error)?,
    ))
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

fn validate_appointment_filters(
    filters: &AppointmentFilters,
    require_date_range: bool,
) -> Result<(), String> {
    match (&filters.from, &filters.to) {
        (Some(from), Some(to)) => {
            validate_filter_date(Some(from), "开始日期")?;
            validate_filter_date(Some(to), "结束日期")?;
            if from > to {
                return Err("开始日期不能晚于结束日期".into());
            }
        }
        (None, None) if !require_date_range => {}
        (None, None) => return Err("预约范围查询必须同时提供开始日期和结束日期".into()),
        _ => return Err("开始日期和结束日期必须同时提供".into()),
    }
    Ok(())
}

fn push_appointment_filter_clauses<'args>(
    builder: &mut QueryBuilder<'args, Sqlite>,
    filters: &AppointmentFilters,
) {
    if let Some(from) = &filters.from {
        builder
            .push(" AND a.service_date >= ")
            .push_bind(from.clone());
    }
    if let Some(to) = &filters.to {
        builder
            .push(" AND a.service_date <= ")
            .push_bind(to.clone());
    }
    if let Some(query) = filters
        .query
        .clone()
        .and_then(|value| optional_text(Some(value)))
    {
        let pattern = format!("%{}%", query.to_lowercase());
        builder
            .push(" AND (lower(a.contact_name) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(a.content, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(a.notes, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(a.account_name, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(a.account_server, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(a.account_specialization, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" OR lower(coalesce(a.account_gear_score, '')) LIKE ")
            .push_bind(pattern)
            .push(")");
    }
    if let Some(mode) = filters.mode {
        builder.push(" AND a.mode = ").push_bind(mode.as_str());
    }
    if let Some(status) = filters.progress_status {
        match status {
            AppointmentProgressStatus::Scheduled => {
                builder.push(
                    " AND a.service_status = 'scheduled'
                      AND (a.mode = 'entertainment' OR a.settlement_status = 'unsettled')",
                );
            }
            AppointmentProgressStatus::InProgress => {
                builder.push(
                    " AND a.service_status = 'in_progress'
                      AND (a.mode = 'entertainment' OR a.settlement_status = 'unsettled')",
                );
            }
            AppointmentProgressStatus::PendingSettlement => {
                builder.push(
                    " AND a.mode = 'business' AND a.service_status = 'completed'
                      AND a.settlement_status = 'unsettled'",
                );
            }
            AppointmentProgressStatus::Completed => {
                builder.push(
                    " AND ((a.mode = 'entertainment' AND a.service_status = 'completed')
                      OR (a.mode = 'business' AND a.service_status != 'cancelled'
                          AND a.settlement_status = 'settled'))",
                );
            }
            AppointmentProgressStatus::Cancelled => {
                builder.push(" AND a.service_status = 'cancelled'");
            }
        }
    }
    if let Some(status) = filters.service_status {
        builder
            .push(" AND a.service_status = ")
            .push_bind(status.as_str());
    }
    if let Some(status) = filters.settlement_status {
        builder
            .push(" AND a.settlement_status = ")
            .push_bind(status.as_str());
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_appointments(
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    filters: AppointmentFilters,
) -> Result<Vec<Appointment>, String> {
    access.require_unlocked()?;
    list_appointments_impl(database.inner(), filters).await
}

pub(crate) async fn list_appointments_impl(
    database: &Database,
    filters: AppointmentFilters,
) -> Result<Vec<Appointment>, String> {
    validate_appointment_filters(&filters, true)?;
    let mut builder = QueryBuilder::<Sqlite>::new(APPOINTMENT_WITH_CREDENTIAL_SELECT);
    builder.push(" WHERE 1 = 1");
    push_appointment_filter_clauses(&mut builder, &filters);
    builder.push(" ORDER BY a.service_date DESC, a.starts_at DESC, a.created_at DESC, a.id DESC");

    let mut rows = builder.build().fetch(database.pool());
    let mut appointments = Vec::with_capacity(256);
    while let Some(row) = rows.try_next().await.map_err(db_error)? {
        appointments.push(appointment_from_selected_row(&row)?);
    }
    Ok(appointments)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_appointment_page(
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    filters: AppointmentFilters,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<AppointmentPage, String> {
    access.require_unlocked()?;
    list_appointment_page_impl(database.inner(), filters, page, page_size).await
}

pub(crate) async fn list_appointment_page_impl(
    database: &Database,
    filters: AppointmentFilters,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<AppointmentPage, String> {
    validate_appointment_filters(&filters, false)?;
    let requested_page = page.unwrap_or(1);
    let page_size = page_size.unwrap_or(DEFAULT_PAGE_SIZE);
    if requested_page < 1 {
        return Err("页码必须大于等于 1".into());
    }
    if !(1..=MAX_PAGE_SIZE).contains(&page_size) {
        return Err(format!("每页数量必须在 1 到 {MAX_PAGE_SIZE} 之间"));
    }

    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let mut count_builder =
        QueryBuilder::<Sqlite>::new("SELECT COUNT(*) FROM appointments a WHERE 1 = 1");
    push_appointment_filter_clauses(&mut count_builder, &filters);
    let total_count = count_builder
        .build_query_scalar::<i64>()
        .fetch_one(&mut *transaction)
        .await
        .map_err(db_error)?;
    let total_pages = if total_count == 0 {
        0
    } else {
        (total_count + page_size - 1) / page_size
    };
    let page = requested_page.min(total_pages.max(1));

    let mut page_builder = QueryBuilder::<Sqlite>::new(APPOINTMENT_WITH_CREDENTIAL_SELECT);
    page_builder.push(" WHERE 1 = 1");
    push_appointment_filter_clauses(&mut page_builder, &filters);
    page_builder
        .push(" ORDER BY a.service_date DESC, a.starts_at DESC, a.created_at DESC, a.id DESC")
        .push(" LIMIT ")
        .push_bind(page_size)
        .push(" OFFSET ")
        .push_bind((page - 1).saturating_mul(page_size));
    let rows = page_builder
        .build()
        .fetch_all(&mut *transaction)
        .await
        .map_err(db_error)?;
    transaction.commit().await.map_err(db_error)?;

    let items = rows
        .iter()
        .map(appointment_from_selected_row)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(AppointmentPage {
        items,
        total_count,
        page,
        page_size,
        total_pages,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_appointment_selection(
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    filters: AppointmentFilters,
) -> Result<AppointmentSelectionSnapshot, String> {
    access.require_unlocked()?;
    create_appointment_selection_impl(database.inner(), filters).await
}

pub(crate) async fn create_appointment_selection_impl(
    database: &Database,
    filters: AppointmentFilters,
) -> Result<AppointmentSelectionSnapshot, String> {
    validate_appointment_filters(&filters, false)?;
    let mut builder = QueryBuilder::<Sqlite>::new("SELECT a.id FROM appointments a WHERE 1 = 1");
    push_appointment_filter_clauses(&mut builder, &filters);
    builder.push(" ORDER BY a.service_date DESC, a.starts_at DESC, a.created_at DESC, a.id DESC");
    let ids = builder
        .build_query_scalar::<String>()
        .fetch_all(database.pool())
        .await
        .map_err(db_error)?;

    let token = Uuid::now_v7().to_string();
    let expires_at = Utc::now() + Duration::minutes(SELECTION_TTL_MINUTES);
    let total_count = ids.len() as i64;
    let mut selections = APPOINTMENT_SELECTIONS
        .lock()
        .map_err(|_| "预约批量选择状态不可用".to_string())?;
    selections.retain(|_, selection| selection.expires_at > Utc::now());
    selections.insert(
        token.clone(),
        StoredAppointmentSelection { ids, expires_at },
    );
    Ok(AppointmentSelectionSnapshot {
        token,
        total_count,
        expires_at: expires_at.to_rfc3339(),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_contact_presets(
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    query: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ContactPreset>, String> {
    access.require_unlocked()?;
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
         SELECT ranked.*, c.password AS account_password
         FROM ranked
         LEFT JOIN appointment_credentials c ON c.appointment_id = ranked.id
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
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    id: String,
) -> Result<Appointment, String> {
    access.require_unlocked()?;
    get_appointment_impl(database.inner(), &id).await
}

pub(crate) async fn get_appointment_impl(
    database: &Database,
    id: &str,
) -> Result<Appointment, String> {
    let query = format!("{APPOINTMENT_WITH_CREDENTIAL_SELECT} WHERE a.id = ?");
    let row = sqlx::query(&query)
        .bind(id)
        .fetch_optional(database.pool())
        .await
        .map_err(db_error)?
        .ok_or_else(|| format!("预约不存在: {id}"))?;
    appointment_from_selected_row(&row)
}

pub(crate) async fn get_appointment_account_name_impl(
    database: &Database,
    id: &str,
) -> Result<String, String> {
    let account_name = sqlx::query_scalar::<_, Option<String>>(
        "SELECT account_name FROM appointments WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await
    .map_err(db_error)?
    .ok_or_else(|| format!("预约不存在: {id}"))?;

    account_name
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "该预约未使用账号".to_string())
}

pub(crate) async fn get_appointment_voice_channel_impl(
    database: &Database,
    id: &str,
) -> Result<String, String> {
    let row = sqlx::query("SELECT voice_platform, voice_channel FROM appointments WHERE id = ?")
        .bind(id)
        .fetch_optional(database.pool())
        .await
        .map_err(db_error)?
        .ok_or_else(|| format!("预约不存在: {id}"))?;
    let platform: Option<String> = row.try_get("voice_platform").map_err(db_error)?;
    if platform.as_deref() != Some("yy") {
        return Err("该预约未选择YY语音".to_string());
    }
    let channel: Option<String> = row.try_get("voice_channel").map_err(db_error)?;
    let channel = channel
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "该预约未填写YY频道号".to_string())?;
    if !channel.chars().all(|character| character.is_ascii_digit()) {
        return Err("YY频道号只能包含数字".to_string());
    }
    Ok(channel)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn copy_appointment_account_name(
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    access.require_unlocked()?;
    let account_name = get_appointment_account_name_impl(&database, &id).await?;
    copy_text_to_clipboard(account_name).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn copy_appointment_voice_channel(
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    access.require_unlocked()?;
    let channel = get_appointment_voice_channel_impl(&database, &id).await?;
    copy_text_to_clipboard(channel).await
}

pub(crate) async fn get_appointment_account_password_impl(
    database: &Database,
    id: &str,
) -> Result<String, String> {
    let row = sqlx::query(
        "SELECT a.account_name, c.password
         FROM appointments a
         LEFT JOIN appointment_credentials c ON c.appointment_id = a.id
         WHERE a.id = ?",
    )
    .bind(id)
    .fetch_optional(database.pool())
    .await
    .map_err(db_error)?
    .ok_or_else(|| format!("预约不存在: {id}"))?;
    let account_name: Option<String> = row.try_get("account_name").map_err(db_error)?;
    if account_name
        .as_deref()
        .map(str::trim)
        .is_none_or(str::is_empty)
    {
        return Err("该预约未使用账号".into());
    }
    row.try_get::<Option<String>, _>("password")
        .map_err(db_error)?
        .ok_or_else(|| "该预约没有可用的账号密码".to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn copy_appointment_account_password(
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    access.require_unlocked()?;
    let password = get_appointment_account_password_impl(database.inner(), &id).await?;
    copy_sensitive_text_to_clipboard(password).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_appointment<R: Runtime>(
    app: AppHandle<R>,
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
    input: AppointmentInput,
) -> Result<AppointmentMutationResult, String> {
    access.require_unlocked()?;
    let _operation_guard = backup.lock_data_operation().await;
    let result = create_appointment_impl(database.inner(), input).await?;
    sync_notification(&app, notifications.inner(), &result.appointment);
    Ok(result)
}

async fn prepare_account(
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
            let (details, password) = load_profile_account_details(database, &profile_id).await?;
            let details = normalize_account_details(details)?;
            Ok(PreparedAccount {
                account: Some(AppointmentAccount {
                    specialization: details.specialization,
                    gear_score: details.gear_score,
                    server: details.server,
                    account_name: details.account_name,
                    password: password.clone(),
                }),
                secret_action: password.map_or(SecretAction::None, SecretAction::Set),
            })
        }
        Some(AppointmentAccountInput::Embedded {
            details,
            credential,
        }) => {
            let (password, secret_action) = match credential {
                AppointmentAccountCredentialInput::Keep => {
                    let existing =
                        existing.ok_or("新建预约或原预约没有账号时，临时账号必须填写密码")?;
                    (existing.password.clone(), SecretAction::Keep)
                }
                AppointmentAccountCredentialInput::Replace { password } => {
                    (Some(password.clone()), SecretAction::Set(password))
                }
                AppointmentAccountCredentialInput::CopyFromAppointment {
                    source_appointment_id,
                } => {
                    let source = get_appointment_impl(database, &source_appointment_id).await?;
                    let source_password = source.account.and_then(|account| account.password);
                    if source_password.is_none() {
                        return Err("来源预约没有可沿用的账号密码".into());
                    }
                    (
                        source_password,
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
                    password,
                }),
                secret_action,
            })
        }
    }
}

async fn apply_secret_action(
    transaction: &mut Transaction<'_, Sqlite>,
    appointment_id: &str,
    action: &SecretAction,
) -> Result<(), String> {
    match action {
        SecretAction::Keep => return Ok(()),
        SecretAction::None => {
            sqlx::query("DELETE FROM appointment_credentials WHERE appointment_id = ?")
                .bind(appointment_id)
                .execute(&mut **transaction)
                .await
                .map_err(db_error)?;
        }
        SecretAction::Set(password) => {
            sqlx::query(
                "INSERT INTO appointment_credentials (appointment_id, password)
                 VALUES (?, ?)
                 ON CONFLICT(appointment_id) DO UPDATE SET password = excluded.password",
            )
            .bind(appointment_id)
            .bind(password)
            .execute(&mut **transaction)
            .await
            .map_err(db_error)?;
        }
        SecretAction::CopyFromAppointment(source_id) => {
            let result = sqlx::query(
                "INSERT INTO appointment_credentials (appointment_id, password)
                 SELECT ?, password FROM appointment_credentials WHERE appointment_id = ?
                 ON CONFLICT(appointment_id) DO UPDATE SET password = excluded.password",
            )
            .bind(appointment_id)
            .bind(source_id)
            .execute(&mut **transaction)
            .await
            .map_err(db_error)?;
            if result.rows_affected() == 0 {
                return Err("来源预约没有可沿用的账号密码".into());
            }
        }
    }
    sqlx::query(
        "DELETE FROM legacy_credential_migration
         WHERE target_kind = 'appointment' AND target_id = ?",
    )
    .bind(appointment_id)
    .execute(&mut **transaction)
    .await
    .map_err(db_error)?;
    Ok(())
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
            voice_platform, voice_channel,
            rate_note, payment_method, amount_minor, reminder_minutes, notes,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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

pub(crate) async fn create_appointment_impl(
    database: &Database,
    input: AppointmentInput,
) -> Result<AppointmentMutationResult, String> {
    let mut input = normalize_input(input)?;
    let prepared = prepare_account(database, input.account.take(), None).await?;
    create_prepared_appointment(database, input, prepared).await
}

async fn create_prepared_appointment(
    database: &Database,
    input: NormalizedAppointment,
    prepared: PreparedAccount,
) -> Result<AppointmentMutationResult, String> {
    let id = Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339();
    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    insert_normalized_appointment(
        &mut transaction,
        &id,
        &input,
        prepared.account.as_ref(),
        &now,
    )
    .await?;
    apply_secret_action(&mut transaction, &id, &prepared.secret_action).await?;
    transaction.commit().await.map_err(db_error)?;
    finish_mutation_result(database, &id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn update_appointment<R: Runtime>(
    app: AppHandle<R>,
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
    id: String,
    input: AppointmentInput,
) -> Result<AppointmentMutationResult, String> {
    access.require_unlocked()?;
    let _operation_guard = backup.lock_data_operation().await;
    let result = update_appointment_impl(database.inner(), &id, input).await?;
    sync_notification(&app, notifications.inner(), &result.appointment);
    Ok(result)
}

pub(crate) async fn update_appointment_impl(
    database: &Database,
    id: &str,
    input: AppointmentInput,
) -> Result<AppointmentMutationResult, String> {
    let existing = get_appointment_impl(database, id).await?;
    let mut input = normalize_input(input)?;
    let prepared =
        prepare_account(database, input.account.take(), existing.account.as_ref()).await?;
    let now = next_unique_updated_at(&existing.updated_at);
    let account = prepared.account.as_ref();

    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let result = sqlx::query(
        "UPDATE appointments SET
            service_date = ?, starts_at = ?, ends_at = ?, contact_name = ?, content = ?,
            mode = ?, service_status = ?, settlement_status = ?,
            account_specialization = ?, account_gear_score = ?, account_server = ?,
            account_name = ?, voice_platform = ?, voice_channel = ?, rate_note = ?,
            payment_method = ?, amount_minor = ?, reminder_minutes = ?, notes = ?, updated_at = ?
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
    .await
    .map_err(db_error)?;
    if result.rows_affected() == 0 {
        return Err(format!("预约不存在: {id}"));
    }
    apply_secret_action(&mut transaction, id, &prepared.secret_action).await?;
    transaction.commit().await.map_err(db_error)?;
    finish_mutation_result(database, id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn duplicate_appointment<R: Runtime>(
    app: AppHandle<R>,
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
    id: String,
    service_date: Option<String>,
) -> Result<AppointmentMutationResult, String> {
    access.require_unlocked()?;
    let _operation_guard = backup.lock_data_operation().await;
    let result = duplicate_appointment_impl(database.inner(), &id, service_date).await?;
    sync_notification(&app, notifications.inner(), &result.appointment);
    Ok(result)
}

pub(crate) async fn duplicate_appointment_impl(
    database: &Database,
    id: &str,
    service_date: Option<String>,
) -> Result<AppointmentMutationResult, String> {
    let source = get_appointment_impl(database, id).await?;
    let input = normalize_input(duplicate_input(&source, service_date)?)?;
    let prepared = match source.account {
        Some(account) => {
            let secret_action = account
                .password
                .clone()
                .map_or(SecretAction::None, SecretAction::Set);
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
    create_prepared_appointment(database, input, prepared).await
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

fn parse_date_time(value: &str) -> Result<NaiveDateTime, String> {
    NaiveDateTime::parse_from_str(value, DATE_TIME_FORMAT)
        .map_err(|_| format!("预约时间数据损坏: {value}"))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_appointment(
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
    id: String,
) -> Result<(), String> {
    access.require_unlocked()?;
    let _operation_guard = backup.lock_data_operation().await;
    let ids = normalized_ids(std::slice::from_ref(&id));
    let result = delete_appointments_impl(database.inner(), &ids).await?;
    if result.deleted_count == 0 {
        return Err(format!("预约不存在: {id}"));
    }
    let _ = cancel_appointment_notifications(notifications.inner(), &ids);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_appointments(
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
    selection: AppointmentDeleteSelection,
) -> Result<AppointmentDeleteResult, String> {
    access.require_unlocked()?;
    let _operation_guard = backup.lock_data_operation().await;
    let (ids, consumed_token) = resolve_delete_selection(selection)?;

    match delete_appointments_impl(database.inner(), &ids).await {
        Ok(result) => {
            let _ = cancel_appointment_notifications(notifications.inner(), &ids);
            Ok(result)
        }
        Err(error) => {
            if let Some((token, stored)) = consumed_token
                && stored.expires_at > Utc::now()
                && let Ok(mut selections) = APPOINTMENT_SELECTIONS.lock()
            {
                selections.entry(token).or_insert(stored);
            }
            Err(error)
        }
    }
}

fn normalized_ids(ids: &[String]) -> Vec<String> {
    let mut ids = ids
        .iter()
        .filter_map(|id| {
            let id = id.trim();
            (!id.is_empty()).then(|| id.to_owned())
        })
        .collect::<Vec<_>>();
    ids.sort_unstable();
    ids.dedup();
    ids
}

fn resolve_delete_selection(
    selection: AppointmentDeleteSelection,
) -> Result<ResolvedAppointmentSelection, String> {
    match selection {
        AppointmentDeleteSelection::Explicit { ids } => Ok((normalized_ids(&ids), None)),
        AppointmentDeleteSelection::Token {
            token,
            excluded_ids,
        } => {
            let token = token.trim().to_owned();
            if token.is_empty() {
                return Err("预约批量选择 token 不能为空".into());
            }
            let now = Utc::now();
            let mut selections = APPOINTMENT_SELECTIONS
                .lock()
                .map_err(|_| "预约批量选择状态不可用".to_string())?;
            let Some(stored) = selections.remove(&token) else {
                return Err("预约批量选择已过期、不存在或已使用".into());
            };
            if stored.expires_at <= now {
                return Err("预约批量选择已过期，请重新全选".into());
            }
            let excluded = normalized_ids(&excluded_ids)
                .into_iter()
                .collect::<HashSet<_>>();
            let ids = stored
                .ids
                .iter()
                .filter(|id| !excluded.contains(*id))
                .cloned()
                .collect();
            Ok((ids, Some((token, stored))))
        }
    }
}

pub(crate) async fn delete_appointments_impl(
    database: &Database,
    ids: &[String],
) -> Result<AppointmentDeleteResult, String> {
    let ids = normalized_ids(ids);
    let matched_count = ids.len() as i64;
    if ids.is_empty() {
        return Ok(AppointmentDeleteResult {
            matched_count: 0,
            deleted_count: 0,
        });
    }

    let mut transaction = database.pool().begin().await.map_err(db_error)?;
    let mut deleted_count = 0_i64;
    for chunk in ids.chunks(DELETE_CHUNK_SIZE) {
        let mut migration_delete = QueryBuilder::<Sqlite>::new(
            "DELETE FROM legacy_credential_migration
             WHERE target_kind = 'appointment' AND target_id IN (",
        );
        {
            let mut separated = migration_delete.separated(", ");
            for id in chunk {
                separated.push_bind(id);
            }
        }
        migration_delete.push(")");
        migration_delete
            .build()
            .execute(&mut *transaction)
            .await
            .map_err(db_error)?;

        let mut delete = QueryBuilder::<Sqlite>::new("DELETE FROM appointments WHERE id IN (");
        {
            let mut separated = delete.separated(", ");
            for id in chunk {
                separated.push_bind(id);
            }
        }
        delete.push(")");
        deleted_count += delete
            .build()
            .execute(&mut *transaction)
            .await
            .map_err(db_error)?
            .rows_affected() as i64;
    }
    transaction.commit().await.map_err(db_error)?;
    Ok(AppointmentDeleteResult {
        matched_count,
        deleted_count,
    })
}

#[cfg(test)]
pub(crate) async fn delete_appointment_impl(database: &Database, id: &str) -> Result<(), String> {
    let result = delete_appointments_impl(database, &[id.to_owned()]).await?;
    if result.deleted_count == 0 {
        return Err(format!("预约不存在: {id}"));
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_appointment_service_status<R: Runtime>(
    app: AppHandle<R>,
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
    id: String,
    status: ServiceStatus,
) -> Result<Appointment, String> {
    access.require_unlocked()?;
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
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
) -> Result<usize, String> {
    access.require_unlocked()?;
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
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    backup: State<'_, BackupState>,
    id: String,
    amount_minor: i64,
    payment_method: Option<String>,
) -> Result<Appointment, String> {
    access.require_unlocked()?;
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
         SET service_status = 'completed', settlement_status = 'settled',
             amount_minor = ?, payment_method = ?, updated_at = ?
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
            voice_platform, voice_channel,
            rate_note, payment_method, amount_minor, reminder_minutes, notes,
            import_fingerprint, created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, ?, ?, 'business', ?, ?, ?, ?, ?, ?, ?, ?,
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
    .bind(appointment.voice_platform.map(VoicePlatform::as_str))
    .bind(appointment.voice_channel.as_deref())
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

    #[cfg(not(debug_assertions))]
    use std::{
        future::Future,
        hint::black_box,
        path::{Path, PathBuf},
        time::{Duration as StdDuration, Instant},
    };

    #[cfg(not(debug_assertions))]
    use crate::{
        models::ReportGranularity,
        reports::{get_dashboard_summary_impl, get_revenue_summary_impl},
    };

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

    async fn seed_performance_appointments(database: &Database) {
        sqlx::query(
            "WITH RECURSIVE seq(x) AS (
                SELECT 1
                UNION ALL
                SELECT x + 1 FROM seq WHERE x < 10000
             )
             INSERT INTO appointments (
                id, service_date, starts_at, contact_name, mode,
                service_status, settlement_status, created_at, updated_at
             )
             SELECT printf('perf-%05d', x), '2026-08-03', '2026-08-03T10:00:00',
                    printf('批量-%05d', x), 'business', 'scheduled', 'unsettled',
                    '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z'
             FROM seq",
        )
        .execute(database.pool())
        .await
        .unwrap();
    }

    #[cfg(not(debug_assertions))]
    struct PerformanceDatabaseDir {
        path: PathBuf,
    }

    #[cfg(not(debug_assertions))]
    impl PerformanceDatabaseDir {
        fn create(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!("timekeeper-{label}-{}", Uuid::now_v7()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn database_path(&self) -> PathBuf {
            self.path.join("performance.db")
        }
    }

    #[cfg(not(debug_assertions))]
    impl Drop for PerformanceDatabaseDir {
        fn drop(&mut self) {
            for attempt in 0..20 {
                match std::fs::remove_dir_all(&self.path) {
                    Ok(()) => return,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
                    Err(_) if attempt < 19 => {
                        std::thread::sleep(StdDuration::from_millis(25));
                    }
                    Err(error) => {
                        eprintln!(
                            "failed to clean performance test directory {}: {error}",
                            self.path.display()
                        );
                    }
                }
            }
        }
    }

    #[cfg(not(debug_assertions))]
    fn assert_test_path(path: &Path) {
        assert!(path.starts_with(std::env::temp_dir()));
        assert!(
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("timekeeper-"))
        );
    }

    #[cfg(not(debug_assertions))]
    fn percentile_95(mut samples: Vec<StdDuration>) -> StdDuration {
        assert_eq!(samples.len(), 20);
        samples.sort_unstable();
        samples[18]
    }

    #[cfg(not(debug_assertions))]
    async fn measure_release_p95<F, Fut, T>(
        label: &str,
        limit: StdDuration,
        mut operation: F,
    ) -> StdDuration
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = T>,
    {
        black_box(operation().await);
        let mut samples = Vec::with_capacity(20);
        for _ in 0..20 {
            let started = Instant::now();
            black_box(operation().await);
            samples.push(started.elapsed());
        }
        let p95 = percentile_95(samples);
        println!("PERF {label}: p95={:.2}ms", p95.as_secs_f64() * 1_000.0);
        assert!(
            p95 <= limit,
            "{label} p95 {:.2}ms exceeded {:.2}ms",
            p95.as_secs_f64() * 1_000.0,
            limit.as_secs_f64() * 1_000.0
        );
        p95
    }

    #[cfg(not(debug_assertions))]
    fn remove_selection_token(token: &str) {
        APPOINTMENT_SELECTIONS.lock().unwrap().remove(token);
    }

    #[test]
    fn resolves_cross_midnight_range_and_validates_voice() {
        let (start, end) = resolve_time_range("2026-07-13", Some("23:30"), Some("01:00")).unwrap();
        assert_eq!(start.as_deref(), Some("2026-07-13T23:30:00"));
        assert_eq!(end.as_deref(), Some("2026-07-14T01:00:00"));

        let mut yy = business_input("2026-08-03", "10:00", "11:00");
        yy.voice_platform = Some(VoicePlatform::Yy);
        yy.voice_channel = Some(" 123456 ".into());
        assert_eq!(
            normalize_input(yy).unwrap().voice_channel.as_deref(),
            Some("123456")
        );

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
    fn appointment_credentials_are_transactional_sqlite_snapshots() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            sqlx::query(
                "INSERT INTO account_profiles (
                    id, server, specialization, gear_score, account_name,
                    needs_review, sort_order, created_at, updated_at
                 ) VALUES (
                    'profile-1', '档案区', '输出', '9999', 'profile-account',
                    0, 0, '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z'
                 )",
            )
            .execute(database.pool())
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO account_profile_credentials (profile_id, password)
                 VALUES ('profile-1', 'profile-password')",
            )
            .execute(database.pool())
            .await
            .unwrap();

            let mut from_profile = business_input("2026-08-03", "08:00", "09:00");
            from_profile.account = Some(AppointmentAccountInput::Profile {
                profile_id: "profile-1".into(),
            });
            let profile_appointment = create_appointment_impl(&database, from_profile)
                .await
                .unwrap()
                .appointment;
            assert_eq!(
                profile_appointment
                    .account
                    .as_ref()
                    .and_then(|account| account.password.as_deref()),
                Some("profile-password")
            );

            sqlx::query(
                "UPDATE account_profile_credentials SET password = 'changed-profile'
                 WHERE profile_id = 'profile-1'",
            )
            .execute(database.pool())
            .await
            .unwrap();
            assert_eq!(
                get_appointment_impl(&database, &profile_appointment.id)
                    .await
                    .unwrap()
                    .account
                    .and_then(|account| account.password),
                Some("profile-password".into())
            );

            let mut source_input = business_input("2026-08-03", "09:00", "10:00");
            source_input.account = Some(embedded_account_input(
                "source-account",
                AppointmentAccountCredentialInput::Replace {
                    password: "source-password".into(),
                },
            ));
            let source = create_appointment_impl(&database, source_input)
                .await
                .unwrap()
                .appointment;

            let mut copied_input = business_input("2026-08-03", "10:00", "11:00");
            copied_input.account = Some(embedded_account_input(
                "copied-account",
                AppointmentAccountCredentialInput::CopyFromAppointment {
                    source_appointment_id: source.id.clone(),
                },
            ));
            let copied = create_appointment_impl(&database, copied_input)
                .await
                .unwrap()
                .appointment;
            assert_eq!(
                copied
                    .account
                    .as_ref()
                    .and_then(|account| account.password.as_deref()),
                Some("source-password")
            );

            let mut keep_input = business_input("2026-08-04", "10:00", "11:00");
            keep_input.account = Some(embedded_account_input(
                "renamed-account",
                AppointmentAccountCredentialInput::Keep,
            ));
            let kept = update_appointment_impl(&database, &copied.id, keep_input)
                .await
                .unwrap()
                .appointment;
            assert_eq!(
                kept.account
                    .as_ref()
                    .and_then(|account| account.password.as_deref()),
                Some("source-password")
            );

            let duplicate =
                duplicate_appointment_impl(&database, &source.id, Some("2026-08-05".into()))
                    .await
                    .unwrap()
                    .appointment;
            assert_eq!(
                duplicate
                    .account
                    .as_ref()
                    .and_then(|account| account.password.as_deref()),
                Some("source-password")
            );

            delete_appointment_impl(&database, &source.id)
                .await
                .unwrap();
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM appointment_credentials WHERE appointment_id = ?",
                )
                .bind(&source.id)
                .fetch_one(database.pool())
                .await
                .unwrap(),
                0
            );
        });
    }

    #[test]
    fn range_list_requires_both_bounds() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            create_appointment_impl(&database, business_input("2026-08-03", "10:00", "11:00"))
                .await
                .unwrap();

            assert!(
                list_appointments_impl(&database, AppointmentFilters::default())
                    .await
                    .unwrap_err()
                    .contains("同时提供")
            );
            assert!(
                list_appointments_impl(
                    &database,
                    AppointmentFilters {
                        from: Some("2026-08-01".into()),
                        ..AppointmentFilters::default()
                    },
                )
                .await
                .unwrap_err()
                .contains("同时提供")
            );
            assert_eq!(
                list_appointments_impl(
                    &database,
                    AppointmentFilters {
                        from: Some("2026-08-01".into()),
                        to: Some("2026-08-07".into()),
                        ..AppointmentFilters::default()
                    },
                )
                .await
                .unwrap()
                .len(),
                1
            );
        });
    }

    #[test]
    fn paginates_ten_thousand_rows_with_stable_order() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            seed_performance_appointments(&database).await;

            let first =
                list_appointment_page_impl(&database, AppointmentFilters::default(), None, None)
                    .await
                    .unwrap();
            assert_eq!(first.total_count, 10_000);
            assert_eq!(first.total_pages, 100);
            assert_eq!(first.items.len(), 100);
            assert_eq!(first.items[0].id, "perf-10000");
            assert_eq!(first.items[99].id, "perf-09901");

            let second = list_appointment_page_impl(
                &database,
                AppointmentFilters::default(),
                Some(2),
                Some(100),
            )
            .await
            .unwrap();
            assert_eq!(second.items[0].id, "perf-09900");
            let clamped = list_appointment_page_impl(
                &database,
                AppointmentFilters::default(),
                Some(101),
                Some(100),
            )
            .await
            .unwrap();
            assert_eq!(clamped.page, 100);
            assert_eq!(clamped.items.len(), 100);
            assert_eq!(clamped.items[0].id, "perf-00100");
            assert!(
                list_appointment_page_impl(
                    &database,
                    AppointmentFilters::default(),
                    Some(1),
                    Some(MAX_PAGE_SIZE + 1),
                )
                .await
                .unwrap_err()
                .contains("每页数量")
            );
        });
    }

    #[test]
    fn range_and_notification_queries_use_v5_indexes() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let history_details = sqlx::query(
                "EXPLAIN QUERY PLAN
                 SELECT id FROM appointments
                 WHERE service_date >= '2026-08-01' AND service_date <= '2026-08-31'
                 ORDER BY service_date DESC, starts_at DESC, created_at DESC, id DESC
                 LIMIT 100",
            )
            .fetch_all(database.pool())
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.get::<String, _>("detail"))
            .collect::<Vec<_>>()
            .join("；");
            assert!(
                history_details.contains("idx_appointments_history_sort"),
                "unexpected history plan: {history_details}"
            );

            let notification_details = sqlx::query(
                "EXPLAIN QUERY PLAN
                 SELECT id FROM appointments
                 WHERE service_status != 'cancelled'
                   AND service_status != 'completed'
                   AND service_date >= '2026-08-03'
                   AND reminder_minutes IS NOT NULL
                   AND starts_at IS NOT NULL
                   AND starts_at > '2026-08-03T00:00:00'
                 ORDER BY starts_at, id",
            )
            .fetch_all(database.pool())
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.get::<String, _>("detail"))
            .collect::<Vec<_>>()
            .join("；");
            assert!(
                notification_details.contains("idx_appointments_pending_notifications"),
                "unexpected notification plan: {notification_details}"
            );
        });
    }

    #[test]
    fn selection_token_deletes_exact_snapshot_with_exclusions() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            seed_performance_appointments(&database).await;
            sqlx::query(
                "INSERT INTO appointment_credentials (appointment_id, password)
                 VALUES ('perf-10000', 'password')",
            )
            .execute(database.pool())
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO legacy_credential_migration (
                    target_kind, target_id, source_kind, source_id
                 ) VALUES ('appointment', 'perf-10000', 'appointment', 'perf-10000')",
            )
            .execute(database.pool())
            .await
            .unwrap();

            let snapshot = create_appointment_selection_impl(
                &database,
                AppointmentFilters {
                    query: Some("批量".into()),
                    ..AppointmentFilters::default()
                },
            )
            .await
            .unwrap();
            assert_eq!(snapshot.total_count, 10_000);

            let (ids, consumed) = resolve_delete_selection(AppointmentDeleteSelection::Token {
                token: snapshot.token.clone(),
                excluded_ids: vec!["perf-00001".into()],
            })
            .unwrap();
            assert!(consumed.is_some());
            assert_eq!(ids.len(), 9_999);
            let result = delete_appointments_impl(&database, &ids).await.unwrap();
            assert_eq!(result.matched_count, 9_999);
            assert_eq!(result.deleted_count, 9_999);
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM appointments")
                    .fetch_one(database.pool())
                    .await
                    .unwrap(),
                1
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM appointment_credentials")
                    .fetch_one(database.pool())
                    .await
                    .unwrap(),
                0
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM legacy_credential_migration
                     WHERE target_kind = 'appointment'",
                )
                .fetch_one(database.pool())
                .await
                .unwrap(),
                0
            );
            assert!(
                resolve_delete_selection(AppointmentDeleteSelection::Token {
                    token: snapshot.token,
                    excluded_ids: Vec::new(),
                })
                .unwrap_err()
                .contains("已使用")
            );
        });
    }

    #[test]
    fn expired_selection_is_rejected_without_deleting() {
        let token = format!("expired-{}", Uuid::now_v7());
        APPOINTMENT_SELECTIONS.lock().unwrap().insert(
            token.clone(),
            StoredAppointmentSelection {
                ids: vec!["appointment-1".into()],
                expires_at: Utc::now() - Duration::seconds(1),
            },
        );
        assert!(
            resolve_delete_selection(AppointmentDeleteSelection::Token {
                token,
                excluded_ids: Vec::new(),
            })
            .unwrap_err()
            .contains("已过期")
        );
    }

    #[test]
    fn batch_delete_rolls_back_on_database_failure() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            for id in ["atomic-1", "atomic-2", "atomic-3"] {
                sqlx::query(
                    "INSERT INTO appointments (
                        id, service_date, contact_name, mode, service_status,
                        settlement_status, created_at, updated_at
                     ) VALUES (?, '2026-08-03', ?, 'business', 'scheduled',
                               'unsettled', '2026-08-03T00:00:00Z',
                               '2026-08-03T00:00:00Z')",
                )
                .bind(id)
                .bind(id)
                .execute(database.pool())
                .await
                .unwrap();
                sqlx::query(
                    "INSERT INTO appointment_credentials (appointment_id, password)
                     VALUES (?, 'password')",
                )
                .bind(id)
                .execute(database.pool())
                .await
                .unwrap();
                sqlx::query(
                    "INSERT INTO legacy_credential_migration (
                        target_kind, target_id, source_kind, source_id
                     ) VALUES ('appointment', ?, 'appointment', ?)",
                )
                .bind(id)
                .bind(id)
                .execute(database.pool())
                .await
                .unwrap();
            }
            sqlx::raw_sql(
                "CREATE TRIGGER reject_atomic_delete
                 BEFORE DELETE ON appointments
                 WHEN OLD.id = 'atomic-2'
                 BEGIN
                     SELECT RAISE(ABORT, 'forced delete failure');
                 END;",
            )
            .execute(database.pool())
            .await
            .unwrap();

            let ids = vec![
                "atomic-1".to_string(),
                "atomic-2".to_string(),
                "atomic-3".to_string(),
            ];
            assert!(delete_appointments_impl(&database, &ids).await.is_err());
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM appointments")
                    .fetch_one(database.pool())
                    .await
                    .unwrap(),
                3
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM appointment_credentials")
                    .fetch_one(database.pool())
                    .await
                    .unwrap(),
                3
            );
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM legacy_credential_migration
                     WHERE target_kind = 'appointment'",
                )
                .fetch_one(database.pool())
                .await
                .unwrap(),
                3
            );
        });
    }

    #[cfg(not(debug_assertions))]
    #[test]
    #[ignore = "run explicitly as an isolated Windows Release performance acceptance test"]
    fn release_ten_thousand_appointment_performance_targets() {
        run_async(async {
            let query_directory = PerformanceDatabaseDir::create("query-performance");
            assert_test_path(&query_directory.path);
            let database = Database::initialize(query_directory.database_path())
                .await
                .unwrap();
            seed_performance_appointments(&database).await;
            sqlx::query(
                "UPDATE appointments
                 SET ends_at = '2026-08-03T11:00:00',
                     service_status = 'completed',
                     settlement_status = 'settled',
                     amount_minor = 8000,
                     payment_method = '微信'",
            )
            .execute(database.pool())
            .await
            .unwrap();

            measure_release_p95("history-page", StdDuration::from_millis(300), || async {
                list_appointment_page_impl(
                    &database,
                    AppointmentFilters::default(),
                    Some(1),
                    Some(100),
                )
                .await
                .unwrap()
            })
            .await;
            measure_release_p95("like-search", StdDuration::from_millis(300), || async {
                list_appointment_page_impl(
                    &database,
                    AppointmentFilters {
                        query: Some("批量-09".into()),
                        ..AppointmentFilters::default()
                    },
                    Some(1),
                    Some(100),
                )
                .await
                .unwrap()
            })
            .await;

            let warm_selection =
                create_appointment_selection_impl(&database, AppointmentFilters::default())
                    .await
                    .unwrap();
            remove_selection_token(&warm_selection.token);
            let mut selection_samples = Vec::with_capacity(20);
            for _ in 0..20 {
                let started = Instant::now();
                let snapshot =
                    create_appointment_selection_impl(&database, AppointmentFilters::default())
                        .await
                        .unwrap();
                selection_samples.push(started.elapsed());
                assert_eq!(snapshot.total_count, 10_000);
                remove_selection_token(&snapshot.token);
            }
            let selection_p95 = percentile_95(selection_samples);
            println!(
                "PERF selection-token: p95={:.2}ms",
                selection_p95.as_secs_f64() * 1_000.0
            );
            assert!(selection_p95 <= StdDuration::from_millis(300));

            measure_release_p95("today-range", StdDuration::from_millis(250), || async {
                list_appointments_impl(
                    &database,
                    AppointmentFilters {
                        from: Some("2026-08-03".into()),
                        to: Some("2026-08-03".into()),
                        ..AppointmentFilters::default()
                    },
                )
                .await
                .unwrap()
            })
            .await;
            measure_release_p95("calendar-range", StdDuration::from_millis(250), || async {
                list_appointments_impl(
                    &database,
                    AppointmentFilters {
                        from: Some("2026-08-01".into()),
                        to: Some("2026-08-31".into()),
                        ..AppointmentFilters::default()
                    },
                )
                .await
                .unwrap()
            })
            .await;
            measure_release_p95("dashboard", StdDuration::from_millis(250), || async {
                get_dashboard_summary_impl(&database, "2026-08-03")
                    .await
                    .unwrap()
            })
            .await;
            measure_release_p95("all-revenue", StdDuration::from_millis(300), || async {
                get_revenue_summary_impl(&database, "", "", ReportGranularity::Day)
                    .await
                    .unwrap()
            })
            .await;

            database.pool().close().await;
            drop(database);
            let query_directory_path = query_directory.path.clone();
            drop(query_directory);
            assert!(!query_directory_path.exists());

            let delete_directory = PerformanceDatabaseDir::create("delete-performance");
            assert_test_path(&delete_directory.path);
            let delete_database = Database::initialize(delete_directory.database_path())
                .await
                .unwrap();
            seed_performance_appointments(&delete_database).await;
            sqlx::query(
                "INSERT INTO appointment_credentials (appointment_id, password)
                 SELECT id, 'performance-password' FROM appointments",
            )
            .execute(delete_database.pool())
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO legacy_credential_migration (
                    target_kind, target_id, source_kind, source_id
                 )
                 SELECT 'appointment', id, 'appointment', id FROM appointments",
            )
            .execute(delete_database.pool())
            .await
            .unwrap();
            let snapshot =
                create_appointment_selection_impl(&delete_database, AppointmentFilters::default())
                    .await
                    .unwrap();
            let (ids, consumed) = resolve_delete_selection(AppointmentDeleteSelection::Token {
                token: snapshot.token,
                excluded_ids: Vec::new(),
            })
            .unwrap();
            assert!(consumed.is_some());
            assert_eq!(ids.len(), 10_000);

            let delete_started = Instant::now();
            let result = delete_appointments_impl(&delete_database, &ids)
                .await
                .unwrap();
            let delete_elapsed = delete_started.elapsed();
            println!(
                "PERF delete-10000: elapsed={:.2}ms",
                delete_elapsed.as_secs_f64() * 1_000.0
            );
            assert!(delete_elapsed <= StdDuration::from_secs(2));
            assert_eq!(result.matched_count, 10_000);
            assert_eq!(result.deleted_count, 10_000);
            for table in [
                "appointments",
                "appointment_credentials",
                "legacy_credential_migration",
            ] {
                let sql = format!("SELECT COUNT(*) FROM {table}");
                let remaining = sqlx::query_scalar::<_, i64>(&sql)
                    .fetch_one(delete_database.pool())
                    .await
                    .unwrap();
                assert_eq!(remaining, 0, "{table} should be empty after delete");
            }

            delete_database.pool().close().await;
            drop(delete_database);
            let delete_directory_path = delete_directory.path.clone();
            drop(delete_directory);
            assert!(!delete_directory_path.exists());
        });
    }
}
