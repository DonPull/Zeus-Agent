use std::path::PathBuf;

pub const APP_FOLDER_NAME: &str = "zeus-agent";

/// Workspace root: %APPDATA%\zeus-agent (Roaming). All app state lives under here.
pub fn workspace_root() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("Failed to resolve the APPDATA directory")?;
    Ok(base.join(APP_FOLDER_NAME))
}

/// Creates the subfolders the app relies on. Actions and logs are unused in M0,
/// but creating them now keeps the layout stable.
pub fn ensure_workspace_dirs() -> Result<(), String> {
    let root = workspace_root()?;
    for sub in ["tasks", "actions", "logs"] {
        std::fs::create_dir_all(root.join(sub))
            .map_err(|e| format!("Failed to create the '{}' workspace folder: {}", sub, e))?;
    }
    Ok(())
}

/// Per-task workspace: %APPDATA%\zeus-agent\tasks\<task_id>\workspace
pub fn task_workspace(task_id: &str) -> Result<PathBuf, String> {
    let path = workspace_root()?.join("tasks").join(task_id).join("workspace");
    std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create the task workspace: {}", e))?;
    Ok(path)
}