use std::{collections::HashSet, time::Duration};

use chrono::{DateTime, FixedOffset, NaiveDate};
use futures_util::{StreamExt, stream};
use reqwest::{Client, StatusCode, Url};
use serde::Serialize;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use tauri::ipc::Channel;
use tokio::sync::{Mutex, MutexGuard};

use crate::backup::BackupState;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_CONCURRENT_REQUESTS: usize = 3;

pub struct AccountRoleDataRefreshState {
    client: Client,
    operation_lock: Mutex<()>,
}

impl AccountRoleDataRefreshState {
    pub fn new() -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: Client::builder()
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(REQUEST_TIMEOUT)
                .build()?,
            operation_lock: Mutex::new(()),
        })
    }

    pub fn try_start(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.operation_lock
            .try_lock()
            .map_err(|_| "已有角色数据更新正在进行，请等待完成".to_string())
    }

    pub fn client(&self) -> &Client {
        &self.client
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AccountRoleDataRefreshStatus {
    Updated,
    NoRecord,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRoleDataRefreshItem {
    pub account_id: String,
    pub status: AccountRoleDataRefreshStatus,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRoleDataRefreshResult {
    pub requested_count: usize,
    pub updated_count: usize,
    pub no_record_count: usize,
    pub skipped_count: usize,
    pub failed_count: usize,
    pub items: Vec<AccountRoleDataRefreshItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRoleDataRefreshPatch {
    pub account_id: String,
    pub gear_score: String,
    pub current_score: i64,
    pub highest_score: Option<i64>,
    pub score_updated_at: String,
    pub weekly_wins: Option<i64>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRoleDataRefreshProgress {
    pub completed_count: usize,
    pub requested_count: usize,
    pub item: AccountRoleDataRefreshItem,
    pub patch: Option<AccountRoleDataRefreshPatch>,
}

#[derive(Debug, Clone)]
struct AccountRoleDataTarget {
    position: usize,
    account_id: String,
    server: String,
    character_name: String,
}

#[derive(Debug, Clone)]
struct AccountRoleDataUpdate {
    account_id: String,
    gear_score: String,
    current_score: i64,
    highest_score: Option<i64>,
    score_updated_at: String,
    weekly_wins: Option<i64>,
}

#[derive(Debug, Clone)]
struct AccountRoleDataFetchOutcome {
    position: usize,
    item: AccountRoleDataRefreshItem,
    update: Option<AccountRoleDataUpdate>,
}

pub async fn refresh_account_role_data(
    pool: &SqlitePool,
    client: &Client,
    base_url: &str,
    api_key: &str,
    ids: Vec<String>,
    backup: &BackupState,
    on_progress: &Channel<AccountRoleDataRefreshProgress>,
) -> Result<AccountRoleDataRefreshResult, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("请先配置角色数据 API 密钥".into());
    }
    let ids = normalize_ids(ids)?;
    let requested_count = ids.len();
    let mut slots = vec![None; ids.len()];
    let mut targets = Vec::new();

    for (position, account_id) in ids.iter().enumerate() {
        let row = sqlx::query("SELECT server, character_name FROM account_profiles WHERE id = ?")
            .bind(account_id)
            .fetch_optional(pool)
            .await
            .map_err(db_error)?;

        let Some(row) = row else {
            slots[position] = Some(AccountRoleDataFetchOutcome {
                position,
                item: result_item(
                    account_id,
                    AccountRoleDataRefreshStatus::Failed,
                    "账号档案不存在",
                ),
                update: None,
            });
            continue;
        };

        let server = optional_text(row.try_get("server").map_err(db_error)?);
        let character_name = optional_text(row.try_get("character_name").map_err(db_error)?);
        let (server, character_name) = match (server, character_name) {
            (Some(server), Some(character_name)) => (server, character_name),
            (server, character_name) => {
                let missing = match (server.is_none(), character_name.is_none()) {
                    (true, true) => "缺少服务器和角色名",
                    (true, false) => "缺少服务器",
                    (false, true) => "缺少角色名",
                    (false, false) => unreachable!(),
                };
                slots[position] = Some(AccountRoleDataFetchOutcome {
                    position,
                    item: result_item(account_id, AccountRoleDataRefreshStatus::Skipped, missing),
                    update: None,
                });
                continue;
            }
        };

        targets.push(AccountRoleDataTarget {
            position,
            account_id: account_id.clone(),
            server,
            character_name,
        });
    }

    let mut completed_count = 0;
    for outcome in slots.iter().flatten() {
        completed_count += 1;
        send_progress(
            on_progress,
            completed_count,
            requested_count,
            outcome.item.clone(),
            None,
        );
    }

    let mut fetched = stream::iter(targets.into_iter().map(|target| async move {
        fetch_account_role_data(client, base_url, api_key, target).await
    }))
    .buffer_unordered(MAX_CONCURRENT_REQUESTS);
    while let Some(mut outcome) = fetched.next().await {
        let patch = if let Some(update) = outcome.update.take() {
            let _operation_guard = backup.lock_data_operation().await;
            match commit_account_role_data_update(pool, update).await {
                Ok(patch) => Some(patch),
                Err(message) => {
                    outcome.item = result_item(
                        &outcome.item.account_id,
                        AccountRoleDataRefreshStatus::Failed,
                        &message,
                    );
                    None
                }
            }
        } else {
            None
        };
        let position = outcome.position;
        slots[position] = Some(AccountRoleDataFetchOutcome {
            position,
            item: outcome.item.clone(),
            update: None,
        });
        completed_count += 1;
        send_progress(
            on_progress,
            completed_count,
            requested_count,
            outcome.item,
            patch,
        );
    }

    let items = slots
        .into_iter()
        .map(|slot| slot.expect("every requested account must produce an outcome"))
        .map(|outcome| outcome.item)
        .collect();
    Ok(summarize(items))
}

async fn commit_account_role_data_update(
    pool: &SqlitePool,
    update: AccountRoleDataUpdate,
) -> Result<AccountRoleDataRefreshPatch, String> {
    let mut transaction = pool.begin().await.map_err(db_error)?;
    let updated_at = chrono::Utc::now().to_rfc3339();
    let result = sqlx::query(
        "UPDATE account_profiles SET
            gear_score = ?, current_score = ?,
            highest_score = CASE
                WHEN ? IS NULL THEN highest_score
                WHEN highest_score IS NULL OR highest_score < ? THEN ?
                ELSE highest_score
            END,
            score_updated_at = ?,
            weekly_wins = CASE WHEN ? IS NULL THEN weekly_wins ELSE ? END,
            updated_at = ?
         WHERE id = ?",
    )
    .bind(update.gear_score)
    .bind(update.current_score)
    .bind(update.highest_score)
    .bind(update.highest_score)
    .bind(update.highest_score)
    .bind(update.score_updated_at)
    .bind(update.weekly_wins)
    .bind(update.weekly_wins)
    .bind(&updated_at)
    .bind(&update.account_id)
    .execute(&mut *transaction)
    .await
    .map_err(db_error)?;
    if result.rows_affected() == 0 {
        return Err(format!("账号档案不存在: {}", update.account_id));
    }

    let row = sqlx::query(
        "SELECT gear_score, current_score, highest_score, score_updated_at,
                weekly_wins, updated_at
         FROM account_profiles WHERE id = ?",
    )
    .bind(&update.account_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(db_error)?;
    let patch = AccountRoleDataRefreshPatch {
        account_id: update.account_id,
        gear_score: row.try_get("gear_score").map_err(db_error)?,
        current_score: row.try_get("current_score").map_err(db_error)?,
        highest_score: row.try_get("highest_score").map_err(db_error)?,
        score_updated_at: row.try_get("score_updated_at").map_err(db_error)?,
        weekly_wins: row.try_get("weekly_wins").map_err(db_error)?,
        updated_at: row.try_get("updated_at").map_err(db_error)?,
    };
    transaction.commit().await.map_err(db_error)?;
    Ok(patch)
}

fn send_progress(
    channel: &Channel<AccountRoleDataRefreshProgress>,
    completed_count: usize,
    requested_count: usize,
    item: AccountRoleDataRefreshItem,
    patch: Option<AccountRoleDataRefreshPatch>,
) {
    let _ = channel.send(AccountRoleDataRefreshProgress {
        completed_count,
        requested_count,
        item,
        patch,
    });
}

async fn fetch_account_role_data(
    client: &Client,
    base_url: &str,
    api_key: &str,
    target: AccountRoleDataTarget,
) -> AccountRoleDataFetchOutcome {
    let failed = |message: &str| AccountRoleDataFetchOutcome {
        position: target.position,
        item: result_item(
            &target.account_id,
            AccountRoleDataRefreshStatus::Failed,
            message,
        ),
        update: None,
    };

    let url = match build_account_role_data_url(
        base_url,
        api_key,
        &target.server,
        &target.character_name,
    ) {
        Ok(url) => url,
        Err(message) => return failed(&message),
    };
    let mut response = match client.get(url).send().await {
        Ok(response) => response,
        Err(error) if error.is_timeout() => return failed("请求角色数据超时"),
        Err(error) if error.is_connect() => return failed("无法连接角色数据服务器"),
        Err(_) => return failed("请求角色数据失败"),
    };
    if response.status() == StatusCode::UNAUTHORIZED {
        return failed("角色数据 API 密钥无效");
    }
    if response.status() == StatusCode::SERVICE_UNAVAILABLE {
        return failed("角色数据服务不可用或服务端未配置 API 密钥");
    }
    if response.status() != StatusCode::OK {
        return failed(&format!("服务器返回 HTTP {}", response.status().as_u16()));
    }

    let mut body = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if body.len() + chunk.len() > MAX_RESPONSE_BYTES => {
                return failed("服务器响应过大");
            }
            Ok(Some(chunk)) => body.extend_from_slice(&chunk),
            Ok(None) => break,
            Err(error) if error.is_timeout() => return failed("读取角色数据响应超时"),
            Err(_) => return failed("读取角色数据响应失败"),
        }
    }

    let payload = match parse_account_role_data_response(&body) {
        Ok(payload) => payload,
        Err(message) => return failed(&message),
    };
    let ParsedAccountRoleData::Updated {
        gear_score,
        current_score,
        highest_score,
        score_updated_at,
        weekly_wins,
    } = payload
    else {
        return AccountRoleDataFetchOutcome {
            position: target.position,
            item: result_item(
                &target.account_id,
                AccountRoleDataRefreshStatus::NoRecord,
                "无角色战绩",
            ),
            update: None,
        };
    };

    AccountRoleDataFetchOutcome {
        position: target.position,
        item: AccountRoleDataRefreshItem {
            account_id: target.account_id.clone(),
            status: AccountRoleDataRefreshStatus::Updated,
            message: None,
        },
        update: Some(AccountRoleDataUpdate {
            account_id: target.account_id,
            gear_score,
            current_score,
            highest_score,
            score_updated_at,
            weekly_wins,
        }),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ParsedAccountRoleData {
    NoRecord,
    Updated {
        gear_score: String,
        current_score: i64,
        highest_score: Option<i64>,
        score_updated_at: String,
        weekly_wins: Option<i64>,
    },
}

fn parse_account_role_data_response(bytes: &[u8]) -> Result<ParsedAccountRoleData, String> {
    let payload: Value =
        serde_json::from_slice(bytes).map_err(|_| "服务器返回的 JSON 无效".to_string())?;
    let object = payload
        .as_object()
        .ok_or_else(|| "服务器返回的 JSON 结构无效".to_string())?;
    let ok = object
        .get("ok")
        .and_then(Value::as_bool)
        .ok_or_else(|| "服务器响应缺少有效的 ok 字段".to_string())?;
    if !ok {
        return Ok(ParsedAccountRoleData::NoRecord);
    }

    let gear_score = parse_gear_score(
        object
            .get("equip")
            .ok_or_else(|| "服务器响应缺少 equip 字段".to_string())?,
    )?;
    let current_score = parse_non_negative_integer(
        object
            .get("score")
            .ok_or_else(|| "服务器响应缺少 score 字段".to_string())?,
        "score",
    )?;
    let highest_score = object
        .get("total_score")
        .filter(|value| !value.is_null())
        .map(|value| parse_non_negative_integer(value, "total_score"))
        .transpose()?;
    let score_updated_at = parse_score_updated_at(
        object
            .get("time")
            .and_then(Value::as_str)
            .ok_or_else(|| "服务器响应缺少有效的 time 字段".to_string())?,
    )?;
    let weekly_wins = object
        .get("week_win")
        .filter(|value| !value.is_null())
        .and_then(|value| parse_non_negative_integer(value, "week_win").ok());

    Ok(ParsedAccountRoleData::Updated {
        gear_score,
        current_score,
        highest_score,
        score_updated_at,
        weekly_wins,
    })
}

fn parse_gear_score(value: &Value) -> Result<String, String> {
    parse_non_negative_integer(value, "equip").map(|value| value.to_string())
}

fn parse_non_negative_integer(value: &Value, field: &str) -> Result<i64, String> {
    let parsed = match value {
        Value::Number(value) => value.as_i64(),
        Value::String(value) => value.trim().parse::<i64>().ok(),
        _ => None,
    }
    .ok_or_else(|| format!("服务器响应的 {field} 字段不是整数"))?;
    if parsed < 0 {
        return Err(format!("服务器响应的 {field} 字段不能为负数"));
    }
    Ok(parsed)
}

fn parse_score_updated_at(value: &str) -> Result<String, String> {
    let value = value.trim();
    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        return Ok(date.format("%Y-%m-%d").to_string());
    }
    let timestamp = DateTime::parse_from_rfc3339(value)
        .map_err(|_| "服务器响应的 time 字段不是有效日期".to_string())?;
    let china = FixedOffset::east_opt(8 * 60 * 60).expect("China offset is valid");
    Ok(timestamp
        .with_timezone(&china)
        .date_naive()
        .format("%Y-%m-%d")
        .to_string())
}

pub(crate) fn validate_account_role_data_server_url(value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|_| "角色数据服务器 URL 格式无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("角色数据服务器 URL 必须是带主机的 http 或 https 地址".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("角色数据服务器 URL 不能包含用户名或密码".into());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("角色数据服务器 URL 不能包含查询参数或片段".into());
    }
    if url.cannot_be_a_base() {
        return Err("角色数据服务器 URL 不能作为基础地址".into());
    }
    Ok(())
}

fn build_account_role_data_url(
    base_url: &str,
    api_key: &str,
    server: &str,
    character_name: &str,
) -> Result<Url, String> {
    validate_account_role_data_server_url(base_url)?;
    let mut url = Url::parse(base_url).map_err(|_| "角色数据服务器 URL 格式无效".to_string())?;
    let mut segments = url
        .path_segments_mut()
        .map_err(|_| "角色数据服务器 URL 不能追加路径".to_string())?;
    segments.pop_if_empty();
    segments.push(server);
    segments.push(character_name);
    segments.push("");
    drop(segments);
    url.query_pairs_mut().append_pair("api_key", api_key);
    Ok(url)
}

fn normalize_ids(ids: Vec<String>) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for id in ids {
        let id = id.trim();
        if id.is_empty() {
            return Err("角色数据更新不能包含空白账号 ID".into());
        }
        if seen.insert(id.to_string()) {
            normalized.push(id.to_string());
        }
    }
    if normalized.is_empty() {
        return Err("请至少选择一个账号更新角色数据".into());
    }
    Ok(normalized)
}

fn optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

fn result_item(
    account_id: &str,
    status: AccountRoleDataRefreshStatus,
    message: &str,
) -> AccountRoleDataRefreshItem {
    AccountRoleDataRefreshItem {
        account_id: account_id.to_string(),
        status,
        message: Some(message.to_string()),
    }
}

fn summarize(items: Vec<AccountRoleDataRefreshItem>) -> AccountRoleDataRefreshResult {
    AccountRoleDataRefreshResult {
        requested_count: items.len(),
        updated_count: items
            .iter()
            .filter(|item| item.status == AccountRoleDataRefreshStatus::Updated)
            .count(),
        no_record_count: items
            .iter()
            .filter(|item| item.status == AccountRoleDataRefreshStatus::NoRecord)
            .count(),
        skipped_count: items
            .iter()
            .filter(|item| item.status == AccountRoleDataRefreshStatus::Skipped)
            .count(),
        failed_count: items
            .iter()
            .filter(|item| item.status == AccountRoleDataRefreshStatus::Failed)
            .count(),
        items,
    }
}

fn db_error(error: sqlx::Error) -> String {
    format!("数据库操作失败: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{backup::BackupState, db::Database};
    use std::{
        fs,
        io::{Read, Write},
        net::TcpListener,
        path::PathBuf,
        sync::{
            Arc, Mutex as StdMutex,
            atomic::{AtomicUsize, Ordering},
        },
        thread,
    };
    use tauri::ipc::InvokeResponseBody;

    fn run_async<T>(future: impl std::future::Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

    fn test_backup_state() -> (BackupState, PathBuf) {
        let data_dir = std::env::temp_dir().join(format!(
            "timekeeper-role-refresh-test-{}",
            uuid::Uuid::now_v7()
        ));
        let state = BackupState::new(&data_dir, data_dir.join("database.sqlite3")).unwrap();
        (state, data_dir)
    }

    fn progress_channel() -> (
        Channel<AccountRoleDataRefreshProgress>,
        Arc<StdMutex<Vec<Value>>>,
    ) {
        let messages = Arc::new(StdMutex::new(Vec::new()));
        let messages_for_channel = Arc::clone(&messages);
        let channel = Channel::new(move |body| {
            let InvokeResponseBody::Json(json) = body else {
                panic!("role refresh progress must use JSON");
            };
            messages_for_channel
                .lock()
                .unwrap()
                .push(serde_json::from_str(&json).unwrap());
            Ok(())
        });
        (channel, messages)
    }

    fn spawn_http_server(
        expected_requests: usize,
        delay: Duration,
        status: u16,
        body: &'static str,
    ) -> (String, Arc<AtomicUsize>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let active = Arc::new(AtomicUsize::new(0));
        let maximum = Arc::new(AtomicUsize::new(0));
        let active_for_thread = Arc::clone(&active);
        let maximum_for_thread = Arc::clone(&maximum);
        let handle = thread::spawn(move || {
            let mut workers = Vec::new();
            for _ in 0..expected_requests {
                let (mut stream, _) = listener.accept().unwrap();
                let active = Arc::clone(&active_for_thread);
                let maximum = Arc::clone(&maximum_for_thread);
                workers.push(thread::spawn(move || {
                    let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                    maximum.fetch_max(current, Ordering::SeqCst);
                    let mut request = [0_u8; 2048];
                    let _ = stream.read(&mut request);
                    thread::sleep(delay);
                    let reason = if status == 200 { "OK" } else { "Error" };
                    let response = format!(
                        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                    active.fetch_sub(1, Ordering::SeqCst);
                }));
            }
            for worker in workers {
                worker.join().unwrap();
            }
        });
        (format!("http://{address}/api/"), maximum, handle)
    }

    fn spawn_staggered_http_server() -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let mut workers = Vec::new();
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                workers.push(thread::spawn(move || {
                    let mut request = [0_u8; 2048];
                    let read = stream.read(&mut request).unwrap_or_default();
                    let request = String::from_utf8_lossy(&request[..read]);
                    let delay = if request.contains("account-slow") {
                        Duration::from_millis(100)
                    } else {
                        Duration::from_millis(10)
                    };
                    thread::sleep(delay);
                    let body = r#"{"ok":true,"time":"2026-08-09","equip":"200","score":"250","total_score":"300","week_win":4}"#;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    stream.write_all(response.as_bytes()).unwrap();
                    stream.flush().unwrap();
                }));
            }
            for worker in workers {
                worker.join().unwrap();
            }
        });
        (format!("http://{address}/api/"), handle)
    }

    async fn insert_account(
        database: &Database,
        id: &str,
        server: Option<&str>,
        character_name: Option<&str>,
        highest_score: i64,
    ) {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO account_profiles (
                id, contact_name, server, character_name, specialization, gear_score,
                account_name, current_score, highest_score, score_updated_at,
                notes, needs_review, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind("联系人")
        .bind(server)
        .bind(character_name)
        .bind("心法")
        .bind("100")
        .bind(format!("login-{id}"))
        .bind(100_i64)
        .bind(highest_score)
        .bind("2026-08-01")
        .bind("原备注")
        .bind(0_i64)
        .bind(&now)
        .bind(&now)
        .execute(database.pool())
        .await
        .unwrap();
    }

    #[test]
    fn validates_and_encodes_role_data_urls() {
        let url = build_account_role_data_url(
            "https://zhishui.cc/api/jx3/excel/",
            "api secret/?",
            "梦江南",
            "角色 名/测试",
        )
        .unwrap();
        assert_eq!(
            url.as_str(),
            "https://zhishui.cc/api/jx3/excel/%E6%A2%A6%E6%B1%9F%E5%8D%97/%E8%A7%92%E8%89%B2%20%E5%90%8D%2F%E6%B5%8B%E8%AF%95/?api_key=api+secret%2F%3F"
        );
        assert!(validate_account_role_data_server_url("file:///tmp/data").is_err());
        assert!(validate_account_role_data_server_url("https://user:pass@example.com/").is_err());
        assert!(validate_account_role_data_server_url("https://example.com/?token=x").is_err());
        assert_eq!(
            normalize_ids(vec![
                " account-1 ".into(),
                "account-1".into(),
                "account-2".into()
            ])
            .unwrap(),
            vec!["account-1", "account-2"]
        );
    }

    #[test]
    fn parses_success_no_record_and_flexible_numbers() {
        let parsed = parse_account_role_data_response(
            br#"{"ok":true,"time":"2026-08-02T20:30:00Z","equip":825153,"score":"2874","total_score":"2934","week_win":6}"#,
        )
        .unwrap();
        assert_eq!(
            parsed,
            ParsedAccountRoleData::Updated {
                gear_score: "825153".into(),
                current_score: 2874,
                highest_score: Some(2934),
                score_updated_at: "2026-08-03".into(),
                weekly_wins: Some(6),
            }
        );
        assert_eq!(
            parse_account_role_data_response(br#"{"ok":false}"#).unwrap(),
            ParsedAccountRoleData::NoRecord
        );
        assert!(parse_account_role_data_response(br#"{"ok":true}"#).is_err());
        assert!(parse_account_role_data_response(b"not-json").is_err());
        assert!(
            parse_account_role_data_response(
                r#"{"ok":true,"time":"2026-08-02","equip":"19.8万","score":1}"#.as_bytes()
            )
            .is_err()
        );
        assert!(
            parse_account_role_data_response(
                br#"{"ok":true,"time":"2026-08-02","equip":-1,"score":1}"#
            )
            .is_err()
        );
    }

    #[test]
    fn missing_or_invalid_week_win_keeps_the_legacy_response_compatible() {
        for body in [
            br#"{"ok":true,"time":"2026-08-02","equip":100,"score":1,"total_score":2}"#.as_slice(),
            br#"{"ok":true,"time":"2026-08-02","equip":100,"score":1,"total_score":2,"week_win":"invalid"}"#.as_slice(),
        ] {
            let ParsedAccountRoleData::Updated { weekly_wins, .. } =
                parse_account_role_data_response(body).unwrap()
            else {
                panic!("expected an updated response");
            };
            assert_eq!(weekly_wins, None);
        }
    }

    #[test]
    fn operation_lock_rejects_overlapping_refreshes() {
        let state = AccountRoleDataRefreshState::new().unwrap();
        let guard = state.try_start().unwrap();
        assert!(state.try_start().is_err());
        drop(guard);
        assert!(state.try_start().is_ok());
    }

    #[test]
    fn empty_api_key_is_rejected_before_any_network_request() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            insert_account(
                &database,
                "account-without-key",
                Some("测试服"),
                Some("测试角色"),
                100,
            )
            .await;
            let client = Client::builder().no_proxy().build().unwrap();
            let (backup, data_dir) = test_backup_state();
            let (channel, _) = progress_channel();
            let error = refresh_account_role_data(
                database.pool(),
                &client,
                "http://127.0.0.1:9/",
                "   ",
                vec!["account-without-key".into()],
                &backup,
                &channel,
            )
            .await
            .unwrap_err();
            assert_eq!(error, "请先配置角色数据 API 密钥");
            fs::remove_dir_all(data_dir).unwrap();
        });
    }

    #[test]
    fn limits_network_concurrency_and_streams_committed_progress() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let ids = (0..7)
                .map(|index| format!("account-{index}"))
                .collect::<Vec<_>>();
            for id in &ids {
                insert_account(&database, id, Some("测试服"), Some(id), 100).await;
            }
            let (base_url, maximum, server) = spawn_http_server(
                ids.len(),
                Duration::from_millis(80),
                200,
                r#"{"ok":true,"time":"2026-08-02","equip":"200","score":"250","total_score":"300","week_win":4}"#,
            );
            let client = Client::builder().no_proxy().build().unwrap();
            let (backup, data_dir) = test_backup_state();
            let (channel, messages) = progress_channel();
            let result = refresh_account_role_data(
                database.pool(),
                &client,
                &base_url,
                "test-api-key",
                ids.clone(),
                &backup,
                &channel,
            )
            .await
            .unwrap();
            server.join().unwrap();

            assert_eq!(maximum.load(Ordering::SeqCst), MAX_CONCURRENT_REQUESTS);
            assert_eq!(
                result
                    .items
                    .iter()
                    .map(|item| item.account_id.clone())
                    .collect::<Vec<_>>(),
                ids
            );
            assert!(
                result
                    .items
                    .iter()
                    .all(|item| item.status == AccountRoleDataRefreshStatus::Updated)
            );
            let messages = messages.lock().unwrap();
            assert_eq!(messages.len(), ids.len());
            assert_eq!(messages.last().unwrap()["completedCount"], ids.len());
            assert!(messages.iter().all(|message| message["patch"].is_object()));
            assert!(
                !serde_json::to_string(&*messages)
                    .unwrap()
                    .contains("password")
            );
            drop(messages);
            fs::remove_dir_all(data_dir).unwrap();
        });
    }

    #[test]
    fn streams_progress_in_completion_order_but_summarizes_in_input_order() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let ids = vec!["account-slow".to_string(), "account-fast".to_string()];
            for id in &ids {
                insert_account(&database, id, Some("测试服"), Some(id), 100).await;
            }
            let (base_url, server) = spawn_staggered_http_server();
            let client = Client::builder().no_proxy().build().unwrap();
            let (backup, data_dir) = test_backup_state();
            let (channel, messages) = progress_channel();

            let result = refresh_account_role_data(
                database.pool(),
                &client,
                &base_url,
                "test-api-key",
                ids.clone(),
                &backup,
                &channel,
            )
            .await
            .unwrap();
            server.join().unwrap();

            assert_eq!(
                result
                    .items
                    .iter()
                    .map(|item| item.account_id.clone())
                    .collect::<Vec<_>>(),
                ids
            );
            let messages = messages.lock().unwrap();
            assert_eq!(messages[0]["item"]["accountId"], "account-fast");
            assert_eq!(messages[1]["item"]["accountId"], "account-slow");
            drop(messages);
            fs::remove_dir_all(data_dir).unwrap();
        });
    }

    #[test]
    fn classifies_http_and_timeout_failures_without_response_details() {
        run_async(async {
            let target = |position| AccountRoleDataTarget {
                position,
                account_id: format!("account-{position}"),
                server: "测试服".into(),
                character_name: "测试角色".into(),
            };

            let (base_url, _, server) =
                spawn_http_server(1, Duration::ZERO, 401, r#"{"ok":false}"#);
            let client = Client::builder().no_proxy().build().unwrap();
            let outcome =
                fetch_account_role_data(&client, &base_url, "invalid-key", target(0)).await;
            server.join().unwrap();
            assert_eq!(outcome.item.status, AccountRoleDataRefreshStatus::Failed);
            assert_eq!(
                outcome.item.message.as_deref(),
                Some("角色数据 API 密钥无效")
            );

            let (base_url, _, server) =
                spawn_http_server(1, Duration::ZERO, 503, r#"{"secret":"do-not-return"}"#);
            let client = Client::builder().no_proxy().build().unwrap();
            let outcome =
                fetch_account_role_data(&client, &base_url, "test-api-key", target(1)).await;
            server.join().unwrap();
            assert_eq!(outcome.item.status, AccountRoleDataRefreshStatus::Failed);
            assert_eq!(
                outcome.item.message.as_deref(),
                Some("角色数据服务不可用或服务端未配置 API 密钥")
            );

            let (base_url, _, server) =
                spawn_http_server(1, Duration::from_millis(120), 200, r#"{"ok":false}"#);
            let client = Client::builder()
                .no_proxy()
                .timeout(Duration::from_millis(30))
                .build()
                .unwrap();
            let outcome =
                fetch_account_role_data(&client, &base_url, "test-api-key", target(2)).await;
            server.join().unwrap();
            assert_eq!(outcome.item.status, AccountRoleDataRefreshStatus::Failed);
            assert_eq!(outcome.item.message.as_deref(), Some("请求角色数据超时"));
        });
    }

    #[test]
    fn skips_profiles_missing_server_or_character_without_a_request() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            insert_account(&database, "missing-server", None, Some("角色"), 100).await;
            insert_account(&database, "missing-character", Some("区服"), None, 100).await;
            let client = Client::builder().no_proxy().build().unwrap();
            let (backup, data_dir) = test_backup_state();
            let (channel, messages) = progress_channel();
            let result = refresh_account_role_data(
                database.pool(),
                &client,
                "http://127.0.0.1:9/",
                "test-api-key",
                vec!["missing-server".into(), "missing-character".into()],
                &backup,
                &channel,
            )
            .await
            .unwrap();
            assert!(
                result
                    .items
                    .iter()
                    .all(|item| item.status == AccountRoleDataRefreshStatus::Skipped)
            );
            assert!(
                messages
                    .lock()
                    .unwrap()
                    .iter()
                    .all(|message| message["patch"].is_null())
            );
            fs::remove_dir_all(data_dir).unwrap();
        });
    }

    #[test]
    fn commits_only_target_columns_and_never_lowers_highest_score() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            let now = chrono::Utc::now().to_rfc3339();
            sqlx::query(
                "INSERT INTO account_profiles (
                    id, contact_name, server, character_name, specialization, gear_score,
                    account_name, current_score, highest_score, score_updated_at,
                    notes, needs_review, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind("account-1")
            .bind("联系人")
            .bind("旧服")
            .bind("旧角色")
            .bind("旧心法")
            .bind("100")
            .bind("login-name")
            .bind(100_i64)
            .bind(300_i64)
            .bind("2026-08-01")
            .bind("原备注")
            .bind(1_i64)
            .bind(&now)
            .bind(&now)
            .execute(database.pool())
            .await
            .unwrap();

            let patch = commit_account_role_data_update(
                database.pool(),
                AccountRoleDataUpdate {
                    account_id: "account-1".into(),
                    gear_score: "200".into(),
                    current_score: 250,
                    highest_score: Some(280),
                    score_updated_at: "2026-08-03".into(),
                    weekly_wins: Some(7),
                },
            )
            .await
            .unwrap();
            assert_eq!(patch.highest_score, Some(300));
            assert_eq!(patch.weekly_wins, Some(7));

            let row = sqlx::query("SELECT * FROM account_profiles WHERE id = ?")
                .bind("account-1")
                .fetch_one(database.pool())
                .await
                .unwrap();
            assert_eq!(row.get::<String, _>("gear_score"), "200");
            assert_eq!(row.get::<i64, _>("current_score"), 250);
            assert_eq!(row.get::<i64, _>("highest_score"), 300);
            assert_eq!(row.get::<String, _>("score_updated_at"), "2026-08-03");
            assert_eq!(row.get::<i64, _>("weekly_wins"), 7);
            assert_eq!(row.get::<String, _>("contact_name"), "联系人");
            assert_eq!(row.get::<String, _>("notes"), "原备注");
            assert_eq!(row.get::<i64, _>("needs_review"), 1);

            let patch = commit_account_role_data_update(
                database.pool(),
                AccountRoleDataUpdate {
                    account_id: "account-1".into(),
                    gear_score: "210".into(),
                    current_score: 260,
                    highest_score: Some(290),
                    score_updated_at: "2026-08-04".into(),
                    weekly_wins: None,
                },
            )
            .await
            .unwrap();
            assert_eq!(patch.highest_score, Some(300));
            assert_eq!(patch.weekly_wins, Some(7));
            let row = sqlx::query("SELECT * FROM account_profiles WHERE id = ?")
                .bind("account-1")
                .fetch_one(database.pool())
                .await
                .unwrap();
            assert_eq!(row.get::<String, _>("gear_score"), "210");
            assert_eq!(row.get::<i64, _>("current_score"), 260);
            assert_eq!(row.get::<i64, _>("weekly_wins"), 7);
        });
    }

    #[test]
    fn preserves_completed_updates_when_a_later_account_disappears() {
        run_async(async {
            let database = Database::in_memory().await.unwrap();
            insert_account(&database, "account-1", Some("区服"), Some("角色"), 300).await;
            commit_account_role_data_update(
                database.pool(),
                AccountRoleDataUpdate {
                    account_id: "account-1".into(),
                    gear_score: "999".into(),
                    current_score: 999,
                    highest_score: Some(999),
                    score_updated_at: "2026-08-03".into(),
                    weekly_wins: Some(9),
                },
            )
            .await
            .unwrap();
            let error = commit_account_role_data_update(
                database.pool(),
                AccountRoleDataUpdate {
                    account_id: "missing-account".into(),
                    gear_score: "999".into(),
                    current_score: 999,
                    highest_score: Some(999),
                    score_updated_at: "2026-08-03".into(),
                    weekly_wins: Some(9),
                },
            )
            .await
            .unwrap_err();
            assert!(error.contains("账号档案不存在"));
            let row = sqlx::query(
                "SELECT gear_score, current_score, highest_score FROM account_profiles WHERE id = ?",
            )
            .bind("account-1")
            .fetch_one(database.pool())
            .await
            .unwrap();
            assert_eq!(row.get::<String, _>("gear_score"), "999");
            assert_eq!(row.get::<i64, _>("current_score"), 999);
            assert_eq!(row.get::<i64, _>("highest_score"), 999);
        });
    }
}
