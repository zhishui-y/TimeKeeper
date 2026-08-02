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
}
