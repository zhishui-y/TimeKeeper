use std::{
    collections::{HashMap, HashSet},
    sync::{LazyLock, Mutex},
};

use chrono::{DateTime, Duration, Utc};

use crate::models::AppointmentDeleteSelection;

const SELECTION_TTL_MINUTES: i64 = 10;
const MAX_ACTIVE_SELECTIONS: usize = 8;

#[derive(Debug, Clone)]
pub(super) struct StoredAppointmentSelection {
    pub(super) ids: Vec<String>,
    pub(super) expires_at: DateTime<Utc>,
}

pub(super) type ConsumedAppointmentSelection = (String, StoredAppointmentSelection);
pub(super) type ResolvedAppointmentSelection = (Vec<String>, Option<ConsumedAppointmentSelection>);

static APPOINTMENT_SELECTIONS: LazyLock<Mutex<HashMap<String, StoredAppointmentSelection>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(super) fn store(ids: Vec<String>) -> Result<(String, DateTime<Utc>), String> {
    let token = uuid::Uuid::now_v7().to_string();
    let expires_at = Utc::now() + Duration::minutes(SELECTION_TTL_MINUTES);
    let mut selections = APPOINTMENT_SELECTIONS
        .lock()
        .map_err(|_| "预约批量选择状态不可用".to_string())?;
    selections.retain(|_, selection| selection.expires_at > Utc::now());
    while selections.len() >= MAX_ACTIVE_SELECTIONS {
        let Some(oldest_token) = selections
            .iter()
            .min_by(|(left_token, left), (right_token, right)| {
                left.expires_at
                    .cmp(&right.expires_at)
                    .then_with(|| left_token.cmp(right_token))
            })
            .map(|(token, _)| token.clone())
        else {
            break;
        };
        selections.remove(&oldest_token);
    }
    selections.insert(
        token.clone(),
        StoredAppointmentSelection { ids, expires_at },
    );
    Ok((token, expires_at))
}

pub(super) fn normalized_ids(ids: &[String]) -> Vec<String> {
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

pub(super) fn resolve(
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

pub(super) fn restore_if_valid(consumed: ConsumedAppointmentSelection) {
    let (token, stored) = consumed;
    if stored.expires_at > Utc::now()
        && let Ok(mut selections) = APPOINTMENT_SELECTIONS.lock()
    {
        selections.entry(token).or_insert(stored);
    }
}

#[cfg(test)]
pub(super) fn insert_for_test(token: String, ids: Vec<String>, expires_at: DateTime<Utc>) {
    APPOINTMENT_SELECTIONS
        .lock()
        .unwrap()
        .insert(token, StoredAppointmentSelection { ids, expires_at });
}

#[cfg(all(test, not(debug_assertions)))]
pub(super) fn remove_for_test(token: &str) {
    APPOINTMENT_SELECTIONS.lock().unwrap().remove(token);
}
