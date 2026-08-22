use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
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

fn find_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|addr| addr.port())
        .unwrap_or(9222)
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !dst.exists() {
        std::fs::create_dir_all(dst)?;
    }
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst_path)?;
        } else {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if !name.contains("lock") && !name.contains(".tmp") {
                let _ = std::fs::copy(entry.path(), dst_path);
            }
        }
    }
    Ok(())
}

fn get_parent_profile_dir() -> Option<PathBuf> {
    // 1. Check current directory / project root .zeus/parent_browser_profile
    if let Ok(cur) = std::env::current_dir() {
        let p = cur.join(".zeus").join("parent_browser_profile");
        if p.exists() {
            return Some(p);
        }
    }
    // 2. Check APPDATA workspace root
    if let Ok(root) = crate::utils::workspace_root() {
        let p1 = root.join(".zeus").join("parent_browser_profile");
        if p1.exists() {
            return Some(p1);
        }
        let p2 = root.join("parent_browser_profile");
        if p2.exists() {
            return Some(p2);
        }
    }
    None
}

pub fn get_installed_extensions() -> Vec<PathBuf> {
    let mut exts = Vec::new();
    let mut search_dirs = Vec::new();

    if let Ok(cur) = std::env::current_dir() {
        search_dirs.push(cur.join(".zeus").join("extensions"));
    }
    if let Ok(root) = crate::utils::workspace_root() {
        search_dirs.push(root.join(".zeus").join("extensions"));
        search_dirs.push(root.join("extensions"));
    }

    // 1. Direct extensions directories
    for ext_dir in search_dirs {
        if ext_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(ext_dir) {
                for entry in entries.filter_map(Result::ok) {
                    if entry.path().is_dir() {
                        if entry.path().join("manifest.json").exists() {
                            if !exts.contains(&entry.path()) {
                                exts.push(entry.path());
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Extensions installed via Store inside parent_browser_profile
    if let Some(parent_profile) = get_parent_profile_dir() {
        let parent_ext_dir = parent_profile.join("Default").join("Extensions");
        if parent_ext_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(parent_ext_dir) {
                for entry in entries.filter_map(Result::ok) {
                    if entry.path().is_dir() {
                        if let Ok(sub_entries) = std::fs::read_dir(entry.path()) {
                            for sub_entry in sub_entries.filter_map(Result::ok) {
                                if sub_entry.path().is_dir() && sub_entry.path().join("manifest.json").exists() {
                                    if !exts.contains(&sub_entry.path()) {
                                        exts.push(sub_entry.path());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    exts
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
        
        let port = find_free_port();
        
        // For sandboxed, use workspace/.zeus/browser_profiles/<task_id>
        let workspace = crate::utils::task_workspace(task_id)?;
        let mut actual_user_data_dir = None;
        let mut state_user_data_dir = PathBuf::new();
        
        if mode == "main" {
            // Main browser takeover uses default profile (omit --user-data-dir).
        } else {
            let dir = workspace.join(".zeus").join("browser_profiles").join(task_id);
            let is_new = !dir.exists();
            std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create user data dir: {}", e))?;
            
            // If newly created, seed from parent_browser_profile if present
            if is_new {
                if let Some(parent_profile) = get_parent_profile_dir() {
                    let _ = copy_dir_all(&parent_profile, &dir);
                    crate::logger::log(task_id, "browser", &format!("Seeded task browser profile from {}", parent_profile.display()));
                }
            }

            state_user_data_dir = dir.clone();
            actual_user_data_dir = Some(state_user_data_dir.clone());
        };
        
        let is_headless = std::env::var("ZEUS_HEADLESS_BROWSER").is_ok();
        let child = spawn_browser(&exe, port, actual_user_data_dir.as_deref(), is_headless)?;
        let pid = child.id();
        
        browsers.insert(task_id.to_string(), BrowserState {
            process: Some(child),
            port,
            user_data_dir: state_user_data_dir,
        });
        
        crate::logger::log(task_id, "browser", &format!("Spawned browser (PID: {:?}) on port {}", pid, port));
        Ok(port)
    }
}

pub fn get_browser_executable() -> Option<PathBuf> {
    // Check local pre-installed or downloaded Chromium
    if let Ok(app_dir) = crate::utils::workspace_root() {
        let local_chromium_win = app_dir.join(".zeus").join("browsers").join("chromium").join("chrome-win").join("chrome.exe");
        if local_chromium_win.exists() {
            return Some(local_chromium_win);
        }
        let local_chromium_linux = app_dir.join(".zeus").join("browsers").join("chromium").join("chrome-linux").join("chrome");
        if local_chromium_linux.exists() {
            return Some(local_chromium_linux);
        }
    }

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
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
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

    let extensions = get_installed_extensions();
    if !extensions.is_empty() {
        let ext_paths: Vec<String> = extensions
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        let ext_arg = ext_paths.join(",");
        cmd.arg(format!("--load-extension={}", ext_arg));
        cmd.arg(format!("--disable-extensions-except={}", ext_arg));
    }
    
    // Stealth & Anti-Bot flags
    cmd.arg("--disable-blink-features=AutomationControlled");
    cmd.arg("--disable-infobars");
    cmd.arg("--no-first-run");
    cmd.arg("--no-default-browser-check");
    cmd.arg("--disable-sync");
    cmd.arg("--disable-background-timer-throttling");
    cmd.arg("--disable-renderer-backgrounding");
    cmd.arg("--disable-backgrounding-occluded-windows");
    
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
    let browsers = state.browser_manager.active_browsers.lock().map_err(|_| "Mutex poisoned")?;
    if let Some(browser_state) = browsers.get(&task_id) {
        crate::logger::log(&task_id, "browser", &format!("Browser handoff started on port {}", browser_state.port));
    }
    Ok(())
}

#[tauri::command]
pub async fn finish_browser_handoff(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<(), String> {
    let browsers = state.browser_manager.active_browsers.lock().map_err(|_| "Mutex poisoned")?;
    if let Some(browser_state) = browsers.get(&task_id) {
        crate::logger::log(&task_id, "browser", &format!("Browser handoff completed on port {}", browser_state.port));
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
