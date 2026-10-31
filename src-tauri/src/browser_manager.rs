//! Shared browser owner and bounded historical adapters. No CDP launcher.
use crate::db::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundingBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserStep {
    pub step: usize,
    pub action: String,
    pub target: Option<String>,
    pub value: Option<String>,
    pub url: String,
    pub timestamp: u64,
    pub bounding_box: Option<BoundingBox>,
    pub screenshot_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserSessionData {
    pub session_id: String,
    pub task_id: String,
    pub started_at: u64,
    pub completed_at: Option<u64>,
    pub duration_ms: Option<u64>,
    pub final_url: Option<String>,
    pub total_steps: usize,
    pub steps: Vec<BrowserStep>,
}

pub struct BrowserManager {
    pub managed: crate::managed_browser::Manager,
}
impl BrowserManager {
    pub fn new() -> Self {
        Self {
            managed: crate::managed_browser::Manager::default(),
        }
    }
}

#[tauri::command]
pub async fn start_browser_handoff(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), String> {
    let _ = (state, task_id);
    Err(
        "BROWSER_UNSUPPORTED: supervised login in Zeus's owned browser is a later capability"
            .into(),
    )
}
#[tauri::command]
pub async fn finish_browser_handoff(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), String> {
    let _ = (state, task_id);
    Err("BROWSER_UNSUPPORTED: no supervised handoff is active".into())
}
#[tauri::command]
pub async fn get_browser_history(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::browser_recordings::task_exists(&conn, &task_id)?;
    Err("BROWSER_HISTORY_API_RETIRED: use the paged recording history; older session readers remain available".into())
}

#[tauri::command]
pub async fn get_browser_session(
    state: State<'_, AppState>,
    task_id: String,
    session_id: String,
) -> Result<BrowserSessionData, String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        crate::browser_recordings::recording_page(&conn, &task_id, &session_id, 0, 1)?;
    }
    let (_, content) = crate::browser_recordings::legacy_manifest(&task_id, &session_id)?;
    let mut data: BrowserSessionData = serde_json::from_value(content)
        .map_err(|e| format!("Failed to parse session manifest: {}", e))?;
    // Deprecated bounded adapter. New viewers use paged metadata and binary reads.
    data.steps.truncate(100);
    let mut total = 0;
    for (index, step) in data.steps.iter_mut().enumerate() {
        step.screenshot_path.clear();
        if let Ok((bytes, mime)) =
            crate::browser_recordings::legacy_image(&task_id, &session_id, index)
        {
            total += bytes.len();
            if total > 8 * 1024 * 1024 {
                continue;
            }
            use base64::Engine;
            step.screenshot_path = format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            );
        }
    }

    Ok(data)
}
