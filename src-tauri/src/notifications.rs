use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use chrono::{DateTime, Utc};
use tauri::{AppHandle, Runtime, plugin::TauriPlugin};
use tauri_plugin_notification::NotificationExt;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum NotificationError {
    #[error("预约 ID 不合法")]
    InvalidAppointmentId,
    #[error("通知标题不能为空或过长")]
    InvalidTitle,
    #[error("通知正文过长")]
    InvalidBody,
    #[error("通知调度状态不可用")]
    StatePoisoned,
}

struct ScheduledTask {
    generation: u64,
    handle: tauri::async_runtime::JoinHandle<()>,
}

struct NotificationRegistry {
    tasks: Mutex<HashMap<String, ScheduledTask>>,
    next_generation: AtomicU64,
}

impl Drop for NotificationRegistry {
    fn drop(&mut self) {
        if let Ok(tasks) = self.tasks.get_mut() {
            for (_, task) in tasks.drain() {
                task.handle.abort();
            }
        }
    }
}

#[derive(Clone)]
pub struct NotificationState {
    inner: Arc<NotificationRegistry>,
}

impl Default for NotificationState {
    fn default() -> Self {
        Self {
            inner: Arc::new(NotificationRegistry {
                tasks: Mutex::new(HashMap::new()),
                next_generation: AtomicU64::new(1),
            }),
        }
    }
}

impl NotificationState {
    pub(crate) fn schedule<R: Runtime>(
        &self,
        app: AppHandle<R>,
        appointment_id: impl Into<String>,
        notify_at: DateTime<Utc>,
        title: impl Into<String>,
        body: impl Into<String>,
    ) -> Result<(), NotificationError> {
        let appointment_id = appointment_id.into();
        let title = title.into();
        let body = body.into();
        validate_notification(&appointment_id, &title, &body)?;

        let generation = self.inner.next_generation.fetch_add(1, Ordering::Relaxed);
        let weak_registry = Arc::downgrade(&self.inner);
        let task_id = appointment_id.clone();
        let (start_sender, start_receiver) = tokio::sync::oneshot::channel();
        let handle = tauri::async_runtime::spawn(async move {
            if start_receiver.await.is_err() {
                return;
            }
            tokio::time::sleep(delay_until(notify_at)).await;
            if !is_current(&weak_registry, &task_id, generation) {
                return;
            }

            let _ = app.notification().builder().title(title).body(body).show();
            remove_if_current(&weak_registry, &task_id, generation);
        });

        let previous = self
            .inner
            .tasks
            .lock()
            .map_err(|_| NotificationError::StatePoisoned)?
            .insert(appointment_id, ScheduledTask { generation, handle });
        if let Some(previous) = previous {
            previous.handle.abort();
        }
        let _ = start_sender.send(());
        Ok(())
    }

    pub(crate) fn cancel(&self, appointment_id: &str) -> Result<bool, NotificationError> {
        if appointment_id.trim().is_empty() {
            return Err(NotificationError::InvalidAppointmentId);
        }
        let task = self
            .inner
            .tasks
            .lock()
            .map_err(|_| NotificationError::StatePoisoned)?
            .remove(appointment_id);
        if let Some(task) = task {
            task.handle.abort();
            Ok(true)
        } else {
            Ok(false)
        }
    }

    #[cfg(test)]
    fn scheduled_count(&self) -> usize {
        self.inner.tasks.lock().unwrap().len()
    }
}

/// Register this plugin before calling `NotificationState::schedule`.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_notification::init()
}

pub(crate) fn schedule_appointment_notification<R: Runtime>(
    state: &NotificationState,
    app: AppHandle<R>,
    appointment_id: &str,
    notify_at: DateTime<Utc>,
    title: &str,
    body: &str,
) -> Result<(), NotificationError> {
    state.schedule(
        app,
        appointment_id.to_owned(),
        notify_at,
        title.to_owned(),
        body.to_owned(),
    )
}

pub(crate) fn cancel_appointment_notification(
    state: &NotificationState,
    appointment_id: &str,
) -> Result<bool, NotificationError> {
    state.cancel(appointment_id)
}

fn validate_notification(
    appointment_id: &str,
    title: &str,
    body: &str,
) -> Result<(), NotificationError> {
    if appointment_id.trim().is_empty() || appointment_id.len() > 256 {
        return Err(NotificationError::InvalidAppointmentId);
    }
    if title.trim().is_empty() || title.chars().count() > 120 {
        return Err(NotificationError::InvalidTitle);
    }
    if body.chars().count() > 1_000 {
        return Err(NotificationError::InvalidBody);
    }
    Ok(())
}

fn delay_until(notify_at: DateTime<Utc>) -> Duration {
    (notify_at - Utc::now()).to_std().unwrap_or(Duration::ZERO)
}

fn is_current(
    registry: &Weak<NotificationRegistry>,
    appointment_id: &str,
    generation: u64,
) -> bool {
    registry
        .upgrade()
        .and_then(|registry| {
            registry.tasks.lock().ok().map(|tasks| {
                tasks
                    .get(appointment_id)
                    .is_some_and(|task| task.generation == generation)
            })
        })
        .unwrap_or(false)
}

fn remove_if_current(registry: &Weak<NotificationRegistry>, appointment_id: &str, generation: u64) {
    let Some(registry) = registry.upgrade() else {
        return;
    };
    let Ok(mut tasks) = registry.tasks.lock() else {
        return;
    };
    if tasks
        .get(appointment_id)
        .is_some_and(|task| task.generation == generation)
    {
        tasks.remove(appointment_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn past_notifications_have_no_delay() {
        assert_eq!(
            delay_until(Utc::now() - chrono::Duration::minutes(1)),
            Duration::ZERO
        );
    }

    #[test]
    fn validates_narrow_notification_payloads() {
        assert!(validate_notification("appointment-1", "预约提醒", "即将开始").is_ok());
        assert!(matches!(
            validate_notification("", "预约提醒", "即将开始"),
            Err(NotificationError::InvalidAppointmentId)
        ));
        assert!(matches!(
            validate_notification("appointment-1", "", "即将开始"),
            Err(NotificationError::InvalidTitle)
        ));
    }

    #[test]
    fn cancelling_an_unknown_task_is_a_noop() {
        let state = NotificationState::default();
        assert!(!state.cancel("missing").unwrap());
        assert_eq!(state.scheduled_count(), 0);
    }
}
