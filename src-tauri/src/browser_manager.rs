use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::State;
use crate::db::AppState;

pub struct BrowserState {
    pub process: Option<Child>,
    pub port: u16,
    pub user_data_dir: PathBuf,
}

pub struct BrowserManager {
    pub active_browsers: Mutex<HashMap<String, BrowserState>>,
}

impl BrowserManager {
    pub fn new() -> Self {
        Self {
            active_browsers: Mutex::new(HashMap::new()),
        }
    }
    
    pub fn ensure_browser(&self, task_id: &str, mode: &str, custom_exe: &Option<String>) -> Result<u16, String> {
        let mut browsers = self.active_browsers.lock().map_err(|_| "Mutex poisoned")?;
        
        if let Some(state) = browsers.get_mut(task_id) {
            // Check if process is still running
            if let Some(mut child) = state.process.take() {
                if let Ok(None) = child.try_wait() {
                    state.process = Some(child);
                    return Ok(state.port);
                }
            }
        }
        
        // Need to spawn
        let exe = if let Some(path) = custom_exe {
            if !path.trim().is_empty() {
                Some(PathBuf::from(path.trim()))
            } else {
                get_browser_executable()
            }
        } else {
            get_browser_executable()
        }.ok_or("No browser executable found.")?;
        
        let port = 9222; // In reality we should find a free port or random port
        
        // For sandboxed, use workspace/.zeus/browser_data
        let workspace = crate::utils::task_workspace(task_id)?;
        let mut actual_user_data_dir = None;
        let mut state_user_data_dir = PathBuf::new();
        
        if mode == "main" {
            // Main browser takeover uses default profile (omit --user-data-dir).
            // User MUST close browser before this runs.
        } else {
            let dir = workspace.join(".zeus").join("browser_data");
            std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create user data dir: {}", e))?;
            state_user_data_dir = dir.clone();
            actual_user_data_dir = Some(state_user_data_dir.clone());
        };
        
        let child = spawn_browser(&exe, port, actual_user_data_dir.as_deref(), true)?;
        
        browsers.insert(task_id.to_string(), BrowserState {
            process: Some(child),
            port,
            user_data_dir: state_user_data_dir,
        });
        
        Ok(port)
    }
}

pub fn get_browser_executable() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let paths = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
        ];
        for p in paths.iter() {
            if Path::new(p).exists() {
                return Some(PathBuf::from(p));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ];
        for p in paths.iter() {
            if Path::new(p).exists() {
                return Some(PathBuf::from(p));
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        let paths = [
            "/usr/bin/google-chrome",
            "/usr/bin/microsoft-edge",
            "/usr/bin/brave-browser",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
        ];
        for p in paths.iter() {
            if Path::new(p).exists() {
                return Some(PathBuf::from(p));
            }
        }
    }
    None
}

/// Spawns a browser process with the given port and user data dir
pub fn spawn_browser(executable: &Path, port: u16, user_data_dir: Option<&Path>, headless: bool) -> Result<Child, String> {
    let mut cmd = Command::new(executable);
    cmd.arg(format!("--remote-debugging-port={}", port));
    
    if let Some(dir) = user_data_dir {
        let mut dir_arg = std::ffi::OsString::from("--user-data-dir=");
        dir_arg.push(dir.as_os_str());
        cmd.arg(dir_arg);
    }
    
    cmd.arg("--no-first-run");
    cmd.arg("--no-default-browser-check");
    cmd.arg("--disable-sync");
    
    if headless {
        cmd.arg("--headless=new");
        cmd.arg("--disable-gpu");
    } else {
        cmd.arg("--restore-last-session");
    }
    
    cmd.spawn().map_err(|e| format!("Failed to spawn browser: {}", e))
}

#[tauri::command]
pub async fn start_browser_handoff(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), String> {
    let mut browsers = state.browser_manager.active_browsers.lock().map_err(|_| "Mutex poisoned")?;
    if let Some(browser_state) = browsers.get_mut(&task_id) {
        if let Some(mut child) = browser_state.process.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        
        let task_data = crate::chat::load_task(&state.db.lock().unwrap(), &task_id).map_err(|e| e.to_string())?;
        
        let exe = if let Some(path) = &task_data.browser_executable_path {
            if !path.trim().is_empty() {
                Some(PathBuf::from(path.trim()))
            } else {
                get_browser_executable()
            }
        } else {
            get_browser_executable()
        }.ok_or("No browser executable found.")?;
        
        let actual_user_data_dir = if task_data.browser_mode == "main" {
            None
        } else {
            Some(browser_state.user_data_dir.as_path())
        };
        
        let is_headless = std::env::var("ZEUS_HEADLESS_HANDOFF").is_ok();
        let new_child = spawn_browser(&exe, browser_state.port, actual_user_data_dir, is_headless)?;
        browser_state.process = Some(new_child);
    }
    Ok(())
}

#[tauri::command]
pub async fn finish_browser_handoff(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), String> {
    let mut browsers = state.browser_manager.active_browsers.lock().map_err(|_| "Mutex poisoned")?;
    if let Some(browser_state) = browsers.get_mut(&task_id) {
        if let Some(mut child) = browser_state.process.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        
        let task_data = crate::chat::load_task(&state.db.lock().unwrap(), &task_id).map_err(|e| e.to_string())?;
        
        let exe = if let Some(path) = &task_data.browser_executable_path {
            if !path.trim().is_empty() {
                Some(PathBuf::from(path.trim()))
            } else {
                get_browser_executable()
            }
        } else {
            get_browser_executable()
        }.ok_or("No browser executable found.")?;
        
        let actual_user_data_dir = if task_data.browser_mode == "main" {
            None
        } else {
            Some(browser_state.user_data_dir.as_path())
        };
        
        // Spawn headless
        let new_child = spawn_browser(&exe, browser_state.port, actual_user_data_dir, true)?;
        browser_state.process = Some(new_child);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_browser_history(task_id: String) -> Result<Vec<String>, String> {
    let mut history_dir = crate::utils::workspace_root()?;
    history_dir.push(".zeus");
    history_dir.push("browser_history");
    history_dir.push(&task_id);
    
    if !history_dir.exists() {
        return Ok(Vec::new());
    }
    
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(history_dir) {
        for entry in entries.filter_map(Result::ok) {
            if let Some(path_str) = entry.path().to_str() {
                if path_str.ends_with(".png") || path_str.ends_with(".jpg") {
                    files.push(path_str.to_string());
                }
            }
        }
    }
    
    // Sort by name (which includes timestamp)
    files.sort();
    
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_browser_executable() {
        // This test will pass if it finds any browser (Chrome, Edge, Brave) or fail if none are installed.
        // It's a smoke test to ensure the OS-specific resolution logic executes without panicking.
        let exe = get_browser_executable();
        // We only assert it returns a valid option, it could be None on a CI without browsers.
        if let Some(path) = exe {
            assert!(path.exists(), "Browser executable path should exist");
        }
    }
}
