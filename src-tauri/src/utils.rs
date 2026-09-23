use std::path::PathBuf;

pub const APP_FOLDER_NAME: &str = "zeus-agent";

/// Workspace root: %APPDATA%\zeus-agent (Roaming). All app state lives under here.
pub fn workspace_root() -> Result<PathBuf, String> {
    if let Ok(test_root) = std::env::var("ZEUS_TEST_WORKSPACE_ROOT") {
        return Ok(PathBuf::from(test_root));
    }
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
    let path = workspace_root()?
        .join("tasks")
        .join(task_id)
        .join("workspace");
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create the task workspace: {}", e))?;
    Ok(path)
}

/// Returns a prefix of `s` that is at most `max_bytes` long and ends on a valid UTF-8 char boundary.
pub fn safe_truncate_str(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Truncates `s` safely to at most `max_bytes` with a `\n…[truncated]` suffix.
pub fn safe_truncate(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        s.to_string()
    } else {
        let prefix = safe_truncate_str(s, max_bytes);
        format!("{}\n…[truncated]", prefix)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_safe_truncate_multibyte_utf8() {
        // Cyrillic 'т' is 2 bytes (D1 82)
        let text = "Преди да продължите към Google Търсене";
        // Slicing at an odd byte inside a multibyte char must not panic
        for cut in 1..=text.len() {
            let slice = safe_truncate_str(text, cut);
            assert!(slice.len() <= cut);
            assert!(std::str::from_utf8(slice.as_bytes()).is_ok());
        }
        let truncated = safe_truncate(text, 10);
        assert!(truncated.contains("…[truncated]"));
    }

    #[test]
    fn test_safe_truncate_emojis() {
        // Emojis are 4 bytes each
        let text = "🚀🔥🎉💻🌟";
        for cut in 1..=text.len() {
            let slice = safe_truncate_str(text, cut);
            assert!(slice.len() <= cut);
            assert!(std::str::from_utf8(slice.as_bytes()).is_ok());
        }
    }
}
