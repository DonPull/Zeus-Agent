//! Read-only browser capture transport. Never takes the actor broker/control lock.
use crate::{browser_store as store, db::AppState};
use image::{ImageDecoder, ImageFormat, ImageReader};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, State};
use tokio_util::sync::CancellationToken;

pub const IMAGE_LIMIT: u64 = 2 * 1024 * 1024;
const SESSION_LIMIT: i64 = 256 * 1024 * 1024;
const GLOBAL_LIMIT: i64 = 2 * 1024 * 1024 * 1024;
pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("SAVEPOINT zeus_capture_migration")
        .map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        conn.execute_batch("
      CREATE TABLE IF NOT EXISTS managed_browser_capture_state(
        session_id TEXT PRIMARY KEY REFERENCES managed_browser_sessions(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS managed_browser_frames(
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES managed_browser_sessions(id) ON DELETE CASCADE,
        action_id TEXT REFERENCES managed_browser_actions(id) ON DELETE CASCADE,
        relation TEXT NOT NULL, status TEXT NOT NULL, bytes INTEGER NOT NULL,
        metadata TEXT, error TEXT, created_ms INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS browser_frames_session ON managed_browser_frames(session_id,created_ms,id);
      CREATE INDEX IF NOT EXISTS browser_sessions_history ON managed_browser_sessions(task_id,created_at,id);
      CREATE TABLE IF NOT EXISTS managed_browser_coverage(
        session_id TEXT NOT NULL REFERENCES managed_browser_sessions(id) ON DELETE CASCADE,
        reason TEXT NOT NULL, first_ms INTEGER NOT NULL, last_ms INTEGER NOT NULL, occurrences INTEGER NOT NULL,
        PRIMARY KEY(session_id,reason));
      CREATE TABLE IF NOT EXISTS run_browser_runtime(
        run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, setup_json TEXT NOT NULL);
    ").map_err(|e| e.to_string())?;
        crate::browser_visuals::init_schema(conn)
    })();
    if result.is_err() {
        let _ = conn.execute_batch("ROLLBACK TO zeus_capture_migration");
    }
    conn.execute_batch("RELEASE zeus_capture_migration")
        .map_err(|e| e.to_string())?;
    result
}

/// Only simple host-created keys, beneath non-linked owned ancestors.
pub fn owned_file(root: &Path, key: &str) -> Result<PathBuf, String> {
    validate_key(key)?;
    validate_directory(root)?;
    let path = root.join(key);
    if crate::file_paths::is_reparse(&path) {
        return Err("BROWSER_IMAGE_PATH: missing or linked file".into());
    }
    Ok(path)
}
pub(crate) fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty()
        || key.len() > 80
        || !key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.' || b == b'_')
        || key.contains("..")
    {
        return Err("BROWSER_IMAGE_PATH: invalid storage key".into());
    }
    Ok(())
}
pub(crate) fn validate_directory(root: &Path) -> Result<(), String> {
    let mut part = Some(root);
    while let Some(path) = part {
        if crate::file_paths::is_reparse(path) {
            return Err("BROWSER_IMAGE_PATH: linked ancestor".into());
        }
        part = path.parent().filter(|p| !p.as_os_str().is_empty());
    }
    Ok(())
}
pub fn bounded_read(root: &Path, key: &str, limit: u64) -> Result<Vec<u8>, String> {
    let path = owned_file(root, key)?;
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > limit {
        return Err("BROWSER_IMAGE_LIMIT: oversized or non-file publication".into());
    }
    let mut data = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() as u64 > limit {
        return Err("BROWSER_IMAGE_LIMIT: publication grew while reading".into());
    }
    Ok(data)
}
pub fn validate_image(bytes: &[u8], frame: &Value) -> Result<(), String> {
    if bytes.len() as u64 > IMAGE_LIMIT
        || frame["bytes"].as_u64() != Some(bytes.len() as u64)
        || frame["sha256"] != format!("{:x}", Sha256::digest(bytes))
        || frame["mime"] != "image/jpeg"
    {
        return Err("BROWSER_IMAGE_INVALID: size/hash/type mismatch".into());
    }
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    if reader.format() != Some(ImageFormat::Jpeg) {
        return Err("BROWSER_IMAGE_INVALID: expected JPEG".into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(1280);
    limits.max_image_height = Some(720);
    limits.max_alloc = Some(8 * 1024 * 1024);
    reader.limits(limits);
    let decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let (width, height) = decoder.dimensions();
    if width == 0
        || height == 0
        || width > 1280
        || height > 720
        || frame["width"] != width
        || frame["height"] != height
    {
        return Err("BROWSER_IMAGE_INVALID: viewport mismatch".into());
    }
    image::DynamicImage::from_decoder(decoder)
        .map_err(|e| format!("BROWSER_IMAGE_INVALID: {e}"))?;
    Ok(())
}
pub fn session_dir(task: &str, session: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(task).map_err(|_| "BROWSER_OWNERSHIP: invalid task")?;
    uuid::Uuid::parse_str(session).map_err(|_| "BROWSER_OWNERSHIP: invalid session")?;
    Ok(crate::utils::workspace_root()?
        .join("browser-runtime/sessions")
        .join(session))
}
pub fn snapshot(conn: &Connection, task: &str, session: &str) -> Result<Value, String> {
    let info = store::session(conn, task, session)?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT payload FROM managed_browser_capture_state WHERE session_id=?1",
            [session],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let capture = raw
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .unwrap_or(json!({"revision":0,"state":"waiting","frame":null}));
    let mut stmt=conn.prepare("SELECT reason,first_ms,last_ms,occurrences FROM managed_browser_coverage WHERE session_id=?1 ORDER BY first_ms LIMIT 50").map_err(|e|e.to_string())?;
    let gaps=stmt.query_map([session],|r|Ok(json!({"reason":r.get::<_,String>(0)?,"first_ms":r.get::<_,i64>(1)?,"last_ms":r.get::<_,i64>(2)?,"occurrences":r.get::<_,i64>(3)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    let retained:Option<(String,String)>=conn.query_row("SELECT id,metadata FROM managed_browser_frames WHERE session_id=?1 AND status='available' ORDER BY created_ms DESC,id DESC LIMIT 1",[session],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
    let retained = retained.and_then(|(id, raw)| {
        serde_json::from_str::<Value>(&raw).ok().map(|mut value| {
            value["id"] = json!(id);
            value
        })
    });
    Ok(
        json!({"session":info,"capture":capture,"coverage":gaps,"last_retained_frame":retained,"server_ms":now_ms()}),
    )
}
pub fn gap(conn: &Connection, session: &str, reason: &str) -> Result<(), String> {
    conn.execute("INSERT INTO managed_browser_coverage VALUES(?1,?2,?3,?3,1) ON CONFLICT(session_id,reason) DO UPDATE SET last_ms=excluded.last_ms,occurrences=occurrences+1",params![session,reason,now_ms()]).map_err(|e|e.to_string())?;
    Ok(())
}

/// Reserve the maximum bytes before a capture can write immutable evidence.
pub fn reserve(
    conn: &Connection,
    session: &str,
    action: Option<&str>,
    relation: &str,
) -> Result<Option<String>, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM managed_browser_frames WHERE session_id=?1",
            [session],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count >= 10000 {
        gap(conn, session, "archive_entry_limit")?;
        return Ok(None);
    }
    let (local,global):(i64,i64)=conn.query_row("SELECT COALESCE(SUM(CASE WHEN session_id=?1 THEN bytes ELSE 0 END),0),COALESCE(SUM(bytes),0) FROM managed_browser_frames WHERE status!='deleted'",[session],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;
    if local + IMAGE_LIMIT as i64 > SESSION_LIMIT || global + IMAGE_LIMIT as i64 > GLOBAL_LIMIT {
        gap(conn, session, "archive_quota")?;
        conn.execute("UPDATE managed_browser_capture_state SET payload=json_set(payload,'$.coverage_gap','archive_quota') WHERE session_id=?1",[session]).map_err(|e|e.to_string())?;
        return Ok(None);
    }
    let id = crate::db::new_id();
    conn.execute("INSERT INTO managed_browser_frames(id,session_id,action_id,relation,status,bytes,created_ms) VALUES(?1,?2,?3,?4,'reserved',?5,?6)",params![id,session,action,relation,IMAGE_LIMIT,now_ms()]).map_err(|e|e.to_string())?;
    Ok(Some(id))
}
pub fn unavailable(conn: &Connection, id: &str, error: &str) -> Result<(), String> {
    conn.execute("UPDATE managed_browser_frames SET status='unavailable',error=?2 WHERE id=?1 AND status='reserved'",params![id,error]).map_err(|e|e.to_string())?;
    Ok(())
}

pub fn register_boundary(
    db: &Mutex<Connection>,
    task: &str,
    session: &str,
    id: &str,
    metadata: &Value,
) -> Result<(), String> {
    let result = (|| -> Result<(), String> {
        if metadata["key"] != format!("{id}.jpg") {
            return Err("BROWSER_CAPTURE_UNAVAILABLE".into());
        }
        let folder = session_dir(task, session)?.join("frames");
        let bytes = bounded_read(&folder, &format!("{id}.jpg"), IMAGE_LIMIT)?;
        validate_image(&bytes, metadata)?;
        let conn = db.lock().map_err(|e| e.to_string())?;
        register(&conn, id, metadata)
    })();
    if let Err(error) = result {
        let conn = db.lock().map_err(|e| e.to_string())?;
        unavailable(&conn, id, &error)?;
        gap(&conn, session, "boundary_unavailable")?;
    }
    Ok(())
}
pub fn frame_folder(task: &str, session: &str, metadata: &Value) -> Result<PathBuf, String> {
    let directory = session_dir(task, session)?;
    if metadata["storage"] == "artifacts" {
        Ok(crate::utils::workspace_root()?
            .join("tasks")
            .join(task)
            .join("workspace/.zeus/managed-browser")
            .join(session)
            .join("artifacts"))
    } else {
        Ok(directory.join("frames"))
    }
}
pub fn register_explicit(
    db: &Mutex<Connection>,
    task: &str,
    session: &str,
    id: &str,
    metadata: &Value,
) -> Result<(), String> {
    let result = (|| -> Result<(), String> {
        let expected = format!(
            "{}.jpg",
            uuid::Uuid::parse_str(id)
                .map_err(|e| e.to_string())?
                .simple()
        );
        if metadata["key"] != expected {
            return Err("BROWSER_CAPTURE_UNAVAILABLE".into());
        }
        let mut metadata = metadata.clone();
        metadata["storage"] = json!("artifacts");
        let bytes = bounded_read(
            &frame_folder(task, session, &metadata)?,
            &expected,
            IMAGE_LIMIT,
        )?;
        validate_image(&bytes, &metadata)?;
        let conn = db.lock().map_err(|e| e.to_string())?;
        register(&conn, id, &metadata)
    })();
    if let Err(error) = result {
        let conn = db.lock().map_err(|e| e.to_string())?;
        unavailable(&conn, id, &error)?;
        gap(&conn, session, "explicit_image_unavailable")?;
    }
    Ok(())
}
pub fn register(conn: &Connection, id: &str, metadata: &Value) -> Result<(), String> {
    conn.execute("UPDATE managed_browser_frames SET status='available',bytes=?2,metadata=?3 WHERE id=?1 AND status='reserved'",params![id,metadata["bytes"].as_u64(),metadata.to_string()]).map_err(|e|e.to_string())?;
    Ok(())
}

pub struct Collector {
    pub session: String,
    task: String,
    run: String,
    mailbox: PathBuf,
    images: Mutex<VecDeque<(u64, Vec<u8>)>>,
    viewer_until: std::sync::atomic::AtomicI64,
    last_archive: Mutex<i64>,
    stop: CancellationToken,
}
impl Collector {
    pub fn new(
        task: &str,
        run: &str,
        session: &str,
        mailbox: PathBuf,
        stop: CancellationToken,
    ) -> Arc<Self> {
        Arc::new(Self {
            session: session.into(),
            task: task.into(),
            run: run.into(),
            mailbox,
            images: Mutex::new(VecDeque::new()),
            viewer_until: std::sync::atomic::AtomicI64::new(0),
            last_archive: Mutex::new(0),
            stop,
        })
    }
    fn accepting(&self, conn: &Connection) -> Result<bool, String> {
        if self.stop.is_cancelled() {
            return Ok(false);
        }
        conn.query_row("SELECT EXISTS(SELECT 1 FROM managed_browser_sessions WHERE id=?1 AND task_id=?2 AND status IN ('starting','active'))",params![self.session,self.task],|r|r.get::<_,bool>(0)).map_err(|e|e.to_string())
    }
    pub fn image(&self, seq: u64) -> Result<Vec<u8>, String> {
        self.images
            .lock()
            .map_err(|e| e.to_string())?
            .iter()
            .find(|(n, _)| *n == seq)
            .map(|(_, b)| b.clone())
            .ok_or("BROWSER_FRAME_EXPIRED: request the latest snapshot".into())
    }
    pub fn heartbeat(&self) {
        self.viewer_until
            .store(now_ms() + 5000, std::sync::atomic::Ordering::Relaxed);
    }
    fn publication(&self) -> Result<(Value, Option<Vec<u8>>), String> {
        let descriptor = bounded_read(&self.mailbox, "capture.json", 8192)?;
        let data: Value = serde_json::from_slice(&descriptor)
            .map_err(|_| "BROWSER_CAPTURE_INVALID: malformed descriptor")?;
        if data["protocol"] != 1
            || data["task_id"] != self.task
            || data["run_id"] != self.run
            || data["session_id"] != self.session
            || data["generation"] != 1
            || !data["revision"].as_u64().is_some_and(|n| n > 0)
            || !["live", "no_tab", "capture_error"].contains(&data["state"].as_str().unwrap_or(""))
        {
            return Err("BROWSER_CAPTURE_IDENTITY: publication does not match owner".into());
        }
        let seq = data["frame"]["seq"].as_u64().unwrap_or(0);
        if data["state"] == "live" && seq == 0 {
            return Err("BROWSER_CAPTURE_INVALID: missing frame sequence".into());
        }
        if !data["frame"].is_null() {
            let frame = &data["frame"];
            if !frame["url"].as_str().is_some_and(|s| s.len() <= 2048)
                || !frame["started_ms"].as_i64().is_some_and(|n| n > 0)
                || !frame["ended_ms"].as_i64().is_some_and(|n| {
                    n >= frame["started_ms"].as_i64().unwrap_or(i64::MAX) && n <= now_ms() + 60000
                })
            {
                return Err("BROWSER_CAPTURE_INVALID: invalid capture metadata".into());
            }
        }
        let known = self
            .images
            .lock()
            .map_err(|e| e.to_string())?
            .iter()
            .any(|(n, _)| *n == seq);
        let bytes = if seq > 0 && !known && data["state"] == "live" {
            let frame = &data["frame"];
            if !["slot-0.jpg", "slot-1.jpg"].contains(&frame["key"].as_str().unwrap_or(""))
                || !frame["tab_id"].as_str().is_some_and(|s| s.len() == 32)
                || frame["ended_ms"].as_i64() < frame["started_ms"].as_i64()
            {
                return Err("BROWSER_CAPTURE_INVALID: invalid frame reference".into());
            }
            let bytes = bounded_read(&self.mailbox, frame["key"].as_str().unwrap(), IMAGE_LIMIT)?;
            validate_image(&bytes, frame)?;
            // These owned bytes match the descriptor's hash and are immutable.
            // A newer descriptor does not invalidate this verified frame. Waiting
            // for a quiet mailbox here starves live viewers at higher frame rates.
            Some(bytes)
        } else {
            None
        };
        Ok((data, bytes))
    }
    fn tick(&self, db: &Mutex<Connection>) -> Result<Option<Value>, String> {
        if self.stop.is_cancelled() {
            return Ok(None);
        }
        let (mut data, bytes) = self.publication()?;
        let (previous, publication) = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            conn.query_row("SELECT revision,COALESCE(json_extract(payload,'$.publication_revision'),0) FROM managed_browser_capture_state WHERE session_id=?1",[&self.session],|r|Ok((r.get::<_,u64>(0)?,r.get::<_,u64>(1)?))).optional().map_err(|e|e.to_string())?.unwrap_or((0,0))
        };
        if data["revision"].as_u64().unwrap_or(0) <= publication {
            return Ok(None);
        }
        data["publication_revision"] = data["revision"].clone();
        data["revision"] = json!(previous + 1);
        if let Some(bytes) = bytes {
            let mut archive = self.last_archive.lock().map_err(|e| e.to_string())?;
            if now_ms() - *archive >= 10000 {
                let reservation = {
                    let conn = db.lock().map_err(|e| e.to_string())?;
                    if !self.accepting(&conn)? {
                        return Ok(None);
                    }
                    reserve(&conn, &self.session, None, "idle")?
                };
                if let Some(id) = reservation {
                    let key = format!("{id}.jpg");
                    let folder = self
                        .mailbox
                        .parent()
                        .ok_or("BROWSER_IMAGE_PATH")?
                        .join("frames");
                    // The owner creates this directory before service startup.
                    let outcome = (|| -> Result<(), String> {
                        validate_directory(&folder)?;
                        let mut file = std::fs::OpenOptions::new()
                            .write(true)
                            .create_new(true)
                            .open(folder.join(&key))
                            .map_err(|e| e.to_string())?;
                        file.write_all(&bytes).map_err(|e| e.to_string())?;
                        file.sync_all().map_err(|e| e.to_string())?;
                        let mut metadata = data["frame"].clone();
                        metadata["key"] = json!(key);
                        metadata["id"] = json!(id);
                        let conn = db.lock().map_err(|e| e.to_string())?;
                        if !self.accepting(&conn)? {
                            return Err("BROWSER_CAPTURE_CLOSED".into());
                        }
                        register(&conn, &id, &metadata)?;
                        Ok(())
                    })();
                    if let Err(error) = outcome {
                        let conn = db.lock().map_err(|e| e.to_string())?;
                        unavailable(&conn, &id, &error)?;
                    }
                    *archive = now_ms();
                } else {
                    data["coverage_gap"] = json!("archive_quota");
                }
            }
            let mut images = self.images.lock().map_err(|e| e.to_string())?;
            images.push_back((data["frame"]["seq"].as_u64().unwrap(), bytes));
            while images.len() > 2 {
                images.pop_front();
            }
        }
        {
            let conn = db.lock().map_err(|e| e.to_string())?;
            if !self.accepting(&conn)? {
                return Ok(None);
            }
            // Keep quota/deletion coverage even when a subsequent frame is valid.
            let old:Option<String>=conn.query_row("SELECT json_extract(payload,'$.coverage_gap') FROM managed_browser_capture_state WHERE session_id=?1",[&self.session],|r|r.get(0)).optional().map_err(|e|e.to_string())?.flatten();
            if let Some(gap) = old {
                data["coverage_gap"] = json!(gap);
            }
            conn.execute("INSERT INTO managed_browser_capture_state(session_id,revision,payload) VALUES(?1,?2,?3) ON CONFLICT(session_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload WHERE excluded.revision>managed_browser_capture_state.revision",params![self.session,data["revision"].as_u64(),data.to_string()]).map_err(|e|e.to_string())?;
        }
        Ok(Some(
            json!({"task_id":self.task,"run_id":self.run,"session_id":self.session,"generation":1,"revision":data["revision"]}),
        ))
    }
    fn report_error(&self, db: &Mutex<Connection>) -> Result<Option<Value>, String> {
        let conn = db.lock().map_err(|e| e.to_string())?;
        if !self.accepting(&conn)? {
            return Ok(None);
        }
        let previous: Option<(u64, String)> = conn
            .query_row(
                "SELECT revision,payload FROM managed_browser_capture_state WHERE session_id=?1",
                [&self.session],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let (revision, mut data) = previous
            .map(|(n, s)| (n, serde_json::from_str::<Value>(&s).unwrap_or(json!({}))))
            .unwrap_or((0, json!({"frame":null,"publication_revision":0})));
        if data["error"] == "BROWSER_CAPTURE_TRANSPORT" {
            return Ok(None);
        }
        data["state"] = json!("capture_error");
        data["error"] = json!("BROWSER_CAPTURE_TRANSPORT");
        data["revision"] = json!(revision + 1);
        conn.execute("INSERT INTO managed_browser_capture_state(session_id,revision,payload) VALUES(?1,?2,?3) ON CONFLICT(session_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",params![self.session,revision+1,data.to_string()]).map_err(|e|e.to_string())?;
        Ok(Some(
            json!({"task_id":self.task,"run_id":self.run,"session_id":self.session,"generation":1,"revision":revision+1}),
        ))
    }
    pub fn spawn(
        self: &Arc<Self>,
        db: Arc<Mutex<Connection>>,
        app: tauri::AppHandle,
        stop: CancellationToken,
    ) -> tokio::task::JoinHandle<()> {
        let owner = self.clone();
        tokio::spawn(async move {
            let mut timer = tokio::time::interval(Duration::from_millis(125));
            timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut last_until = None;
            loop {
                tokio::select! {_=stop.cancelled()=>break,_=timer.tick()=>{}}
                let capture = owner.clone();
                let conn = db.clone();
                let result = tokio::task::spawn_blocking(move || {
                    capture.tick(&conn).or_else(|_| capture.report_error(&conn))
                })
                .await;
                if let Ok(Ok(Some(event))) = result {
                    let _ = app.emit("managed-browser-capture", event);
                }
                let until = owner
                    .viewer_until
                    .load(std::sync::atomic::Ordering::Relaxed);
                if last_until != Some(until) {
                    let temporary = owner.mailbox.join("viewer.tmp");
                    if std::fs::write(&temporary, json!({"until_ms":until}).to_string()).is_ok()
                        && std::fs::rename(temporary, owner.mailbox.join("viewer.json")).is_ok()
                    {
                        last_until = Some(until);
                    }
                }
            }
        })
    }
}

#[tauri::command]
pub fn get_browser_capture(
    state: State<'_, AppState>,
    task_id: String,
    session_id: String,
) -> Result<Value, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    snapshot(&conn, &task_id, &session_id)
}
#[tauri::command]
pub fn heartbeat_browser_viewer(
    state: State<'_, AppState>,
    task_id: String,
    session_id: String,
) -> Result<(), String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        store::session(&conn, &task_id, &session_id)?;
    }
    if let Some(owner) = state.browser_manager.managed.capture(&session_id) {
        owner.heartbeat();
    }
    Ok(())
}
#[tauri::command]
pub fn read_browser_live_image(
    state: State<'_, AppState>,
    task_id: String,
    session_id: String,
    seq: u64,
) -> Result<tauri::ipc::Response, String> {
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        store::session(&conn, &task_id, &session_id)?;
    }
    let capture = state
        .browser_manager
        .managed
        .capture(&session_id)
        .ok_or("BROWSER_FRAME_EXPIRED: owner ended")?;
    Ok(tauri::ipc::Response::new(capture.image(seq)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        folder: PathBuf,
        db: Mutex<Connection>,
        owner: Arc<Collector>,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.folder);
        }
    }
    fn fixture() -> Fixture {
        let folder =
            std::env::temp_dir().join(format!("zeus-capture-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(folder.join("mailbox")).unwrap();
        std::fs::create_dir(folder.join("frames")).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO tasks(id,title,created_at,updated_at) VALUES('t','test','now','now')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO runs(id,request_id,task_id,status,started_at,updated_at) VALUES('r','req','t','running','now','now')",[]).unwrap();
        let session = store::ensure_session(&conn, "t", "r").unwrap();
        let owner = Collector::new(
            "t",
            "r",
            &session,
            folder.join("mailbox"),
            CancellationToken::new(),
        );
        Fixture {
            folder,
            db: Mutex::new(conn),
            owner,
        }
    }
    fn publication(f: &Fixture, seq: u64, color: u8) -> Value {
        let image = image::RgbImage::from_pixel(1280, 720, image::Rgb([color, 90, 160]));
        let mut bytes = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 60)
            .encode_image(&image)
            .unwrap();
        let key = format!("slot-{}.jpg", seq % 2);
        std::fs::write(f.folder.join("mailbox").join(&key), &bytes).unwrap();
        let frame = json!({"key":key,"seq":seq,"tab_id":"a".repeat(32),"tab_revision":1,"url":"https://fixture.invalid/","started_ms":now_ms()-10,"ended_ms":now_ms(),"width":1280,"height":720,"mime":"image/jpeg","bytes":bytes.len(),"sha256":format!("{:x}",Sha256::digest(bytes))});
        json!({"protocol":1,"task_id":"t","run_id":"r","session_id":f.owner.session,"generation":1,"revision":seq,"state":"live","frame":frame})
    }
    fn write(f: &Fixture, value: &Value) {
        std::fs::write(f.folder.join("mailbox/capture.json"), value.to_string()).unwrap();
    }
    #[test]
    fn publication_identity_hash_and_image_dimensions_are_validated() {
        let f = fixture();
        let good = publication(&f, 1, 20);
        write(&f, &good);
        assert!(f.owner.publication().unwrap().1.is_some());
        for field in ["task_id", "run_id", "session_id", "generation"] {
            let mut bad = good.clone();
            bad[field] = json!("foreign");
            write(&f, &bad);
            assert!(f.owner.publication().is_err());
        }
        let mut bad = good.clone();
        bad["frame"]["key"] = json!("../other.jpg");
        write(&f, &bad);
        assert!(f.owner.publication().is_err());
        let mut bad = good.clone();
        bad["frame"]["width"] = json!(20000);
        write(&f, &bad);
        assert!(f.owner.publication().is_err());
        let mut bad = good.clone();
        bad["frame"]["sha256"] = json!("changed");
        write(&f, &bad);
        assert!(f.owner.publication().is_err());
        std::fs::write(f.folder.join("mailbox/capture.json"), vec![b' '; 8193]).unwrap();
        assert!(f.owner.publication().is_err());
    }
    #[test]
    fn collector_persists_before_notification_and_keeps_only_two_exact_images() {
        let f = fixture();
        for seq in 1..=3 {
            let value = publication(&f, seq, seq as u8 * 50);
            write(&f, &value);
            assert!(f.owner.tick(&f.db).unwrap().is_some());
        }
        assert!(f.owner.image(1).is_err());
        assert!(f.owner.image(2).is_ok());
        assert!(f.owner.image(3).is_ok());
        assert!(f.owner.tick(&f.db).unwrap().is_none());
        let conn = f.db.lock().unwrap();
        let data = snapshot(&conn, "t", &f.owner.session).unwrap();
        assert_eq!(data["capture"]["frame"]["seq"], 3);
        assert!(snapshot(&conn, "foreign", &f.owner.session).is_err());
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM managed_browser_frames WHERE status='available'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
    #[test]
    fn capture_errors_preserve_last_good_pixels_and_recover_with_independent_versions() {
        let f = fixture();
        write(&f, &publication(&f, 1, 50));
        f.owner.tick(&f.db).unwrap();
        f.owner.report_error(&f.db).unwrap();
        assert!(f.owner.report_error(&f.db).unwrap().is_none());
        {
            let conn = f.db.lock().unwrap();
            let state = snapshot(&conn, "t", &f.owner.session).unwrap();
            assert_eq!(state["capture"]["state"], "capture_error");
            assert_eq!(state["capture"]["frame"]["seq"], 1);
        }
        write(&f, &publication(&f, 2, 180));
        f.owner.tick(&f.db).unwrap();
        let conn = f.db.lock().unwrap();
        let data = snapshot(&conn, "t", &f.owner.session).unwrap();
        assert_eq!(data["capture"]["revision"], 3);
        assert_eq!(data["capture"]["publication_revision"], 2);
        assert_eq!(data["capture"]["state"], "live");
    }
    #[test]
    fn quota_reservations_restart_and_repeat_migration_preserve_actions() {
        let f = fixture();
        let conn = f.db.lock().unwrap();
        let id = reserve(&conn, &f.owner.session, None, "idle")
            .unwrap()
            .unwrap();
        conn.execute(
            "UPDATE managed_browser_frames SET bytes=?2 WHERE id=?1",
            params![id, SESSION_LIMIT],
        )
        .unwrap();
        assert!(reserve(&conn, &f.owner.session, None, "idle")
            .unwrap()
            .is_none());
        init_schema(&conn).unwrap();
        crate::browser_store::recover(&conn).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT status FROM managed_browser_frames WHERE id=?1",
                [id],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "unavailable"
        );
        assert!(snapshot(&conn, "t", &f.owner.session).is_ok());
    }
    #[test]
    fn online_migration_backup_contains_committed_wal_and_is_not_repeated() {
        let root =
            std::env::temp_dir().join(format!("zeus-migration-test-{}", crate::db::new_id()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("zeus.db");
        let old = crate::db::init(&path).unwrap();
        old.execute_batch("DROP TABLE managed_browser_frames; DROP TABLE managed_browser_capture_state; DROP TABLE managed_browser_coverage; PRAGMA journal_mode=WAL;").unwrap();
        old.execute("INSERT INTO tasks(id,title,created_at,updated_at) VALUES('saved','Retain committed WAL','now','now')",[]).unwrap();
        let migrated = crate::db::init(&path).unwrap();
        let files = std::fs::read_dir(root.join("migration-backups"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect::<Vec<_>>();
        assert_eq!(files.len(), 1);
        let backup = Connection::open(&files[0]).unwrap();
        assert_eq!(
            backup
                .query_row("SELECT title FROM tasks WHERE id='saved'", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "Retain committed WAL"
        );
        drop(backup);
        drop(migrated);
        drop(old);
        drop(crate::db::init(&path).unwrap());
        assert_eq!(
            std::fs::read_dir(root.join("migration-backups"))
                .unwrap()
                .count(),
            1
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_capture_migration_rolls_back_all_new_tables() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE browser_visual_deliveries(id TEXT); INSERT INTO browser_visual_deliveries VALUES('preserved');").unwrap();
        assert!(init_schema(&conn).is_err());
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='managed_browser_capture_state'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT id FROM browser_visual_deliveries", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "preserved"
        );
    }
    #[test]
    fn late_collector_work_cannot_publish_after_stop_or_recreate_deleted_ownership() {
        let f = fixture();
        write(&f, &publication(&f, 1, 50));
        f.owner.tick(&f.db).unwrap();
        f.owner.stop.cancel();
        {
            let conn = f.db.lock().unwrap();
            conn.execute(
                "DELETE FROM managed_browser_sessions WHERE id=?1",
                [&f.owner.session],
            )
            .unwrap();
            conn.execute("DELETE FROM managed_browser_capture_state", [])
                .unwrap();
        }
        write(&f, &publication(&f, 2, 90));
        assert!(f.owner.tick(&f.db).unwrap().is_none());
        assert!(f.owner.report_error(&f.db).unwrap().is_none());
        assert_eq!(
            f.db.lock()
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM managed_browser_capture_state",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
    }
}
