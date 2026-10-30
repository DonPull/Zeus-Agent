#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod cookie_vault;
pub mod accounting;
pub mod model_routes;
pub mod model_catalogue;
pub mod attachments;
pub mod evaluation;
pub mod db;
pub mod chat;
pub mod browser_manager;
pub mod gatekeeper;
pub mod file_paths;
pub mod gateway;
pub mod logger;
pub mod orchestrator;
pub mod python_runner;
pub mod settings;
pub mod utils;
pub mod worker;
pub mod output_compressor;

use std::fs;
use tauri::{generate_context, Manager};

pub fn run() {
    // Resolve and create the workspace root (%APPDATA%\zeus-agent) plus its subfolders
    let app_data_dir = utils::workspace_root().expect("Failed to resolve workspace root");
    fs::create_dir_all(&app_data_dir).expect("Failed to create workspace root");
    utils::ensure_workspace_dirs().expect("Failed to create workspace directories");

    // Open (or create) the SQLite database
    let connection =
        db::init(&app_data_dir.join("zeus.db")).expect("Failed to initialize database");

    if let Ok(settings) = settings::read_settings(&connection) {
        if let Some(url) = settings.local_base_url {
            gateway::set_cached_local_url(url);
        }
        if let Some(url) = settings.xiaomi_base_url {
            gateway::set_cached_xiaomi_url(url);
        }
    }

    tauri::Builder::default()
        .setup(|app| {
            if std::env::var("ZEUS_TEST_HIDE_WINDOW").as_deref() == Ok("1") {
                if let Some(window) = app.get_webview_window("main") { window.hide()?; }
            }
            Ok(())
        })
        .manage(db::AppState {
            db: std::sync::Arc::new(std::sync::Mutex::new(connection)),
            active_runs: std::sync::Mutex::new(std::collections::HashMap::new()),
            browser_manager: browser_manager::BrowserManager::new(),
        })
        .invoke_handler(tauri::generate_handler![
            chat::create_task,
            chat::list_tasks,
            chat::get_task_messages,
            chat::get_task_spend,
            chat::get_task_run_state,
            chat::cancel_task_run,
            chat::send_user_message,
            chat::resolve_pending_approvals,
            chat::resolve_handoff,
            chat::resolve_choice,
            chat::rename_task,
            chat::update_task_settings,
            chat::delete_task,
            chat::save_task_attachment,
            attachments::get_attachment_preview,
            settings::get_settings,
            settings::save_settings,
            settings::set_api_key,
            settings::has_api_key,
            settings::set_gemini_api_key,
            settings::has_gemini_api_key,
            settings::set_xiaomi_api_key,
            settings::has_xiaomi_api_key,
            gateway::fetch_available_models,
            model_catalogue::fetch_model_catalogue,
            gateway::get_local_model_ids,
            gateway::test_local_endpoint,
            gateway::test_xiaomi_endpoint,
            logger::get_debug_log,
            gatekeeper::get_file_permissions,
            gatekeeper::add_file_permission,
            gatekeeper::delete_file_permission,
            gatekeeper::get_watcher_policies,
            gatekeeper::add_watcher_policy,
            gatekeeper::delete_watcher_policy,
            gatekeeper::negotiate_watcher_policy,
            browser_manager::start_browser_handoff,
            browser_manager::finish_browser_handoff,
            browser_manager::get_browser_history,
            browser_manager::get_browser_session,
            cookie_vault::get_vault_accounts,
            cookie_vault::get_vault_account,
            cookie_vault::save_vault_account,
            cookie_vault::delete_vault_account,
        ])
        .run(generate_context!())
        .expect("error while running tauri application");
}
