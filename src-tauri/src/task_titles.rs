use rusqlite::{params, Connection};
pub const PREFIX: &str = "[[chat_title:";
pub const INSTRUCTION:&str="Name this new conversation with a short, useful 2–7 word title. On the FIRST line of your reply, emit [[chat_title: Your short title]] followed by a newline, then your normal answer or single zeus-directive. This is title metadata, not an additional directive. Do not copy/truncate the user's prompt or include a URL. No separate title tool call is needed.";
pub fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS task_title_state(task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE, mode TEXT NOT NULL CHECK(mode IN ('pending','generated','manual')))").map_err(|e|e.to_string())
}
pub fn prepare(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("INSERT OR IGNORE INTO task_title_state SELECT id,'pending' FROM tasks WHERE id=?1 AND title=?2",params![id,crate::chat::DEFAULT_TASK_TITLE]).map_err(|e|e.to_string())?;
    Ok(())
}
pub fn pending(conn: &Connection, id: &str) -> bool {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM task_title_state s JOIN tasks t ON t.id=s.task_id WHERE t.id=?1 AND s.mode='pending' AND t.title=?2)",params![id,crate::chat::DEFAULT_TASK_TITLE],|r|r.get(0)).unwrap_or(false)
}
pub fn proposal(text: &str) -> Option<(String, &str)> {
    let rest = text.trim_start().strip_prefix(PREFIX)?;
    let end = rest.find("]]")?;
    if end > 256 {
        return None;
    }
    let title = rest[..end].trim();
    if title.is_empty()
        || title.chars().count() > 64
        || title.chars().any(char::is_control)
        || title.contains(['[', ']'])
    {
        return None;
    }
    Some((
        title.into(),
        rest[end + 2..].trim_start_matches(['\r', '\n']),
    ))
}
pub fn visible_partial(text: &str) -> &str {
    let trimmed = text.trim_start();
    if PREFIX.starts_with(trimmed) || (trimmed.starts_with(PREFIX) && !trimmed.contains("]]")) {
        return "";
    }
    proposal(text).map(|(_, body)| body).unwrap_or(text)
}
pub fn apply(conn: &Connection, id: &str, title: &str) -> Result<bool, String> {
    conn.execute_batch("SAVEPOINT title_change")
        .map_err(|e| e.to_string())?;
    let result = (|| {
        let changed=conn.execute("UPDATE tasks SET title=?1,updated_at=?2 WHERE id=?3 AND title=?4 AND EXISTS(SELECT 1 FROM task_title_state WHERE task_id=?3 AND mode='pending')",params![title,crate::db::now_iso(),id,crate::chat::DEFAULT_TASK_TITLE]).map_err(|e|e.to_string())?;
        if changed == 1 {
            conn.execute(
                "UPDATE task_title_state SET mode='generated' WHERE task_id=?1",
                [id],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(changed == 1)
    })();
    if result.is_err() {
        let _ = conn.execute_batch("ROLLBACK TO title_change");
    }
    conn.execute_batch("RELEASE title_change")
        .map_err(|e| e.to_string())?;
    result
}
pub fn manual(conn: &Connection, id: &str, title: &str) -> Result<(), String> {
    conn.execute_batch("SAVEPOINT manual_title")
        .map_err(|e| e.to_string())?;
    let result = (|| {
        conn.execute(
            "UPDATE tasks SET title=?1,updated_at=?2 WHERE id=?3",
            params![title, crate::db::now_iso(), id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO task_title_state VALUES(?1,'manual') ON CONFLICT(task_id) DO UPDATE SET mode='manual'",[id]).map_err(|e|e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = conn.execute_batch("ROLLBACK TO manual_title");
    }
    conn.execute_batch("RELEASE manual_title")
        .map_err(|e| e.to_string())?;
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn title_metadata_is_bounded_and_manual_rename_wins() {
        assert_eq!(
            proposal("[[chat_title: Library cleanup]]\nDone.").unwrap(),
            ("Library cleanup".into(), "Done.")
        );
        assert_eq!(visible_partial("[[chat_t"), "");
        assert!(proposal("[[chat_title: bad\nname]]").is_none());
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        let id = crate::db::new_id();
        conn.execute(
            "INSERT INTO tasks(id,title,created_at,updated_at) VALUES(?1,?2,'now','now')",
            params![id, crate::chat::DEFAULT_TASK_TITLE],
        )
        .unwrap();
        prepare(&conn, &id).unwrap();
        assert!(pending(&conn, &id));
        manual(&conn, &id, "My chosen name").unwrap();
        assert!(!apply(&conn, &id, "Automatic name").unwrap());
        assert_eq!(
            conn.query_row("SELECT title FROM tasks WHERE id=?1", [id], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "My chosen name"
        );
        assert!(proposal(&format!("[[chat_title: {}]]", "x".repeat(65))).is_none());
        assert_eq!(
            visible_partial("[[chat_title: Library cleanup]]\nDone."),
            "Done."
        );
        // Schema initialization and prepare are repeatable; one accepted title
        // cannot be replaced by a later model response.
        crate::db::init_schema(&conn).unwrap();
        let fresh = crate::db::new_id();
        conn.execute(
            "INSERT INTO tasks(id,title,created_at,updated_at) VALUES(?1,?2,'now','now')",
            params![fresh, crate::chat::DEFAULT_TASK_TITLE],
        )
        .unwrap();
        prepare(&conn, &fresh).unwrap();
        prepare(&conn, &fresh).unwrap();
        assert!(apply(&conn, &fresh, "Garden planning").unwrap());
        assert!(!pending(&conn, &fresh));
        assert!(!apply(&conn, &fresh, "Another title").unwrap());
    }
}
