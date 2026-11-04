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
pub mod browser_store;
pub mod browser_capture;
pub mod browser_recordings;
pub mod browser_visuals;
pub mod message_links;
pub mod task_titles;
pub mod task_state;
pub mod ui_showcase;
pub mod managed_browser;
pub mod process_tree;
pub mod gatekeeper;
pub mod file_paths;
pub mod gateway;
mod sse;
pub mod logger;
pub mod orchestrator;
pub mod python_runner;
pub mod settings;
pub mod utils;
pub mod worker;
pub mod output_compressor;

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

    if let Ok(settings) = settings::read_settings(&connection) {
        if let Some(url) = settings.local_base_url {
            gateway::set_cached_local_url(url);
        }
        if let Some(url) = settings.xiaomi_base_url {
            gateway::set_cached_xiaomi_url(url);
        }
    }

    // Apply test visibility before Tauri creates any native windows. Hiding in
    // setup is too late: each fresh test process can flash and take focus first.
    let mut context = generate_context!();
    if std::env::var("ZEUS_TEST_HIDE_WINDOW").as_deref() == Ok("1") {
        for window in &mut context.config_mut().app.windows {
            window.visible = false;
            window.focus = false;
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
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
            managed_browser::open_browser_handoff,
            managed_browser::get_managed_browser_transfers,
            chat::resolve_choice,
            chat::rename_task,
            chat::update_task_settings,
            chat::delete_task,
            chat::save_task_attachment,
            attachments::get_attachment_preview,
            message_links::resolve_message_link,
            message_links::open_message_link,
            browser_recordings::get_browser_recording_index,
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
            managed_browser::get_managed_browser_sessions,
            managed_browser::get_managed_browser_status,
            managed_browser::get_managed_browser_actions,
            managed_browser::get_managed_browser_observation,
            browser_capture::get_browser_capture,
            browser_capture::heartbeat_browser_viewer,
            browser_capture::read_browser_live_image,
            browser_recordings::list_browser_recordings,
            browser_recordings::get_browser_recording_page,
            browser_recordings::read_browser_recording_image,
            browser_recordings::delete_browser_recording_images,
            browser_recordings::export_browser_recording,
            browser_visuals::get_browser_visual_deliveries,
            cookie_vault::get_vault_accounts,
            cookie_vault::get_vault_account,
            cookie_vault::save_vault_account,
            cookie_vault::delete_vault_account,
        ])
        .run(context)
        .expect("error while running tauri application");
}
