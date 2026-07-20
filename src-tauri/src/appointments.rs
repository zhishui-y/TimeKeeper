use std::str::FromStr;

use chrono::{Days, Duration, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use sqlx::{QueryBuilder, Row, Sqlite, Transaction, sqlite::SqliteRow};
use tauri::{AppHandle, Runtime, State};
use uuid::Uuid;

use crate::{
    backup::BackupState,
    db::{Database, ImportWriteResult},
    importer::LegacyAppointment,
    models::{
        AccountSnapshot, Appointment, AppointmentConflict, AppointmentFilters, AppointmentInput,
        AppointmentMode, AppointmentMutationResult, ServiceStatus, SettlementStatus,
    },
    notifications::{
        NotificationState, cancel_appointment_notification, schedule_appointment_notification,
    },
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
    account_profile_id: Option<String>,
    rate_note: Option<String>,
    payment_method: Option<String>,
    amount_minor: Option<i64>,
    reminder_minutes: Option<i64>,
    notes: Option<String>,
}

fn optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
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

    Ok(NormalizedAppointment {
        service_date: date.format(DATE_FORMAT).to_string(),
        starts_at,
        ends_at,
        contact_name,
        content: optional_text(input.content),
        mode: input.mode,
        service_status: input.service_status,
        settlement_status,
        account_profile_id: optional_text(input.account_profile_id),
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
    let snapshot_json: Option<String> = row.try_get("account_snapshot_json").map_err(db_error)?;
    let account_snapshot = snapshot_json
        .map(|json| {
            serde_json::from_str(&json).map_err(|error| format!("账号快照数据损坏: {error}"))
        })
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
        account_profile_id: row.try_get("account_profile_id").map_err(db_error)?,
        account_snapshot,
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

async fn load_account_snapshot(
    database: &Database,
    account_profile_id: &str,
) -> Result<AccountSnapshot, String> {
    let row = sqlx::query(
        "SELECT account_name, contact_name, server, character_name, specialization, gear_score
         FROM account_profiles WHERE id = ?",
    )
    .bind(account_profile_id)
    .fetch_optional(database.pool())
    .await
    .map_err(db_error)?
    .ok_or_else(|| format!("关联的账号档案不存在: {account_profile_id}"))?;

    Ok(AccountSnapshot {
        account_name: row.try_get("account_name").map_err(db_error)?,
        contact_name: row.try_get("contact_name").map_err(db_error)?,
        server: row.try_get("server").map_err(db_error)?,
        character_name: row.try_get("character_name").map_err(db_error)?,
        specialization: row.try_get("specialization").map_err(db_error)?,
        gear_score: row.try_get("gear_score").map_err(db_error)?,
    })
}

async fn load_account_snapshot_in_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
    account_profile_id: &str,
) -> Result<AccountSnapshot, String> {
    let row = sqlx::query(
        "SELECT account_name, contact_name, server, character_name, specialization, gear_score
         FROM account_profiles WHERE id = ?",
    )
    .bind(account_profile_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(db_error)?
    .ok_or_else(|| format!("关联的账号档案不存在: {account_profile_id}"))?;

    Ok(AccountSnapshot {
        account_name: row.try_get("account_name").map_err(db_error)?,
        contact_name: row.try_get("contact_name").map_err(db_error)?,
        server: row.try_get("server").map_err(db_error)?,
        character_name: row.try_get("character_name").map_err(db_error)?,
        specialization: row.try_get("specialization").map_err(db_error)?,
        gear_score: row.try_get("gear_score").map_err(db_error)?,
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
    if let Some(account_profile_id) = optional_text(filters.account_profile_id) {
        builder
            .push(" AND account_profile_id = ")
            .push_bind(account_profile_id);
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
    let result = create_appointment_impl(database.inner(), input).await?;
    sync_notification(&app, notifications.inner(), &result.appointment);
    Ok(result)
}

pub(crate) async fn create_appointment_impl(
    database: &Database,
    input: AppointmentInput,
) -> Result<AppointmentMutationResult, String> {
    let input = normalize_input(input)?;
    let snapshot = match input.account_profile_id.as_deref() {
        Some(id) => Some(load_account_snapshot(database, id).await?),
        None => None,
    };
    let snapshot_json = snapshot
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| format!("序列化账号快照失败: {error}"))?;
    let id = Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO appointments (
            id, service_date, starts_at, ends_at, contact_name, content, mode,
            service_status, settlement_status, account_profile_id, account_snapshot_json,
            rate_note, payment_method, amount_minor, reminder_minutes, notes,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&input.service_date)
    .bind(&input.starts_at)
    .bind(&input.ends_at)
    .bind(&input.contact_name)
    .bind(&input.content)
    .bind(input.mode.as_str())
    .bind(input.service_status.as_str())
    .bind(input.settlement_status.as_str())
    .bind(&input.account_profile_id)
    .bind(snapshot_json)
    .bind(&input.rate_note)
    .bind(&input.payment_method)
    .bind(input.amount_minor)
    .bind(input.reminder_minutes)
    .bind(&input.notes)
    .bind(&now)
    .bind(&now)
    .execute(database.pool())
    .await
    .map_err(db_error)?;

    let appointment = get_appointment_impl(database, &id).await?;
    let conflicts = find_conflicts(
        database,
        appointment.starts_at.as_deref(),
        appointment.ends_at.as_deref(),
        Some(&id),
    )
    .await?;
    Ok(AppointmentMutationResult {
        appointment,
        conflicts,
    })
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
    let input = normalize_input(input)?;
    let snapshot = match input.account_profile_id.as_deref() {
        Some(profile_id)
            if existing.account_profile_id.as_deref() == Some(profile_id)
                && existing.account_snapshot.is_some() =>
        {
            existing.account_snapshot
        }
        Some(profile_id) => Some(load_account_snapshot(database, profile_id).await?),
        None => existing.account_snapshot,
    };
    let snapshot_json = snapshot
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| format!("序列化账号快照失败: {error}"))?;
    let now = Utc::now().to_rfc3339();

    let result = sqlx::query(
        "UPDATE appointments SET
            service_date = ?, starts_at = ?, ends_at = ?, contact_name = ?, content = ?,
            mode = ?, service_status = ?, settlement_status = ?, account_profile_id = ?,
            account_snapshot_json = ?, rate_note = ?, payment_method = ?, amount_minor = ?,
            reminder_minutes = ?, notes = ?, updated_at = ?
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
    .bind(&input.account_profile_id)
    .bind(snapshot_json)
    .bind(&input.rate_note)
    .bind(&input.payment_method)
    .bind(input.amount_minor)
    .bind(input.reminder_minutes)
    .bind(&input.notes)
    .bind(now)
    .bind(id)
    .execute(database.pool())
    .await
    .map_err(db_error)?;
    if result.rows_affected() == 0 {
        return Err(format!("预约不存在: {id}"));
    }

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

    create_appointment_impl(
        database,
        AppointmentInput {
            service_date: service_date.unwrap_or(source.service_date),
            start_time,
            end_time,
            contact_name: source.contact_name,
            content: source.content,
            mode: source.mode,
            service_status: ServiceStatus::Scheduled,
            settlement_status,
            account_profile_id: source.account_profile_id,
            rate_note: source.rate_note,
            payment_method: source.payment_method,
            amount_minor: source.amount_minor,
            reminder_minutes: source.reminder_minutes,
            notes: source.notes,
        },
    )
    .await
}

fn parse_date_time(value: &str) -> Result<NaiveDateTime, String> {
    NaiveDateTime::parse_from_str(value, DATE_TIME_FORMAT)
        .map_err(|_| format!("预约时间数据损坏: {value}"))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_appointment(
    database: State<'_, Database>,
    notifications: State<'_, NotificationState>,
    backup: State<'_, BackupState>,
    id: String,
) -> Result<(), String> {
    let _operation_guard = backup.lock_data_operation().await;
    delete_appointment_impl(database.inner(), &id).await?;
    let _ = cancel_appointment_notification(notifications.inner(), &id);
    Ok(())
}

pub(crate) async fn delete_appointment_impl(database: &Database, id: &str) -> Result<(), String> {
    let result = sqlx::query("DELETE FROM appointments WHERE id = ?")
        .bind(id)
        .execute(database.pool())
        .await
        .map_err(db_error)?;
    if result.rows_affected() == 0 {
        return Err(format!("预约不存在: {id}"));
    }
    Ok(())
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
    account_profile_id: Option<&str>,
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

    let snapshot = match account_profile_id {
        Some(id) => Some(load_account_snapshot_in_transaction(transaction, id).await?),
        None => appointment
            .account_name
            .as_ref()
            .map(|account_name| AccountSnapshot {
                account_name: account_name.clone(),
                contact_name: Some(appointment.contact_name.clone()),
                server: appointment.server.clone(),
                character_name: None,
                specialization: appointment.specialization.clone(),
                gear_score: appointment.gear_score.clone(),
            }),
    };
    let snapshot_json = snapshot
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| format!("序列化导入账号快照失败: {error}"))?;
    let id = Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO appointments (
            id, service_date, starts_at, ends_at, contact_name, content, mode,
            service_status, settlement_status, account_profile_id, account_snapshot_json,
            rate_note, payment_method, amount_minor, reminder_minutes, notes,
            import_fingerprint, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'business', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(appointment.service_date.to_string())
    .bind(starts_at)
    .bind(ends_at)
    .bind(appointment.contact_name.trim())
    .bind(appointment.content.as_deref())
    .bind(service_status.as_str())
    .bind(settlement_status.as_str())
    .bind(account_profile_id)
    .bind(snapshot_json)
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
            account_profile_id: None,
            rate_note: Some("80/小时".into()),
            payment_method: None,
            amount_minor: Some(8_000),
            reminder_minutes: Some(30),
            notes: None,
        }
    }

    #[test]
    fn resolves_cross_midnight_range() {
        let (start, end) = resolve_time_range("2026-07-13", Some("23:30"), Some("01:00")).unwrap();
        assert_eq!(start.as_deref(), Some("2026-07-13T23:30:00"));
        assert_eq!(end.as_deref(), Some("2026-07-14T01:00:00"));
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
            let first = insert_imported_appointment(&mut transaction, &appointment, None)
                .await
                .unwrap();
            let second = insert_imported_appointment(&mut transaction, &appointment, None)
                .await
                .unwrap();
            assert_eq!((first.inserted, first.skipped), (1, 0));
            assert_eq!((second.inserted, second.skipped), (0, 1));
            assert_eq!(first.record_id, second.record_id);
            transaction.commit().await.unwrap();
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

            let mut changed = business_input("2026-07-13", "20:30", "22:00");
            changed.service_status = ServiceStatus::Completed;
            let updated = update_appointment_impl(&database, &created.appointment.id, changed)
                .await
                .unwrap();
            assert_eq!(updated.appointment.service_status, ServiceStatus::Completed);
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

            delete_appointment_impl(&database, &duplicate.appointment.id)
                .await
                .unwrap();
            assert!(
                get_appointment_impl(&database, &duplicate.appointment.id)
                    .await
                    .is_err()
            );
        });
    }
}
