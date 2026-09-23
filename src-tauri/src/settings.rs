use crate::db::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::State;

const KEYRING_SERVICE: &str = "zeus-agent";
const KEYRING_USER: &str = "routellm-api-key";
const KEYRING_GEMINI_USER: &str = "gemini-api-key";
const KEYRING_XIAOMI_USER: &str = "xiaomi-api-key";

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
    #[serde(default = "default_xiaomi_base_url")]
    pub xiaomi_base_url: Option<String>,
    #[serde(default = "default_effort")]
    pub master_effort: String,
    #[serde(default = "default_effort")]
    pub worker_effort: String,
    #[serde(default = "default_effort")]
    pub verifier_effort: String,
    #[serde(default = "default_effort")]
    pub watcher_effort: String,
    #[serde(default = "default_vision_model")]
    pub vision_model: String,
    #[serde(default = "default_effort")]
    pub vision_effort: String,
}

pub fn default_vision_model() -> String {
    "gemini-3.8-flash".into()
}

pub fn default_effort() -> String {
    "default".into()
}

fn default_local_base_url() -> Option<String> {
    Some("http://localhost:11434/v1".into())
}

pub fn default_xiaomi_base_url() -> Option<String> {
    Some("https://token-plan-ams.xiaomimimo.com/v1".into())
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
            xiaomi_base_url: default_xiaomi_base_url(),
            master_effort: "default".into(),
            worker_effort: "default".into(),
            verifier_effort: "default".into(),
            watcher_effort: "default".into(),
            vision_model: "gemini-3.8-flash".into(),
            vision_effort: "default".into(),
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
        xiaomi_base_url: get_setting(connection, "xiaomi_base_url")?.or_else(|| defaults.xiaomi_base_url),
        master_effort: get_setting(connection, "master_effort")?.unwrap_or_else(|| defaults.master_effort),
        worker_effort: get_setting(connection, "worker_effort")?.unwrap_or_else(|| defaults.worker_effort),
        verifier_effort: get_setting(connection, "verifier_effort")?.unwrap_or_else(|| defaults.verifier_effort),
        watcher_effort: get_setting(connection, "watcher_effort")?.unwrap_or_else(|| defaults.watcher_effort),
        vision_model: get_setting(connection, "vision_model")?.unwrap_or_else(|| defaults.vision_model),
        vision_effort: get_setting(connection, "vision_effort")?.unwrap_or_else(|| defaults.vision_effort),
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

pub fn write_settings(connection: &Connection, settings: &AppSettings) -> Result<(), String> {
    set_setting(connection, "master_model", &settings.master_model)?;
    set_setting(connection, "worker_model", &settings.worker_model)?;
    set_setting(connection, "verifier_model", &settings.verifier_model)?;
    set_setting(connection, "watcher_model", &settings.watcher_model)?;
    set_setting(connection, "vision_model", &settings.vision_model)?;
    set_setting(connection, "vision_effort", &settings.vision_effort)?;
    set_setting(
        connection,
        "default_budget_credits",
        &settings.default_budget_credits.to_string(),
    )?;
    set_setting(connection, "browser_mode", &settings.browser_mode)?;
    if let Some(path) = &settings.browser_executable_path {
        set_setting(connection, "browser_executable_path", path)?;
    } else {
        let _ = connection.execute("DELETE FROM settings WHERE key = 'browser_executable_path'", []);
    }
    if let Some(url) = &settings.local_base_url {
        set_setting(connection, "local_base_url", url)?;
    } else {
        let _ = connection.execute("DELETE FROM settings WHERE key = 'local_base_url'", []);
    }
    if let Some(key) = &settings.local_api_key {
        set_setting(connection, "local_api_key", key)?;
    } else {
        let _ = connection.execute("DELETE FROM settings WHERE key = 'local_api_key'", []);
    }
    if let Some(url) = &settings.xiaomi_base_url {
        set_setting(connection, "xiaomi_base_url", url)?;
        crate::gateway::set_cached_xiaomi_url(url.clone());
    } else {
        let _ = connection.execute("DELETE FROM settings WHERE key = 'xiaomi_base_url'", []);
    }
    set_setting(connection, "master_effort", &settings.master_effort)?;
    set_setting(connection, "worker_effort", &settings.worker_effort)?;
    set_setting(connection, "verifier_effort", &settings.verifier_effort)?;
    set_setting(connection, "watcher_effort", &settings.watcher_effort)?;
    Ok(())
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: AppSettings) -> Result<(), String> {
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    write_settings(&connection, &settings)
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

#[tauri::command]
pub fn set_xiaomi_api_key(api_key: String) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("The Xiaomi API key cannot be empty.".into());
    }
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_XIAOMI_USER)
        .map_err(|e| format!("Failed to access the credential vault: {}", e))?;
    entry
        .set_password(api_key)
        .map_err(|e| format!("Failed to store the Xiaomi API key: {}", e))
}

#[tauri::command]
pub fn has_xiaomi_api_key() -> bool {
    load_xiaomi_api_key().is_ok()
}

pub fn load_xiaomi_api_key() -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_XIAOMI_USER)
        .map_err(|e| format!("Failed to access the credential vault: {}", e))?;
    entry
        .get_password()
        .map_err(|_| "No Xiaomi API key is set. Open Settings and add one.".to_string())
}

/// M1a ships the prompt as an editable file (fast iteration). When shipping,
/// flip this to true so the app uses the baked-in prompt and never writes the file.
pub const EMBED_PROMPT: bool = false;

pub const EXPECTED_PROMPT_VERSION: &str = "2.5";

/// The file name inside the per-user app data dir.
pub const PROMPT_FILE_NAME: &str = "master.txt";

/// The default master prompt, embedded at compile time from this crate.
pub const DEFAULT_MASTER_PROMPT: &str = include_str!("prompts/default_master.txt");

/// The local unified master prompt, optimized for high-speed local models.
pub const LOCAL_MASTER_PROMPT: &str = include_str!("prompts/local_master.txt");

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
    let mut needs_update = false;

    if !path.exists() {
        needs_update = true;
    } else {
        if let Ok(content) = fs::read_to_string(&path) {
            if content.trim() != DEFAULT_MASTER_PROMPT.trim() {
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

pub fn load_master_prompt_for_config(model: &str, has_worker: bool, has_vision: bool) -> Result<String, String> {
    let mut base_prompt = if !has_worker || crate::gateway::is_local_model(model) {
        LOCAL_MASTER_PROMPT.to_string()
    } else {
        load_master_prompt()?
    };

    if !base_prompt.to_lowercase().contains("output compression") {
        base_prompt.push_str("\n\n- **Output Compression**: Terminal commands producing large outputs (>2,000 characters) are automatically compressed, retaining the first 15 lines and last 30 lines while persisting the complete lossless output to an artifact file in the task artifacts folder. If you need to inspect the full untruncated output, use `read_file` on the specified artifact path.");
    }

    if has_vision && !base_prompt.contains("analyze_visual") {
        base_prompt.push_str("\n\n[VISUAL PERCEPTION CAPABILITY]\nYou have access to the `analyze_visual` tool (powered by Zeus Eyes). Call it with `{\"type\":\"analyze_visual\",\"image_path\":\"<path>\",\"query\":\"<question>\"}` to inspect screenshots, diagrams, UI popups, or verify rendered web designs.");
    }

    let host_os = std::env::consts::OS;
    let host_family = std::env::consts::FAMILY;
    base_prompt = base_prompt
        .replace("{host_os}", host_os)
        .replace("{host_family}", host_family)
        .replace("You are running on Windows CMD.", &format!("You are running on {} ({}).", host_os, host_family));

    Ok(base_prompt)
}

pub fn load_master_prompt_for_model(model: &str) -> Result<String, String> {
    load_master_prompt_for_config(model, true, true)
}
