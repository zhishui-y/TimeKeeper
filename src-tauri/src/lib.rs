mod accounts;
mod appointments;
mod backup;
mod db;
mod importer;
mod models;
mod notifications;
mod reports;
mod settings;
mod vault;

use std::io;

use tauri::{
    AppHandle, Manager, Runtime, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

fn setup_error(error: impl std::fmt::Display) -> io::Error {
    io::Error::other(error.to_string())
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
            let data_dir = app.path().app_data_dir().map_err(setup_error)?;
            std::fs::create_dir_all(&data_dir).map_err(setup_error)?;

            let backup = backup::BackupState::new(&data_dir, data_dir.join(db::DATABASE_FILE_NAME))
                .map_err(setup_error)?;
            backup.apply_pending_restore().map_err(setup_error)?;

            let settings = settings::SettingsState::load(&data_dir).map_err(setup_error)?;
            let vault = vault::VaultState::new(&data_dir).map_err(setup_error)?;
            vault
                .set_auto_lock_minutes(settings.snapshot().map_err(setup_error)?.auto_lock_minutes)
                .map_err(setup_error)?;
            let database = tauri::async_runtime::block_on(db::initialize_database(app.handle()))
                .map_err(setup_error)?;

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
            app.manage(notification_state);
            app.manage(importer::ImportState::default());
            setup_tray(app).map_err(setup_error)?;
            vault::spawn_auto_lock_task(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            appointments::list_appointments,
            appointments::get_appointment,
            appointments::create_appointment,
            appointments::update_appointment,
            appointments::duplicate_appointment,
            appointments::delete_appointment,
            appointments::set_appointment_service_status,
            appointments::settle_appointment,
            accounts::list_account_profiles,
            accounts::get_account_profile,
            accounts::create_account_profile,
            accounts::update_account_profile,
            accounts::delete_account_profile,
            reports::get_dashboard_summary,
            reports::get_revenue_summary,
            importer::preview_excel_import,
            importer::commit_excel_import,
            vault::vault_status,
            vault::initialize_vault,
            vault::unlock_vault,
            vault::lock_vault,
            vault::reveal_account_password,
            vault::copy_account_password,
            settings::get_settings,
            settings::update_settings,
            backup::create_backup,
            backup::restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run TimeKeeper");
}
