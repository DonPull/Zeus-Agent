//! Durable, task-owned input files. Storage acceptance is separate from perception.
use crate::db::{new_id, now_iso};
use base64::prelude::*;
use image::{ImageDecoder, ImageFormat, ImageReader};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    io::Cursor,
    path::{Path, PathBuf},
};

pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_MESSAGE_BYTES: u64 = 30 * 1024 * 1024;
pub const MAX_IMAGES: usize = 8;
const MAX_PIXELS: u64 = 25_000_000;
#[derive(Clone, Debug, Serialize)]
pub struct Attachment {
    pub id: String,
    pub task_id: String,
    pub filename: String,
    pub storage_key: String,
    pub mime_type: String,
    pub byte_count: u64,
    pub sha256: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub created_at: String,
    pub status: String,
    pub last_delivery: Option<serde_json::Value>,
}
pub fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS attachments(
        id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),filename TEXT NOT NULL,
        storage_key TEXT NOT NULL UNIQUE,mime_type TEXT NOT NULL,byte_count INTEGER NOT NULL,
        sha256 TEXT NOT NULL,width INTEGER,height INTEGER,created_at TEXT NOT NULL,status TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS message_attachments(message_id TEXT NOT NULL REFERENCES messages(id),
            attachment_id TEXT NOT NULL REFERENCES attachments(id),ordinal INTEGER NOT NULL,
            PRIMARY KEY(message_id,ordinal),UNIQUE(message_id,attachment_id));
        CREATE TABLE IF NOT EXISTS attachment_deliveries(id TEXT PRIMARY KEY,attachment_id TEXT NOT NULL REFERENCES attachments(id),
            run_id TEXT NOT NULL,request_id TEXT,route_json TEXT NOT NULL,state TEXT NOT NULL,error TEXT,
            created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
        CREATE TABLE IF NOT EXISTS task_media_settings(task_id TEXT PRIMARY KEY REFERENCES tasks(id),image_delivery TEXT NOT NULL DEFAULT 'auto');")
        .map_err(|e|e.to_string())?;
    conn.execute("UPDATE attachment_deliveries SET state='interrupted',error='Runtime restarted before delivery completed',updated_at=?1 WHERE state='dispatched'",[now_iso()]).map_err(|e|e.to_string())?;
    Ok(())
}
pub fn mode(conn: &Connection, task: &str) -> Result<String, String> {
    Ok(conn
        .query_row(
            "SELECT image_delivery FROM task_media_settings WHERE task_id=?1",
            [task],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "auto".into()))
}
pub fn set_mode(conn: &Connection, task: &str, value: &str) -> Result<(), String> {
    if !["auto", "helper"].contains(&value) {
        return Err("ATTACHMENT_MODE: expected auto or helper".into());
    }
    conn.execute("INSERT INTO task_media_settings(task_id,image_delivery) VALUES(?1,?2) ON CONFLICT(task_id) DO UPDATE SET image_delivery=excluded.image_delivery",params![task,value]).map_err(|e|e.to_string())?;
    Ok(())
}
fn row(row: &rusqlite::Row) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        id: row.get(0)?,
        task_id: row.get(1)?,
        filename: row.get(2)?,
        storage_key: row.get(3)?,
        mime_type: row.get(4)?,
        byte_count: row.get(5)?,
        sha256: row.get(6)?,
        width: row.get(7)?,
        height: row.get(8)?,
        created_at: row.get(9)?,
        status: row.get(10)?,
        last_delivery: None,
    })
}
const COLUMNS: &str =
    "id,task_id,filename,storage_key,mime_type,byte_count,sha256,width,height,created_at,status";
pub fn get(conn: &Connection, task: &str, id: &str) -> Result<Attachment, String> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM attachments WHERE id=?1 AND task_id=?2"),
        params![id, task],
        row,
    )
    .map_err(|_| "ATTACHMENT_OWNERSHIP: attachment is unavailable in this task".into())
}
pub fn for_message(conn: &Connection, message: &str) -> Result<Vec<Attachment>, String> {
    let mut stmt=conn.prepare(&format!("SELECT {} FROM attachments a JOIN message_attachments ma ON a.id=ma.attachment_id WHERE ma.message_id=?1 ORDER BY ma.ordinal",COLUMNS.split(',').map(|name|format!("a.{name}")).collect::<Vec<_>>().join(","))).map_err(|e|e.to_string())?;
    let mut files = stmt
        .query_map([message], row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for file in &mut files {
        file.last_delivery=conn.query_row("SELECT state,error,route_json,request_id FROM attachment_deliveries WHERE attachment_id=?1 ORDER BY rowid DESC LIMIT 1",[&file.id],|row|Ok(serde_json::json!({"state":row.get::<_,String>(0)?,"error":row.get::<_,Option<String>>(1)?,"route":row.get::<_,String>(2)?,"request_id":row.get::<_,Option<String>>(3)?}))).optional().map_err(|e|e.to_string())?;
    }
    Ok(files)
}
pub fn validate_selection(
    conn: &Connection,
    task: &str,
    ids: &[String],
) -> Result<Vec<Attachment>, String> {
    if ids.len() > MAX_IMAGES {
        return Err("ATTACHMENT_QUOTA: at most eight attachments per message".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut bytes = 0;
    let mut files = vec![];
    for id in ids {
        if !seen.insert(id) {
            return Err("ATTACHMENT_DUPLICATE: repeated attachment ID".into());
        }
        let file = get(conn, task, id)?;
        if file.status != "ready" {
            return Err("ATTACHMENT_NOT_READY: upload must finish before sending".into());
        }
        bytes += file.byte_count;
        if bytes > MAX_MESSAGE_BYTES {
            return Err("ATTACHMENT_QUOTA: message attachments exceed 30 MiB".into());
        }
        let _ = read_verified(conn, &file)?;
        files.push(file);
    }
    Ok(files)
}
pub fn link(conn: &Connection, message: &str, files: &[Attachment]) -> Result<(), String> {
    for (ordinal, file) in files.iter().enumerate() {
        conn.execute(
            "INSERT INTO message_attachments(message_id,attachment_id,ordinal) VALUES(?1,?2,?3)",
            params![message, file.id, ordinal as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn decode_image(bytes: &[u8]) -> Result<(String, u32, u32), String> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("ATTACHMENT_QUOTA: image exceeds 10 MiB".into());
    }
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("ATTACHMENT_MEDIA: {e}"))?;
    let format = reader
        .format()
        .ok_or("ATTACHMENT_MEDIA: unrecognized image bytes")?;
    let mime = match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::WebP => "image/webp",
        _ => {
            return Err(
                "ATTACHMENT_FORMAT: only static PNG, JPEG and WebP images are supported".into(),
            )
        }
    };
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(25000);
    limits.max_image_height = Some(25000);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let decoder = reader
        .into_decoder()
        .map_err(|e| format!("ATTACHMENT_MEDIA: invalid image: {e}"))?;
    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("ATTACHMENT_QUOTA: image exceeds 25 million pixels".into());
    }
    // Decode fully, not just its signature/dimensions. Reject animations first.
    match format {
        ImageFormat::Png => {
            let d = image::codecs::png::PngDecoder::new(Cursor::new(bytes))
                .map_err(|e| e.to_string())?;
            if d.is_apng().map_err(|e| e.to_string())? {
                return Err("ATTACHMENT_FORMAT: animated PNG is not supported".into());
            }
        }
        ImageFormat::WebP => {
            let d = image::codecs::webp::WebPDecoder::new(Cursor::new(bytes))
                .map_err(|e| e.to_string())?;
            if d.has_animation() {
                return Err("ATTACHMENT_FORMAT: animated WebP is not supported".into());
            }
        }
        _ => {}
    }
    let _ = image::DynamicImage::from_decoder(decoder)
        .map_err(|e| format!("ATTACHMENT_MEDIA: invalid image pixels: {e}"))?;
    Ok((mime.into(), width, height))
}
fn explicit_deny(conn: &Connection, task: &str, path: &Path) -> Result<bool, String> {
    Ok(crate::gatekeeper::evaluate_file_permission(conn,task,&path.to_string_lossy(),"read")?
        ==crate::gatekeeper::PermissionVerdict::Deny)
}
fn checked_path(file: &Attachment) -> Result<PathBuf, String> {
    let workspace = crate::utils::task_workspace(&file.task_id)?;
    let relative = Path::new(&file.storage_key);
    if !relative.starts_with(Path::new("attachments").join(&file.id)) {
        return Err("ATTACHMENT_PATH: storage identity does not match attachment ID".into());
    }
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err("ATTACHMENT_PATH: invalid storage key".into());
    }
    let mut path = workspace.clone();
    if std::fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("ATTACHMENT_PATH: workspace is a link".into());
    }
    for part in relative.components() {
        path.push(part);
        let meta = std::fs::symlink_metadata(&path)
            .map_err(|_| "ATTACHMENT_MISSING: stored bytes are unavailable".to_string())?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err("ATTACHMENT_PATH: reparse points are not accepted".into());
            }
        }
        if meta.file_type().is_symlink() {
            return Err("ATTACHMENT_PATH: links are not accepted".into());
        }
    }
    let full = path.canonicalize().map_err(|e| e.to_string())?;
    if !full.starts_with(workspace.canonicalize().map_err(|e| e.to_string())?) {
        return Err("ATTACHMENT_PATH: escaped task storage".into());
    }
    Ok(full)
}
pub fn read_verified(conn: &Connection, file: &Attachment) -> Result<Vec<u8>, String> {
    let path = checked_path(file)?;
    if explicit_deny(conn, &file.task_id, &path)? {
        return Err("ATTACHMENT_DENIED: an explicit read denial covers this input".into());
    }
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file()
        || metadata.len() != file.byte_count
        || metadata.len() > MAX_MESSAGE_BYTES
    {
        return Err("ATTACHMENT_CHANGED: stored file size changed".into());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if format!("{:x}", Sha256::digest(&bytes)) != file.sha256 {
        return Err("ATTACHMENT_CHANGED: stored image no longer matches the accepted input".into());
    }
    Ok(bytes)
}
pub fn image_inputs(
    conn: &Connection,
    files: &[Attachment],
) -> Result<Vec<crate::gateway::ImageInput>, String> {
    files
        .iter()
        .filter(|file| file.mime_type.starts_with("image/"))
        .map(|file| {
            Ok(crate::gateway::ImageInput {
                attachment_id: file.id.clone(),
                data_url: format!(
                    "data:{};base64,{}",
                    file.mime_type,
                    BASE64_STANDARD.encode(read_verified(conn, file)?)
                ),
            })
        })
        .collect()
}
pub fn save(
    conn: &Connection,
    task: &str,
    filename: &str,
    data: &str,
) -> Result<Attachment, String> {
    let exists = conn
        .query_row("SELECT 1 FROM tasks WHERE id=?1", [task], |_| Ok(()))
        .optional()
        .map_err(|e| e.to_string())?
        .is_some();
    if !exists {
        return Err("ATTACHMENT_OWNERSHIP: task does not exist".into());
    }
    if data.len() > ((MAX_MESSAGE_BYTES as usize) * 4 / 3 + 1024) {
        return Err("ATTACHMENT_QUOTA: encoded file exceeds upload limit".into());
    }
    let (header, encoded) = data
        .split_once(',')
        .map(|(header, body)| (header, body))
        .unwrap_or(("", data));
    let bytes = BASE64_STANDARD
        .decode(encoded.trim())
        .map_err(|_| "ATTACHMENT_ENCODING: invalid base64".to_string())?;
    if bytes.len() as u64 > MAX_MESSAGE_BYTES {
        return Err("ATTACHMENT_QUOTA: file exceeds 30 MiB".into());
    }
    let image_extension = Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| {
            [
                "png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "heic", "svg",
            ]
            .contains(&ext.to_lowercase().as_str())
        });
    let is_image =
        image_extension || header.starts_with("data:image/") || image::guess_format(&bytes).is_ok();
    let (mime, width, height) = if is_image {
        let (mime, w, h) = decode_image(&bytes)?;
        (mime, Some(w), Some(h))
    } else {
        ("application/octet-stream".into(), None, None)
    };
    let name = filename
        .rsplit(['/', '\\'])
        .next()
        .filter(|value| !value.is_empty() && *value != "." && *value != "..")
        .unwrap_or("attachment.bin");
    let name: String = name
        .chars()
        .take(180)
        .map(|ch| {
            if ch.is_control() || "<>:\"|?*".contains(ch) {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let id = new_id();
    let storage_key = format!("attachments/{id}/{name}");
    let workspace = crate::utils::task_workspace(task)?;
    let parent = workspace.join("attachments");
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        for path in [&workspace, &parent] {
            if std::fs::symlink_metadata(path)
                .map_err(|e| e.to_string())?
                .file_attributes()
                & 0x400
                != 0
            {
                return Err("ATTACHMENT_PATH: upload directory is a reparse point".into());
            }
        }
    }
    if std::fs::symlink_metadata(&parent)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
        || !parent
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(workspace.canonicalize().map_err(|e| e.to_string())?)
    {
        return Err("ATTACHMENT_PATH: invalid upload directory".into());
    }
    let dir = parent.join(&id);
    std::fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let destination = dir.join(&name);
    let temporary = dir.join("upload.pending");
    std::fs::write(&temporary, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
    let file = Attachment {
        id,
        task_id: task.into(),
        filename: name,
        storage_key,
        mime_type: mime,
        byte_count: bytes.len() as u64,
        sha256: format!("{:x}", Sha256::digest(&bytes)),
        width,
        height,
        created_at: now_iso(),
        status: "ready".into(),
        last_delivery: None,
    };
    let result = conn.execute(
        "INSERT INTO attachments VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            file.id,
            file.task_id,
            file.filename,
            file.storage_key,
            file.mime_type,
            file.byte_count,
            file.sha256,
            file.width,
            file.height,
            file.created_at,
            file.status
        ],
    );
    if let Err(error) = result {
        let _ = std::fs::remove_file(&destination);
        let _ = std::fs::remove_dir(&dir);
        return Err(error.to_string());
    }
    Ok(file)
}
pub fn start_delivery(
    conn: &Connection,
    run: &str,
    files: &[Attachment],
    binding: &crate::model_routes::ModelRef,
) -> Result<Vec<String>, String> {
    let mut ids = vec![];
    for file in files
        .iter()
        .filter(|file| file.mime_type.starts_with("image/"))
    {
        let id = new_id();
        conn.execute("INSERT INTO attachment_deliveries(id,attachment_id,run_id,route_json,state,created_at,updated_at) VALUES(?1,?2,?3,?4,'dispatched',?5,?5)",params![id,file.id,run,serde_json::to_string(binding).map_err(|e|e.to_string())?,now_iso()]).map_err(|e|e.to_string())?;
        ids.push(id);
    }
    Ok(ids)
}
pub fn finish_delivery(
    conn: &Connection,
    ids: &[String],
    request: Option<&str>,
    error: Option<&str>,
) -> Result<(), String> {
    for id in ids {
        conn.execute("UPDATE attachment_deliveries SET state=?1,request_id=?2,error=?3,updated_at=?4 WHERE id=?5 AND state='dispatched'",params![if error.is_some_and(|error|error.contains("RUN_CANCELLED")){"cancelled"}else if error.is_some(){"failed"}else{"succeeded"},request,error,now_iso(),id]).map_err(|e|e.to_string())?;
    }
    Ok(())
}
pub fn route(
    conn: &Connection,
    task: &str,
    files: &[Attachment],
) -> Result<Option<(crate::model_routes::ModelRef, bool)>, String> {
    if !files
        .iter()
        .any(|file| file.mime_type.starts_with("image/"))
    {
        return Ok(None);
    }
    let bindings = crate::model_routes::load(conn, task)?;
    let actor = bindings
        .get("master")
        .cloned()
        .map(crate::model_routes::ModelRef::resolved)
        .ok_or("ATTACHMENT_CAPABILITY: actor has no provider binding")?;
    if mode(conn, task)? == "auto" && actor.images() == "supported" {
        return Ok(Some((actor, false)));
    }
    let helper=bindings.get("vision").cloned().map(crate::model_routes::ModelRef::resolved).ok_or("ATTACHMENT_CAPABILITY: select a vision helper or declare the actor's image support in task settings")?;
    if helper.images() != "supported" {
        return Err("ATTACHMENT_CAPABILITY: helper image capability is unknown or unsupported; validate/declare it in task settings".into());
    }
    Ok(Some((helper, true)))
}
/// Bounded cleanup of unchanged, unsent input bytes after a seven-day grace period.
/// Never recursively deletes a directory or touches linked conversation inputs.
pub fn cleanup_orphans(conn: &Connection) -> Result<usize, String> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(7)).to_rfc3339();
    let mut stmt=conn.prepare(&format!("SELECT {COLUMNS} FROM attachments a WHERE created_at<?1 AND NOT EXISTS(SELECT 1 FROM message_attachments m WHERE m.attachment_id=a.id) AND NOT EXISTS(SELECT 1 FROM attachment_deliveries d WHERE d.attachment_id=a.id) ORDER BY created_at LIMIT 2")).map_err(|e|e.to_string())?;
    let files = stmt
        .query_map([cutoff], row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut count = 0;
    for file in files {
        if read_verified(conn, &file).is_err() {
            continue;
        }
        let path = checked_path(&file)?;
        if std::fs::remove_file(&path).is_ok() {
            let _ = std::fs::remove_dir(path.parent().unwrap());
            conn.execute("DELETE FROM attachments WHERE id=?1", [&file.id])
                .map_err(|e| e.to_string())?;
            count += 1;
        }
    }
    Ok(count)
}
#[tauri::command]
pub fn get_attachment_preview(
    state: tauri::State<crate::db::AppState>,
    task_id: String,
    attachment_id: String,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let file = get(&conn, &task_id, &attachment_id)?;
    if !file.mime_type.starts_with("image/") {
        return Err("ATTACHMENT_FORMAT: no image preview for this file".into());
    }
    let bytes = read_verified(&conn, &file)?;
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|e| e.to_string())?
        .thumbnail(320, 240);
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        BASE64_STANDARD.encode(output.into_inner())
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn png() -> Vec<u8> {
        let mut out = Cursor::new(vec![]);
        image::DynamicImage::new_rgb8(2, 3)
            .write_to(&mut out, ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }
    #[test]
    fn actual_media_type_and_pixels_are_validated() {
        assert_eq!(decode_image(&png()).unwrap(), ("image/png".into(), 2, 3));
        for format in [ImageFormat::Jpeg, ImageFormat::WebP] {
            let mut bytes = Cursor::new(vec![]);
            image::DynamicImage::new_rgb8(2, 3)
                .write_to(&mut bytes, format)
                .unwrap();
            assert_eq!(decode_image(&bytes.into_inner()).unwrap().1, 2);
        }
    }
    #[test]
    fn fake_truncated_and_oversized_images_fail() {
        assert!(decode_image(b"not an image").is_err());
        let bytes = png();
        assert!(decode_image(&bytes[..bytes.len() / 2]).is_err());
        assert!(decode_image(&vec![0; MAX_IMAGE_BYTES + 1])
            .unwrap_err()
            .contains("QUOTA"));
    }
    #[test]
    fn dimension_bomb_is_rejected_before_pixel_decode() {
        let mut bytes = png();
        bytes[16..20].copy_from_slice(&7000u32.to_be_bytes());
        bytes[20..24].copy_from_slice(&4000u32.to_be_bytes());
        let mut crc = 0xffff_ffffu32;
        for byte in &bytes[12..29] {
            crc ^= *byte as u32;
            for _ in 0..8 {
                crc = if crc & 1 == 1 {
                    (crc >> 1) ^ 0xedb8_8320
                } else {
                    crc >> 1
                };
            }
        }
        bytes[29..33].copy_from_slice(&(!crc).to_be_bytes());
        assert!(decode_image(&bytes).unwrap_err().contains("25 million"));
    }
    #[test]
    fn delivery_state_survives_success_and_marks_orphans_interrupted() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO tasks(id,title,created_at,updated_at) VALUES('t','t','now','now')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO attachments VALUES('a','t','a.png','attachments/a/a.png','image/png',1,'hash',1,1,'now','ready')",[]).unwrap();
        let file = get(&conn, "t", "a").unwrap();
        assert!(get(&conn, "other", "a").is_err());
        let binding = crate::model_routes::ModelRef::new("abacus", "gpt-5-nano", "explicit");
        let first = start_delivery(&conn, "run", &[file.clone()], &binding).unwrap();
        finish_delivery(&conn, &first, Some("request"), None).unwrap();
        let second = start_delivery(&conn, "run", &[file], &binding).unwrap();
        init_schema(&conn).unwrap();
        let state = |id: &str| {
            conn.query_row(
                "SELECT state FROM attachment_deliveries WHERE id=?1",
                [id],
                |row| row.get::<_, String>(0),
            )
            .unwrap()
        };
        assert_eq!(state(&first[0]), "succeeded");
        assert_eq!(state(&second[0]), "interrupted");
        finish_delivery(&conn, &second, None, None).unwrap();
        assert_eq!(state(&second[0]), "interrupted");
    }

    #[test]
    fn reopening_database_preserves_ordered_links_routes_and_delivery_history() {
        let path = std::env::temp_dir().join(format!("zeus-attachment-restart-{}.db", new_id()));
        {
            let conn = crate::db::init(&path).unwrap();
            conn.execute("INSERT INTO tasks(id,title,created_at,updated_at) VALUES('t','t','now','now')", []).unwrap();
            conn.execute("INSERT INTO messages(id,task_id,role,content,created_at) VALUES('m','t','user','Images','now')", []).unwrap();
            for id in ["a", "b"] {
                conn.execute("INSERT INTO attachments VALUES(?1,'t','same.png',?2,'image/png',42,?1,2,3,'now','ready')",
                    params![id,format!("attachments/{id}/same.png")]).unwrap();
            }
            let files = vec![get(&conn,"t","b").unwrap(),get(&conn,"t","a").unwrap()];
            link(&conn,"m",&files).unwrap();
            let binding = crate::model_routes::ModelRef::new("abacus","gemini-2.5-flash","explicit");
            crate::model_routes::save(&conn,"t","master",&binding).unwrap();
            set_mode(&conn,"t","helper").unwrap();
            let completed = start_delivery(&conn,"old-run",&files,&binding).unwrap();
            finish_delivery(&conn,&completed,Some("old-request"),None).unwrap();
            start_delivery(&conn,"unfinished-run",&files[..1],&binding).unwrap();
        }
        {
            let conn = crate::db::init(&path).unwrap();
            let files = for_message(&conn,"m").unwrap();
            assert_eq!(files.iter().map(|file|file.id.as_str()).collect::<Vec<_>>(),vec!["b","a"]);
            assert_eq!(files[0].width,Some(2));
            assert_eq!(files[0].last_delivery.as_ref().unwrap()["state"],"interrupted");
            assert_eq!(files[1].last_delivery.as_ref().unwrap()["state"],"succeeded");
            assert_eq!(files[1].last_delivery.as_ref().unwrap()["request_id"],"old-request");
            assert_eq!(mode(&conn,"t").unwrap(),"helper");
            assert_eq!(crate::model_routes::load(&conn,"t").unwrap()["master"].connection,"abacus");
        }
        std::fs::remove_file(path).unwrap();
    }
}
