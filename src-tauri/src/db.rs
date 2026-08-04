use std::{path::Path, time::Duration};

use sqlx::{
    SqlitePool,
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};

pub const DATABASE_FILE_NAME: &str = "timekeeper.db";
pub(crate) static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImportWriteResult {
    pub record_id: String,
    pub inserted: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone)]
pub struct Database {
    pool: SqlitePool,
}

impl Database {
    pub async fn initialize(path: impl AsRef<Path>) -> Result<Self, String> {
        let options = SqliteConnectOptions::new()
            .filename(path.as_ref())
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));

        Self::connect_with_options(options, 5).await
    }

    #[cfg(test)]
    pub async fn in_memory() -> Result<Self, String> {
        let options = "sqlite::memory:"
            .parse::<SqliteConnectOptions>()
            .map_err(|error| format!("创建内存数据库配置失败: {error}"))?
            .foreign_keys(true);

        Self::connect_with_options(options, 1).await
    }

    async fn connect_with_options(
        options: SqliteConnectOptions,
        max_connections: u32,
    ) -> Result<Self, String> {
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await
            .map_err(|error| format!("连接数据库失败: {error}"))?;

        MIGRATOR
            .run(&pool)
            .await
            .map_err(|error| format!("执行数据库迁移失败: {error}"))?;

        Ok(Self { pool })
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

pub async fn initialize_database(data_dir: impl AsRef<Path>) -> Result<Database, String> {
    let data_dir = data_dir.as_ref();
    std::fs::create_dir_all(data_dir).map_err(|error| format!("创建应用数据目录失败: {error}"))?;

    Database::initialize(data_dir.join(DATABASE_FILE_NAME)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Connection, Row};

    fn run_async<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(future)
    }

    #[test]
    fn runs_initial_migration() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let tables: Vec<String> =
                sqlx::query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
                    .fetch_all(database.pool())
                    .await
                    .unwrap()
                    .into_iter()
                    .map(|row| row.get("name"))
                    .collect();

            assert!(tables.iter().any(|name| name == "appointments"));
            assert!(tables.iter().any(|name| name == "account_profiles"));
            let profile_columns = sqlx::query_scalar::<_, String>(
                "SELECT name FROM pragma_table_info('account_profiles') ORDER BY cid",
            )
            .fetch_all(database.pool())
            .await
            .unwrap();
            assert!(profile_columns.iter().any(|name| name == "sort_order"));
            assert!(profile_columns.iter().any(|name| name == "usage_info"));
            let appointment_columns = sqlx::query_scalar::<_, String>(
                "SELECT name FROM pragma_table_info('appointments') ORDER BY cid",
            )
            .fetch_all(database.pool())
            .await
            .unwrap();
            for expected in [
                "account_specialization",
                "account_gear_score",
                "account_server",
                "account_name",
                "account_source",
                "account_character_name",
                "voice_platform",
                "voice_channel",
            ] {
                assert!(appointment_columns.iter().any(|name| name == expected));
            }
            assert!(
                !appointment_columns
                    .iter()
                    .any(|name| name == "account_profile_id")
            );
            assert!(
                !appointment_columns
                    .iter()
                    .any(|name| name == "account_snapshot_json")
            );
            assert!(
                !appointment_columns
                    .iter()
                    .any(|name| name == "account_password_available")
            );
            assert!(
                !tables
                    .iter()
                    .any(|name| name == "appointment_password_backfill")
            );
            for expected in [
                "account_profile_credentials",
                "appointment_credentials",
                "app_access",
                "legacy_credential_migration",
            ] {
                assert!(tables.iter().any(|name| name == expected));
            }
        });
    }

    #[test]
    fn sort_order_migration_preserves_the_previous_default_order() {
        run_async(async {
            let mut connection = sqlx::SqliteConnection::connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::raw_sql(include_str!("../migrations/0001_initial.sql"))
                .execute(&mut connection)
                .await
                .unwrap();
            for (id, account_name, needs_review, updated_at) in [
                ("account-a", "A", 0_i64, "2026-07-28T00:00:00Z"),
                ("account-b", "B", 1_i64, "2026-07-20T00:00:00Z"),
                ("account-c", "C", 0_i64, "2026-07-29T00:00:00Z"),
            ] {
                sqlx::query(
                    "INSERT INTO account_profiles (
                        id, account_name, needs_review, created_at, updated_at
                     ) VALUES (?, ?, ?, ?, ?)",
                )
                .bind(id)
                .bind(account_name)
                .bind(needs_review)
                .bind(updated_at)
                .bind(updated_at)
                .execute(&mut connection)
                .await
                .unwrap();
            }

            sqlx::raw_sql(include_str!(
                "../migrations/0002_account_profile_sort_order.sql"
            ))
            .execute(&mut connection)
            .await
            .unwrap();
            let ordered = sqlx::query_scalar::<_, String>(
                "SELECT id FROM account_profiles ORDER BY sort_order",
            )
            .fetch_all(&mut connection)
            .await
            .unwrap();
            assert_eq!(ordered, ["account-b", "account-c", "account-a"]);
            assert!(
                sqlx::query("UPDATE account_profiles SET sort_order = -1 WHERE id = 'account-a'")
                    .execute(&mut connection)
                    .await
                    .is_err()
            );
        });
    }

    #[test]
    fn usage_info_migration_preserves_existing_profiles() {
        run_async(async {
            let mut connection = sqlx::SqliteConnection::connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::raw_sql(include_str!("../migrations/0001_initial.sql"))
                .execute(&mut connection)
                .await
                .unwrap();
            sqlx::raw_sql(include_str!(
                "../migrations/0002_account_profile_sort_order.sql"
            ))
            .execute(&mut connection)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO account_profiles (
                    id, account_name, needs_review, sort_order, created_at, updated_at
                 ) VALUES ('existing-account', 'existing-name', 0, 0, ?, ?)",
            )
            .bind("2026-08-02T00:00:00Z")
            .bind("2026-08-02T00:00:00Z")
            .execute(&mut connection)
            .await
            .unwrap();

            sqlx::raw_sql(include_str!(
                "../migrations/0003_account_profile_usage_info.sql"
            ))
            .execute(&mut connection)
            .await
            .unwrap();

            let row = sqlx::query("SELECT account_name, usage_info FROM account_profiles")
                .fetch_one(&mut connection)
                .await
                .unwrap();
            assert_eq!(row.get::<String, _>("account_name"), "existing-name");
            assert_eq!(row.get::<Option<String>, _>("usage_info"), None);
        });
    }

    #[test]
    fn embedded_account_migration_preserves_snapshots_and_records_password_backfill() {
        run_async(async {
            let mut connection = sqlx::SqliteConnection::connect("sqlite::memory:")
                .await
                .unwrap();
            for migration in [
                include_str!("../migrations/0001_initial.sql"),
                include_str!("../migrations/0002_account_profile_sort_order.sql"),
                include_str!("../migrations/0003_account_profile_usage_info.sql"),
            ] {
                sqlx::raw_sql(migration)
                    .execute(&mut connection)
                    .await
                    .unwrap();
            }
            sqlx::query(
                "INSERT INTO account_profiles (
                    id, server, specialization, gear_score, account_name,
                    needs_review, sort_order, created_at, updated_at
                 ) VALUES ('profile-1', '档案区服', '档案职业', '9999', 'profile-name',
                           0, 0, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')",
            )
            .execute(&mut connection)
            .await
            .unwrap();
            let insert = "INSERT INTO appointments (
                id, service_date, contact_name, mode, service_status, settlement_status,
                account_profile_id, account_snapshot_json, created_at, updated_at
             ) VALUES (?, '2026-08-01', '联系人', 'business', 'scheduled', 'unsettled',
                       'profile-1', ?, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')";
            sqlx::query(insert)
                .bind("snapshot-appointment")
                .bind(
                    r#"{"accountName":"snapshot-name","server":"快照区服","specialization":"快照职业","gearScore":"8888","characterName":"不迁移","contactName":"不迁移"}"#,
                )
                .execute(&mut connection)
                .await
                .unwrap();
            sqlx::query(insert)
                .bind("fallback-appointment")
                .bind(Option::<String>::None)
                .execute(&mut connection)
                .await
                .unwrap();

            sqlx::raw_sql(include_str!(
                "../migrations/0004_appointment_embedded_account_voice.sql"
            ))
            .execute(&mut connection)
            .await
            .unwrap();

            let snapshot = sqlx::query(
                "SELECT account_name, account_server, account_specialization,
                        account_gear_score, account_password_available
                 FROM appointments WHERE id = 'snapshot-appointment'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(snapshot.get::<String, _>("account_name"), "snapshot-name");
            assert_eq!(snapshot.get::<String, _>("account_server"), "快照区服");
            assert_eq!(
                snapshot.get::<String, _>("account_specialization"),
                "快照职业"
            );
            assert_eq!(snapshot.get::<String, _>("account_gear_score"), "8888");
            assert_eq!(snapshot.get::<i64, _>("account_password_available"), 0);

            let fallback = sqlx::query(
                "SELECT account_name, account_server, account_specialization, account_gear_score
                 FROM appointments WHERE id = 'fallback-appointment'",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(fallback.get::<String, _>("account_name"), "profile-name");
            assert_eq!(fallback.get::<String, _>("account_server"), "档案区服");
            assert_eq!(
                fallback.get::<String, _>("account_specialization"),
                "档案职业"
            );
            assert_eq!(fallback.get::<String, _>("account_gear_score"), "9999");

            let backfill_count =
                sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM appointment_password_backfill")
                    .fetch_one(&mut connection)
                    .await
                    .unwrap();
            assert_eq!(backfill_count, 2);
            let foreign_key_count = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM pragma_foreign_key_list('appointments')",
            )
            .fetch_one(&mut connection)
            .await
            .unwrap();
            assert_eq!(foreign_key_count, 0);
        });
    }

    #[test]
    fn account_source_migration_only_matches_unique_normalized_profile_names() {
        run_async(async {
            let mut connection = sqlx::SqliteConnection::connect("sqlite::memory:")
                .await
                .unwrap();
            for migration in [
                include_str!("../migrations/0001_initial.sql"),
                include_str!("../migrations/0002_account_profile_sort_order.sql"),
                include_str!("../migrations/0003_account_profile_usage_info.sql"),
                include_str!("../migrations/0004_appointment_embedded_account_voice.sql"),
                include_str!("../migrations/0005_app_access_sqlite_credentials.sql"),
            ] {
                sqlx::raw_sql(migration)
                    .execute(&mut connection)
                    .await
                    .unwrap();
            }

            for (id, account_name, character_name, sort_order) in [
                ("unique", "  Unique-Account ", "唯一角色", 0_i64),
                ("duplicate-a", "duplicate", "重复甲", 1_i64),
                ("duplicate-b", " DUPLICATE ", "重复乙", 2_i64),
            ] {
                sqlx::query(
                    "INSERT INTO account_profiles (
                        id, character_name, account_name, needs_review, sort_order,
                        created_at, updated_at
                     ) VALUES (?, ?, ?, 0, ?, '2026-08-04T00:00:00Z', '2026-08-04T00:00:00Z')",
                )
                .bind(id)
                .bind(character_name)
                .bind(account_name)
                .bind(sort_order)
                .execute(&mut connection)
                .await
                .unwrap();
            }
            for (id, account_name) in [
                ("unique-match", Some("unique-account")),
                ("duplicate-match", Some("duplicate")),
                ("missing-match", Some("missing")),
                ("no-account", None),
            ] {
                sqlx::query(
                    "INSERT INTO appointments (
                        id, service_date, contact_name, mode, service_status,
                        settlement_status, account_name, created_at, updated_at
                     ) VALUES (?, '2026-08-04', '联系人', 'business', 'scheduled',
                               'unsettled', ?, '2026-08-04T00:00:00Z', '2026-08-04T00:00:00Z')",
                )
                .bind(id)
                .bind(account_name)
                .execute(&mut connection)
                .await
                .unwrap();
            }

            sqlx::raw_sql(include_str!(
                "../migrations/0006_appointment_account_snapshot_source.sql"
            ))
            .execute(&mut connection)
            .await
            .unwrap();

            let rows = sqlx::query(
                "SELECT id, account_source, account_character_name
                 FROM appointments ORDER BY id",
            )
            .fetch_all(&mut connection)
            .await
            .unwrap();
            let snapshots = rows
                .iter()
                .map(|row| {
                    (
                        row.get::<String, _>("id"),
                        row.get::<Option<String>, _>("account_source"),
                        row.get::<Option<String>, _>("account_character_name"),
                    )
                })
                .collect::<Vec<_>>();
            assert_eq!(
                snapshots,
                vec![
                    ("duplicate-match".into(), Some("embedded".into()), None),
                    ("missing-match".into(), Some("embedded".into()), None),
                    ("no-account".into(), None, None),
                    (
                        "unique-match".into(),
                        Some("profile".into()),
                        Some("唯一角色".into())
                    ),
                ]
            );
        });
    }
}
