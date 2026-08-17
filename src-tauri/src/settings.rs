use crate::db::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::State;

const KEYRING_SERVICE: &str = "zeus-agent";
const KEYRING_USER: &str = "routellm-api-key";
const KEYRING_GEMINI_USER: &str = "gemini-api-key";

/// Default model IDs. VERIFY these against RouteLLM's GET /v1/models
/// (Settings modal -> "Load available models") and adjust if they differ.
#[derive(Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub master_model: String,
    pub worker_model: String,
    pub verifier_model: String,
    pub watcher_model: String,
    pub default_budget_credits: i64,
    pub browser_mode: String,
    pub browser_executable_path: Option<String>,
    #[serde(default = "default_local_base_url")]
    pub local_base_url: Option<String>,
    pub local_api_key: Option<String>,
}

fn default_local_base_url() -> Option<String> {
    Some("http://localhost:11434/v1".into())
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            master_model: "moonshotai/Kimi-K3".into(),
            worker_model: "deepseek-ai/DeepSeek-V4-Pro".into(),
            verifier_model: "grok-4.5".into(),
            watcher_model: "grok-4.5".into(),
            default_budget_credits: 40000,
            browser_mode: "sandboxed".into(),
            browser_executable_path: None,
            local_base_url: Some("http://localhost:11434/v1".into()),
            local_api_key: None,
        }
    }
}

fn get_setting(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
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
        master_model: get_setting(connection, "master_model")?.unwrap_or_else(|| defaults.master_model),
        worker_model: get_setting(connection, "worker_model")?.unwrap_or_else(|| defaults.worker_model),
        verifier_model: get_setting(connection, "verifier_model")?.unwrap_or_else(|| defaults.verifier_model),
        watcher_model: get_setting(connection, "watcher_model")?.unwrap_or_else(|| defaults.watcher_model),
        default_budget_credits: get_setting(connection, "default_budget_credits")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(defaults.default_budget_credits),
        browser_mode: get_setting(connection, "browser_mode")?.unwrap_or_else(|| defaults.browser_mode),
        browser_executable_path: get_setting(connection, "browser_executable_path")?,
        local_base_url: get_setting(connection, "local_base_url")?.or_else(|| defaults.local_base_url),
        local_api_key: get_setting(connection, "local_api_key")?,
    })
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<AppSettings, String> {
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    read_settings(&connection)
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: AppSettings) -> Result<(), String> {
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    set_setting(&connection, "master_model", &settings.master_model)?;
    set_setting(&connection, "worker_model", &settings.worker_model)?;
    set_setting(&connection, "verifier_model", &settings.verifier_model)?;
    set_setting(&connection, "watcher_model", &settings.watcher_model)?;
    set_setting(
        &connection,
        "default_budget_credits",
        &settings.default_budget_credits.to_string(),
    )?;
    set_setting(&connection, "browser_mode", &settings.browser_mode)?;
    if let Some(path) = &settings.browser_executable_path {
        set_setting(&connection, "browser_executable_path", path)?;
    } else {
        let _ = connection.execute("DELETE FROM settings WHERE key = 'browser_executable_path'", []);
    }
    if let Some(url) = &settings.local_base_url {
        set_setting(&connection, "local_base_url", url)?;
    } else {
        let _ = connection.execute("DELETE FROM settings WHERE key = 'local_base_url'", []);
    }
    if let Some(key) = &settings.local_api_key {
        set_setting(&connection, "local_api_key", key)?;
    } else {
        let _ = connection.execute("DELETE FROM settings WHERE key = 'local_api_key'", []);
    }
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

#[tauri::command]
pub fn set_gemini_api_key(api_key: String) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("The Gemini API key cannot be empty.".into());
    }
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_GEMINI_USER)
        .map_err(|e| format!("Failed to access the credential vault: {}", e))?;
    entry
        .set_password(api_key)
        .map_err(|e| format!("Failed to store the Gemini API key: {}", e))
}

#[tauri::command]
pub fn has_gemini_api_key() -> bool {
    load_gemini_api_key().is_ok()
}

pub fn load_gemini_api_key() -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_GEMINI_USER)
        .map_err(|e| format!("Failed to access the credential vault: {}", e))?;
    entry
        .get_password()
        .map_err(|_| "No Gemini API key is set. Open Settings and add one.".to_string())
}

/// M1a ships the prompt as an editable file (fast iteration). When shipping,
/// flip this to true so the app uses the baked-in prompt and never writes the file.
pub const EMBED_PROMPT: bool = false;

pub const EXPECTED_PROMPT_VERSION: &str = "2.5";

/// The file name inside the per-user app data dir.
pub const PROMPT_FILE_NAME: &str = "master.txt";

/// The default master prompt, embedded at compile time from this crate.
pub const DEFAULT_MASTER_PROMPT: &str = include_str!("prompts/default_master.txt");

fn app_data_dir() -> Result<std::path::PathBuf, String> {
    crate::utils::workspace_root()
}

pub fn load_master_prompt() -> Result<String, String> {
    if EMBED_PROMPT {
        return Ok(DEFAULT_MASTER_PROMPT.to_string());
    }
    let dir = app_data_dir()?.join("prompts");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create the prompts folder: {}", e))?;
    let path = dir.join(PROMPT_FILE_NAME);
    
    let default_first_line = DEFAULT_MASTER_PROMPT.lines().next().unwrap_or("");
    let mut needs_update = false;

    if !path.exists() {
        needs_update = true;
    } else {
        if let Ok(content) = fs::read_to_string(&path) {
            let existing_first_line = content.lines().next().unwrap_or("");
            if existing_first_line != default_first_line {
                needs_update = true;
            }
        } else {
            needs_update = true;
        }
    }

    if needs_update {
        fs::write(&path, DEFAULT_MASTER_PROMPT)
            .map_err(|e| format!("Failed to seed or update the master prompt file: {}", e))?;
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read the master prompt file: {}", e))?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_MASTER_PROMPT.to_string());
    }
    Ok(trimmed.to_string())
}
