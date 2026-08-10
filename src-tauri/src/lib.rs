#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod chat;
pub mod db;
pub mod browser_manager;
pub mod gatekeeper;
pub mod gateway;
pub mod logger;
pub mod orchestrator;
pub mod python_runner;
pub mod settings;
pub mod utils;
pub mod worker;

use std::fs;
use tauri::generate_context;

pub fn run() {
    // Resolve and create the workspace root (%APPDATA%\zeus-agent) plus its subfolders
    let app_data_dir = utils::workspace_root().expect("Failed to resolve workspace root");
    fs::create_dir_all(&app_data_dir).expect("Failed to create workspace root");
    utils::ensure_workspace_dirs().expect("Failed to create workspace directories");

    // Open (or create) the SQLite database
    let connection =
        db::init(&app_data_dir.join("zeus.db")).expect("Failed to initialize database");

    tauri::Builder::default()
        .manage(db::AppState {
            db: std::sync::Mutex::new(connection),
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
            chat::rename_task,
            chat::update_task_settings,
            chat::delete_task,
            settings::get_settings,
            settings::save_settings,
            settings::set_api_key,
            settings::has_api_key,
            settings::set_gemini_api_key,
            settings::has_gemini_api_key,
            gateway::fetch_available_models,
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
        ])
        .run(generate_context!())
        .expect("error while running tauri application");
}
