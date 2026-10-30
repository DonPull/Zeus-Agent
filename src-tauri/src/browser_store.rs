//! SQLite is the browser lifecycle journal. No browser/process I/O lives here.
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

pub fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("
    CREATE TABLE IF NOT EXISTS managed_browser_sessions(
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, generation INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL, runtime_json TEXT, terminal_reason TEXT, version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(task_id,run_id));
    CREATE TABLE IF NOT EXISTS managed_browser_actions(
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES managed_browser_sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL, caller TEXT NOT NULL, request_hash TEXT NOT NULL,
      op TEXT NOT NULL, arguments TEXT NOT NULL, status TEXT NOT NULL, authorization TEXT,
      response TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(session_id,seq));
    CREATE TABLE IF NOT EXISTS managed_browser_tabs(
      session_id TEXT NOT NULL REFERENCES managed_browser_sessions(id) ON DELETE CASCADE,
      tab_id TEXT NOT NULL, url TEXT NOT NULL, revision INTEGER NOT NULL, selected INTEGER NOT NULL,
      PRIMARY KEY(session_id,tab_id));
    CREATE TABLE IF NOT EXISTS managed_browser_artifacts(
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES managed_browser_sessions(id) ON DELETE CASCADE,
      action_id TEXT NOT NULL REFERENCES managed_browser_actions(id) ON DELETE CASCADE,
      storage_key TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, mime TEXT NOT NULL);
    ").map_err(|e|format!("BROWSER_DB: {e}"))?;
    let version_column:i64=conn.query_row("SELECT COUNT(*) FROM pragma_table_info('managed_browser_sessions') WHERE name='version'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
    if version_column == 0 {
        conn.execute(
            "ALTER TABLE managed_browser_sessions ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn recover(conn: &Connection) -> Result<(), String> {
    let now = crate::db::now_iso();
    conn.execute("UPDATE managed_browser_actions SET status=CASE WHEN status='dispatched' THEN 'uncertain' ELSE 'cancelled' END,updated_at=?1 WHERE status IN ('pending','awaiting_approval','dispatched')",[&now]).map_err(|e|e.to_string())?;
    conn.execute("UPDATE managed_browser_sessions SET status='interrupted',terminal_reason='Application restarted; external effects require reconciliation',updated_at=?1,version=version+1 WHERE status IN ('starting','active','finalizing')",[now]).map_err(|e|e.to_string())?;
    let recovered = {
        let mut stmt = conn
            .prepare("SELECT id,task_id FROM managed_browser_sessions WHERE status='interrupted'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    for (id, task) in recovered {
        let mut message = crate::chat::new_message(
            &task,
            "event",
            "managed_browser_session",
            session(conn, &task, &id)?.to_string(),
            None,
            None,
            true,
        );
        message.id = format!("managed-browser-{id}");
        let changed = conn
            .execute(
                "UPDATE messages SET content=?2 WHERE id=?1",
                params![message.id, message.content],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            crate::chat::insert_message(conn, &mut message)?;
        }
    }
    Ok(())
}

pub fn assert_running(conn: &Connection, task: &str, run: &str) -> Result<(), String> {
    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM runs WHERE id=?1 AND task_id=?2",
            params![run, task],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if !status.is_some_and(|state| {
        matches!(
            state.as_str(),
            "running" | "waiting_for_approval" | "waiting_for_user"
        )
    }) {
        return Err("BROWSER_RUN_ENDED: no matching active root run".into());
    }
    Ok(())
}

pub fn ensure_session(conn: &Connection, task: &str, run: &str) -> Result<String, String> {
    assert_running(conn, task, run)?;
    if let Some((id, status)) = conn
        .query_row(
            "SELECT id,status FROM managed_browser_sessions WHERE task_id=?1 AND run_id=?2",
            params![task, run],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        if !matches!(status.as_str(), "starting" | "active") {
            return Err(
                "BROWSER_SESSION_ENDED: this run's browser cannot be restarted implicitly".into(),
            );
        }
        return Ok(id);
    }
    let id = crate::db::new_id();
    let now = crate::db::now_iso();
    conn.execute("INSERT INTO managed_browser_sessions(id,task_id,run_id,status,created_at,updated_at) VALUES(?1,?2,?3,'starting',?4,?4)",params![id,task,run,now]).map_err(|e|e.to_string())?;
    Ok(id)
}

pub fn session(conn: &Connection, task: &str, id: &str) -> Result<Value, String> {
    conn.query_row("SELECT run_id,generation,status,runtime_json,terminal_reason,created_at,updated_at,version FROM managed_browser_sessions WHERE id=?1 AND task_id=?2",params![id,task],|r|{
        let runtime:Option<String>=r.get(3)?;
        Ok(json!({"schema_version":1,"session_id":id,"task_id":task,"run_id":r.get::<_,String>(0)?,"generation":r.get::<_,i64>(1)?,
          "status":r.get::<_,String>(2)?,"runtime":runtime.and_then(|s|serde_json::from_str::<Value>(&s).ok()),"terminal_reason":r.get::<_,Option<String>>(4)?,
          "created_at":r.get::<_,String>(5)?,"updated_at":r.get::<_,String>(6)?,"version":r.get::<_,i64>(7)?,"recording_coverage":"managed_actions","viewer_available":false}))
    }).map_err(|_|"BROWSER_OWNERSHIP: session does not belong to this task".into())
}

pub fn status(
    conn: &Connection,
    id: &str,
    state: &str,
    reason: Option<&str>,
    runtime: Option<&Value>,
) -> Result<(), String> {
    conn.execute("UPDATE managed_browser_sessions SET status=?2,terminal_reason=?3,runtime_json=COALESCE(?4,runtime_json),updated_at=?5,version=version+1 WHERE id=?1",params![id,state,reason,runtime.map(Value::to_string),crate::db::now_iso()]).map_err(|e|e.to_string())?;
    Ok(())
}

pub fn begin_action(
    conn: &Connection,
    session: &str,
    id: &str,
    caller: &str,
    op: &str,
    args: &Value,
    hash: &str,
) -> Result<Option<Value>, String> {
    if let Some((previous_hash,response,status))=conn.query_row("SELECT request_hash,response,status FROM managed_browser_actions WHERE id=?1 AND session_id=?2",params![id,session],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?))).optional().map_err(|e|e.to_string())?{
        if previous_hash!=hash{return Err("BROWSER_ID_REUSED: action ID refers to different arguments/caller".into());}
        return Ok(Some(response.and_then(|s|serde_json::from_str(&s).ok()).unwrap_or(json!({"ok":false,"error":{"code":"BROWSER_ACTION_UNRESOLVED","message":format!("Prior action is {status}; it will not be repeated")}}))));
    }
    let (count,bytes):(i64,i64)=conn.query_row("SELECT COUNT(*),COALESCE(SUM(length(response)+length(arguments)),0) FROM managed_browser_actions WHERE session_id=?1",[session],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;
    if count >= 5000 || bytes > 256 * 1024 * 1024 {
        return Err("BROWSER_JOURNAL_LIMIT: session storage allowance exhausted".into());
    }
    let seq: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(seq),0)+1 FROM managed_browser_actions WHERE session_id=?1",
            [session],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let now = crate::db::now_iso();
    conn.execute("INSERT INTO managed_browser_actions(id,session_id,seq,caller,request_hash,op,arguments,status,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'pending',?8,?8)",params![id,session,seq,caller,hash,op,args.to_string(),now]).map_err(|e|e.to_string())?;
    Ok(None)
}

pub fn action_state(
    conn: &Connection,
    id: &str,
    status: &str,
    authorization: Option<&str>,
    response: Option<&Value>,
) -> Result<(), String> {
    conn.execute("UPDATE managed_browser_actions SET status=?2,authorization=COALESCE(?3,authorization),response=COALESCE(?4,response),updated_at=?5 WHERE id=?1 AND status IN ('pending','awaiting_approval','dispatched')",params![id,status,authorization,response.map(Value::to_string),crate::db::now_iso()]).map_err(|e|e.to_string())?;
    Ok(())
}

pub fn tabs(conn: &Connection, session: &str, tabs: &Value) -> Result<(), String> {
    let Some(tabs) = tabs.as_array() else {
        return Ok(());
    };
    conn.execute(
        "DELETE FROM managed_browser_tabs WHERE session_id=?1",
        [session],
    )
    .map_err(|e| e.to_string())?;
    for tab in tabs.iter().take(32) {
        conn.execute("INSERT INTO managed_browser_tabs(session_id,tab_id,url,revision,selected) VALUES(?1,?2,?3,?4,?5)",params![session,tab["tab_id"].as_str().unwrap_or(""),tab["url"].as_str().unwrap_or(""),tab["revision"].as_i64().unwrap_or(0),tab["selected"].as_bool().unwrap_or(false)]).map_err(|e|e.to_string())?;
    }
    Ok(())
}

pub fn finish(
    conn: &Connection,
    session: &str,
    state: &str,
    reason: Option<&str>,
) -> Result<(), String> {
    let now = crate::db::now_iso();
    conn.execute("UPDATE managed_browser_actions SET status=CASE WHEN status='dispatched' THEN 'uncertain' ELSE 'cancelled' END,updated_at=?2 WHERE session_id=?1 AND status IN ('pending','awaiting_approval','dispatched')",params![session,now]).map_err(|e|e.to_string())?;
    let previous: String = conn
        .query_row(
            "SELECT status FROM managed_browser_sessions WHERE id=?1",
            [session],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if matches!(previous.as_str(), "failed" | "interrupted" | "cancelled") && state != "failed" {
        return Ok(());
    }
    status(conn, session, state, reason, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&c).unwrap();
        c.execute(
            "INSERT INTO tasks(id,title,created_at,updated_at) VALUES('t','test','now','now')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO runs(id,request_id,task_id,status,started_at,updated_at) VALUES('r','req','t','running','now','now')",[]).unwrap();
        c
    }
    #[test]
    fn session_identity_and_action_retries_do_not_duplicate_effects() {
        let c = fixture();
        let id = ensure_session(&c, "t", "r").unwrap();
        assert_eq!(ensure_session(&c, "t", "r").unwrap(), id);
        assert!(ensure_session(&c, "foreign", "r").is_err());
        assert!(
            begin_action(&c, &id, "a", "master", "click", &json!({}), "hash")
                .unwrap()
                .is_none()
        );
        assert_eq!(
            begin_action(&c, &id, "a", "master", "click", &json!({}), "hash")
                .unwrap()
                .unwrap()["ok"],
            false
        );
        let result = json!({"ok":true});
        action_state(&c, "a", "succeeded", Some("normal"), Some(&result)).unwrap();
        assert_eq!(
            begin_action(&c, &id, "a", "master", "click", &json!({}), "hash").unwrap(),
            Some(result)
        );
        assert!(begin_action(&c, &id, "a", "other", "click", &json!({}), "other-hash").is_err());
    }
    #[test]
    fn restart_and_finalization_keep_uncertainty_and_historical_rows() {
        let c = fixture();
        let id = ensure_session(&c, "t", "r").unwrap();
        begin_action(&c, &id, "dispatched", "master", "click", &json!({}), "h").unwrap();
        action_state(&c, "dispatched", "dispatched", None, None).unwrap();
        begin_action(&c, &id, "pending", "master", "click", &json!({}), "h2").unwrap();
        recover(&c).unwrap();
        assert_eq!(session(&c, "t", &id).unwrap()["status"], "interrupted");
        let card = crate::chat::load_message(&c, &format!("managed-browser-{id}")).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&card.content).unwrap()["status"],
            "interrupted"
        );
        assert!(ensure_session(&c, "t", "r").is_err());
        assert_eq!(
            c.query_row(
                "SELECT status FROM managed_browser_actions WHERE id='dispatched'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "uncertain"
        );
        assert_eq!(
            c.query_row(
                "SELECT status FROM managed_browser_actions WHERE id='pending'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "cancelled"
        );
        init_schema(&c).unwrap();
        assert!(session(&c, "t", &id).is_ok());
    }
    #[test]
    fn projection_version_migration_preserves_existing_sessions_and_advances_mechanically() {
        let c = fixture();
        let id = ensure_session(&c, "t", "r").unwrap();
        c.execute(
            "ALTER TABLE managed_browser_sessions DROP COLUMN version",
            [],
        )
        .unwrap();
        init_schema(&c).unwrap();
        assert_eq!(session(&c, "t", &id).unwrap()["version"], 1);
        status(&c, &id, "active", None, None).unwrap();
        assert_eq!(session(&c, "t", &id).unwrap()["version"], 2);
        recover(&c).unwrap();
        let snapshot = session(&c, "t", &id).unwrap();
        assert_eq!(snapshot["version"], 3);
        let card = crate::chat::load_message(&c, &format!("managed-browser-{id}")).unwrap();
        assert_eq!(card.projection_version, Some(3));
    }
}
