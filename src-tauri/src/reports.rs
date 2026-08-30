use std::{
    collections::{BTreeMap, HashSet},
    str::FromStr,
};

use chrono::{Datelike, Days, Duration, Months, NaiveDate, NaiveDateTime, Utc};
use sqlx::Row;
use tauri::State;

use crate::{
    app_access::AppAccessState,
    appointments::{get_appointment_impl, list_appointments_impl},
    db::{Database, JS_SAFE_INTEGER_MAX},
    models::{
        Appointment, AppointmentFilters, AppointmentMode, DashboardSummary, ReportGranularity,
        RevenueBreakdownItem, RevenuePoint, RevenueSummary, ServiceStatus, SettlementStatus,
    },
};

const DATE_FORMAT: &str = "%Y-%m-%d";
const DATE_TIME_FORMAT: &str = "%Y-%m-%dT%H:%M:%S";

fn parse_date(value: &str, field: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value.trim(), DATE_FORMAT)
        .map_err(|_| format!("{field}必须使用 YYYY-MM-DD 格式"))
}

fn db_error(error: sqlx::Error) -> String {
    format!("数据库操作失败: {error}")
}

fn week_start(date: NaiveDate) -> Result<NaiveDate, String> {
    date.checked_sub_days(Days::new(date.weekday().num_days_from_monday().into()))
        .ok_or_else(|| "周起始日期超出支持范围".to_string())
}

fn month_start(date: NaiveDate) -> Result<NaiveDate, String> {
    NaiveDate::from_ymd_opt(date.year(), date.month(), 1)
        .ok_or_else(|| "月份超出支持范围".to_string())
}

fn period_key(date: NaiveDate, granularity: ReportGranularity) -> Result<String, String> {
    match granularity {
        ReportGranularity::Day => Ok(date.format(DATE_FORMAT).to_string()),
        ReportGranularity::Week => Ok(week_start(date)?.format(DATE_FORMAT).to_string()),
        ReportGranularity::Month => Ok(date.format("%Y-%m").to_string()),
    }
}

fn empty_points(
    from: NaiveDate,
    to: NaiveDate,
    granularity: ReportGranularity,
) -> Result<BTreeMap<String, RevenuePoint>, String> {
    let mut points = BTreeMap::new();
    let mut cursor = match granularity {
        ReportGranularity::Day => from,
        ReportGranularity::Week => week_start(from)?,
        ReportGranularity::Month => month_start(from)?,
    };

    while cursor <= to {
        let key = period_key(cursor, granularity)?;
        points.insert(
            key.clone(),
            RevenuePoint {
                period: key,
                settled_minor: 0,
                unsettled_minor: 0,
                pending_count: 0,
                business_hours: 0.0,
                appointment_count: 0,
            },
        );
        cursor = match granularity {
            ReportGranularity::Day => cursor.checked_add_days(Days::new(1)),
            ReportGranularity::Week => cursor.checked_add_days(Days::new(7)),
            ReportGranularity::Month => cursor.checked_add_months(Months::new(1)),
        }
        .ok_or_else(|| "报表日期范围超出支持范围".to_string())?;
    }
    Ok(points)
}

fn duration_hours(starts_at: Option<&str>, ends_at: Option<&str>) -> Result<f64, String> {
    let (Some(starts_at), Some(ends_at)) = (starts_at, ends_at) else {
        return Ok(0.0);
    };
    let start = NaiveDateTime::parse_from_str(starts_at, DATE_TIME_FORMAT)
        .map_err(|_| format!("预约开始时间数据损坏: {starts_at}"))?;
    let end = NaiveDateTime::parse_from_str(ends_at, DATE_TIME_FORMAT)
        .map_err(|_| format!("预约结束时间数据损坏: {ends_at}"))?;
    if end <= start {
        return Err("预约结束时间没有晚于开始时间".into());
    }
    Ok((end - start).num_minutes() as f64 / 60.0)
}

fn round_hours(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn revenue_contact_name(value: &str) -> String {
    let trimmed = value.trim();
    let Some(prefix) = trimmed.get(..2) else {
        return trimmed.to_owned();
    };
    if !prefix.eq_ignore_ascii_case("qq") {
        return trimmed.to_owned();
    }

    let Some(suffix) = trimmed[2..].trim_start().strip_prefix('|') else {
        return trimmed.to_owned();
    };
    let suffix = suffix.trim();
    if suffix.is_empty() {
        trimmed.to_owned()
    } else {
        suffix.to_owned()
    }
}

async fn sum_minor(database: &Database, sql: &str, values: &[&str]) -> Result<i64, String> {
    let mut query = sqlx::query(sql);
    for value in values {
        query = query.bind(*value);
    }
    let rows = query.fetch_all(database.pool()).await.map_err(db_error)?;
    let mut total = 0_i64;
    for row in rows {
        let amount = row
            .try_get::<Option<i64>, _>("amount_minor")
            .map_err(db_error)?
            .unwrap_or(0);
        total = checked_add_money(total, amount)?;
    }
    Ok(total)
}

fn checked_add_money(total: i64, amount: i64) -> Result<i64, String> {
    let sum = i128::from(total) + i128::from(amount);
    if !(0..=i128::from(JS_SAFE_INTEGER_MAX)).contains(&sum) {
        return Err("报表金额合计超出安全整数范围".into());
    }
    i64::try_from(sum).map_err(|_| "报表金额合计超出支持范围".to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_dashboard_summary(
    database: State<'_, Database>,
    access: State<'_, AppAccessState>,
    date: String,
) -> Result<DashboardSummary, String> {
    access.require_unlocked()?;
    get_dashboard_summary_impl(database.inner(), &date).await
}

pub(crate) async fn get_dashboard_summary_impl(
    database: &Database,
    date: &str,
) -> Result<DashboardSummary, String> {
    let local_now = Utc::now().naive_utc() + Duration::hours(8);
    get_dashboard_summary_at(database, date, local_now).await
}

async fn get_dashboard_summary_at(
    database: &Database,
    date: &str,
    local_now: NaiveDateTime,
) -> Result<DashboardSummary, String> {
    let date_value = parse_date(date, "日期")?;
    let week_from = week_start(date_value)?;
    let week_to = week_from
        .checked_add_days(Days::new(6))
        .ok_or_else(|| "周结束日期超出支持范围".to_string())?;
    let normalized_date = date_value.format(DATE_FORMAT).to_string();
    let week_from = week_from.format(DATE_FORMAT).to_string();
    let week_to = week_to.format(DATE_FORMAT).to_string();

    let today_settled_minor = sum_minor(
        database,
        "SELECT amount_minor FROM appointments
         WHERE service_date = ? AND mode = 'business' AND service_status != 'cancelled'
           AND settlement_status = 'settled'",
        &[&normalized_date],
    )
    .await?;
    let week_settled_minor = sum_minor(
        database,
        "SELECT amount_minor FROM appointments
         WHERE service_date >= ? AND service_date <= ? AND mode = 'business'
           AND service_status != 'cancelled' AND settlement_status = 'settled'",
        &[&week_from, &week_to],
    )
    .await?;
    let pending_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM appointments
         WHERE mode = 'business' AND service_status = 'completed'
           AND settlement_status = 'unsettled'",
    )
    .fetch_one(database.pool())
    .await
    .map_err(db_error)?;

    let apply_time_cutoff = i64::from(date_value == local_now.date());
    let cutoff = local_now.format(DATE_TIME_FORMAT).to_string();
    let next_id: Option<String> = sqlx::query(
        "SELECT id FROM appointments
         WHERE service_date >= ? AND service_status IN ('scheduled', 'in_progress')
           AND (
             service_status = 'in_progress' OR ? = 0 OR service_date > ?
             OR starts_at IS NULL OR starts_at >= ?
           )
         ORDER BY CASE WHEN service_status = 'in_progress' THEN 0 ELSE 1 END,
           service_date,
           CASE WHEN starts_at IS NULL THEN 1 ELSE 0 END,
           starts_at, created_at
         LIMIT 1",
    )
    .bind(&normalized_date)
    .bind(apply_time_cutoff)
    .bind(&normalized_date)
    .bind(cutoff)
    .fetch_optional(database.pool())
    .await
    .map_err(db_error)?
    .map(|row| row.try_get("id").map_err(db_error))
    .transpose()?;
    let next_appointment = match next_id {
        Some(id) => Some(get_appointment_impl(database, &id).await?),
        None => None,
    };

    Ok(DashboardSummary {
        today_settled_minor,
        week_settled_minor,
        pending_count,
        next_appointment,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_revenue_summary(
    database: State<'_, Database>,
    access: State<'_, AppAccessState>,
    from: String,
    to: String,
    granularity: ReportGranularity,
) -> Result<RevenueSummary, String> {
    access.require_unlocked()?;
    get_revenue_summary_impl(database.inner(), &from, &to, granularity).await
}

pub(crate) async fn get_revenue_summary_impl(
    database: &Database,
    from: &str,
    to: &str,
    granularity: ReportGranularity,
) -> Result<RevenueSummary, String> {
    let from = from.trim();
    let to = to.trim();
    if from.is_empty() != to.is_empty() {
        return Err("开始日期和结束日期必须同时填写，或同时留空查看全部记录".into());
    }

    let (from_date, to_date) = if from.is_empty() {
        let today = (Utc::now().naive_utc() + Duration::hours(8)).date();
        let today_text = today.format(DATE_FORMAT).to_string();
        let row = sqlx::query(
            "SELECT MIN(service_date) AS first_date
             FROM appointments
             WHERE mode = 'business' AND service_status != 'cancelled'
               AND settlement_status = 'settled' AND COALESCE(amount_minor, 0) > 0
               AND service_date <= ?",
        )
        .bind(&today_text)
        .fetch_one(database.pool())
        .await
        .map_err(db_error)?;
        let first_date: Option<String> = row.try_get("first_date").map_err(db_error)?;
        let first_date = first_date
            .map(|value| parse_date(&value, "数据库最早收入日期"))
            .transpose()?
            .unwrap_or(today);
        (first_date, today)
    } else {
        (parse_date(from, "开始日期")?, parse_date(to, "结束日期")?)
    };
    if from_date > to_date {
        return Err("开始日期不能晚于结束日期".into());
    }

    let normalized_from = from_date.format(DATE_FORMAT).to_string();
    let normalized_to = to_date.format(DATE_FORMAT).to_string();
    let rows = sqlx::query(
        "SELECT service_date, starts_at, ends_at, contact_name, service_status, settlement_status,
                amount_minor, payment_method
         FROM appointments
         WHERE service_date >= ? AND service_date <= ?
           AND mode = 'business' AND service_status != 'cancelled'
         ORDER BY service_date, starts_at",
    )
    .bind(&normalized_from)
    .bind(&normalized_to)
    .fetch_all(database.pool())
    .await
    .map_err(db_error)?;

    let mut points = empty_points(from_date, to_date, granularity)?;
    let mut payment_methods = BTreeMap::<String, (i64, i64)>::new();
    let mut contacts = BTreeMap::<String, (i64, i64)>::new();
    let mut settled_minor = 0_i64;
    let mut unsettled_minor = 0_i64;
    let mut pending_count = 0_i64;
    let mut business_hours = 0.0_f64;
    let mut completed_count = 0_i64;

    for row in &rows {
        let service_date_text: String = row.try_get("service_date").map_err(db_error)?;
        let service_date = parse_date(&service_date_text, "数据库服务日期")?;
        let key = period_key(service_date, granularity)?;
        let point = points
            .get_mut(&key)
            .ok_or_else(|| format!("报表分组缺少周期: {key}"))?;
        let service_status = ServiceStatus::from_str(
            &row.try_get::<String, _>("service_status")
                .map_err(db_error)?,
        )?;
        let settlement_status = SettlementStatus::from_str(
            &row.try_get::<String, _>("settlement_status")
                .map_err(db_error)?,
        )?;
        let amount_minor: Option<i64> = row.try_get("amount_minor").map_err(db_error)?;
        let amount_minor = amount_minor.unwrap_or(0);

        point.appointment_count = point
            .appointment_count
            .checked_add(1)
            .ok_or_else(|| "报表预约数量超出支持范围".to_string())?;
        match settlement_status {
            SettlementStatus::Settled => {
                settled_minor = checked_add_money(settled_minor, amount_minor)?;
                point.settled_minor = checked_add_money(point.settled_minor, amount_minor)?;
                let payment_method: Option<String> =
                    row.try_get("payment_method").map_err(db_error)?;
                let name = payment_method
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "未填写".to_string());
                let payment_entry = payment_methods.entry(name).or_default();
                payment_entry.0 = checked_add_money(payment_entry.0, amount_minor)?;
                payment_entry.1 = payment_entry
                    .1
                    .checked_add(1)
                    .ok_or_else(|| "报表预约数量超出支持范围".to_string())?;

                let contact_name: String = row.try_get("contact_name").map_err(db_error)?;
                let contact_name = revenue_contact_name(&contact_name);
                let contact_entry = contacts.entry(contact_name).or_default();
                contact_entry.0 = checked_add_money(contact_entry.0, amount_minor)?;
                contact_entry.1 = contact_entry
                    .1
                    .checked_add(1)
                    .ok_or_else(|| "报表预约数量超出支持范围".to_string())?;
            }
            SettlementStatus::Unsettled => {
                unsettled_minor = checked_add_money(unsettled_minor, amount_minor)?;
                point.unsettled_minor = checked_add_money(point.unsettled_minor, amount_minor)?;
                if service_status == ServiceStatus::Completed {
                    pending_count = pending_count
                        .checked_add(1)
                        .ok_or_else(|| "报表预约数量超出支持范围".to_string())?;
                    point.pending_count = point
                        .pending_count
                        .checked_add(1)
                        .ok_or_else(|| "报表预约数量超出支持范围".to_string())?;
                }
            }
            SettlementStatus::NotApplicable => {
                return Err("业务预约包含不适用的结算状态".into());
            }
        }

        if service_status == ServiceStatus::Completed {
            completed_count = completed_count
                .checked_add(1)
                .ok_or_else(|| "报表预约数量超出支持范围".to_string())?;
            let starts_at: Option<String> = row.try_get("starts_at").map_err(db_error)?;
            let ends_at: Option<String> = row.try_get("ends_at").map_err(db_error)?;
            let hours = duration_hours(starts_at.as_deref(), ends_at.as_deref())?;
            business_hours += hours;
            point.business_hours += hours;
        }
    }

    let mut payment_methods: Vec<_> = payment_methods
        .into_iter()
        .map(
            |(name, (amount_minor, appointment_count))| RevenueBreakdownItem {
                name,
                amount_minor,
                appointment_count,
            },
        )
        .collect();
    payment_methods.sort_by(|left, right| {
        right
            .amount_minor
            .cmp(&left.amount_minor)
            .then_with(|| left.name.cmp(&right.name))
    });
    let mut contacts: Vec<_> = contacts
        .into_iter()
        .map(
            |(name, (amount_minor, appointment_count))| RevenueBreakdownItem {
                name,
                amount_minor,
                appointment_count,
            },
        )
        .collect();
    contacts.sort_by(|left, right| {
        right
            .amount_minor
            .cmp(&left.amount_minor)
            .then_with(|| left.name.cmp(&right.name))
    });

    let business_hours = round_hours(business_hours);
    let average_hourly_minor = if business_hours > 0.0 {
        let average = (settled_minor as f64 / business_hours).round();
        if !average.is_finite() || !(0.0..=JS_SAFE_INTEGER_MAX as f64).contains(&average) {
            return Err("报表平均时薪超出安全整数范围".into());
        }
        average as i64
    } else {
        0
    };
    let points = points
        .into_values()
        .map(|mut point| {
            point.business_hours = round_hours(point.business_hours);
            point
        })
        .collect();

    Ok(RevenueSummary {
        from: normalized_from,
        to: normalized_to,
        settled_minor,
        unsettled_minor,
        pending_count,
        business_hours,
        average_hourly_minor,
        appointment_count: i64::try_from(rows.len())
            .map_err(|_| "报表预约数量超出支持范围".to_string())?,
        completed_count,
        payment_methods,
        contacts,
        points,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_revenue_contact_appointments(
    database: State<'_, Database>,
    access: State<'_, AppAccessState>,
    from: String,
    to: String,
    contact_names: Vec<String>,
) -> Result<Vec<Appointment>, String> {
    access.require_unlocked()?;
    list_revenue_contact_appointments_impl(database.inner(), &from, &to, contact_names).await
}

pub(crate) async fn list_revenue_contact_appointments_impl(
    database: &Database,
    from: &str,
    to: &str,
    contact_names: Vec<String>,
) -> Result<Vec<Appointment>, String> {
    let from = from.trim();
    let to = to.trim();
    if from.is_empty() || to.is_empty() {
        return Err("收益对象明细必须同时提供开始日期和结束日期".into());
    }
    let from_date = parse_date(from, "开始日期")?;
    let to_date = parse_date(to, "结束日期")?;
    if from_date > to_date {
        return Err("开始日期不能晚于结束日期".into());
    }

    let mut normalized_names = HashSet::with_capacity(contact_names.len());
    for name in contact_names {
        let name = name.trim();
        if name.is_empty() {
            return Err("收款对象不能为空".into());
        }
        normalized_names.insert(name.to_owned());
    }
    if normalized_names.is_empty() {
        return Err("收款对象不能为空".into());
    }

    let appointments = list_appointments_impl(
        database,
        AppointmentFilters {
            from: Some(from_date.format(DATE_FORMAT).to_string()),
            to: Some(to_date.format(DATE_FORMAT).to_string()),
            mode: Some(AppointmentMode::Business),
            settlement_status: Some(SettlementStatus::Settled),
            ..AppointmentFilters::default()
        },
    )
    .await?;

    Ok(appointments
        .into_iter()
        .filter(|appointment| {
            appointment.service_status != ServiceStatus::Cancelled
                && normalized_names.contains(&revenue_contact_name(&appointment.contact_name))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        appointments::create_appointment_impl,
        models::{AppointmentInput, AppointmentMode},
    };

    fn run_async<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(future)
    }

    fn input(
        date: &str,
        start: &str,
        end: &str,
        settlement_status: SettlementStatus,
        amount_minor: i64,
    ) -> AppointmentInput {
        AppointmentInput {
            service_date: date.into(),
            start_time: Some(start.into()),
            end_time: Some(end.into()),
            contact_name: "测试联系人".into(),
            content: None,
            mode: AppointmentMode::Business,
            service_status: ServiceStatus::Completed,
            settlement_status,
            account: None,
            voice_platform: None,
            voice_channel: None,
            rate_note: None,
            payment_method: Some("微信".into()),
            amount_minor: Some(amount_minor),
            reminder_minutes: None,
            notes: None,
        }
    }

    #[test]
    fn normalizes_qq_contact_prefixes_for_revenue_only() {
        for (input, expected) in [
            ("QQ|可乐", "可乐"),
            ("qq|可乐", "可乐"),
            (" QQ | 可乐 ", "可乐"),
            ("QQ|独行", "独行"),
            ("QQ|", "QQ|"),
            ("好友QQ|可乐", "好友QQ|可乐"),
            ("QQ｜可乐", "QQ｜可乐"),
        ] {
            assert_eq!(revenue_contact_name(input), expected);
        }
    }

    #[test]
    fn lists_only_settled_report_appointments_for_normalized_contact_members() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();

            let mut older = input(
                "2026-07-13",
                "18:00",
                "19:00",
                SettlementStatus::Settled,
                10_000,
            );
            older.contact_name = " QQ | 可乐 ".into();
            create_appointment_impl(&database, older).await.unwrap();

            let mut newer = input(
                "2026-07-14",
                "20:00",
                "21:00",
                SettlementStatus::Settled,
                20_000,
            );
            newer.contact_name = "小北".into();
            create_appointment_impl(&database, newer).await.unwrap();

            let mut unsettled = input(
                "2026-07-14",
                "19:00",
                "20:00",
                SettlementStatus::Unsettled,
                8_000,
            );
            unsettled.contact_name = "可乐".into();
            create_appointment_impl(&database, unsettled).await.unwrap();

            let mut cancelled = input(
                "2026-07-14",
                "18:00",
                "19:00",
                SettlementStatus::Settled,
                7_000,
            );
            cancelled.contact_name = "小北".into();
            cancelled.service_status = ServiceStatus::Cancelled;
            create_appointment_impl(&database, cancelled).await.unwrap();

            let mut entertainment = input(
                "2026-07-14",
                "17:00",
                "18:00",
                SettlementStatus::NotApplicable,
                0,
            );
            entertainment.contact_name = "小北".into();
            entertainment.mode = AppointmentMode::Entertainment;
            create_appointment_impl(&database, entertainment)
                .await
                .unwrap();

            let mut outside = input(
                "2026-07-15",
                "21:00",
                "22:00",
                SettlementStatus::Settled,
                30_000,
            );
            outside.contact_name = "可乐".into();
            create_appointment_impl(&database, outside).await.unwrap();

            let result = list_revenue_contact_appointments_impl(
                &database,
                "2026-07-13",
                "2026-07-14",
                vec!["小北".into(), "可乐".into(), "小北".into()],
            )
            .await
            .unwrap();

            assert_eq!(
                result
                    .iter()
                    .map(|item| item.contact_name.as_str())
                    .collect::<Vec<_>>(),
                vec!["小北", "QQ | 可乐"]
            );
            assert!(
                result
                    .iter()
                    .all(|item| item.mode == AppointmentMode::Business
                        && item.service_status != ServiceStatus::Cancelled
                        && item.settlement_status == SettlementStatus::Settled)
            );

            assert!(
                list_revenue_contact_appointments_impl(
                    &database,
                    "2026-07-13",
                    "2026-07-14",
                    vec![]
                )
                .await
                .unwrap_err()
                .contains("对象不能为空")
            );
            assert!(
                list_revenue_contact_appointments_impl(
                    &database,
                    "2026-07-15",
                    "2026-07-14",
                    vec!["可乐".into()]
                )
                .await
                .unwrap_err()
                .contains("不能晚于")
            );
        });
    }

    #[test]
    fn aggregates_day_week_and_month_revenue_without_mixing_pending_money() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            create_appointment_impl(
                &database,
                input(
                    "2026-07-13",
                    "20:00",
                    "21:00",
                    SettlementStatus::Settled,
                    10_000,
                ),
            )
            .await
            .unwrap();
            create_appointment_impl(
                &database,
                input(
                    "2026-07-14",
                    "23:00",
                    "01:00",
                    SettlementStatus::Unsettled,
                    5_000,
                ),
            )
            .await
            .unwrap();

            let daily = get_revenue_summary_impl(
                &database,
                "2026-07-13",
                "2026-07-15",
                ReportGranularity::Day,
            )
            .await
            .unwrap();
            assert_eq!(daily.settled_minor, 10_000);
            assert_eq!(daily.unsettled_minor, 5_000);
            assert_eq!(daily.pending_count, 1);
            assert_eq!(daily.points[1].pending_count, 1);
            assert_eq!(daily.business_hours, 3.0);
            assert_eq!(daily.average_hourly_minor, 3_333);
            assert_eq!(daily.points.len(), 3);
            assert_eq!(daily.payment_methods[0].name, "微信");
            assert_eq!(daily.payment_methods[0].appointment_count, 1);
            assert_eq!(daily.contacts[0].name, "测试联系人");
            assert_eq!(daily.contacts[0].appointment_count, 1);

            let weekly = get_revenue_summary_impl(
                &database,
                "2026-07-13",
                "2026-07-19",
                ReportGranularity::Week,
            )
            .await
            .unwrap();
            assert_eq!(weekly.points.len(), 1);
            assert_eq!(weekly.points[0].period, "2026-07-13");

            let monthly = get_revenue_summary_impl(
                &database,
                "2026-07-01",
                "2026-07-31",
                ReportGranularity::Month,
            )
            .await
            .unwrap();
            assert_eq!(monthly.points[0].period, "2026-07");
        });
    }

    #[test]
    fn aggregates_settled_revenue_by_contact_and_payment_method() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();

            let mut contact_b_first = input(
                "2026-07-13",
                "18:00",
                "19:00",
                SettlementStatus::Settled,
                10_000,
            );
            contact_b_first.contact_name = "QQ|B联系人".into();
            create_appointment_impl(&database, contact_b_first)
                .await
                .unwrap();

            let mut contact_b_second = input(
                "2026-07-14",
                "18:00",
                "19:00",
                SettlementStatus::Settled,
                5_000,
            );
            contact_b_second.contact_name = "B联系人".into();
            contact_b_second.payment_method = Some("   ".into());
            create_appointment_impl(&database, contact_b_second)
                .await
                .unwrap();

            let mut contact_a = input(
                "2026-07-15",
                "18:00",
                "19:00",
                SettlementStatus::Settled,
                15_000,
            );
            contact_a.contact_name = "A联系人".into();
            contact_a.payment_method = Some("支付宝".into());
            create_appointment_impl(&database, contact_a).await.unwrap();

            let mut zero_amount =
                input("2026-07-16", "18:00", "19:00", SettlementStatus::Settled, 0);
            zero_amount.contact_name = "零额联系人".into();
            create_appointment_impl(&database, zero_amount)
                .await
                .unwrap();

            let mut pending = input(
                "2026-07-17",
                "18:00",
                "19:00",
                SettlementStatus::Unsettled,
                8_000,
            );
            pending.contact_name = "待结联系人".into();
            create_appointment_impl(&database, pending).await.unwrap();

            let mut cancelled = input(
                "2026-07-18",
                "18:00",
                "19:00",
                SettlementStatus::Settled,
                9_000,
            );
            cancelled.contact_name = "取消联系人".into();
            cancelled.service_status = ServiceStatus::Cancelled;
            create_appointment_impl(&database, cancelled).await.unwrap();

            let mut entertainment = input(
                "2026-07-19",
                "18:00",
                "19:00",
                SettlementStatus::NotApplicable,
                7_000,
            );
            entertainment.contact_name = "娱乐联系人".into();
            entertainment.mode = AppointmentMode::Entertainment;
            create_appointment_impl(&database, entertainment)
                .await
                .unwrap();

            let summary = get_revenue_summary_impl(
                &database,
                "2026-07-13",
                "2026-07-19",
                ReportGranularity::Day,
            )
            .await
            .unwrap();

            assert_eq!(summary.settled_minor, 30_000);
            assert_eq!(summary.contacts.len(), 3);
            assert_eq!(summary.contacts[0].name, "A联系人");
            assert_eq!(summary.contacts[0].amount_minor, 15_000);
            assert_eq!(summary.contacts[0].appointment_count, 1);
            assert_eq!(summary.contacts[1].name, "B联系人");
            assert_eq!(summary.contacts[1].amount_minor, 15_000);
            assert_eq!(summary.contacts[1].appointment_count, 2);
            assert_eq!(summary.contacts[2].name, "零额联系人");
            assert_eq!(summary.contacts[2].amount_minor, 0);
            assert_eq!(summary.contacts[2].appointment_count, 1);
            assert_eq!(
                summary
                    .contacts
                    .iter()
                    .map(|item| item.amount_minor)
                    .sum::<i64>(),
                summary.settled_minor
            );

            assert_eq!(summary.payment_methods.len(), 3);
            assert_eq!(summary.payment_methods[0].name, "支付宝");
            assert_eq!(summary.payment_methods[1].name, "微信");
            assert_eq!(summary.payment_methods[1].appointment_count, 2);
            assert_eq!(summary.payment_methods[2].name, "未填写");
            assert_eq!(
                summary
                    .payment_methods
                    .iter()
                    .map(|item| item.amount_minor)
                    .sum::<i64>(),
                summary.settled_minor
            );
        });
    }

    #[test]
    fn rejects_revenue_aggregates_outside_the_javascript_safe_integer_range() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let amount = JS_SAFE_INTEGER_MAX / 2 + 1;
            create_appointment_impl(
                &database,
                input(
                    "2026-07-13",
                    "18:00",
                    "19:00",
                    SettlementStatus::Settled,
                    amount,
                ),
            )
            .await
            .unwrap();
            create_appointment_impl(
                &database,
                input(
                    "2026-07-13",
                    "20:00",
                    "21:00",
                    SettlementStatus::Settled,
                    amount,
                ),
            )
            .await
            .unwrap();

            assert!(
                get_revenue_summary_impl(
                    &database,
                    "2026-07-13",
                    "2026-07-13",
                    ReportGranularity::Day,
                )
                .await
                .unwrap_err()
                .contains("安全整数")
            );
            assert!(
                get_dashboard_summary_impl(&database, "2026-07-13")
                    .await
                    .unwrap_err()
                    .contains("安全整数")
            );
        });
    }

    #[test]
    fn resolves_an_empty_revenue_range_from_first_income_through_today() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let today = (Utc::now().naive_utc() + Duration::hours(8)).date();
            let first_income_date = today.checked_sub_days(Days::new(2)).unwrap();
            let earlier_pending_date = today.checked_sub_days(Days::new(3)).unwrap();
            create_appointment_impl(
                &database,
                input(
                    &earlier_pending_date.format(DATE_FORMAT).to_string(),
                    "20:00",
                    "21:00",
                    SettlementStatus::Unsettled,
                    8_000,
                ),
            )
            .await
            .unwrap();
            create_appointment_impl(
                &database,
                input(
                    &first_income_date.format(DATE_FORMAT).to_string(),
                    "20:00",
                    "22:00",
                    SettlementStatus::Settled,
                    5_000,
                ),
            )
            .await
            .unwrap();
            create_appointment_impl(
                &database,
                input(
                    &today.format(DATE_FORMAT).to_string(),
                    "18:00",
                    "19:00",
                    SettlementStatus::Unsettled,
                    3_000,
                ),
            )
            .await
            .unwrap();

            let all = get_revenue_summary_impl(&database, "", "", ReportGranularity::Day)
                .await
                .unwrap();
            assert_eq!(all.from, first_income_date.format(DATE_FORMAT).to_string());
            assert_eq!(all.to, today.format(DATE_FORMAT).to_string());
            assert_eq!(all.points.len(), 3);
            assert_eq!(all.appointment_count, 2);

            let error = get_revenue_summary_impl(
                &database,
                &first_income_date.format(DATE_FORMAT).to_string(),
                "",
                ReportGranularity::Day,
            )
            .await
            .unwrap_err();
            assert!(error.contains("必须同时填写"));
        });
    }

    #[test]
    fn falls_back_to_today_when_no_income_exists() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let all = get_revenue_summary_impl(&database, "", "", ReportGranularity::Month)
                .await
                .unwrap();
            let today = (Utc::now().naive_utc() + Duration::hours(8))
                .date()
                .format(DATE_FORMAT)
                .to_string();

            assert_eq!(all.from, today);
            assert_eq!(all.to, today);
            assert_eq!(all.points.len(), 1);
            assert_eq!(all.appointment_count, 0);
        });
    }

    #[test]
    fn dashboard_uses_monday_week_and_counts_only_completed_unsettled_appointments() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            create_appointment_impl(
                &database,
                input(
                    "2026-07-13",
                    "20:00",
                    "21:00",
                    SettlementStatus::Settled,
                    10_000,
                ),
            )
            .await
            .unwrap();
            create_appointment_impl(
                &database,
                input(
                    "2026-07-14",
                    "20:00",
                    "21:00",
                    SettlementStatus::Unsettled,
                    5_000,
                ),
            )
            .await
            .unwrap();
            let mut upcoming = input(
                "2026-07-15",
                "18:00",
                "19:00",
                SettlementStatus::Unsettled,
                8_000,
            );
            upcoming.service_status = ServiceStatus::Scheduled;
            create_appointment_impl(&database, upcoming).await.unwrap();

            let dashboard = get_dashboard_summary_impl(&database, "2026-07-13")
                .await
                .unwrap();
            assert_eq!(dashboard.today_settled_minor, 10_000);
            assert_eq!(dashboard.week_settled_minor, 10_000);
            assert_eq!(dashboard.pending_count, 1);
            assert_eq!(
                dashboard.next_appointment.unwrap().service_date,
                "2026-07-15"
            );
        });
    }

    #[test]
    fn dashboard_skips_past_scheduled_times_but_keeps_an_ongoing_appointment() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let mut past = input(
                "2026-07-20",
                "10:00",
                "11:00",
                SettlementStatus::Unsettled,
                1_000,
            );
            past.contact_name = "已过时预约".into();
            past.service_status = ServiceStatus::Scheduled;
            create_appointment_impl(&database, past).await.unwrap();

            let mut future = input(
                "2026-07-20",
                "13:00",
                "14:00",
                SettlementStatus::Unsettled,
                2_000,
            );
            future.contact_name = "未来预约".into();
            future.service_status = ServiceStatus::Scheduled;
            create_appointment_impl(&database, future).await.unwrap();

            let noon =
                NaiveDateTime::parse_from_str("2026-07-20T12:00:00", DATE_TIME_FORMAT).unwrap();
            let dashboard = get_dashboard_summary_at(&database, "2026-07-20", noon)
                .await
                .unwrap();
            assert_eq!(dashboard.next_appointment.unwrap().contact_name, "未来预约");

            let mut ongoing = input(
                "2026-07-20",
                "09:00",
                "12:30",
                SettlementStatus::Unsettled,
                3_000,
            );
            ongoing.contact_name = "进行中预约".into();
            ongoing.service_status = ServiceStatus::InProgress;
            create_appointment_impl(&database, ongoing).await.unwrap();

            let dashboard = get_dashboard_summary_at(&database, "2026-07-20", noon)
                .await
                .unwrap();
            assert_eq!(
                dashboard.next_appointment.unwrap().contact_name,
                "进行中预约"
            );
        });
    }
}
