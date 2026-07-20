use std::{path::Path, time::Duration};

use sqlx::{
    SqlitePool,
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use tauri::Manager;

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

pub async fn initialize_database(app: &tauri::AppHandle) -> Result<Database, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法确定应用数据目录: {error}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|error| format!("创建应用数据目录失败: {error}"))?;

    Database::initialize(data_dir.join(DATABASE_FILE_NAME)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

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
        });
    }
}
