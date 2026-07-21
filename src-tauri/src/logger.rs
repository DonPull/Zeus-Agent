//! Minimal per-task debug logger. In-memory ring buffer, exposed to the UI via
//! the temporary "Copy debug log" button in the chat-log modal (dev builds).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

const MAX_ENTRIES_PER_TASK: usize = 2000;

static LOGS: OnceLock<Mutex<HashMap<String, Vec<String>>>> = OnceLock::new();

fn logs() -> &'static Mutex<HashMap<String, Vec<String>>> {
    LOGS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Appends a log line for a task. Never panics, never fails.
pub fn log(task_id: &str, source: &str, message: &str) {
    if let Ok(mut map) = logs().lock() {
        let entries = map.entry(task_id.to_string()).or_default();
        if entries.len() >= MAX_ENTRIES_PER_TASK {
            entries.remove(0);
        }
        entries.push(format!("[{}] [{}] {}", crate::db::now_iso(), source, message));
    }
}

#[tauri::command]
pub fn get_debug_log(task_id: String) -> String {
    logs()
        .lock()
        .map(|map| map.get(&task_id).map(|v| v.join("\n")).unwrap_or_default())
        .unwrap_or_default()
}