#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod chat;
mod db;
mod gateway;
mod settings;
mod utils;

use std::fs;
use tauri::generate_context;

pub fn run() {
    // Resolve and create the workspace root (%APPDATA%\zeus-agent) plus its subfolders
    let app_data_dir = utils::workspace_root().expect("Failed to resolve workspace root");
    fs::create_dir_all(&app_data_dir).expect("Failed to create workspace root");
    utils::ensure_workspace_dirs().expect("Failed to create workspace directories");

    // Open (or create) the SQLite database
    let connection = db::init(&app_data_dir.join("zeus.db")).expect("Failed to initialize database");

    tauri::Builder::default()
        .manage(db::AppState { db: std::sync::Mutex::new(connection) })
        .invoke_handler(tauri::generate_handler![
            chat::create_task,
            chat::list_tasks,
            chat::get_task_messages,
            chat::get_task_spend,
            chat::send_user_message,
            chat::rename_task,
            chat::delete_task,
            settings::get_settings,
            settings::save_settings,
            settings::set_api_key,
            settings::has_api_key,
            gateway::fetch_available_models,
        ])
        .run(generate_context!())
        .expect("error while running tauri application");
}