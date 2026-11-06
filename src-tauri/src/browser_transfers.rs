//! Owned file snapshots and verified browser downloads. No model-supplied
//! service path is accepted; upload bytes are frozen before authorization.
use super::*;
use std::io::{Read, Write};
const LIMIT: u64 = 50 * 1024 * 1024;

pub(super) struct Upload {
    pub metadata: Value,
    path: PathBuf,
}
impl Drop for Upload {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn handle_path(file: &std::fs::File, path: &Path) -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        #[link(name = "kernel32")]
        extern "system" {
            fn GetFinalPathNameByHandleW(
                handle: *mut std::ffi::c_void,
                buffer: *mut u16,
                length: u32,
                flags: u32,
            ) -> u32;
        }
        let mut data = vec![0u16; 32768];
        let len = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                data.as_mut_ptr(),
                data.len() as u32,
                0,
            )
        };
        if len == 0 || len as usize >= data.len() {
            return Err("BROWSER_UPLOAD_PATH: cannot verify opened file ownership".into());
        }
        let _ = path;
        Ok(PathBuf::from(String::from_utf16_lossy(
            &data[..len as usize],
        )))
    }
    #[cfg(not(windows))]
    {
        let _ = file;
        path.canonicalize().map_err(|e| e.to_string())
    }
}

pub(super) fn prepare(workspace: &Path, folder: &Path, path: &str) -> Result<Upload, String> {
    let relative = folder
        .strip_prefix(workspace)
        .map_err(|_| "BROWSER_UPLOAD_PATH: staging outside task")?;
    let root = workspace.canonicalize().map_err(|e| e.to_string())?;
    let folder = root.join(relative);
    let identity = crate::file_paths::resolve(&root, path)?;
    if !identity.physically_resolved
        || !crate::file_paths::within(&crate::file_paths::normal(&root), &identity.resolved)
    {
        return Err("BROWSER_UPLOAD_PATH: use a file inside this task's workspace".into());
    }
    let file = std::fs::File::open(&identity.path).map_err(|e| e.to_string())?;
    let actual = handle_path(&file, &identity.path)?;
    if !crate::file_paths::within(
        &crate::file_paths::normal(&root),
        &crate::file_paths::normal(&actual),
    ) || !file.metadata().map_err(|e| e.to_string())?.is_file()
    {
        return Err("BROWSER_UPLOAD_PATH: opened file is outside the task workspace".into());
    }
    if file.metadata().map_err(|e| e.to_string())?.len() > LIMIT {
        return Err("BROWSER_TRANSFER_LIMIT: upload exceeds 50 MiB".into());
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("BROWSER_TRANSFER_LIMIT: upload exceeds 50 MiB".into());
    }
    owned_directory(&root, &folder)?;
    let key = format!("{}.upload", uuid::Uuid::new_v4().simple());
    let destination = folder.join(&key);
    let name = identity
        .path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("BROWSER_UPLOAD_NAME: invalid file name")?;
    if name.len() > 240 {
        return Err("BROWSER_UPLOAD_NAME: file name exceeds 240 bytes".into());
    }
    let upload = Upload {
        metadata: json!({"key":key,"name":name,"bytes":bytes.len(),"sha256":format!("{:x}",Sha256::digest(&bytes))}),
        path: destination,
    };
    let mut output = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&upload.path)
        .map_err(|e| e.to_string())?;
    output.write_all(&bytes).map_err(|e| e.to_string())?;
    output.sync_all().map_err(|e| e.to_string())?;
    Ok(upload)
}

pub(super) fn collect(
    state: &State<'_, AppState>,
    task: &str,
    session: &str,
    items: &Value,
) -> Result<Vec<Value>, String> {
    let Some(items) = items.as_array() else {
        return Ok(vec![]);
    };
    let folder = crate::utils::task_workspace(task)?
        .join(".zeus/managed-browser")
        .join(session)
        .join("transfers");
    let mut output = Vec::new();
    for item in items.iter().take(64) {
        let id = item["id"].as_str().ok_or("BROWSER_TRANSFER_IDENTITY")?;
        if id.len() != 32
            || !id.bytes().all(|c| c.is_ascii_hexdigit())
            || item["direction"] != "download"
            || !["pending", "completed", "failed", "cancelled"]
                .contains(&item["status"].as_str().unwrap_or(""))
        {
            return Err("BROWSER_TRANSFER_IDENTITY: invalid transfer metadata".into());
        }
        let mut row = item.clone();
        let registered = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            conn.query_row("SELECT metadata FROM managed_browser_transfers WHERE id=?1 AND session_id=?2 AND status='completed'",params![id,session],|r|r.get::<_,String>(0)).optional().map_err(|e|e.to_string())?
        };
        if let Some(raw) = registered {
            let previous: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            if item["status"] == "completed" && item["sha256"] != previous["sha256"] {
                return Err("BROWSER_TRANSFER_CHANGED: completed identity changed".into());
            }
            output.push(previous);
            continue;
        }
        if item["status"] == "completed" {
            let key = item["key"].as_str().ok_or("BROWSER_TRANSFER_PATH")?;
            if !key.starts_with(&format!("{id}-"))
                || key.len() > 160
                || key
                    .chars()
                    .any(|c| !c.is_ascii_alphanumeric() && !"._-".contains(c))
            {
                return Err("BROWSER_TRANSFER_PATH: invalid download key".into());
            }
            let identity = crate::file_paths::resolve(&folder, key)?;
            if !identity.physically_resolved
                || !crate::file_paths::within(
                    &crate::file_paths::normal(&folder.canonicalize().map_err(|e| e.to_string())?),
                    &identity.resolved,
                )
                || crate::file_paths::is_reparse(&identity.path)
            {
                return Err("BROWSER_TRANSFER_PATH: invalid download ownership".into());
            }
            let file = std::fs::File::open(&identity.path).map_err(|e| e.to_string())?;
            let actual = handle_path(&file, &identity.path)?;
            if !crate::file_paths::within(
                &crate::file_paths::normal(&folder.canonicalize().map_err(|e| e.to_string())?),
                &crate::file_paths::normal(&actual),
            ) {
                return Err(
                    "BROWSER_TRANSFER_PATH: opened download is outside owned storage".into(),
                );
            }
            if file.metadata().map_err(|e| e.to_string())?.len() > LIMIT {
                return Err("BROWSER_TRANSFER_LIMIT".into());
            }
            let mut bytes = Vec::new();
            file.take(LIMIT + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() as u64 > LIMIT
                || item["bytes"] != bytes.len()
                || item["sha256"] != format!("{:x}", Sha256::digest(&bytes))
            {
                return Err(
                    "BROWSER_TRANSFER_CHANGED: downloaded bytes do not match acknowledgement"
                        .into(),
                );
            }
            // Return the verified handle's canonical path. On Windows this
            // retains the extended-length prefix required by Python file I/O
            // when task/session/download names exceed MAX_PATH.
            row["path"] = json!(actual);
        }
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO managed_browser_transfers(id,session_id,direction,status,metadata,updated_at) VALUES(?1,?2,'download',?3,?4,?5) ON CONFLICT(id) DO UPDATE SET status=excluded.status,metadata=excluded.metadata,updated_at=excluded.updated_at WHERE managed_browser_transfers.session_id=excluded.session_id AND managed_browser_transfers.status!='completed'",params![id,session,row["status"].as_str(),row.to_string(),crate::db::now_iso()]).map_err(|e|e.to_string())?;
        output.push(row);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upload_snapshots_are_immutable_and_task_bound() {
        let root = std::env::temp_dir().join(format!("zeus-transfer-{}", crate::db::new_id()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("source.txt"), b"original").unwrap();
        let folder = root.join("transfers");
        let upload = prepare(&root, &folder, "source.txt").unwrap();
        std::fs::write(root.join("source.txt"), b"changed").unwrap();
        assert_eq!(std::fs::read(&upload.path).unwrap(), b"original");
        assert!(prepare(&root, &folder, "../outside.txt").is_err());
        let staged = upload.path.clone();
        drop(upload);
        assert!(!staged.exists());
        std::fs::remove_file(root.join("source.txt")).unwrap();
        std::fs::remove_dir(folder).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
