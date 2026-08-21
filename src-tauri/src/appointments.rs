use std::str::FromStr;

use chrono::{
    DateTime, Days, Duration, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc,
};
use futures_util::TryStreamExt;
use sqlx::{QueryBuilder, Row, Sqlite, Transaction, sqlite::SqliteRow};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use uuid::Uuid;

use crate::{
    app_access::AppAccessState,
    backup::BackupState,
    db::{Database, ImportWriteResult, JS_SAFE_INTEGER_MAX, literal_like_pattern},
    importer::LegacyAppointment,
    models::{
        Appointment, AppointmentAccount, AppointmentAccountCredentialInput,
        AppointmentAccountDetails, AppointmentAccountInput, AppointmentAccountSource,
        AppointmentConflict, AppointmentDeleteResult, AppointmentDeleteSelection,
        AppointmentFilters, AppointmentInput, AppointmentMode, AppointmentMutationResult,
        AppointmentPage, AppointmentProgressStatus, AppointmentSelectionSnapshot, ContactPreset,
        EmbeddedAccountPreset, ServiceStatus, SettlementStatus, VoicePlatform,
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
const STATUS_SYNC_INTERVAL_SECONDS: u64 = 30;
const STATUS_SYNCED_EVENT: &str = "appointment-statuses-synced";
const OPERATION_WARNING_EVENT: &str = "operation-warning";
const MAX_REMINDER_MINUTES: i64 = 1_440;
const APPOINTMENT_WITH_CREDENTIAL_SELECT: &str =
    "SELECT a.id, a.service_date, a.starts_at, a.ends_at, a.contact_name, a.content,
            a.mode, a.service_status, a.settlement_status,
            a.account_specialization, a.account_gear_score, a.account_server, a.account_name,
            a.account_source, a.account_character_name,
            a.voice_platform, a.voice_channel, a.rate_note, a.payment_method,
            a.amount_minor, a.reminder_minutes, a.notes, a.import_fingerprint,
            a.created_at, a.updated_at, c.password AS account_password
     FROM appointments a
     LEFT JOIN appointment_credentials c ON c.appointment_id = a.id";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationWarning {
    operation: &'static str,
    message: String,
}

mod selection;

fn sync_notification<R: Runtime>(
    app: &AppHandle<R>,
    notifications: &NotificationState,
    appointment: &Appointment,
) {
    if cancel_appointment_notification(notifications, &appointment.id).is_err() {
        emit_notification_warning(app, "无法取消旧的预约提醒");
    }
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
    if schedule_reminder(
        app,
        notifications,
        &appointment.id,
        starts_at,
        reminder_minutes,
        &appointment.contact_name,
        appointment.content.as_deref(),
    )
    .is_err()
    {
        emit_notification_warning(app, "预约已保存，但提醒调度失败");
    }
}

fn emit_notification_warning<R: Runtime>(app: &AppHandle<R>, message: impl Into<String>) {
    let warning = OperationWarning {
        operation: "appointmentNotification",
        message: message.into(),
    };
    let _ = app.emit(OPERATION_WARNING_EVENT, warning);
}

fn schedule_reminder<R: Runtime>(
    app: &AppHandle<R>,
    notifications: &NotificationState,
    appointment_id: &str,
    starts_at: &str,
    reminder_minutes: i64,
    contact_name: &str,
    content: Option<&str>,
) -> Result<(), String> {
    if !(0..=MAX_REMINDER_MINUTES).contains(&reminder_minutes) {
        return Err("提醒分钟数必须在 0 到 1440 之间".into());
    }
    let naive = NaiveDateTime::parse_from_str(starts_at, DATE_TIME_FORMAT)
        .map_err(|_| "预约提醒时间数据不合法".to_string())?;
    let offset = FixedOffset::east_opt(8 * 60 * 60).ok_or("无法创建东八区时区")?;
    let local_start = offset
        .from_local_datetime(&naive)
        .single()
        .ok_or("预约提醒时间数据不合法")?;
    if local_start.with_timezone(&Utc) <= Utc::now() {
        return Ok(());
    }
    let notify_at = local_start
        .checked_sub_signed(Duration::minutes(reminder_minutes))
        .ok_or("预约提醒时间超出支持范围")?
        .with_timezone(&Utc);
    let body = match content {
        Some(content) if !content.trim().is_empty() => {
            format!("{} · {}", contact_name, content.trim())
        }
        _ => contact_name.to_owned(),
    };
    schedule_appointment_notification(
        notifications,
        app.clone(),
        appointment_id,
        notify_at,
        "预约即将开始",
        &body,
    )
    .map_err(|error| error.to_string())
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
        let Ok(starts_at) = row.try_get::<String, _>("starts_at") else {
            emit_notification_warning(&app, "跳过一条无法读取的预约提醒");
            continue;
        };
        let result = schedule_reminder(
            &app,
            notifications,
            &row.try_get::<String, _>("id").unwrap_or_default(),
            &starts_at,
            row.try_get("reminder_minutes").unwrap_or(-1),
            &row.try_get::<String, _>("contact_name").unwrap_or_default(),
            row.try_get::<Option<String>, _>("content")
                .unwrap_or_default()
                .as_deref(),
        );
        if result.is_err() {
            emit_notification_warning(&app, "跳过一条无效的预约提醒");
        }
    }
    Ok(())
}

pub(crate) async fn restore_notifications_for_ids<R: Runtime>(
    app: AppHandle<R>,
    database: &Database,
    notifications: &NotificationState,
    ids: &[String],
) -> Result<(), String> {
    let ids = selection::normalized_ids(ids);
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
            let Ok(starts_at) = row.try_get::<String, _>("starts_at") else {
                emit_notification_warning(&app, "跳过一条无法读取的预约提醒");
                continue;
            };
            let result = schedule_reminder(
                &app,
                notifications,
                &row.try_get::<String, _>("id").unwrap_or_default(),
                &starts_at,
                row.try_get("reminder_minutes").unwrap_or(-1),
                &row.try_get::<String, _>("contact_name").unwrap_or_default(),
                row.try_get::<Option<String>, _>("content")
                    .unwrap_or_default()
                    .as_deref(),
            );
            if result.is_err() {
                emit_notification_warning(&app, "跳过一条无效的预约提醒");
            }
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
                    AppointmentAccountCredentialInput::None => {
                        return Err("一次性账号不能使用无密码凭据状态".into());
                    }
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
            AppointmentAccountInput::Snapshot {
                source,
                character_name,
                details,
                credential,
            } => {
                let details = normalize_account_details(details)?;
                let character_name = match source {
                    AppointmentAccountSource::Profile => optional_text(character_name),
                    AppointmentAccountSource::Embedded => None,
                };
                let credential = match credential {
                    AppointmentAccountCredentialInput::None => {
                        AppointmentAccountCredentialInput::None
                    }
                    AppointmentAccountCredentialInput::Keep => {
                        AppointmentAccountCredentialInput::Keep
                    }
                    AppointmentAccountCredentialInput::Replace { password } => {
                        if password.is_empty() {
                            return Err("账号密码不能为空".into());
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
                Ok(AppointmentAccountInput::Snapshot {
                    source,
                    character_name,
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

    if input
        .amount_minor
        .is_some_and(|amount| !(0..=JS_SAFE_INTEGER_MAX).contains(&amount))
    {
        return Err("金额必须是非负安全整数".into());
    }
    if input
        .reminder_minutes
        .is_some_and(|minutes| !(0..=MAX_REMINDER_MINUTES).contains(&minutes))
    {
        return Err("提醒分钟数必须在 0 到 1440 之间".into());
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
                input.service_status,
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
            let source = row
                .try_get::<Option<String>, _>("account_source")
                .unwrap_or(None)
                .unwrap_or_else(|| AppointmentAccountSource::Embedded.as_str().to_owned());
            Ok::<AppointmentAccount, String>(AppointmentAccount {
                source: AppointmentAccountSource::from_str(&source)?,
                character_name: row.try_get("account_character_name").unwrap_or(None),
                specialization: row.try_get("account_specialization").map_err(db_error)?,
                gear_score: row.try_get("account_gear_score").map_err(db_error)?,
                server: row.try_get("account_server").map_err(db_error)?,
                account_name,
                password: row.try_get("account_password").map_err(db_error)?,
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
                source: AppointmentAccountSource::from_str(
                    row.try_get::<&str, _>(13).map_err(db_error)?,
                )?,
                character_name: row.try_get(14).map_err(db_error)?,
                specialization: row.try_get(9).map_err(db_error)?,
                gear_score: row.try_get(10).map_err(db_error)?,
                server: row.try_get(11).map_err(db_error)?,
                account_name,
                password: row.try_get(25).map_err(db_error)?,
            })
        })
        .transpose()?;
    let voice_platform = row
        .try_get::<Option<&str>, _>(15)
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
        voice_channel: row.try_get(16).map_err(db_error)?,
        rate_note: row.try_get(17).map_err(db_error)?,
        payment_method: row.try_get(18).map_err(db_error)?,
        amount_minor: row.try_get(19).map_err(db_error)?,
        reminder_minutes: row.try_get(20).map_err(db_error)?,
        notes: row.try_get(21).map_err(db_error)?,
        import_fingerprint: row.try_get(22).map_err(db_error)?,
        created_at: row.try_get(23).map_err(db_error)?,
        updated_at: row.try_get(24).map_err(db_error)?,
    })
}

async fn load_profile_account_details(
    database: &Database,
    account_profile_id: &str,
) -> Result<(AppointmentAccountDetails, Option<String>, Option<String>), String> {
    let row = sqlx::query(
        "SELECT p.account_name, p.server, p.character_name, p.specialization, p.gear_score,
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
        row.try_get("character_name").map_err(db_error)?,
        row.try_get("account_password").map_err(db_error)?,
    ))
}

async fn find_conflicts(
    transaction: &mut Transaction<'_, Sqlite>,
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
    .fetch_all(&mut **transaction)
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
        let pattern = literal_like_pattern(&query.to_lowercase());
        builder
            .push(" AND (lower(a.contact_name) LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR lower(coalesce(a.content, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR lower(coalesce(a.notes, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR lower(coalesce(a.voice_channel, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR lower(coalesce(a.account_name, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR lower(coalesce(a.account_server, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR lower(coalesce(a.account_character_name, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR lower(coalesce(a.account_specialization, '')) LIKE ")
            .push_bind(pattern.clone())
            .push(" ESCAPE '\\' OR lower(coalesce(a.account_gear_score, '')) LIKE ")
            .push_bind(pattern)
            .push(" ESCAPE '\\')");
    }
    if let Some(mode) = filters.mode {
        builder.push(" AND a.mode = ").push_bind(mode.as_str());
    }
    if let Some(status) = filters.progress_status {
        match status {
            AppointmentProgressStatus::Scheduled => {
                builder.push(" AND a.service_status = 'scheduled'");
            }
            AppointmentProgressStatus::InProgress => {
                builder.push(" AND a.service_status = 'in_progress'");
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
                      OR (a.mode = 'business' AND a.service_status = 'completed'
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

    let total_count = ids.len() as i64;
    let (token, expires_at) = selection::store(ids)?;
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
    let pattern = query
        .as_ref()
        .map(|query| literal_like_pattern(&query.to_lowercase()));
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
              AND (? IS NULL OR lower(contact_name) LIKE ? ESCAPE '\\')
         )
         SELECT ranked.*, c.password AS account_password
         FROM ranked
         LEFT JOIN appointment_credentials c ON c.appointment_id = ranked.id
         WHERE (? IS NOT NULL OR contact_rank = 1)
         ORDER BY service_date DESC,
                  CASE WHEN starts_at IS NULL THEN 1 ELSE 0 END,
                  starts_at DESC,
                  created_at DESC,
                  id DESC
         LIMIT ?",
    )
    .bind(pattern.as_deref())
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
                service_date: appointment.service_date,
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

#[tauri::command(rename_all = "camelCase")]
pub async fn list_recent_embedded_account_presets(
    access: State<'_, AppAccessState>,
    database: State<'_, Database>,
    limit: Option<i64>,
) -> Result<Vec<EmbeddedAccountPreset>, String> {
    access.require_unlocked()?;
    list_recent_embedded_account_presets_impl(database.inner(), limit).await
}

pub(crate) async fn list_recent_embedded_account_presets_impl(
    database: &Database,
    limit: Option<i64>,
) -> Result<Vec<EmbeddedAccountPreset>, String> {
    let limit = limit.unwrap_or(10);
    if !(1..=50).contains(&limit) {
        return Err("一次性账号模板数量必须在 1 到 50 之间".into());
    }

    let rows = sqlx::query(
        "WITH ranked AS (
            SELECT a.id AS source_appointment_id,
                   a.account_name,
                   a.account_specialization,
                   a.account_server,
                   a.account_gear_score,
                   CASE WHEN c.appointment_id IS NULL THEN 0 ELSE 1 END AS has_password,
                   a.service_date,
                   a.starts_at,
                   a.created_at,
                   ROW_NUMBER() OVER (
                       PARTITION BY lower(trim(a.account_name))
                       ORDER BY a.service_date DESC,
                                CASE WHEN a.starts_at IS NULL THEN 1 ELSE 0 END,
                                a.starts_at DESC,
                                a.created_at DESC,
                                a.id DESC
                   ) AS account_rank
            FROM appointments a
            LEFT JOIN appointment_credentials c ON c.appointment_id = a.id
            WHERE a.service_status != 'cancelled'
              AND a.account_source = 'embedded'
              AND a.account_name IS NOT NULL
              AND length(trim(a.account_name)) > 0
         )
         SELECT source_appointment_id, account_name, account_specialization,
                account_server, account_gear_score, has_password
         FROM ranked
         WHERE account_rank = 1
         ORDER BY service_date DESC,
                  CASE WHEN starts_at IS NULL THEN 1 ELSE 0 END,
                  starts_at DESC,
                  created_at DESC,
                  source_appointment_id DESC
         LIMIT ?",
    )
    .bind(limit)
    .fetch_all(database.pool())
    .await
    .map_err(db_error)?;

    rows.iter()
        .map(|row| {
            Ok(EmbeddedAccountPreset {
                source_appointment_id: row.try_get("source_appointment_id").map_err(db_error)?,
                account_name: row
                    .try_get::<String, _>("account_name")
                    .map_err(db_error)?
                    .trim()
                    .to_owned(),
                specialization: row.try_get("account_specialization").map_err(db_error)?,
                server: row.try_get("account_server").map_err(db_error)?,
                gear_score: row.try_get("account_gear_score").map_err(db_error)?,
                has_password: row.try_get::<i64, _>("has_password").map_err(db_error)? != 0,
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
            let (details, character_name, password) =
                load_profile_account_details(database, &profile_id).await?;
            let details = normalize_account_details(details)?;
            Ok(PreparedAccount {
                account: Some(AppointmentAccount {
                    source: AppointmentAccountSource::Profile,
                    character_name,
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
            prepare_snapshot_account(
                database,
                AppointmentAccountSource::Embedded,
                None,
                details,
                credential,
                existing,
            )
            .await
        }
        Some(AppointmentAccountInput::Snapshot {
            source,
            character_name,
            details,
            credential,
        }) => {
            prepare_snapshot_account(
                database,
                source,
                character_name,
                details,
                credential,
                existing,
            )
            .await
        }
    }
}

async fn prepare_snapshot_account(
    database: &Database,
    source: AppointmentAccountSource,
    character_name: Option<String>,
    details: AppointmentAccountDetails,
    credential: AppointmentAccountCredentialInput,
    existing: Option<&AppointmentAccount>,
) -> Result<PreparedAccount, String> {
    let (password, secret_action) = match credential {
        AppointmentAccountCredentialInput::None => (None, SecretAction::None),
        AppointmentAccountCredentialInput::Keep => {
            let existing =
                existing.ok_or("新建预约或原预约没有账号时，账号密码不能使用保留状态")?;
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
            source,
            character_name,
            specialization: details.specialization,
            gear_score: details.gear_score,
            server: details.server,
            account_name: details.account_name,
            password,
        }),
        secret_action,
    })
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
            account_source, account_character_name,
            voice_platform, voice_channel,
            rate_note, payment_method, amount_minor, reminder_minutes, notes,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
    .bind(account.map(|account| account.source.as_str()))
    .bind(account.and_then(|account| account.character_name.as_deref()))
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
    transaction: &mut Transaction<'_, Sqlite>,
    id: &str,
) -> Result<AppointmentMutationResult, String> {
    let query = format!("{APPOINTMENT_WITH_CREDENTIAL_SELECT} WHERE a.id = ?");
    let row = sqlx::query(&query)
        .bind(id)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(db_error)?
        .ok_or_else(|| format!("预约不存在: {id}"))?;
    let appointment = appointment_from_selected_row(&row)?;
    let conflicts = find_conflicts(
        transaction,
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
    let result = finish_mutation_result(&mut transaction, &id).await?;
    transaction.commit().await.map_err(db_error)?;
    Ok(result)
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
            account_name = ?, account_source = ?, account_character_name = ?,
            voice_platform = ?, voice_channel = ?, rate_note = ?,
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
    .bind(account.map(|account| account.source.as_str()))
    .bind(account.and_then(|account| account.character_name.as_deref()))
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
    if input.amount_minor.is_some() {
        sqlx::query(
            "UPDATE legacy_numeric_repair_issues
             SET resolved_at = COALESCE(resolved_at, ?)
             WHERE entity_kind = 'appointment' AND entity_id = ?
               AND field_name = 'amount_minor'",
        )
        .bind(&now)
        .bind(id)
        .execute(&mut *transaction)
        .await
        .map_err(db_error)?;
    }
    apply_secret_action(&mut transaction, id, &prepared.secret_action).await?;
    let result = finish_mutation_result(&mut transaction, id).await?;
    transaction.commit().await.map_err(db_error)?;
    Ok(result)
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
    let ids = selection::normalized_ids(std::slice::from_ref(&id));
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
    let (ids, consumed_token) = selection::resolve(selection)?;

    match delete_appointments_impl(database.inner(), &ids).await {
        Ok(result) => {
            let _ = cancel_appointment_notifications(notifications.inner(), &ids);
            Ok(result)
        }
        Err(error) => {
            if let Some(consumed) = consumed_token {
                selection::restore_if_valid(consumed);
            }
            Err(error)
        }
    }
}

pub(crate) async fn delete_appointments_impl(
    database: &Database,
    ids: &[String],
) -> Result<AppointmentDeleteResult, String> {
    let ids = selection::normalized_ids(ids);
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

pub fn spawn_appointment_status_sync_task<R: Runtime>(app: AppHandle<R>) {
    let (access, database, notifications, backup) = {
        let Some(access) = app.try_state::<AppAccessState>() else {
            return;
        };
        let Some(database) = app.try_state::<Database>() else {
            return;
        };
        let Some(notifications) = app.try_state::<NotificationState>() else {
            return;
        };
        let Some(backup) = app.try_state::<BackupState>() else {
            return;
        };
        (
            AppAccessState::clone(access.inner()),
            Database::clone(database.inner()),
            NotificationState::clone(notifications.inner()),
            BackupState::clone(backup.inner()),
        )
    };

    tauri::async_runtime::spawn(async move {
        let mut interval =
            tokio::time::interval(std::time::Duration::from_secs(STATUS_SYNC_INTERVAL_SECONDS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut error_reported = false;
        loop {
            interval.tick().await;
            if access.require_unlocked().is_err() {
                continue;
            }

            let _operation_guard = backup.lock_data_operation().await;
            let Some(offset) = FixedOffset::east_opt(8 * 60 * 60) else {
                continue;
            };
            let now = Utc::now().with_timezone(&offset).naive_local();
            match sync_appointment_service_statuses_impl(&database, now).await {
                Ok(changed) => {
                    error_reported = false;
                    if changed.is_empty() {
                        continue;
                    }
                    for appointment in &changed {
                        sync_notification(&app, &notifications, appointment);
                    }
                    let _ = app.emit(STATUS_SYNCED_EVENT, changed.len());
                }
                Err(error) if !error_reported => {
                    eprintln!("automatic appointment status sync failed: {error}");
                    error_reported = true;
                }
                Err(_) => {}
            }
        }
    });
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
    if !(0..=JS_SAFE_INTEGER_MAX).contains(&amount_minor) {
        return Err("结算金额必须是非负安全整数".into());
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

    if appointment
        .amount_minor
        .is_some_and(|amount| !(0..=JS_SAFE_INTEGER_MAX).contains(&amount))
    {
        return Err(format!(
            "联系人 {} 的导入金额必须是非负安全整数",
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
            account_source, account_character_name,
            voice_platform, voice_channel,
            rate_note, payment_method, amount_minor, reminder_minutes, notes,
            import_fingerprint, created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, ?, ?, 'business', ?, ?, ?, ?, ?, ?, 'embedded', NULL, ?, ?,
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
#[path = "appointments/tests.rs"]
mod tests;
