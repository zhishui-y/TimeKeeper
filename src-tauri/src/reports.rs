use std::{collections::BTreeMap, str::FromStr};

use chrono::{Datelike, Days, Duration, Months, NaiveDate, NaiveDateTime, Utc};
use sqlx::Row;
use tauri::State;

use crate::{
    app_access::AppAccessState,
    appointments::get_appointment_impl,
    db::Database,
    models::{
        DashboardSummary, PaymentMethodSummary, ReportGranularity, RevenuePoint, RevenueSummary,
        ServiceStatus, SettlementStatus,
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

async fn sum_minor(database: &Database, sql: &str, values: &[&str]) -> Result<i64, String> {
    let mut query = sqlx::query(sql);
    for value in values {
        query = query.bind(*value);
    }
    let row = query.fetch_one(database.pool()).await.map_err(db_error)?;
    row.try_get("total").map_err(db_error)
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
        "SELECT COALESCE(SUM(amount_minor), 0) AS total FROM appointments
         WHERE service_date = ? AND mode = 'business' AND service_status != 'cancelled'
           AND settlement_status = 'settled'",
        &[&normalized_date],
    )
    .await?;
    let week_settled_minor = sum_minor(
        database,
        "SELECT COALESCE(SUM(amount_minor), 0) AS total FROM appointments
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
        "SELECT service_date, starts_at, ends_at, service_status, settlement_status,
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
    let mut payment_methods = BTreeMap::<String, i64>::new();
    let mut settled_minor = 0_i64;
    let mut unsettled_minor = 0_i64;
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

        point.appointment_count += 1;
        match settlement_status {
            SettlementStatus::Settled => {
                settled_minor += amount_minor;
                point.settled_minor += amount_minor;
                let payment_method: Option<String> =
                    row.try_get("payment_method").map_err(db_error)?;
                let name = payment_method
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "未填写".to_string());
                *payment_methods.entry(name).or_default() += amount_minor;
            }
            SettlementStatus::Unsettled => {
                unsettled_minor += amount_minor;
                point.unsettled_minor += amount_minor;
            }
            SettlementStatus::NotApplicable => {
                return Err("业务预约包含不适用的结算状态".into());
            }
        }

        if service_status == ServiceStatus::Completed {
            completed_count += 1;
            let starts_at: Option<String> = row.try_get("starts_at").map_err(db_error)?;
            let ends_at: Option<String> = row.try_get("ends_at").map_err(db_error)?;
            let hours = duration_hours(starts_at.as_deref(), ends_at.as_deref())?;
            business_hours += hours;
            point.business_hours += hours;
        }
    }

    let mut payment_methods: Vec<_> = payment_methods
        .into_iter()
        .map(|(name, amount_minor)| PaymentMethodSummary { name, amount_minor })
        .collect();
    payment_methods.sort_by(|left, right| {
        right
            .amount_minor
            .cmp(&left.amount_minor)
            .then_with(|| left.name.cmp(&right.name))
    });

    let business_hours = round_hours(business_hours);
    let average_hourly_minor = if business_hours > 0.0 {
        (settled_minor as f64 / business_hours).round() as i64
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
        business_hours,
        average_hourly_minor,
        appointment_count: rows.len() as i64,
        completed_count,
        payment_methods,
        points,
    })
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
            assert_eq!(daily.business_hours, 3.0);
            assert_eq!(daily.average_hourly_minor, 3_333);
            assert_eq!(daily.points.len(), 3);
            assert_eq!(daily.payment_methods[0].name, "微信");

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
