mod accounts;
mod accounts_remote;
mod app_access;
mod appointments;
mod backup;
mod db;
mod importer;
mod models;
mod notifications;
mod reports;
mod settings;
mod vault;

use std::{io, path::PathBuf};

use tauri::{
    AppHandle, Manager, Runtime, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

fn setup_error(error: impl std::fmt::Display) -> io::Error {
    io::Error::other(error.to_string())
}

fn app_data_dir(app: &tauri::App) -> Result<PathBuf, io::Error> {
    #[cfg(debug_assertions)]
    if let Some(configured) = std::env::var_os("TIMEKEEPER_DATA_DIR") {
        let path = PathBuf::from(configured);
        if !path.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "TIMEKEEPER_DATA_DIR must be an absolute path",
            ));
        }
        return Ok(path);
    }

    app.path().app_data_dir().map_err(setup_error)
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "打开时约管家", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("时约管家")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(notifications::plugin())
        .on_window_event(|window, event| {
            if window.label() == "main"
                && let WindowEvent::CloseRequested { api, .. } = event
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let data_dir = app_data_dir(app)?;
            std::fs::create_dir_all(&data_dir).map_err(setup_error)?;

            let backup = backup::BackupState::new(&data_dir, data_dir.join(db::DATABASE_FILE_NAME))
                .map_err(setup_error)?;
            backup.apply_pending_restore().map_err(setup_error)?;

            let settings = settings::SettingsState::load(&data_dir).map_err(setup_error)?;
            let vault = vault::VaultState::new(&data_dir).map_err(setup_error)?;
            let database = tauri::async_runtime::block_on(db::initialize_database(&data_dir))
                .map_err(setup_error)?;
            let account_role_data_refresh =
                accounts_remote::AccountRoleDataRefreshState::new().map_err(setup_error)?;

            let notification_state = notifications::NotificationState::default();
            tauri::async_runtime::block_on(appointments::restore_pending_notifications(
                app.handle().clone(),
                &database,
                &notification_state,
            ))
            .map_err(setup_error)?;

            app.manage(database);
            app.manage(backup);
            app.manage(settings);
            app.manage(vault);
            app.manage(app_access::AppAccessState::new());
            app.manage(notification_state);
            app.manage(importer::ImportState::default());
            app.manage(account_role_data_refresh);
            setup_tray(app).map_err(setup_error)?;
            backup::spawn_automatic_backup_task(app.handle().clone());
            appointments::spawn_appointment_status_sync_task(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            appointments::list_appointments,
            appointments::list_appointment_page,
            appointments::create_appointment_selection,
            appointments::list_contact_presets,
            appointments::get_appointment,
            appointments::create_appointment,
            appointments::update_appointment,
            appointments::duplicate_appointment,
            appointments::delete_appointment,
            appointments::delete_appointments,
            appointments::copy_appointment_account_name,
            appointments::copy_appointment_voice_channel,
            appointments::copy_appointment_account_password,
            appointments::sync_appointment_service_statuses,
            appointments::set_appointment_service_status,
            appointments::settle_appointment,
            accounts::list_account_profiles,
            accounts::get_account_profile,
            accounts::create_account_profile,
            accounts::update_account_profile,
            accounts::update_account_profile_usage,
            accounts::clear_account_profile_usage,
            accounts::sync_account_profile_usage_week,
            accounts::delete_account_profile,
            accounts::delete_account_profiles,
            accounts::reorder_account_profiles,
            accounts::copy_account_name,
            accounts::copy_account_character_name,
            accounts::copy_account_password,
            accounts::refresh_account_profile_role_data,
            reports::get_dashboard_summary,
            reports::get_revenue_summary,
            importer::preview_excel_import,
            importer::commit_excel_import,
            app_access::app_access_status,
            app_access::initialize_app_access,
            app_access::unlock_app_access,
            app_access::lock_app_access,
            app_access::change_app_access_password,
            app_access::reset_app_access_password,
            app_access::migrate_legacy_credentials,
            settings::get_settings,
            settings::update_settings,
            settings::update_account_table_column_widths,
            settings::update_appointment_table_column_widths,
            backup::create_backup,
            backup::restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run TimeKeeper");
}

#[cfg(test)]
mod access_boundary_tests {
    use super::app_access::AppAccessState;

    const BUSINESS_COMMAND_GROUPS: &[(&str, &str)] = &[
        ("appointments", include_str!("appointments.rs")),
        ("accounts", include_str!("accounts.rs")),
        ("reports", include_str!("reports.rs")),
        ("excelImport", include_str!("importer.rs")),
        ("settings", include_str!("settings.rs")),
        ("backup", include_str!("backup.rs")),
    ];

    fn command_blocks(source: &str) -> impl Iterator<Item = &str> {
        let mut starts = source
            .match_indices("#[tauri::command")
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        starts.push(source.len());
        starts
            .windows(2)
            .map(|range| &source[range[0]..range[1]])
            .collect::<Vec<_>>()
            .into_iter()
    }

    fn command_name(block: &str) -> &str {
        let marker = if block.contains("pub async fn ") {
            "pub async fn "
        } else {
            "pub fn "
        };
        let start = block.find(marker).expect("command must be public") + marker.len();
        let tail = &block[start..];
        let end = tail
            .find(|character: char| !character.is_ascii_alphanumeric() && character != '_')
            .unwrap_or(tail.len());
        &tail[..end]
    }

    #[test]
    fn locked_process_and_every_business_command_group_keep_the_guard() {
        let access = AppAccessState::new();
        assert_eq!(
            access.require_unlocked().unwrap_err(),
            "应用已锁定，请先输入入口密码"
        );

        for (group, source) in BUSINESS_COMMAND_GROUPS {
            let blocks = command_blocks(source).collect::<Vec<_>>();
            assert!(
                !blocks.is_empty(),
                "命令分组 {group} 没有发现 Tauri command"
            );
            for block in blocks {
                let name = command_name(block);
                let body_start = block.find('{').expect("command must have a body");
                let guard_prefix = &block[body_start..block.len().min(body_start + 1_200)];
                assert!(
                    guard_prefix.contains("require_unlocked()?"),
                    "命令分组 {group} 的 {name} 缺少 Rust 入口锁检查"
                );
            }
        }
    }
}
