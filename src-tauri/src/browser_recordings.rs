//! Paged, read-only recording adapters. Stored history never executes a browser.
use crate::{browser_capture as capture, browser_store as store, db::AppState};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{
    io::{Cursor, Write},
    path::PathBuf,
};
use tauri::State;

pub(crate) fn task_exists(conn: &Connection, task: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(task).map_err(|_| "BROWSER_OWNERSHIP: invalid task")?;
    if !conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM tasks WHERE id=?1)",
            [task],
            |r| r.get::<_, bool>(0),
        )
        .map_err(|e| e.to_string())?
    {
        return Err("BROWSER_OWNERSHIP: unknown task".into());
    }
    Ok(())
}
fn old_roots(task: &str) -> Result<Vec<PathBuf>, String> {
    uuid::Uuid::parse_str(task).map_err(|_| "BROWSER_OWNERSHIP: invalid task")?;
    let root = crate::utils::workspace_root()?;
    Ok(vec![
        root.join(".zeus/browser_history").join(task),
        root.join("tasks")
            .join(task)
            .join("workspace/.zeus/browser_history"),
    ])
}
pub fn legacy_manifest(task: &str, session: &str) -> Result<(PathBuf, Value), String> {
    uuid::Uuid::parse_str(
        session
            .strip_prefix("sess_")
            .ok_or("BROWSER_RECORDING_ID: invalid older recording ID")?,
    )
    .map_err(|_| "BROWSER_RECORDING_ID: invalid older recording ID")?;
    for root in old_roots(task)? {
        let folder = root.join(session);
        if !folder.join("manifest.json").exists() {
            continue;
        }
        let data = capture::bounded_read(&folder, "manifest.json", 4 * 1024 * 1024)?;
        let data: Value = serde_json::from_slice(&data)
            .map_err(|_| "BROWSER_RECORDING_INVALID: malformed older recording")?;
        if data["task_id"] != task
            || data["session_id"] != session
            || !data["steps"].as_array().is_some_and(|s| s.len() <= 5000)
        {
            return Err("BROWSER_RECORDING_INVALID: identity or step limit".into());
        }
        for step in data["steps"].as_array().unwrap() {
            let text = |key: &str, optional: bool| {
                step[key].as_str().is_some_and(|s| s.len() <= 32768)
                    || (optional && step[key].is_null())
            };
            if !text("action", false)
                || !text("url", false)
                || !text("target", true)
                || !text("value", true)
                || !text("screenshot_path", false)
                || step["timestamp"].as_u64().is_none()
            {
                return Err("BROWSER_RECORDING_INVALID: invalid step fields".into());
            }
            if !step["bounding_box"].is_null()
                && !["x", "y", "width", "height"].iter().all(|key| {
                    step["bounding_box"][key]
                        .as_f64()
                        .is_some_and(|n| n.is_finite() && n.abs() <= 100000.0)
                })
            {
                return Err("BROWSER_RECORDING_INVALID: invalid recorded coordinates".into());
            }
        }
        return Ok((folder, data));
    }
    Err("BROWSER_RECORDING_MISSING: older recording is unavailable".into())
}
pub fn legacy_image(task: &str, session: &str, index: usize) -> Result<(Vec<u8>, String), String> {
    let (root, data) = legacy_manifest(task, session)?;
    let key = data["steps"]
        .get(index)
        .and_then(|s| s["screenshot_path"].as_str())
        .ok_or("BROWSER_IMAGE_UNAVAILABLE: no image")?;
    let bytes = capture::bounded_read(&root, key, capture::IMAGE_LIMIT)?;
    let mut reader = image::ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mime = match reader.format() {
        Some(image::ImageFormat::Jpeg) => "image/jpeg",
        Some(image::ImageFormat::Png) => "image/png",
        Some(image::ImageFormat::WebP) => "image/webp",
        _ => return Err("BROWSER_IMAGE_INVALID: unsupported historical image".into()),
    };
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(80 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|e| format!("BROWSER_IMAGE_INVALID: {e}"))?;
    Ok((bytes, mime.into()))
}
fn frames(conn: &Connection, session: &str, action: &str) -> Result<Vec<Value>, String> {
    let mut stmt=conn.prepare("SELECT id,relation,status,metadata,error,created_ms FROM managed_browser_frames WHERE session_id=?1 AND action_id=?2 ORDER BY created_ms,id LIMIT 4").map_err(|e|e.to_string())?;
    let rows=stmt.query_map(params![session,action],|r|{let meta:Option<String>=r.get(3)?;Ok(json!({"id":r.get::<_,String>(0)?,"relation":r.get::<_,String>(1)?,"status":r.get::<_,String>(2)?,"metadata":meta.and_then(|s|serde_json::from_str::<Value>(&s).ok()),"error":r.get::<_,Option<String>>(4)?,"created_ms":r.get::<_,i64>(5)?}))}).map_err(|e|e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
const PAGE_BYTES: usize = 512 * 1024;
fn bounded_page(mut page: Value, after: i64) -> Result<Value, String> {
    let actions = page["actions"]
        .as_array_mut()
        .ok_or("BROWSER_RECORDING_INVALID")?;
    let input = std::mem::take(actions);
    let mut used = serde_json::to_vec(&page).map_err(|e| e.to_string())?.len() + 1024;
    let mut output = Vec::new();
    for mut action in input {
        if serde_json::to_vec(&action)
            .map_err(|e| e.to_string())?
            .len()
            > 32 * 1024
        {
            let text = action["arguments"].to_string();
            action["arguments"] = json!({"summary":text.chars().take(2048).collect::<String>(),"truncated":true,"original_bytes":text.len()});
            if let Some(op) = action["op"].as_str() {
                action["op"] = json!(op.chars().take(256).collect::<String>());
            }
            if serde_json::to_vec(&action["frames"])
                .map_err(|e| e.to_string())?
                .len()
                > 16 * 1024
            {
                action["images_truncated"] = json!(true);
                action["frames"] = json!([]);
            }
            if serde_json::to_vec(&action["outcome"])
                .map_err(|e| e.to_string())?
                .len()
                > 4096
            {
                let summary = action["outcome"]
                    .to_string()
                    .chars()
                    .take(1024)
                    .collect::<String>();
                action["outcome"] = json!({"ok":action["outcome"]["ok"],"summary":summary});
            }
            action["presentation_truncated"] = json!(true);
        }
        let bytes = serde_json::to_vec(&action)
            .map_err(|e| e.to_string())?
            .len()
            + 1;
        if used + bytes > PAGE_BYTES {
            if output.is_empty() {
                return Err("BROWSER_PAGE_LIMIT: metadata exceeds the reader allowance".into());
            }
            break;
        }
        used += bytes;
        output.push(action);
    }
    let end = output
        .last()
        .and_then(|row| row["seq"].as_i64())
        .unwrap_or(after);
    page["next_after"] = if end < page["total_actions"].as_i64().unwrap_or(0) {
        json!(end)
    } else {
        Value::Null
    };
    page["actions"] = json!(output);
    if serde_json::to_vec(&page).map_err(|e| e.to_string())?.len() > PAGE_BYTES {
        return Err("BROWSER_PAGE_LIMIT: oversized reader page".into());
    }
    Ok(page)
}
pub fn recording_page(
    conn: &Connection,
    task: &str,
    session: &str,
    after: i64,
    limit: usize,
) -> Result<Value, String> {
    task_exists(conn, task)?;
    if !(0..=5000).contains(&after) || !(1..=100).contains(&limit) {
        return Err("BROWSER_PAGE_LIMIT: invalid cursor/limit".into());
    }
    if session.starts_with("sess_") {
        let (_, data) = legacy_manifest(task, session)?;
        let steps = data["steps"].as_array().unwrap();
        let actions=steps.iter().enumerate().skip(after as usize).take(limit).map(|(i,step)|json!({"id":format!("old:{i}"),"seq":i+1,"op":step["action"],"status":"recorded_unverified","arguments":{"target":step["target"],"url":step["url"]},"timestamp":step["timestamp"],"bounding_box":step["bounding_box"],"frames":[{"id":format!("old:{i}"),"relation":"approximate","status":if step["screenshot_path"].as_str().unwrap_or("").is_empty(){"unavailable"}else{"unverified"}}]})).collect::<Vec<_>>();
        let end = after as usize + actions.len();
        return bounded_page(
            json!({"kind":"older","coverage":"Older recording — limited evidence","session":{"session_id":session,"task_id":task,"status":"historical","version":0,"created_at":data["started_at"],"updated_at":data["completed_at"],"duration_ms":data["duration_ms"]},"actions":actions,"next_after":if end<steps.len(){Some(end)}else{None},"total_actions":steps.len()}),
            after,
        );
    }
    let snapshot = capture::snapshot(conn, task, session)?;
    let mut stmt=conn.prepare("SELECT id,seq,caller,op,arguments,status,created_at,updated_at,authorization FROM managed_browser_actions WHERE session_id=?1 AND seq>?2 ORDER BY seq LIMIT ?3").map_err(|e|e.to_string())?;
    let rows=stmt.query_map(params![session,after,limit as i64],|r|{let args:String=r.get(4)?;Ok(json!({"id":r.get::<_,String>(0)?,"seq":r.get::<_,i64>(1)?,"caller":r.get::<_,String>(2)?,"op":r.get::<_,String>(3)?,"arguments":serde_json::from_str::<Value>(&args).unwrap_or(Value::Null),"status":r.get::<_,String>(5)?,"created_at":r.get::<_,String>(6)?,"updated_at":r.get::<_,String>(7)?,"authorization":r.get::<_,Option<String>>(8)?}))}).map_err(|e|e.to_string())?;
    let mut actions = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for action in &mut actions {
        action["frames"] = json!(frames(conn, session, action["id"].as_str().unwrap())?);
        let response: Option<String> = conn
            .query_row(
                "SELECT response FROM managed_browser_actions WHERE id=?1 AND session_id=?2",
                params![action["id"].as_str(), session],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if let Some(response) = response.and_then(|raw| serde_json::from_str::<Value>(&raw).ok()) {
            action["outcome"] = json!({"ok":response["ok"],"error":response["error"],"timing_ms":response["timing_ms"]});
        }
    }
    let total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM managed_browser_actions WHERE session_id=?1",
            [session],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let end = actions
        .last()
        .and_then(|a| a["seq"].as_i64())
        .unwrap_or(after);
    let frame_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM managed_browser_frames WHERE session_id=?1",
            [session],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    bounded_page(
        json!({"kind":"managed","coverage":if frame_count==0{"Action evidence only; images were not recorded"}else{"Recorded action outcomes; image gaps are explicit"},"session":snapshot["session"],"capture":snapshot["capture"],"coverage_gaps":snapshot["coverage"],"actions":actions,"total_actions":total,"next_after":if end<total{Some(end)}else{None}}),
        after,
    )
}

#[tauri::command]
pub async fn get_browser_recording_index(
    state: State<'_, AppState>,
    task_id: String,
    session_id: String,
    after: Option<i64>,
) -> Result<Value, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move||{
        let conn=db.lock().map_err(|e|e.to_string())?;task_exists(&conn,&task_id)?;
        let after=after.unwrap_or(0);if !(0..=5000).contains(&after){return Err("BROWSER_PAGE_LIMIT: invalid cursor".into());}
        let rows:Vec<Value>=if session_id.starts_with("sess_") {
            let (root,data)=legacy_manifest(&task_id,&session_id)?;
            data["steps"].as_array().unwrap().iter().enumerate().skip(after as usize).take(500).map(|(i,s)|{let has_image=s["screenshot_path"].as_str().and_then(|key|capture::owned_file(&root,key).ok()).is_some_and(|path|path.is_file());json!({"seq":i+1,"op":s["action"].as_str().unwrap_or("").chars().take(64).collect::<String>(),"status":"recorded_unverified","has_image":has_image})}).collect()
        }else{
            store::session(&conn,&task_id,&session_id)?;
            let mut stmt=conn.prepare("SELECT a.seq,a.op,a.status,EXISTS(SELECT 1 FROM managed_browser_frames f WHERE f.session_id=a.session_id AND f.action_id=a.id AND f.status='available') FROM managed_browser_actions a WHERE a.session_id=?1 AND a.seq>?2 ORDER BY a.seq LIMIT 500").map_err(|e|e.to_string())?;
            let rows=stmt.query_map(params![session_id,after],|r|Ok(json!({"seq":r.get::<_,i64>(0)?,"op":r.get::<_,String>(1)?,"status":r.get::<_,String>(2)?,"has_image":r.get::<_,bool>(3)?}))).map_err(|e|e.to_string())?;
            rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
        };
        let next=if rows.len()==500{rows.last().and_then(|r|r["seq"].as_i64())}else{None};
        Ok(json!({"actions":rows,"next_after":next}))
    }).await.map_err(|e|format!("BROWSER_RECORDING_WORKER: {e}"))?
}
#[tauri::command]
pub async fn get_browser_recording_page(
    state: State<'_, AppState>,
    task_id: String,
    session_id: String,
    after: Option<i64>,
    limit: Option<usize>,
) -> Result<Value, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        get_browser_recording_page_inner(&db, task_id, session_id, after, limit)
    })
    .await
    .map_err(|error| format!("BROWSER_RECORDING_WORKER: {error}"))?
}
fn get_browser_recording_page_inner(
    db: &std::sync::Mutex<Connection>,
    task_id: String,
    session_id: String,
    after: Option<i64>,
    limit: Option<usize>,
) -> Result<Value, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    recording_page(
        &conn,
        &task_id,
        &session_id,
        after.unwrap_or(0),
        limit.unwrap_or(50),
    )
}
#[tauri::command]
pub async fn list_browser_recordings(
    state: State<'_, AppState>,
    task_id: String,
    offset: Option<usize>,
) -> Result<Value, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || list_browser_recordings_inner(&db, task_id, offset))
        .await
        .map_err(|error| format!("BROWSER_RECORDING_WORKER: {error}"))?
}
fn list_browser_recordings_inner(
    db: &std::sync::Mutex<Connection>,
    task_id: String,
    offset: Option<usize>,
) -> Result<Value, String> {
    let offset = offset.unwrap_or(0);
    if offset > 1000000 {
        return Err("BROWSER_PAGE_LIMIT: invalid cursor".into());
    }
    let (mut recordings, managed_total) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        task_exists(&conn, &task_id)?;
        let total: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM managed_browser_sessions WHERE task_id=?1",
                [&task_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let mut stmt=conn.prepare("SELECT id FROM managed_browser_sessions WHERE task_id=?1 ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?2").map_err(|e|e.to_string())?;
        let ids = stmt
            .query_map(params![task_id, offset], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        (
            ids.iter()
                .map(|id| {
                    store::session(&conn, &task_id, id).map(|mut value| {
                        value["kind"] = json!("managed");
                        value
                    })
                })
                .collect::<Result<Vec<_>, _>>()?,
            total,
        )
    };
    let mut scanned = 0;
    let mut older = Vec::new();
    for root in old_roots(&task_id)? {
        if !root.is_dir() {
            continue;
        }
        if capture::validate_directory(&root).is_err() {
            continue;
        }
        for entry in std::fs::read_dir(root)
            .map_err(|e| e.to_string())?
            .take(1001)
            .flatten()
        {
            scanned += 1;
            if scanned > 1000 {
                break;
            }
            let id = entry.file_name().to_string_lossy().into_owned();
            if older.iter().any(|r: &Value| r["session_id"] == id) {
                continue;
            }
            if !id
                .strip_prefix("sess_")
                .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
            {
                continue;
            }
            if let Ok(path) = capture::owned_file(&entry.path(), "manifest.json") {
                if let Ok(metadata) = std::fs::metadata(path) {
                    if metadata.is_file() && metadata.len() <= 4 * 1024 * 1024 {
                        older.push(json!({"session_id":id,"task_id":task_id,"kind":"older","status":"historical","created_at":metadata.modified().ok().map(chrono::DateTime::<chrono::Utc>::from).map(|date|date.to_rfc3339()).unwrap_or_default(),"time_source":"recording_file_modified","coverage":"Older recording — limited evidence"}));
                    }
                }
            }
        }
    }
    older.sort_by(|a, b| {
        b["created_at"]
            .as_str()
            .cmp(&a["created_at"].as_str())
            .then_with(|| b["session_id"].as_str().cmp(&a["session_id"].as_str()))
    });
    let total = managed_total + older.len();
    let remaining = 50 - recordings.len();
    recordings.extend(
        older
            .into_iter()
            .skip(offset.saturating_sub(managed_total))
            .take(remaining),
    );
    let next = offset + recordings.len();
    Ok(
        json!({"recordings":recordings,"next_offset":if next<total{Some(next)}else{None},"older_scan_truncated":scanned>1000}),
    )
}
pub fn retained_image(
    conn: &Connection,
    task: &str,
    session: &str,
    id: &str,
) -> Result<Value, String> {
    store::session(conn, task, session)?;
    let raw:Option<String>=conn.query_row("SELECT metadata FROM managed_browser_frames WHERE id=?1 AND session_id=?2 AND status='available'",params![id,session],|r|r.get(0)).optional().map_err(|e|e.to_string())?.flatten();
    serde_json::from_str(
        &raw.ok_or("BROWSER_IMAGE_UNAVAILABLE: image was not retained or was deleted")?,
    )
    .map_err(|_| "BROWSER_IMAGE_INVALID: invalid metadata".into())
}
#[tauri::command]
pub async fn read_browser_recording_image(
    state: State<'_, AppState>,
    task_id: String,
    session_id: String,
    frame_id: String,
) -> Result<tauri::ipc::Response, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        read_browser_recording_image_inner(&db, task_id, session_id, frame_id)
    })
    .await
    .map_err(|error| format!("BROWSER_RECORDING_WORKER: {error}"))?
}
fn read_browser_recording_image_inner(
    db: &std::sync::Mutex<Connection>,
    task_id: String,
    session_id: String,
    frame_id: String,
) -> Result<tauri::ipc::Response, String> {
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        task_exists(&conn, &task_id)?;
    }
    if session_id.starts_with("sess_") {
        let index = frame_id
            .strip_prefix("old:")
            .and_then(|s| s.parse::<usize>().ok())
            .ok_or("BROWSER_IMAGE_INVALID: invalid older frame")?;
        return Ok(tauri::ipc::Response::new(
            legacy_image(&task_id, &session_id, index)?.0,
        ));
    }
    let meta = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        retained_image(&conn, &task_id, &session_id, &frame_id)?
    };
    let folder = capture::frame_folder(&task_id, &session_id, &meta)?;
    let bytes = capture::bounded_read(
        &folder,
        meta["key"].as_str().ok_or("BROWSER_IMAGE_INVALID")?,
        capture::IMAGE_LIMIT,
    )?;
    capture::validate_image(&bytes, &meta)?;
    // A concurrent delete must not publish a different or misleading image.
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        retained_image(&conn, &task_id, &session_id, &frame_id)?;
    }
    Ok(tauri::ipc::Response::new(bytes))
}

fn terminal(conn: &Connection, task: &str, session: &str) -> Result<(), String> {
    let info = store::session(conn, task, session)?;
    if ["starting", "active", "finalizing"].contains(&info["status"].as_str().unwrap_or("")) {
        return Err(
            "BROWSER_RECORDING_ACTIVE: close the run before exporting or deleting images".into(),
        );
    }
    Ok(())
}
#[tauri::command]
pub async fn delete_browser_recording_images(
    state: State<'_, AppState>,
    task_id: String,
    session_id: String,
) -> Result<Value, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        delete_browser_recording_images_inner(&db, task_id, session_id)
    })
    .await
    .map_err(|error| format!("BROWSER_RECORDING_WORKER: {error}"))?
}
fn delete_browser_recording_images_inner(
    db: &std::sync::Mutex<Connection>,
    task_id: String,
    session_id: String,
) -> Result<Value, String> {
    let ids = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        terminal(&conn, &task_id, &session_id)?;
        let mut stmt=conn.prepare("SELECT id FROM managed_browser_frames WHERE session_id=?1 AND status!='deleted' LIMIT 10001").map_err(|e|e.to_string())?;
        let ids = stmt
            .query_map([&session_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if ids.len() > 10000 {
            return Err("BROWSER_RECORDING_LIMIT: image count exceeds deletion bound".into());
        }
        conn.execute("UPDATE managed_browser_frames SET status='deleting' WHERE session_id=?1 AND status!='deleted'",[&session_id]).map_err(|e|e.to_string())?;
        ids
    };
    let mut failures = 0;
    for id in &ids {
        uuid::Uuid::parse_str(id).map_err(|_| "BROWSER_IMAGE_INVALID: invalid retained ID")?;
        let result = (|| -> Result<(), String> {
            let (raw, relation): (Option<String>, String) = {
                let conn = db.lock().map_err(|e| e.to_string())?;
                conn.query_row("SELECT metadata,relation FROM managed_browser_frames WHERE id=?1 AND session_id=?2",params![id,session_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?
            };
            let fallback = if relation == "explicit" {
                json!({"storage":"artifacts","key":format!("{}.jpg",uuid::Uuid::parse_str(id).unwrap().simple())})
            } else {
                json!({"key":format!("{id}.jpg")})
            };
            let meta = raw
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .unwrap_or(fallback);
            let folder = capture::frame_folder(&task_id, &session_id, &meta)?;
            capture::validate_directory(&folder)?;
            let key = meta["key"]
                .as_str()
                .ok_or("BROWSER_IMAGE_INVALID: missing key")?;
            capture::validate_key(key)?;
            for key in [
                key.to_string(),
                format!(
                    "{}.tmp",
                    key.strip_suffix(".jpg")
                        .ok_or("BROWSER_IMAGE_INVALID: expected JPEG")?
                ),
            ] {
                match std::fs::symlink_metadata(folder.join(&key)) {
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(error) => return Err(error.to_string()),
                    Ok(_) => {}
                }
                let path = capture::owned_file(&folder, &key)?;
                std::fs::remove_file(path).map_err(|e| e.to_string())?;
            }
            Ok(())
        })();
        if result.is_err() {
            failures += 1;
        }
        let conn = db.lock().map_err(|e| e.to_string())?;
        conn.execute("UPDATE managed_browser_frames SET status=?2,bytes=CASE WHEN ?2='deleted' THEN 0 ELSE bytes END,error=?3 WHERE id=?1",params![id,if result.is_ok(){"deleted"}else{"delete_failed"},result.err()]).map_err(|e|e.to_string())?;
    }
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        capture::gap(&conn, &session_id, "images_deleted_by_user")?;
    }
    Ok(json!({"deleted":ids.len()-failures,"failed":failures}))
}
#[tauri::command]
pub async fn export_browser_recording(
    state: State<'_, AppState>,
    task_id: String,
    session_id: String,
) -> Result<Value, String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || export_browser_recording_inner(&db, task_id, session_id))
        .await
        .map_err(|error| format!("BROWSER_RECORDING_WORKER: {error}"))?
}
fn export_browser_recording_inner(
    db: &std::sync::Mutex<Connection>,
    task_id: String,
    session_id: String,
) -> Result<Value, String> {
    let (snapshot, images) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        terminal(&conn, &task_id, &session_id)?;
        let snapshot = capture::snapshot(&conn, &task_id, &session_id)?;
        let mut stmt=conn.prepare("SELECT id FROM managed_browser_frames WHERE session_id=?1 AND status='available' ORDER BY created_ms,id LIMIT 10001").map_err(|e|e.to_string())?;
        let ids = stmt
            .query_map([&session_id], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if ids.len() > 10000 {
            return Err("BROWSER_RECORDING_LIMIT: export count exceeded".into());
        }
        (snapshot, ids)
    };
    let parent = crate::utils::workspace_root()?.join("browser-exports");
    crate::managed_browser::owned_directory(&crate::utils::workspace_root()?, &parent)?;
    let folder = parent.join(crate::db::new_id());
    std::fs::create_dir(&folder).map_err(|e| e.to_string())?;
    let mut frames = Vec::new();
    for id in images {
        let result = (|| -> Result<Value, String> {
            let meta = {
                let conn = db.lock().map_err(|e| e.to_string())?;
                retained_image(&conn, &task_id, &session_id, &id)?
            };
            let source = capture::frame_folder(&task_id, &session_id, &meta)?;
            let bytes = capture::bounded_read(
                &source,
                meta["key"].as_str().ok_or("BROWSER_IMAGE_INVALID")?,
                capture::IMAGE_LIMIT,
            )?;
            capture::validate_image(&bytes, &meta)?;
            let key = format!("{id}.jpg");
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(folder.join(&key))
                .map_err(|e| e.to_string())?;
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            Ok(json!({"id":id,"file":key,"metadata":meta,"status":"available"}))
        })();
        frames.push(
            result.unwrap_or_else(|error| json!({"id":id,"status":"unavailable","error":error})),
        );
    }
    // Page the bounded action journal rather than load binary images into it.
    let mut actions_file = std::io::BufWriter::new(
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(folder.join("actions.jsonl"))
            .map_err(|e| e.to_string())?,
    );
    let mut cursor = 0;
    loop {
        let batch = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            let mut stmt=conn.prepare("SELECT seq,id,caller,op,arguments,status,authorization,response,created_at,updated_at FROM managed_browser_actions WHERE session_id=?1 AND seq>?2 ORDER BY seq LIMIT 20").map_err(|e|e.to_string())?;
            let rows=stmt.query_map(params![session_id,cursor],|r|Ok(json!({"seq":r.get::<_,i64>(0)?,"id":r.get::<_,String>(1)?,"caller":r.get::<_,String>(2)?,"op":r.get::<_,String>(3)?,"arguments_json":r.get::<_,String>(4)?,"status":r.get::<_,String>(5)?,"authorization":r.get::<_,Option<String>>(6)?,"response_json":r.get::<_,Option<String>>(7)?,"created_at":r.get::<_,String>(8)?,"updated_at":r.get::<_,String>(9)?}))).map_err(|e|e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        if batch.is_empty() {
            break;
        }
        for action in &batch {
            serde_json::to_writer(&mut actions_file, action).map_err(|e| e.to_string())?;
            actions_file.write_all(b"\n").map_err(|e| e.to_string())?;
            cursor = action["seq"].as_i64().ok_or("BROWSER_RECORDING_INVALID")?;
        }
        if cursor > 5000 {
            return Err("BROWSER_RECORDING_LIMIT: action export bound exceeded".into());
        }
    }
    actions_file.flush().map_err(|e| e.to_string())?;
    actions_file
        .get_ref()
        .sync_all()
        .map_err(|e| e.to_string())?;
    let mut pages = Vec::new();
    let mut after = 0;
    loop {
        let page = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            recording_page(&conn, &task_id, &session_id, after, 100)?
        };
        let next = page["next_after"].as_i64();
        pages.push(page);
        if let Some(next) = next {
            after = next;
        } else {
            break;
        }
    }
    let manifest = json!({"schema_version":1,"snapshot":snapshot,"action_pages":pages,"action_journal":"actions.jsonl","action_high_water":cursor,"frames":frames,"note":"Read-only sampled evidence. No executable page or viewer is included. The journal can contain private observed text."});
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(folder.join("recording.json"))
        .map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, &manifest).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(json!({"path":folder,"images":manifest["frames"].as_array().map(Vec::len)}))
}

/// Maintainer CLI: read the existing journal without migrating or mutating it.
pub fn export_diagnostic_recording(task: String, session: String) -> Result<Value, String> {
    let root = crate::utils::workspace_root()?;
    capture::validate_directory(&root)?;
    let file = root.join("zeus.db");
    if crate::file_paths::is_reparse(&file) {
        return Err("BROWSER_DIAGNOSTICS_PATH: database is missing or linked".into());
    }
    let conn = Connection::open_with_flags(file, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(3))
        .map_err(|e| e.to_string())?;
    export_browser_recording_inner(&std::sync::Mutex::new(conn), task, session)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pages_preserve_failed_and_denied_actions_and_old_action_only_evidence() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        let task = crate::db::new_id();
        conn.execute(
            "INSERT INTO tasks(id,title,created_at,updated_at) VALUES(?1,'test','now','now')",
            [&task],
        )
        .unwrap();
        conn.execute("INSERT INTO runs(id,request_id,task_id,status,started_at,updated_at) VALUES('r','request',?1,'running','now','now')",[&task]).unwrap();
        let session = store::ensure_session(&conn, &task, "r").unwrap();
        for n in 0..123 {
            let id = format!("a{n}");
            store::begin_action(
                &conn,
                &session,
                &id,
                "worker:test",
                "click",
                &json!({"target":{"text":"Button"}}),
                &id,
            )
            .unwrap();
            store::action_state(
                &conn,
                &id,
                if n == 122 {
                    "denied"
                } else if n == 121 {
                    "failed"
                } else {
                    "succeeded"
                },
                Some("test_policy"),
                None,
            )
            .unwrap();
        }
        let first = recording_page(&conn, &task, &session, 0, 50).unwrap();
        assert_eq!(first["actions"].as_array().unwrap().len(), 50);
        assert_eq!(first["next_after"], 50);
        assert!(first["coverage"]
            .as_str()
            .unwrap()
            .contains("Action evidence only"));
        let middle = recording_page(&conn, &task, &session, 50, 50).unwrap();
        assert_eq!(middle["actions"][0]["seq"], 51);
        let last = recording_page(&conn, &task, &session, 100, 50).unwrap();
        assert_eq!(last["actions"][21]["status"], "failed");
        assert_eq!(last["actions"][22]["status"], "denied");
        assert!(last["next_after"].is_null());
        assert!(recording_page(&conn, &task, &session, 0, 101).is_err());
        assert!(recording_page(&conn, &crate::db::new_id(), &session, 0, 50).is_err());
        assert!(terminal(&conn, &task, &session).is_err());
        store::finish(&conn, &session, "cancelled", None).unwrap();
        assert!(terminal(&conn, &task, &session).is_ok());
        let huge = json!({"value":"large 🐘 input ".repeat(10000)}).to_string();
        conn.execute(
            "UPDATE managed_browser_actions SET arguments=?1 WHERE session_id=?2",
            params![huge, session],
        )
        .unwrap();
        let bounded = recording_page(&conn, &task, &session, 0, 100).unwrap();
        assert!(serde_json::to_vec(&bounded).unwrap().len() <= PAGE_BYTES);
        assert_eq!(bounded["actions"][0]["presentation_truncated"], true);
        let next = bounded["next_after"].as_i64().unwrap();
        let following = recording_page(&conn, &task, &session, next, 100).unwrap();
        assert_eq!(following["actions"][0]["seq"], next + 1);
        let medium = json!({"value":"x".repeat(12000)}).to_string();
        conn.execute(
            "UPDATE managed_browser_actions SET arguments=?1 WHERE session_id=?2",
            params![medium, session],
        )
        .unwrap();
        let limited = recording_page(&conn, &task, &session, 0, 100).unwrap();
        assert!(serde_json::to_vec(&limited).unwrap().len() <= PAGE_BYTES);
        assert!(limited["actions"].as_array().unwrap().len() < 100);
        let cursor = limited["next_after"].as_i64().unwrap();
        assert_eq!(
            recording_page(&conn, &task, &session, cursor, 100).unwrap()["actions"][0]["seq"],
            cursor + 1
        );
    }
}
