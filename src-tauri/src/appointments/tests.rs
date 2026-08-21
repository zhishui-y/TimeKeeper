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
    embedded_account_input_with_details(account_name, "治疗", "测试区", "8888", credential)
}

fn embedded_account_input_with_details(
    account_name: &str,
    specialization: &str,
    server: &str,
    gear_score: &str,
    credential: AppointmentAccountCredentialInput,
) -> AppointmentAccountInput {
    AppointmentAccountInput::Embedded {
        details: AppointmentAccountDetails {
            specialization: Some(specialization.into()),
            gear_score: Some(gear_score.into()),
            server: Some(server.into()),
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
    selection::remove_for_test(token);
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
                    id, server, character_name, specialization, gear_score, account_name,
                    needs_review, sort_order, created_at, updated_at
                 ) VALUES (
                    'profile-1', '档案区', '档案角色', '输出', '9999', 'profile-account',
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
        let profile_snapshot = profile_appointment.account.as_ref().unwrap();
        assert_eq!(profile_snapshot.source, AppointmentAccountSource::Profile);
        assert_eq!(profile_snapshot.character_name.as_deref(), Some("档案角色"));

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

        let mut snapshot_update = business_input("2026-08-04", "08:00", "09:00");
        snapshot_update.account = Some(AppointmentAccountInput::Snapshot {
            source: AppointmentAccountSource::Profile,
            character_name: Some("档案角色".into()),
            details: AppointmentAccountDetails {
                specialization: Some("输出".into()),
                gear_score: Some("10000".into()),
                server: Some("档案区".into()),
                account_name: "profile-account".into(),
            },
            credential: AppointmentAccountCredentialInput::Keep,
        });
        let updated_profile_snapshot =
            update_appointment_impl(&database, &profile_appointment.id, snapshot_update)
                .await
                .unwrap()
                .appointment;
        let updated_profile_account = updated_profile_snapshot.account.as_ref().unwrap();
        assert_eq!(
            updated_profile_account.source,
            AppointmentAccountSource::Profile
        );
        assert_eq!(
            updated_profile_account.character_name.as_deref(),
            Some("档案角色")
        );
        assert_eq!(
            updated_profile_account.password.as_deref(),
            Some("profile-password")
        );

        let mut passwordless_input = business_input("2026-08-03", "07:00", "08:00");
        passwordless_input.account = Some(AppointmentAccountInput::Snapshot {
            source: AppointmentAccountSource::Embedded,
            character_name: None,
            details: AppointmentAccountDetails {
                specialization: None,
                gear_score: None,
                server: None,
                account_name: "passwordless-account".into(),
            },
            credential: AppointmentAccountCredentialInput::None,
        });
        let passwordless = create_appointment_impl(&database, passwordless_input)
            .await
            .unwrap()
            .appointment;
        assert_eq!(
            passwordless.account.and_then(|account| account.password),
            None
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
        assert_eq!(
            source.account.as_ref().map(|account| account.source),
            Some(AppointmentAccountSource::Embedded)
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
        assert_eq!(
            duplicate.account.as_ref().map(|account| account.source),
            Some(AppointmentAccountSource::Embedded)
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
fn progress_filters_follow_service_progress_and_independent_settlement() {
    run_async(async {
        let database = Database::in_memory().await.unwrap();

        let mut scheduled_settled_input = business_input("2026-08-03", "08:00", "09:00");
        scheduled_settled_input.settlement_status = SettlementStatus::Settled;
        let scheduled_settled = create_appointment_impl(&database, scheduled_settled_input)
            .await
            .unwrap()
            .appointment;

        let mut in_progress_settled_input = business_input("2026-08-03", "09:00", "10:00");
        in_progress_settled_input.service_status = ServiceStatus::InProgress;
        in_progress_settled_input.settlement_status = SettlementStatus::Settled;
        let in_progress_settled = create_appointment_impl(&database, in_progress_settled_input)
            .await
            .unwrap()
            .appointment;

        let mut completed_settled_input = business_input("2026-08-03", "10:00", "11:00");
        completed_settled_input.service_status = ServiceStatus::Completed;
        completed_settled_input.settlement_status = SettlementStatus::Settled;
        let completed_settled = create_appointment_impl(&database, completed_settled_input)
            .await
            .unwrap()
            .appointment;

        let mut pending_input = business_input("2026-08-03", "11:00", "12:00");
        pending_input.service_status = ServiceStatus::Completed;
        let pending = create_appointment_impl(&database, pending_input)
            .await
            .unwrap()
            .appointment;

        let mut entertainment_input = business_input("2026-08-03", "12:00", "13:00");
        entertainment_input.mode = AppointmentMode::Entertainment;
        entertainment_input.service_status = ServiceStatus::Completed;
        entertainment_input.settlement_status = SettlementStatus::NotApplicable;
        entertainment_input.rate_note = None;
        entertainment_input.amount_minor = None;
        let entertainment = create_appointment_impl(&database, entertainment_input)
            .await
            .unwrap()
            .appointment;

        let scheduled = list_appointment_page_impl(
            &database,
            AppointmentFilters {
                progress_status: Some(AppointmentProgressStatus::Scheduled),
                ..AppointmentFilters::default()
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(scheduled.total_count, 1);
        assert_eq!(scheduled.items[0].id, scheduled_settled.id);

        let in_progress = list_appointment_page_impl(
            &database,
            AppointmentFilters {
                progress_status: Some(AppointmentProgressStatus::InProgress),
                ..AppointmentFilters::default()
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(in_progress.total_count, 1);
        assert_eq!(in_progress.items[0].id, in_progress_settled.id);

        let completed = list_appointment_page_impl(
            &database,
            AppointmentFilters {
                progress_status: Some(AppointmentProgressStatus::Completed),
                ..AppointmentFilters::default()
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(completed.total_count, 2);
        let completed_ids = completed
            .items
            .iter()
            .map(|appointment| appointment.id.as_str())
            .collect::<Vec<_>>();
        assert!(completed_ids.contains(&completed_settled.id.as_str()));
        assert!(completed_ids.contains(&entertainment.id.as_str()));
        assert!(!completed_ids.contains(&scheduled_settled.id.as_str()));

        let pending_page = list_appointment_page_impl(
            &database,
            AppointmentFilters {
                progress_status: Some(AppointmentProgressStatus::PendingSettlement),
                ..AppointmentFilters::default()
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(pending_page.total_count, 1);
        assert_eq!(pending_page.items[0].id, pending.id);
    });
}

#[test]
fn searches_partial_yy_channels_and_notes() {
    run_async(async {
        let database = Database::in_memory().await.unwrap();

        let mut yy_input = business_input("2026-08-03", "10:00", "11:00");
        yy_input.voice_platform = Some(VoicePlatform::Yy);
        yy_input.voice_channel = Some("794676".into());
        let yy = create_appointment_impl(&database, yy_input)
            .await
            .unwrap()
            .appointment;

        let mut notes_input = business_input("2026-08-03", "11:00", "12:00");
        notes_input.notes = Some("赛季末冲分，优先晚间".into());
        let notes = create_appointment_impl(&database, notes_input)
            .await
            .unwrap()
            .appointment;

        let unrelated =
            create_appointment_impl(&database, business_input("2026-08-03", "12:00", "13:00"))
                .await
                .unwrap()
                .appointment;

        let yy_page = list_appointment_page_impl(
            &database,
            AppointmentFilters {
                query: Some("4676".into()),
                ..AppointmentFilters::default()
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(yy_page.total_count, 1);
        assert_eq!(yy_page.items[0].id, yy.id);

        let notes_page = list_appointment_page_impl(
            &database,
            AppointmentFilters {
                query: Some("末冲".into()),
                ..AppointmentFilters::default()
            },
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(notes_page.total_count, 1);
        assert_eq!(notes_page.items[0].id, notes.id);
        assert_ne!(notes_page.items[0].id, unrelated.id);
    });
}

#[test]
fn zero_amount_is_valid_for_completed_and_settled_appointments() {
    run_async(async {
        let database = Database::in_memory().await.unwrap();
        let mut direct_input = business_input("2026-08-03", "10:00", "11:00");
        direct_input.settlement_status = SettlementStatus::Settled;
        direct_input.amount_minor = Some(0);
        let direct = create_appointment_impl(&database, direct_input)
            .await
            .unwrap()
            .appointment;
        assert_eq!(direct.service_status, ServiceStatus::Scheduled);
        assert_eq!(direct.settlement_status, SettlementStatus::Settled);
        assert_eq!(direct.amount_minor, Some(0));

        let mut negative_input = business_input("2026-08-03", "11:00", "12:00");
        negative_input.amount_minor = Some(-1);
        assert_eq!(
            normalize_input(negative_input).unwrap_err(),
            "金额必须是非负安全整数"
        );

        let pending =
            create_appointment_impl(&database, business_input("2026-08-03", "12:00", "13:00"))
                .await
                .unwrap()
                .appointment;
        assert_eq!(
            settle_appointment_impl(&database, &pending.id, -1, None)
                .await
                .unwrap_err(),
            "结算金额必须是非负安全整数"
        );
        let settled = settle_appointment_impl(&database, &pending.id, 0, Some("其他".into()))
            .await
            .unwrap();
        assert_eq!(settled.service_status, ServiceStatus::Scheduled);
        assert_eq!(settled.settlement_status, SettlementStatus::Settled);
        assert_eq!(settled.amount_minor, Some(0));
    });
}

#[test]
fn appointment_amount_and_reminder_ranges_are_bounded() {
    let mut input = business_input("2026-08-03", "10:00", "11:00");
    input.amount_minor = Some(JS_SAFE_INTEGER_MAX);
    input.reminder_minutes = Some(MAX_REMINDER_MINUTES);
    assert!(normalize_input(input).is_ok());

    let mut amount = business_input("2026-08-03", "10:00", "11:00");
    amount.amount_minor = Some(JS_SAFE_INTEGER_MAX + 1);
    assert_eq!(
        normalize_input(amount).unwrap_err(),
        "金额必须是非负安全整数"
    );

    for minutes in [-1, MAX_REMINDER_MINUTES + 1] {
        let mut reminder = business_input("2026-08-03", "10:00", "11:00");
        reminder.reminder_minutes = Some(minutes);
        assert_eq!(
            normalize_input(reminder).unwrap_err(),
            "提醒分钟数必须在 0 到 1440 之间"
        );
    }
}

#[test]
fn appointment_search_treats_like_metacharacters_as_literals() {
    run_async(async {
        let database = Database::in_memory().await.unwrap();
        let mut literal = business_input("2026-08-03", "10:00", "11:00");
        literal.contact_name = "literal%_\\contact".into();
        let literal = create_appointment_impl(&database, literal)
            .await
            .unwrap()
            .appointment;
        create_appointment_impl(&database, business_input("2026-08-03", "12:00", "13:00"))
            .await
            .unwrap();

        for query in ["%", "_", "\\"] {
            let page = list_appointment_page_impl(
                &database,
                AppointmentFilters {
                    query: Some(query.into()),
                    ..AppointmentFilters::default()
                },
                None,
                None,
            )
            .await
            .unwrap();
            assert_eq!(page.total_count, 1, "query {query:?} must be literal");
            assert_eq!(page.items[0].id, literal.id);
        }

        for query in ["%", "_", "\\"] {
            let presets = list_contact_presets_impl(&database, Some(query.into()), None)
                .await
                .unwrap();
            assert_eq!(presets.len(), 1, "preset query {query:?} must be literal");
            assert_eq!(presets[0].source_appointment_id, literal.id);
        }
    });
}

#[test]
fn contact_presets_return_recent_matching_appointments_but_keep_empty_query_distinct() {
    run_async(async {
        let database = Database::in_memory().await.unwrap();

        let mut oldest = business_input("2026-08-01", "10:00", "11:00");
        oldest.contact_name = "小林".into();
        oldest.content = Some("第一场".into());
        let oldest = create_appointment_impl(&database, oldest)
            .await
            .unwrap()
            .appointment;

        let mut related = business_input("2026-08-02", "10:00", "11:00");
        related.contact_name = "小林助理".into();
        related.content = Some("第二场".into());
        let related = create_appointment_impl(&database, related)
            .await
            .unwrap()
            .appointment;

        let mut newest = business_input("2026-08-03", "10:00", "11:00");
        newest.contact_name = "小林".into();
        newest.content = Some("第三场".into());
        let newest = create_appointment_impl(&database, newest)
            .await
            .unwrap()
            .appointment;

        let mut cancelled = business_input("2026-08-04", "10:00", "11:00");
        cancelled.contact_name = "小林".into();
        cancelled.service_status = ServiceStatus::Cancelled;
        create_appointment_impl(&database, cancelled).await.unwrap();

        let empty = list_contact_presets_impl(&database, None, Some(10))
            .await
            .unwrap();
        assert_eq!(empty.len(), 2);
        assert_eq!(empty[0].source_appointment_id, newest.id);
        assert_eq!(empty[1].source_appointment_id, related.id);

        let matching = list_contact_presets_impl(&database, Some("小林".into()), Some(10))
            .await
            .unwrap();
        assert_eq!(matching.len(), 3);
        assert_eq!(matching[0].source_appointment_id, newest.id);
        assert_eq!(matching[0].service_date, "2026-08-03");
        assert_eq!(matching[1].source_appointment_id, related.id);
        assert_eq!(matching[2].source_appointment_id, oldest.id);

        let limited = list_contact_presets_impl(&database, Some("小林".into()), Some(2))
            .await
            .unwrap();
        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0].source_appointment_id, newest.id);
        assert_eq!(limited[1].source_appointment_id, related.id);
    });
}

#[test]
fn recent_embedded_account_presets_filter_deduplicate_and_report_password_availability() {
    run_async(async {
        let database = Database::in_memory().await.unwrap();

        let mut old_shared = business_input("2026-08-01", "10:00", "11:00");
        old_shared.account = Some(embedded_account_input_with_details(
            "SharedLogin",
            "旧职业",
            "旧区服",
            "10000",
            AppointmentAccountCredentialInput::Replace {
                password: "old-secret".into(),
            },
        ));
        create_appointment_impl(&database, old_shared)
            .await
            .unwrap();

        let mut passwordless = business_input("2026-08-02", "10:00", "11:00");
        passwordless.account = Some(AppointmentAccountInput::Snapshot {
            source: AppointmentAccountSource::Embedded,
            character_name: None,
            details: AppointmentAccountDetails {
                specialization: None,
                gear_score: None,
                server: None,
                account_name: "no-secret".into(),
            },
            credential: AppointmentAccountCredentialInput::None,
        });
        let passwordless = create_appointment_impl(&database, passwordless)
            .await
            .unwrap()
            .appointment;

        let mut latest_shared = business_input("2026-08-03", "10:00", "11:00");
        latest_shared.account = Some(embedded_account_input_with_details(
            " sharedlogin ",
            "新职业",
            "新区服",
            "20000",
            AppointmentAccountCredentialInput::Replace {
                password: "new-secret".into(),
            },
        ));
        let latest_shared = create_appointment_impl(&database, latest_shared)
            .await
            .unwrap()
            .appointment;

        let mut profile_snapshot = business_input("2026-08-04", "10:00", "11:00");
        profile_snapshot.account = Some(AppointmentAccountInput::Snapshot {
            source: AppointmentAccountSource::Profile,
            character_name: Some("档案角色".into()),
            details: AppointmentAccountDetails {
                specialization: Some("档案职业".into()),
                gear_score: Some("30000".into()),
                server: Some("档案区服".into()),
                account_name: "profile-login".into(),
            },
            credential: AppointmentAccountCredentialInput::Replace {
                password: "profile-secret".into(),
            },
        });
        create_appointment_impl(&database, profile_snapshot)
            .await
            .unwrap();

        let mut cancelled = business_input("2026-08-05", "10:00", "11:00");
        cancelled.service_status = ServiceStatus::Cancelled;
        cancelled.account = Some(embedded_account_input(
            "cancelled-login",
            AppointmentAccountCredentialInput::Replace {
                password: "cancelled-secret".into(),
            },
        ));
        create_appointment_impl(&database, cancelled).await.unwrap();

        let presets = list_recent_embedded_account_presets_impl(&database, Some(10))
            .await
            .unwrap();
        assert_eq!(presets.len(), 2);
        assert_eq!(presets[0].source_appointment_id, latest_shared.id);
        assert_eq!(presets[0].account_name, "sharedlogin");
        assert_eq!(presets[0].specialization.as_deref(), Some("新职业"));
        assert_eq!(presets[0].server.as_deref(), Some("新区服"));
        assert_eq!(presets[0].gear_score.as_deref(), Some("20000"));
        assert!(presets[0].has_password);
        assert_eq!(presets[1].source_appointment_id, passwordless.id);
        assert!(!presets[1].has_password);

        assert_eq!(
            list_recent_embedded_account_presets_impl(&database, Some(1))
                .await
                .unwrap()
                .len(),
            1
        );
        for limit in [0, 51] {
            assert_eq!(
                list_recent_embedded_account_presets_impl(&database, Some(limit))
                    .await
                    .unwrap_err(),
                "一次性账号模板数量必须在 1 到 50 之间"
            );
        }
    });
}

#[test]
fn create_rolls_back_when_the_returning_query_fails() {
    run_async(async {
        let database = Database::in_memory().await.unwrap();
        sqlx::query("DROP TABLE appointment_credentials")
            .execute(database.pool())
            .await
            .unwrap();

        assert!(
            create_appointment_impl(&database, business_input("2026-08-03", "10:00", "11:00"),)
                .await
                .unwrap_err()
                .contains("数据库操作失败")
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM appointments")
                .fetch_one(database.pool())
                .await
                .unwrap(),
            0
        );
    });
}

#[test]
fn timed_appointments_advance_to_mode_specific_completion_states() {
    run_async(async {
        let database = Database::in_memory().await.unwrap();
        let business =
            create_appointment_impl(&database, business_input("2026-08-08", "10:00", "11:00"))
                .await
                .unwrap()
                .appointment;
        let mut entertainment_input = business_input("2026-08-08", "10:00", "11:00");
        entertainment_input.mode = AppointmentMode::Entertainment;
        entertainment_input.settlement_status = SettlementStatus::NotApplicable;
        entertainment_input.rate_note = None;
        entertainment_input.amount_minor = None;
        let entertainment = create_appointment_impl(&database, entertainment_input)
            .await
            .unwrap()
            .appointment;
        let mut settled_input = business_input("2026-08-08", "10:00", "11:00");
        settled_input.settlement_status = SettlementStatus::Settled;
        let settled = create_appointment_impl(&database, settled_input)
            .await
            .unwrap()
            .appointment;

        assert!(
            sync_appointment_service_statuses_impl(
                &database,
                NaiveDate::from_ymd_opt(2026, 8, 8)
                    .unwrap()
                    .and_hms_opt(9, 59, 59)
                    .unwrap(),
            )
            .await
            .unwrap()
            .is_empty()
        );

        let started = sync_appointment_service_statuses_impl(
            &database,
            NaiveDate::from_ymd_opt(2026, 8, 8)
                .unwrap()
                .and_hms_opt(10, 0, 0)
                .unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(started.len(), 3);
        assert!(
            started
                .iter()
                .all(|appointment| appointment.service_status == ServiceStatus::InProgress)
        );

        let completed = sync_appointment_service_statuses_impl(
            &database,
            NaiveDate::from_ymd_opt(2026, 8, 8)
                .unwrap()
                .and_hms_opt(11, 0, 0)
                .unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(completed.len(), 3);

        let business = get_appointment_impl(&database, &business.id).await.unwrap();
        assert_eq!(business.service_status, ServiceStatus::Completed);
        assert_eq!(business.settlement_status, SettlementStatus::Unsettled);

        let entertainment = get_appointment_impl(&database, &entertainment.id)
            .await
            .unwrap();
        assert_eq!(entertainment.service_status, ServiceStatus::Completed);
        assert_eq!(
            entertainment.settlement_status,
            SettlementStatus::NotApplicable
        );

        let settled = get_appointment_impl(&database, &settled.id).await.unwrap();
        assert_eq!(settled.service_status, ServiceStatus::Completed);
        assert_eq!(settled.settlement_status, SettlementStatus::Settled);
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

        let (ids, consumed) = selection::resolve(AppointmentDeleteSelection::Token {
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
            selection::resolve(AppointmentDeleteSelection::Token {
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
    selection::insert_for_test(
        token.clone(),
        vec!["appointment-1".into()],
        Utc::now() - Duration::seconds(1),
    );
    assert!(
        selection::resolve(AppointmentDeleteSelection::Token {
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
            list_appointment_page_impl(&database, AppointmentFilters::default(), Some(1), Some(100))
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
        let (ids, consumed) = selection::resolve(AppointmentDeleteSelection::Token {
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
