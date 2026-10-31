//! Explicit user-click handling. Resolving a link never executes a file or page.
use crate::{db::AppState, file_paths};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

fn context(conn: &Connection, task: &str, message: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(task).map_err(|_| "LINK_CONTEXT: invalid task")?;
    let exists=conn.query_row("SELECT EXISTS(SELECT 1 FROM messages WHERE id=?1 AND task_id=?2 AND visible=1 AND kind='chat')",[message,task],|r|r.get::<_,bool>(0)).map_err(|e|e.to_string())?;
    if !exists {
        return Err("LINK_CONTEXT: message does not belong to this task".into());
    }
    Ok(())
}
fn resolve(root: &Path, raw: &str, app_origin: Option<&str>) -> Result<Value, String> {
    if raw.is_empty() || raw.len() > 8192 || raw.chars().any(char::is_control) {
        return Err("LINK_UNSUPPORTED: invalid link".into());
    }
    let mut file = raw.to_owned();
    let mut decoded = Path::new(raw).is_absolute();
    if let Ok(url) = reqwest::Url::parse(raw) {
        let app_url = app_origin.is_some_and(|origin| url.origin().ascii_serialization() == origin)
            || matches!(
                url.origin().ascii_serialization().as_str(),
                "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
            );
        if matches!(url.scheme(), "http" | "https") && !app_url {
            if url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
                return Err("LINK_UNSUPPORTED: invalid web URL".into());
            }
            return Ok(json!({"kind":"web","url":url.as_str()}));
        }
        if app_url {
            file = url.path().trim_start_matches('/').to_owned();
        } else if url.scheme() == "file" {
            file = url
                .to_file_path()
                .map_err(|_| "LINK_UNSUPPORTED: invalid local URL")?
                .to_string_lossy()
                .into_owned();
            decoded = true;
        } else if !(cfg!(windows) && Path::new(raw).is_absolute()) {
            return Err("LINK_UNSUPPORTED: only web links and task files are supported".into());
        }
    }
    let file = if decoded {
        std::borrow::Cow::Owned(file)
    } else {
        percent_encoding::percent_decode_str(file.split(['?', '#']).next().unwrap_or_default())
            .decode_utf8()
            .map_err(|_| "LINK_UNSUPPORTED: invalid encoding")?
            .into_owned()
            .into()
    };
    // Windows canonicalization uses an extended local-drive prefix. Normalize
    // that prefix only; UNC/device namespaces still fail before filesystem I/O.
    #[cfg(windows)]
    let file = match Path::new(file.as_ref()).components().next() {
        Some(Component::Prefix(prefix))
            if matches!(prefix.kind(), std::path::Prefix::VerbatimDisk(_)) =>
        {
            std::borrow::Cow::Owned(file[4..].to_owned())
        }
        _ => file,
    };
    if file.is_empty()
        || file.chars().any(char::is_control)
        || file.replace('\\', "/").starts_with("//")
    {
        return Err("LINK_PATH: empty, network and device paths are unsupported".into());
    }
    let identity = file_paths::resolve(root, &file)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "LINK_MISSING: the task workspace is unavailable")?;
    if !identity.physically_resolved
        || !file_paths::within(&file_paths::normal(&canonical_root), &identity.resolved)
    {
        return Err("LINK_PATH: file is outside this task workspace".into());
    }
    // Reject links/reparse points on every ancestor, including a renamed task root.
    for ancestor in root.ancestors() {
        if file_paths::is_reparse(ancestor) {
            return Err("LINK_PATH: linked workspace ancestor".into());
        }
    }
    let relative = identity
        .path
        .strip_prefix(root)
        .or_else(|_| identity.path.strip_prefix(&canonical_root))
        .map_err(|_| "LINK_PATH: ambiguous path")?;
    let mut current = canonical_root;
    for part in relative.components() {
        match part {
            Component::Normal(name) => current.push(name),
            Component::CurDir => {}
            _ => return Err("LINK_PATH: traversal is unsupported".into()),
        }
        if !current.exists() {
            return Err("LINK_MISSING: this file no longer exists".into());
        }
        if file_paths::is_reparse(&current) {
            return Err("LINK_PATH: linked file or directory".into());
        }
    }
    let metadata =
        std::fs::metadata(&current).map_err(|_| "LINK_MISSING: this file is unavailable")?;
    if !metadata.is_file() {
        return Err("LINK_PATH: the link does not identify a file".into());
    }
    Ok(
        json!({"kind":"file","name":current.file_name().unwrap_or_default().to_string_lossy(),"bytes":metadata.len(),"path":current.to_string_lossy().strip_prefix(r"\\?\").unwrap_or(&current.to_string_lossy()),"extension":current.extension().unwrap_or_default().to_string_lossy()}),
    )
}
fn origin(app: &tauri::AppHandle) -> Option<String> {
    app.config()
        .build
        .dev_url
        .as_ref()
        .map(|url| url.origin().ascii_serialization())
}
fn workspace(task: &str) -> Result<PathBuf, String> {
    Ok(crate::utils::workspace_root()?
        .join("tasks")
        .join(task)
        .join("workspace"))
}

#[tauri::command]
pub async fn resolve_message_link(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    task_id: String,
    message_id: String,
    href: String,
) -> Result<Value, String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        context(&conn, &task_id, &message_id)?;
    }
    let root = workspace(&task_id)?;
    let origin = origin(&app);
    tokio::task::spawn_blocking(move || resolve(&root, &href, origin.as_deref()))
        .await
        .map_err(|e| format!("LINK_WORKER: {e}"))?
}
#[tauri::command]
pub async fn open_message_link(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    task_id: String,
    message_id: String,
    href: String,
) -> Result<Value, String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        context(&conn, &task_id, &message_id)?;
    }
    let root = workspace(&task_id)?;
    let origin = origin(&app);
    tokio::task::spawn_blocking(move || {
        let resolved = resolve(&root, &href, origin.as_deref())?;
        // Evaluation-only seam: exercise the production resolver/opener selection
        // without flashing OS windows in hidden desktop tests. Absent in production.
        #[cfg(feature = "evaluation-runner")]
        if std::env::var("ZEUS_TEST_LINK_OPENER").as_deref() == Ok("1") {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(crate::utils::workspace_root()?.join("link-open-intents.jsonl"))
                .map_err(|e| e.to_string())?;
            writeln!(file, "{}", resolved).map_err(|e| e.to_string())?;
            return Ok(resolved);
        }
        match resolved["kind"].as_str() {
            Some("web") => app
                .opener()
                .open_url(resolved["url"].as_str().unwrap(), None::<&str>)
                .map_err(|e| format!("LINK_OPEN: {e}"))?,
            Some("file") => app
                .opener()
                .reveal_item_in_dir(resolved["path"].as_str().unwrap())
                .map_err(|e| format!("LINK_REVEAL: {e}"))?,
            _ => return Err("LINK_UNSUPPORTED".into()),
        }
        Ok(resolved)
    })
    .await
    .map_err(|e| format!("LINK_WORKER: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn task_links_are_decoded_contained_and_never_execute_files() {
        let folder = std::env::temp_dir().join(format!("zeus-links-{}", crate::db::new_id()));
        std::fs::create_dir_all(folder.join("workspace")).unwrap();
        let root = folder.join("workspace");
        std::fs::write(root.join("report with space.md"), b"report").unwrap();
        std::fs::write(root.join("literal%20name.md"), b"encoded once").unwrap();
        std::fs::write(folder.join("private.txt"), b"outside").unwrap();
        let origin = Some("http://127.0.0.1:1420");
        for href in [
            "report%20with%20space.md",
            "http://127.0.0.1:1420/report%20with%20space.md",
        ] {
            assert_eq!(resolve(&root, href, origin).unwrap()["kind"], "file");
        }
        for name in ["report with space.md", "literal%20name.md"] {
            let path = root.join(name).canonicalize().unwrap();
            let href = reqwest::Url::from_file_path(&path).unwrap();
            assert_eq!(resolve(&root, href.as_str(), origin).unwrap()["name"], name);
            assert_eq!(
                resolve(&root, path.to_str().unwrap(), origin).unwrap()["name"],
                name
            );
        }
        assert_eq!(
            resolve(&root, "https://example.com/page?q=1", origin).unwrap()["kind"],
            "web"
        );
        assert!(resolve(&root, "missing.md", origin)
            .unwrap_err()
            .contains("LINK_MISSING"));
        for href in [
            "../private.txt",
            "%2e%2e/private.txt",
            "javascript:alert(1)",
            "//server/share",
            "file://server/private.txt",
            r"\\?\UNC\server\share\private.txt",
            r"\\.\C:\private.txt",
            "https://user:password@example.com/",
        ] {
            assert!(resolve(&root, href, origin).is_err(), "{href}");
        }
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        assert!(context(&conn, &crate::db::new_id(), "foreign").is_err());
        std::fs::remove_dir_all(folder).unwrap();
    }
}
