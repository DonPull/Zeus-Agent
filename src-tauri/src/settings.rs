use crate::db::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

const KEYRING_SERVICE: &str = "zeus-agent";
const KEYRING_USER: &str = "routellm-api-key";

/// Default model IDs. VERIFY these against RouteLLM's GET /v1/models
/// (Settings modal -> "Load available models") and adjust if they differ.
#[derive(Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub master_model: String,
    pub worker_model: String,
    pub verifier_model: String,
    pub default_budget_credits: i64,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            master_model: "moonshotai/Kimi-K3".into(),
            worker_model: "deepseek-ai/DeepSeek-V4-Pro".into(),
            verifier_model: "grok-4.5".into(),
            default_budget_credits: 40000,
        }
    }
}

fn get_setting(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
        .optional()
        .map_err(|e| format!("Failed to read the '{}' setting: {}", key, e))
}

fn set_setting(connection: &Connection, key: &str, value: &str) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| format!("Failed to save the '{}' setting: {}", key, e))?;
    Ok(())
}

pub fn read_settings(connection: &Connection) -> Result<AppSettings, String> {
    let defaults = AppSettings::default();
    Ok(AppSettings {
        master_model: get_setting(connection, "master_model")?.unwrap_or(defaults.master_model),
        worker_model: get_setting(connection, "worker_model")?.unwrap_or(defaults.worker_model),
        verifier_model: get_setting(connection, "verifier_model")?.unwrap_or(defaults.verifier_model),
        default_budget_credits: get_setting(connection, "default_budget_credits")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(defaults.default_budget_credits),
    })
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<AppSettings, String> {
    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    read_settings(&connection)
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: AppSettings) -> Result<(), String> {
    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    set_setting(&connection, "master_model", &settings.master_model)?;
    set_setting(&connection, "worker_model", &settings.worker_model)?;
    set_setting(&connection, "verifier_model", &settings.verifier_model)?;
    set_setting(&connection, "default_budget_credits", &settings.default_budget_credits.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_api_key(api_key: String) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("The API key cannot be empty.".into());
    }
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Failed to access the credential vault: {}", e))?;
    entry
        .set_password(api_key)
        .map_err(|e| format!("Failed to store the API key: {}", e))
}

#[tauri::command]
pub fn has_api_key() -> bool {
    load_api_key().is_ok()
}

/// The API key lives in the Windows Credential Manager (via the keyring crate),
/// never in the database, never in logs, never in model context.
pub fn load_api_key() -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Failed to access the credential vault: {}", e))?;
    entry
        .get_password()
        .map_err(|_| "No RouteLLM API key is set. Open Settings and add one.".to_string())
}