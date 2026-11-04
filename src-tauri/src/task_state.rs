//! Durable bookkeeping, not a natural-language goal verifier. Triggers journal
//! references in the transaction of the source change. The versioned UI message
//! is rebuildable; original plans, messages and execution journals remain.
use crate::chat::{insert_message, new_message, MessageDto};
use crate::db::AppState;
use crate::orchestrator::{ActionPlanStep, Directive};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

pub fn init_schema(conn: &Connection) -> Result<(), String> {
    let transaction = if conn.is_autocommit() {
        Some(conn.unchecked_transaction().map_err(|e| e.to_string())?)
    } else {
        None
    };
    conn.execute_batch(r#"
    CREATE TABLE IF NOT EXISTS task_checkpoints (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 0,
      user_input_revision INTEGER NOT NULL DEFAULT 0,
      last_user_message_id TEXT, run_id TEXT, run_status TEXT NOT NULL DEFAULT 'idle',
      plan_message_id TEXT, plan_input_revision INTEGER,
      updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_checkpoint_events (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id TEXT, kind TEXT NOT NULL, source_id TEXT NOT NULL,
      detail TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_checkpoint_events_task_run
      ON task_checkpoint_events(task_id,run_id,kind);
    CREATE INDEX IF NOT EXISTS idx_checkpoint_events_source
      ON task_checkpoint_events(task_id,kind,source_id);
    CREATE TABLE IF NOT EXISTS task_checkpoint_actions (
      id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      conversation TEXT NOT NULL, operation TEXT NOT NULL,
      status TEXT NOT NULL, result_message_id TEXT, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_checkpoint_actions_open
      ON task_checkpoint_actions(task_id,run_id,conversation,status);

    CREATE TRIGGER IF NOT EXISTS checkpoint_event AFTER INSERT ON task_checkpoint_events BEGIN
      INSERT OR IGNORE INTO task_checkpoints(task_id,updated_at) VALUES(NEW.task_id,NEW.created_at);
      UPDATE task_checkpoints SET revision=revision+1, updated_at=NEW.created_at,
        user_input_revision=user_input_revision+CASE WHEN NEW.kind='input_accepted' THEN 1 ELSE 0 END,
        last_user_message_id=CASE WHEN NEW.kind='input_accepted' THEN NEW.source_id ELSE last_user_message_id END,
        run_id=CASE WHEN NEW.kind='run_started' THEN NEW.run_id ELSE run_id END,
        run_status=CASE WHEN NEW.kind='run_started' OR (NEW.kind='run_state' AND run_id=NEW.run_id)
          THEN json_extract(NEW.detail,'$.status') ELSE run_status END,
        plan_message_id=CASE WHEN NEW.kind IN ('plan_accepted','plan_legacy') THEN NEW.source_id ELSE plan_message_id END,
        plan_input_revision=CASE WHEN NEW.kind IN ('plan_accepted','plan_legacy') THEN json_extract(NEW.detail,'$.base_input_revision') ELSE plan_input_revision END
      WHERE task_id=NEW.task_id;
    END;
    CREATE TRIGGER IF NOT EXISTS checkpoint_task AFTER INSERT ON tasks BEGIN
      INSERT OR IGNORE INTO task_checkpoints(task_id,updated_at) VALUES(NEW.id,NEW.created_at);
    END;
    CREATE TRIGGER IF NOT EXISTS checkpoint_run_start AFTER INSERT ON runs BEGIN
      INSERT OR IGNORE INTO task_checkpoint_events VALUES('run:'||NEW.id||':started',NEW.task_id,NEW.id,
        'run_started',NEW.id,json_object('status',NEW.status),NEW.started_at);
    END;
    CREATE TRIGGER IF NOT EXISTS checkpoint_run_state AFTER UPDATE OF status ON runs
    WHEN OLD.status IS NOT NEW.status BEGIN
      INSERT OR IGNORE INTO task_checkpoint_events VALUES('run:'||NEW.id||':'||NEW.status,NEW.task_id,NEW.id,
        'run_state',NEW.id,json_object('status',NEW.status),NEW.updated_at);
      UPDATE task_checkpoint_actions SET status='uncertain',updated_at=NEW.updated_at
        WHERE run_id=NEW.id AND status='attempted' AND NEW.status NOT IN ('running','stopping');
    END;
    CREATE TRIGGER IF NOT EXISTS checkpoint_human_input AFTER INSERT ON messages
    WHEN NEW.conversation='master' AND NEW.role='user' AND NEW.kind='chat' AND NEW.visible=1 BEGIN
      INSERT OR IGNORE INTO task_checkpoint_events VALUES('input:'||NEW.id,NEW.task_id,
        (SELECT run_id FROM task_checkpoints WHERE task_id=NEW.task_id),
        'input_accepted',NEW.id,'{}',NEW.created_at);
    END;
    CREATE TRIGGER IF NOT EXISTS checkpoint_plan AFTER INSERT ON messages
    WHEN NEW.kind='action_plan' AND NEW.conversation='master' AND
      json_extract(CASE WHEN json_valid(NEW.content) THEN NEW.content ELSE '{}' END,'$.proposal_state')='accepted' AND
      json_extract(NEW.content,'$.base_input_revision')=(SELECT user_input_revision FROM task_checkpoints WHERE task_id=NEW.task_id) AND
      json_extract(NEW.content,'$.source_run_id')=(SELECT run_id FROM task_checkpoints WHERE task_id=NEW.task_id) BEGIN
      INSERT OR IGNORE INTO task_checkpoint_events VALUES('plan:'||NEW.id,NEW.task_id,
        (SELECT run_id FROM task_checkpoints WHERE task_id=NEW.task_id),'plan_accepted',NEW.id,
        json_object('base_input_revision',json_extract(NEW.content,'$.base_input_revision')),NEW.created_at);
    END;
    CREATE TRIGGER IF NOT EXISTS checkpoint_legacy_plan AFTER INSERT ON messages
    WHEN NEW.kind='action_plan' AND NEW.conversation='master' AND
      json_extract(CASE WHEN json_valid(NEW.content) THEN NEW.content ELSE '{}' END,'$.proposal_state') IS NULL AND
      (SELECT plan_input_revision FROM task_checkpoints WHERE task_id=NEW.task_id) IS NULL BEGIN
      INSERT OR IGNORE INTO task_checkpoint_events VALUES('plan:'||NEW.id,NEW.task_id,
        (SELECT run_id FROM task_checkpoints WHERE task_id=NEW.task_id),'plan_legacy',NEW.id,'{}',NEW.created_at);
    END;
    CREATE TRIGGER IF NOT EXISTS checkpoint_action_start AFTER INSERT ON task_checkpoint_actions BEGIN
      INSERT OR IGNORE INTO task_checkpoint_events VALUES('action:'||NEW.id||':attempted',NEW.task_id,NEW.run_id,
        'action_attempted',NEW.id,json_object('operation',NEW.operation,'conversation',NEW.conversation),NEW.updated_at);
    END;
    CREATE TRIGGER IF NOT EXISTS checkpoint_action_state AFTER UPDATE OF status ON task_checkpoint_actions
    WHEN OLD.status IS NOT NEW.status BEGIN
      INSERT OR IGNORE INTO task_checkpoint_events VALUES('action:'||NEW.id||':'||NEW.status,NEW.task_id,NEW.run_id,
        'action_'||NEW.status,NEW.id,json_object('result_message_id',NEW.result_message_id),NEW.updated_at);
    END;
    CREATE TRIGGER IF NOT EXISTS checkpoint_action_result AFTER INSERT ON messages
    WHEN NEW.kind IN ('directive_result','handoff_result') AND NEW.role='user' BEGIN
      UPDATE task_checkpoint_actions SET status='returned',result_message_id=NEW.id,updated_at=NEW.created_at
      WHERE id=(SELECT id FROM task_checkpoint_actions WHERE task_id=NEW.task_id
        AND conversation=NEW.conversation AND status='attempted'
        AND run_id=(SELECT run_id FROM task_checkpoints WHERE task_id=NEW.task_id)
        ORDER BY rowid DESC LIMIT 1);
    END;
    "#).map_err(|e| format!("CHECKPOINT_DB: {e}"))?;

    // These records can change without inserting another chat message.
    for (suffix, transition) in [("insert", "INSERT"), ("update", "UPDATE OF content")] {
        let event_time = if suffix == "insert" {
            "NEW.created_at"
        } else {
            "strftime('%Y-%m-%dT%H:%M:%f+00:00','now')"
        };
        conn.execute_batch(&format!(r#"
        CREATE TRIGGER IF NOT EXISTS checkpoint_wait_{suffix} AFTER {transition} ON messages
        WHEN NEW.kind IN ('approval','handoff','choice') AND json_valid(NEW.content) BEGIN
          INSERT OR IGNORE INTO task_checkpoint_events VALUES(
            'wait:'||NEW.id||':'||COALESCE(json_extract(NEW.content,'$.status'),'unknown')||':'||COALESCE(json_extract(NEW.content,'$.phase'),''),
            NEW.task_id,COALESCE(json_extract(NEW.content,'$.root_run_id'),
              (SELECT run_id FROM task_checkpoint_events WHERE task_id=NEW.task_id AND kind='human_wait' AND source_id=NEW.id ORDER BY rowid LIMIT 1),
              (SELECT run_id FROM task_checkpoints WHERE task_id=NEW.task_id)),
            'human_wait',NEW.id,json_object('status',json_extract(NEW.content,'$.status'),'kind',NEW.kind,'phase',json_extract(NEW.content,'$.phase')),{event_time});
        END;
        "#)).map_err(|e| e.to_string())?;
    }
    for (suffix, transition, condition) in [
        ("insert", "INSERT", "1"),
        (
            "update",
            "UPDATE OF status,retry_count",
            "OLD.status IS NOT NEW.status OR OLD.retry_count IS NOT NEW.retry_count",
        ),
    ] {
        conn.execute_batch(&format!(r#"
        CREATE TRIGGER IF NOT EXISTS checkpoint_worker_{suffix} AFTER {transition} ON workers
        WHEN {condition} BEGIN
          INSERT OR IGNORE INTO task_checkpoint_events VALUES('worker:'||NEW.id||':'||NEW.status||':'||NEW.retry_count,
            NEW.task_id,(SELECT run_id FROM task_checkpoints WHERE task_id=NEW.task_id),'worker_state',NEW.id,
            json_object('status',NEW.status,'retry_count',NEW.retry_count),NEW.updated_at);
        END;
        "#)).map_err(|e| e.to_string())?;
    }

    // Existing plans are historical/model-authored; no invented verification
    // or assertion that an old plan incorporated the latest user input.
    conn.execute_batch(r#"
    INSERT OR IGNORE INTO task_checkpoints(task_id,user_input_revision,last_user_message_id,
      run_id,run_status,plan_message_id,updated_at)
    SELECT t.id,
      (SELECT COUNT(*) FROM messages WHERE task_id=t.id AND conversation='master' AND role='user' AND kind='chat' AND visible=1),
      (SELECT id FROM messages WHERE task_id=t.id AND conversation='master' AND role='user' AND kind='chat' AND visible=1 ORDER BY rowid DESC LIMIT 1),
      (SELECT id FROM runs WHERE task_id=t.id ORDER BY rowid DESC LIMIT 1),
      COALESCE((SELECT status FROM runs WHERE task_id=t.id ORDER BY rowid DESC LIMIT 1),'idle'),
      (SELECT id FROM messages WHERE task_id=t.id AND conversation='master' AND kind='action_plan' ORDER BY rowid DESC LIMIT 1),t.updated_at
    FROM tasks t;
    "#).map_err(|e| e.to_string())?;
    if let Some(transaction) = transaction {
        transaction.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn input_revision(conn: &Connection, task: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT user_input_revision FROM task_checkpoints WHERE task_id=?1",
        [task],
        |r| r.get(0),
    )
    .map_err(|e| format!("CHECKPOINT_READ: {e}"))
}

/// Parse exactly one directive first. Malformed replies never enter this ledger.
pub fn insert_directive(
    conn: &Connection,
    message: &mut MessageDto,
    run: &str,
    directive: &Directive,
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let status: Option<String> = tx
        .query_row(
            "SELECT status FROM runs WHERE id=?1 AND task_id=?2",
            params![run, message.task_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match status.as_deref() {
        Some("running") => {}
        Some("stopping" | "cancelled") => return Err("RUN_CANCELLED".into()),
        _ => return Err("RUN_NOT_ACTIVE: action belongs to an inactive run".into()),
    }
    insert_message(&tx, message)?;
    let value = serde_json::to_value(directive).map_err(|e| e.to_string())?;
    let op = value["type"]
        .as_str()
        .ok_or("CHECKPOINT_ACTION: missing operation")?;
    if matches!(directive, Directive::FinalAnswer { .. }) {
        tx.execute("INSERT OR IGNORE INTO task_checkpoint_events VALUES(?1,?2,?3,'completion_claimed',?4,'{}',?5)",
            params![format!("claim:{}",message.id),message.task_id,run,message.id,message.created_at]).map_err(|e|e.to_string())?;
    } else if !matches!(
        directive,
        Directive::UpdateActionPlan { .. }
            | Directive::UpdateMemory { .. }
            | Directive::TaskUpdate { .. }
    ) {
        tx.execute(
            "INSERT INTO task_checkpoint_actions VALUES(?1,?2,?3,?4,?5,'attempted',NULL,?6)",
            params![
                message.id,
                message.task_id,
                run,
                message.conversation,
                op,
                message.created_at
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

pub fn save_plan(
    conn: &Connection,
    task: &str,
    run: &str,
    base: i64,
    markdown: &str,
    steps: Option<Vec<ActionPlanStep>>,
) -> Result<(MessageDto, bool), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let current = input_revision(&tx, task)?;
    let accepted = current == base
        && tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM runs WHERE id=?1 AND task_id=?2 AND status='running')",
                params![run, task],
                |r| r.get::<_, bool>(0),
            )
            .map_err(|e| e.to_string())?;
    let source = if steps.as_ref().is_some_and(|s| !s.is_empty()) {
        "explicit"
    } else {
        "markdown"
    };
    let mut steps = steps
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| crate::orchestrator::parse_markdown_steps(markdown));
    let previous:Option<String>=tx.query_row("SELECT m.content FROM task_checkpoints c JOIN messages m ON m.id=c.plan_message_id WHERE c.task_id=?1",[task],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    let old = previous.as_deref().map(plan_data).unwrap_or(json!({}));
    let mut ids = std::collections::HashSet::new();
    for step in &mut steps {
        if step.id.trim().is_empty() {
            step.id = old["steps"]
                .as_array()
                .and_then(|values| {
                    values
                        .iter()
                        .find(|v| v["title"].as_str() == Some(step.title.as_str()))
                })
                .and_then(|v| v["id"].as_str())
                .map(str::to_owned)
                .unwrap_or_else(crate::db::new_id);
        }
        if !ids.insert(step.id.clone()) {
            step.id = crate::db::new_id();
            ids.insert(step.id.clone());
        }
    }
    let payload = json!({"markdown":markdown,"steps":steps,"steps_source":source,"base_input_revision":base,
        "source_run_id":run,"proposal_state":if accepted{"accepted"}else{"stale"}});
    let mut message = new_message(
        task,
        "assistant",
        "action_plan",
        payload.to_string(),
        None,
        None,
        true,
    );
    insert_message(&tx, &mut message)?;
    let selected: Option<String> = tx
        .query_row(
            "SELECT plan_message_id FROM task_checkpoints WHERE task_id=?1",
            [task],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let selected = accepted && selected.as_deref() == Some(message.id.as_str());
    tx.commit().map_err(|e| e.to_string())?;
    Ok((message, selected))
}

fn plan_data(raw: &str) -> Value {
    let mut value = serde_json::from_str::<Value>(raw)
        .ok()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({"markdown":raw}));
    if !value["steps"].is_array() {
        value["steps"] = json!(crate::orchestrator::parse_markdown_steps(
            value["markdown"].as_str().unwrap_or("")
        ));
    }
    value
}

pub fn snapshot(conn: &Connection, task: &str) -> Result<Option<Value>, String> {
    let row=conn.query_row("SELECT revision,user_input_revision,last_user_message_id,run_id,run_status,plan_message_id,plan_input_revision,updated_at FROM task_checkpoints WHERE task_id=?1",[task],|r|{
        Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,String>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<i64>>(6)?,r.get::<_,String>(7)?))
    }).optional().map_err(|e|e.to_string())?;
    let Some((
        version,
        input_revision,
        user_message_id,
        run_id,
        run_status,
        plan_id,
        plan_revision,
        updated_at,
    )) = row
    else {
        return Ok(None);
    };
    let raw: Option<String> = match &plan_id {
        Some(id) => conn
            .query_row(
                "SELECT content FROM messages WHERE id=?1 AND task_id=?2",
                params![id, task],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?,
        None => None,
    };
    let mut value = raw
        .as_deref()
        .map(plan_data)
        .unwrap_or(json!({"markdown":"","steps":[]}));
    let waiting: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM task_checkpoint_events e WHERE e.task_id=?1 AND e.run_id=?2
         AND e.kind='human_wait' AND json_extract(e.detail,'$.status')='pending'
         AND NOT EXISTS(SELECT 1 FROM task_checkpoint_events newer WHERE newer.task_id=e.task_id
         AND newer.kind='human_wait' AND newer.source_id=e.source_id AND newer.rowid>e.rowid)",
            params![task, run_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let state = if run_status == "running" && waiting > 0 {
        "awaiting_user"
    } else {
        run_status.as_str()
    };
    let actions:Value=conn.query_row(
        "SELECT json_object('attempted',COUNT(*),'returned',COALESCE(SUM(status='returned'),0),
         'uncertain',COALESCE(SUM(status='uncertain'),0)) FROM task_checkpoint_actions WHERE task_id=?1 AND run_id=?2",
        params![task,run_id],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())
        .and_then(|raw|serde_json::from_str(&raw).map_err(|e|e.to_string()))?;
    value["checkpoint"] = json!({"version":version,"user_input_revision":input_revision,"last_user_message_id":user_message_id,
        "run_id":run_id,"state":state,"plan_message_id":plan_id,"plan_input_revision":plan_revision,
        "plan_stale":plan_revision.is_some_and(|revision|revision<input_revision),
        "historical_plan":plan_id.is_some()&&plan_revision.is_none(),"pending_human_requests":waiting,"actions":actions,"updated_at":updated_at});
    // Runtime only projects interruption of active steps. Completed steps are
    // model reports, never promoted to verified effects by a successful tool.
    if let Some(steps) = value["steps"].as_array_mut() {
        for step in steps {
            if !step.is_object() {
                continue;
            }
            step["reported_status"] = step["status"].clone();
            if step["status"] == "in_progress" {
                match state {
                    "cancelled" | "interrupted" => step["status"] = json!("interrupted"),
                    "failed" => step["status"] = json!("failed"),
                    "paused" | "awaiting_user" => step["status"] = json!("paused"),
                    "completed" => step["status"] = json!("unconfirmed"),
                    _ => {}
                }
            }
        }
    }
    value["steps_source"] = json!("checkpoint");
    Ok(Some(value))
}

pub fn sync_projection(conn: &Connection, task: &str) -> Result<Option<MessageDto>, String> {
    let Some(value) = snapshot(conn, task)? else {
        return Ok(None);
    };
    let mut message = new_message(
        task,
        "event",
        "task_checkpoint",
        value.to_string(),
        None,
        None,
        true,
    );
    message.id = format!("task-checkpoint:{task}");
    let existing: Option<(String, i64, String)> = conn
        .query_row(
            "SELECT content,rowid,created_at FROM messages WHERE id=?1",
            [&message.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match existing {
        Some((content, seq, created_at)) => {
            if content != message.content {
                conn.execute(
                    "UPDATE messages SET content=?1 WHERE id=?2",
                    params![message.content, message.id],
                )
                .map_err(|e| e.to_string())?;
            }
            message.seq = seq;
            message.created_at = created_at;
        }
        None => insert_message(conn, &mut message)?,
    }
    message.projection_version = value["checkpoint"]["version"].as_i64();
    Ok(Some(message))
}

pub fn emit(
    state: &tauri::State<'_, AppState>,
    app: &tauri::AppHandle,
    task: &str,
) -> Result<(), String> {
    let projection = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        sync_projection(&conn, task)?
    };
    if let Some(message) = projection {
        crate::chat::emit_message(app, task, &message);
    }
    Ok(())
}

pub fn delete(conn: &Connection, task: &str) -> Result<(), String> {
    for table in [
        "task_checkpoint_actions",
        "task_checkpoint_events",
        "task_checkpoints",
    ] {
        conn.execute(&format!("DELETE FROM {table} WHERE task_id=?1"), [task])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        conn.execute("INSERT INTO tasks(id,title,created_at,updated_at) VALUES('t','Synthetic task','n','n')",[]).unwrap();
        conn.execute("INSERT INTO runs(id,request_id,task_id,status,started_at,updated_at) VALUES('r','request','t','running','n','n')",[]).unwrap();
        message(&conn, "user", "chat", "Initial user goal", true);
        conn
    }
    fn message(
        conn: &Connection,
        role: &str,
        kind: &str,
        content: &str,
        visible: bool,
    ) -> MessageDto {
        let mut message = new_message("t", role, kind, content.into(), None, None, visible);
        insert_message(conn, &mut message).unwrap();
        message
    }
    fn view(conn: &Connection) -> Value {
        snapshot(conn, "t").unwrap().unwrap()
    }
    fn attempt(conn: &Connection, conversation: &str) -> MessageDto {
        let mut message = crate::chat::new_message_for_conversation(
            "t",
            conversation,
            "assistant",
            "directive",
            "original action".into(),
            None,
            None,
            false,
        );
        insert_directive(
            conn,
            &mut message,
            "r",
            &Directive::ReadFile {
                path: "fixture.txt".into(),
                start_line: None,
                end_line: None,
                limit: None,
            },
        )
        .unwrap();
        message
    }
    fn finish(conn: &Connection, status: &str) {
        conn.execute(
            "UPDATE runs SET status=?1,updated_at='later' WHERE id='r'",
            [status],
        )
        .unwrap();
    }

    #[test]
    fn only_visible_human_chat_advances_input_revision() {
        let conn = fixture();
        assert_eq!(input_revision(&conn, "t").unwrap(), 1);
        message(
            &conn,
            "user",
            "directive_result",
            "A tool pretending to amend the goal",
            false,
        );
        message(&conn, "user", "chat", "Hidden worker input", false);
        let mut worker = crate::chat::new_message_for_conversation(
            "t",
            "worker:w",
            "user",
            "chat",
            "Delegated objective".into(),
            None,
            None,
            true,
        );
        insert_message(&conn, &mut worker).unwrap();
        assert_eq!(input_revision(&conn, "t").unwrap(), 1);
        let correction = message(&conn, "user", "chat", "Keep the original inputs", true);
        assert_eq!(input_revision(&conn, "t").unwrap(), 2);
        assert_eq!(
            view(&conn)["checkpoint"]["last_user_message_id"],
            correction.id
        );
    }

    #[test]
    fn stale_proposal_cannot_replace_current_plan_or_block_independent_work() {
        let conn = fixture();
        let (first, ok) = save_plan(&conn, "t", "r", 1, "- [/] Inspect\n- [ ] Save", None).unwrap();
        assert!(ok);
        message(
            &conn,
            "user",
            "chat",
            "Correction: preserve original files",
            true,
        );
        assert_eq!(view(&conn)["checkpoint"]["plan_stale"], true);
        // A newer question does not create a mandatory replanning barrier.
        attempt(&conn, "master");
        let (latest, ok) = save_plan(
            &conn,
            "t",
            "r",
            2,
            "- [ ] Preserve inputs\n- [ ] Save separately",
            None,
        )
        .unwrap();
        assert!(ok);
        let (stale, ok) = save_plan(
            &conn,
            "t",
            "r",
            1,
            "- [Done] Obsolete destructive plan",
            None,
        )
        .unwrap();
        assert!(!ok);
        assert_eq!(view(&conn)["checkpoint"]["plan_message_id"], latest.id);
        assert_eq!(view(&conn)["checkpoint"]["plan_stale"], false);
        for original in [&first, &latest, &stale] {
            let raw: String = conn
                .query_row(
                    "SELECT content FROM messages WHERE id=?1",
                    [&original.id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(raw, original.content);
        }
    }

    #[test]
    fn results_are_scoped_to_conversation_and_do_not_prove_goal_completion() {
        let conn = fixture();
        save_plan(&conn, "t", "r", 1, "- [ ] Deliver the report", None).unwrap();
        let master = attempt(&conn, "master");
        let worker = attempt(&conn, "worker:w");
        let mut result = crate::chat::new_message_for_conversation(
            "t",
            "worker:w",
            "user",
            "directive_result",
            "Tool failed; no effect was confirmed".into(),
            None,
            None,
            false,
        );
        insert_message(&conn, &mut result).unwrap();
        let states: Vec<(String, String, Option<String>)> = conn
            .prepare(
                "SELECT id,status,result_message_id FROM task_checkpoint_actions ORDER BY rowid",
            )
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            states,
            vec![
                (master.id, "attempted".into(), None),
                (worker.id, "returned".into(), Some(result.id))
            ]
        );
        assert_eq!(view(&conn)["steps"][0]["status"], "pending");
        finish(&conn, "completed");
        assert_eq!(view(&conn)["steps"][0]["status"], "pending");
        assert_eq!(view(&conn)["checkpoint"]["actions"]["uncertain"], 1);
    }

    #[test]
    fn human_wait_updates_are_durable_idempotent_and_bound_to_original_run() {
        let conn = fixture();
        let approval = message(&conn, "event", "approval", r#"{"status":"pending"}"#, true);
        assert_eq!(view(&conn)["checkpoint"]["state"], "awaiting_user");
        let revision = view(&conn)["checkpoint"]["version"].clone();
        conn.execute(
            "UPDATE messages SET content=content WHERE id=?1",
            [&approval.id],
        )
        .unwrap();
        assert_eq!(view(&conn)["checkpoint"]["version"], revision);
        conn.execute(
            "UPDATE messages SET content=json_set(content,'$.status','denied') WHERE id=?1",
            [&approval.id],
        )
        .unwrap();
        assert_eq!(view(&conn)["checkpoint"]["state"], "running");
        finish(&conn, "completed");
        conn.execute("INSERT INTO runs(id,request_id,task_id,status,started_at,updated_at) VALUES('r2','q2','t','running','later','later')",[]).unwrap();
        conn.execute("UPDATE messages SET content=json_set(content,'$.note','late notification') WHERE id=?1",[&approval.id]).unwrap();
        assert_eq!(view(&conn)["checkpoint"]["state"], "running");
        let owners:i64=conn.query_row("SELECT COUNT(*) FROM task_checkpoint_events WHERE source_id=?1 AND kind='human_wait' AND run_id!='r'",[&approval.id],|r|r.get(0)).unwrap();
        assert_eq!(owners, 0);
    }

    #[test]
    fn source_and_checkpoint_rollback_together_on_persistence_failure() {
        let conn = fixture();
        let before = view(&conn);
        conn.execute_batch("CREATE TRIGGER reject_checkpoint BEFORE INSERT ON task_checkpoint_events WHEN NEW.kind='action_attempted' BEGIN SELECT RAISE(ABORT,'injected checkpoint failure'); END;").unwrap();
        let mut source = new_message(
            "t",
            "assistant",
            "directive",
            "A valid parsed action".into(),
            None,
            None,
            false,
        );
        let result = insert_directive(
            &conn,
            &mut source,
            "r",
            &Directive::ListDir { path: ".".into() },
        );
        assert!(result.is_err());
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE id=?1",
                [&source.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        assert_eq!(view(&conn), before);
        assert_eq!(view(&conn)["checkpoint"]["actions"]["attempted"], 0);
        conn.execute_batch("DROP TRIGGER reject_checkpoint;")
            .unwrap();
        attempt(&conn, "master");
        conn.execute_batch("CREATE TRIGGER reject_return BEFORE INSERT ON task_checkpoint_events WHEN NEW.kind='action_returned' BEGIN SELECT RAISE(ABORT,'injected result persistence failure'); END;").unwrap();
        let mut result = new_message(
            "t",
            "user",
            "directive_result",
            "Uncommitted result".into(),
            None,
            None,
            false,
        );
        assert!(insert_message(&conn, &mut result).is_err());
        assert_eq!(view(&conn)["checkpoint"]["actions"]["returned"], 0);
        let saved: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM messages WHERE id=?1)",
                [result.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!saved);
    }

    #[test]
    fn terminal_projection_preserves_raw_plan_and_stable_identity() {
        let conn = fixture();
        let (original, _) = save_plan(
            &conn,
            "t",
            "r",
            1,
            "- [Done] Read inputs\n- [/] Write report",
            None,
        )
        .unwrap();
        let initial = sync_projection(&conn, "t").unwrap().unwrap();
        let idle_revision = input_revision(&conn, "t").unwrap();
        for (status, expected) in [
            ("paused", "paused"),
            ("running", "in_progress"),
            ("completed", "unconfirmed"),
            ("failed", "failed"),
            ("cancelled", "interrupted"),
        ] {
            finish(&conn, status);
            let projection = sync_projection(&conn, "t").unwrap().unwrap();
            assert_eq!(projection.id, initial.id);
            assert_eq!(projection.seq, initial.seq);
            assert_eq!(view(&conn)["steps"][1]["status"], expected);
            assert_eq!(view(&conn)["steps"][0]["status"], "completed");
            assert_eq!(input_revision(&conn, "t").unwrap(), idle_revision);
        }
        let raw: String = conn
            .query_row(
                "SELECT content FROM messages WHERE id=?1",
                [original.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(raw, original.content);
        let revision = view(&conn)["checkpoint"]["version"].clone();
        sync_projection(&conn, "t").unwrap();
        assert_eq!(view(&conn)["checkpoint"]["version"], revision);
    }

    #[test]
    fn restart_reconciles_inflight_work_without_replaying_actions() {
        let conn = fixture();
        save_plan(&conn, "t", "r", 1, "- [/] Finish the workflow", None).unwrap();
        attempt(&conn, "master");
        conn.execute("INSERT INTO workers(id,task_id,name,objective,success_criteria,status,created_at,updated_at) VALUES('w','t','Worker','Do work','Observed result','running','n','n')",[]).unwrap();
        crate::db::init_schema(&conn).unwrap();
        let current = view(&conn);
        assert_eq!(current["checkpoint"]["state"], "interrupted");
        assert_eq!(current["steps"][0]["status"], "interrupted");
        assert_eq!(current["checkpoint"]["actions"]["uncertain"], 1);
        assert_eq!(current["checkpoint"]["actions"]["attempted"], 1);
        let revision = current["checkpoint"]["version"].clone();
        crate::db::init_schema(&conn).unwrap();
        assert_eq!(view(&conn)["checkpoint"]["version"], revision);
        let worker_event:i64=conn.query_row("SELECT COUNT(*) FROM task_checkpoint_events WHERE kind='worker_state' AND json_extract(detail,'$.status')='interrupted'",[],|r|r.get(0)).unwrap();
        assert_eq!(worker_event, 1);
    }

    #[test]
    fn legacy_markdown_stays_historical_and_deleted_checkpoint_does_not_return() {
        let conn = fixture();
        message(
            &conn,
            "assistant",
            "action_plan",
            "- [Done] Old model claim",
            true,
        );
        assert_eq!(view(&conn)["checkpoint"]["historical_plan"], true);
        assert_eq!(view(&conn)["steps"][0]["status"], "completed");
        delete(&conn, "t").unwrap();
        conn.execute("DELETE FROM messages WHERE task_id='t'", [])
            .unwrap();
        conn.execute("DELETE FROM runs WHERE task_id='t'", [])
            .unwrap();
        conn.execute("DELETE FROM tasks WHERE id='t'", []).unwrap();
        assert!(snapshot(&conn, "t").unwrap().is_none());
        init_schema(&conn).unwrap();
        assert!(snapshot(&conn, "t").unwrap().is_none());
    }

    #[test]
    fn migration_preserves_old_sources_and_does_not_invent_plan_coverage() {
        let conn = fixture();
        let triggers: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'checkpoint_%'",
            )
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        for name in triggers {
            conn.execute_batch(&format!("DROP TRIGGER {name};"))
                .unwrap();
        }
        conn.execute_batch("DROP TABLE task_checkpoint_actions; DROP TABLE task_checkpoint_events; DROP TABLE task_checkpoints;").unwrap();
        let old = message(
            &conn,
            "assistant",
            "action_plan",
            "- [Done] Historical report",
            true,
        );
        crate::db::init_schema(&conn).unwrap();
        let current = view(&conn);
        assert_eq!(current["checkpoint"]["user_input_revision"], 1);
        assert_eq!(current["checkpoint"]["state"], "interrupted");
        assert_eq!(current["checkpoint"]["historical_plan"], true);
        assert_eq!(current["checkpoint"]["plan_input_revision"], Value::Null);
        assert_eq!(current["checkpoint"]["plan_message_id"], old.id);
        let raw: String = conn
            .query_row("SELECT content FROM messages WHERE id=?1", [old.id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(raw, old.content);
        assert_eq!(current["checkpoint"]["actions"]["attempted"], 0);
    }
}
