//! Supervisor-only native handoff. Cards are durable; page telemetry cannot resolve them.
use super::*;

pub(super) fn validate(
    state: &State<'_, AppState>,
    task: &str,
    message: &str,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    pending(&conn, task, message).map(|_| ())
}

fn pending(conn: &rusqlite::Connection, task: &str, message: &str) -> Result<Value, String> {
    let raw: String = conn
        .query_row(
            "SELECT content FROM messages WHERE id=?1 AND task_id=?2 AND kind='handoff'",
            params![message, task],
            |r| r.get(0),
        )
        .map_err(|_| "BROWSER_HANDOFF_STALE: intervention not found")?;
    let data: Value =
        serde_json::from_str(&raw).map_err(|_| "BROWSER_HANDOFF_STALE: invalid intervention")?;
    if data["status"] != "pending" {
        return Err("BROWSER_HANDOFF_STALE: intervention is no longer pending".into());
    }
    let run = data["root_run_id"]
        .as_str()
        .ok_or("BROWSER_HANDOFF_STALE: missing run")?;
    store::assert_running(conn, task, run)?;
    let session = store::session(
        conn,
        task,
        data["session_id"]
            .as_str()
            .ok_or("BROWSER_HANDOFF_STALE: missing session")?,
    )?;
    if session["run_id"] != run || session["status"] != "active" {
        return Err("BROWSER_HANDOFF_STALE: browser is no longer active".into());
    }
    Ok(data)
}

fn save(
    state: &State<'_, AppState>,
    app: &tauri::AppHandle,
    task: &str,
    message: &str,
    data: &Value,
) -> Result<(), String> {
    let msg = {
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        if tx.execute("UPDATE messages SET content=?1 WHERE id=?2 AND task_id=?3 AND kind='handoff' AND json_extract(content,'$.status')='pending'",params![data.to_string(),message,task]).map_err(|e|e.to_string())?!=1{return Err("BROWSER_HANDOFF_STALE: intervention changed".into());}
        tx.execute(
            "UPDATE managed_browser_sessions SET version=version+1,updated_at=?2 WHERE id=?1",
            params![data["session_id"].as_str(), crate::db::now_iso()],
        )
        .map_err(|e| e.to_string())?;
        let message = crate::chat::load_message(&tx, message)?;
        tx.commit().map_err(|e| e.to_string())?;
        message
    };
    crate::chat::emit_message(app, task, &msg);
    Ok(())
}

pub(super) fn invalidate(
    state: &State<'_, AppState>,
    app: &tauri::AppHandle,
    task: &str,
    run: &str,
) -> Result<(), String> {
    let messages = {
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let ids = {
            let mut s=tx.prepare("SELECT id FROM messages WHERE task_id=?1 AND kind='handoff' AND json_extract(content,'$.root_run_id')=?2 AND json_extract(content,'$.status')='pending'").map_err(|e|e.to_string())?;
            let rows = s
                .query_map(params![task, run], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        let mut out = Vec::new();
        for id in ids {
            tx.execute("UPDATE messages SET content=json_set(content,'$.status','cancelled','$.phase','cancelled') WHERE id=?1",[&id]).map_err(|e|e.to_string())?;
            out.push(crate::chat::load_message(&tx, &id)?);
        }
        tx.commit().map_err(|e| e.to_string())?;
        out
    };
    for message in messages {
        crate::chat::emit_message(app, task, &message);
    }
    Ok(())
}

async fn control(broker: &mut Broker, op: &str, epoch: &str) -> Result<Value, String> {
    let reply = match tokio::time::timeout(
        Duration::from_secs(8),
        broker.call(
            &crate::db::new_id(),
            op,
            &json!({"epoch":epoch}),
            &json!({}),
        ),
    )
    .await
    {
        Ok(Ok(reply)) => reply,
        Ok(Err(error)) => {
            broker.abort();
            return Err(error);
        }
        Err(_) => {
            broker.abort();
            return Err("BROWSER_HANDOFF_TIMEOUT: browser acknowledgement was lost; the owned browser was stopped".into());
        }
    };
    if reply["ok"] != true {
        return Err(format!(
            "{}: {}",
            reply["error"]["code"]
                .as_str()
                .unwrap_or("BROWSER_HANDOFF_FAILED"),
            reply["error"]["message"]
                .as_str()
                .unwrap_or("Intervention failed")
        ));
    }
    Ok(reply)
}

async fn collect(
    state: &State<'_, AppState>,
    task: &str,
    slot: &Arc<Slot>,
    broker: &mut Broker,
    epoch: &str,
    reply: &Value,
    capture: bool,
) -> Result<(), String> {
    transfers::collect(state, task, &slot.id, &reply["result"]["transfers"])?;
    let events = reply["result"]["events"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let last = {
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        store::tabs(&tx, &slot.id, &reply["tabs"])?;
        if reply["result"]["dropped"].as_u64().unwrap_or(0) > 0 {
            crate::browser_capture::gap(&tx, &slot.id, "human_event_queue_overflow")?;
        }
        let mut last = None;
        for event in events.iter().take(64) {
            if event["epoch"] != epoch {
                continue;
            }
            let count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM managed_browser_actions WHERE session_id=?1",
                    [&slot.id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if count >= 5000 {
                crate::browser_capture::gap(&tx, &slot.id, "human_action_limit")?;
                break;
            }
            let id = format!("human:{epoch}:{}", event["seq"]);
            let raw = event.to_string();
            let hash = format!("{:x}", Sha256::digest(raw.as_bytes()));
            if store::begin_action(
                &tx,
                &slot.id,
                &id,
                "human",
                event["op"].as_str().unwrap_or("observe"),
                event,
                &hash,
            )?
            .is_none()
            {
                store::action_state(
                    &tx,
                    &id,
                    "observed",
                    Some("human_page_observation"),
                    Some(
                        &json!({"ok":null,"coverage":reply["result"]["coverage"],"recorded_ms":event["recorded_ms"]}),
                    ),
                )?;
                if let Some(at) = event["recorded_ms"]
                    .as_i64()
                    .and_then(chrono::DateTime::from_timestamp_millis)
                {
                    tx.execute(
                        "UPDATE managed_browser_actions SET created_at=?2 WHERE id=?1",
                        params![id, at.to_rfc3339()],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            last = Some((id, event["tab_id"].clone()));
        }
        tx.commit().map_err(|e| e.to_string())?;
        last
    };
    // A batch gets one explicitly approximate post-event image. Event geometry
    // is retained as evidence, never projected onto these later pixels.
    if let Some((action, tab)) = last.filter(|_| capture) {
        let frame = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            crate::browser_capture::reserve(&conn, &slot.id, Some(&action), "approximate")?
        };
        if let Some(frame) = frame {
            let image = tokio::time::timeout(
                Duration::from_secs(3),
                broker.call(
                    &crate::db::new_id(),
                    "_human_capture",
                    &json!({"epoch":epoch,"tab_id":tab}),
                    &json!({"after":frame}),
                ),
            )
            .await;
            match image {
                Ok(Ok(image)) => crate::browser_capture::register_boundary(
                    &state.db,
                    task,
                    &slot.id,
                    &frame,
                    &image["result"]["capture"],
                )?,
                _ => {
                    broker.abort();
                    let conn = state.db.lock().map_err(|e| e.to_string())?;
                    crate::browser_capture::unavailable(
                        &conn,
                        &frame,
                        "human_capture_unavailable",
                    )?;
                    return Err("BROWSER_HANDOFF_TRANSPORT: capture acknowledgement lost".into());
                }
            }
        }
    }
    Ok(())
}

pub(super) async fn decide(
    state: &State<'_, AppState>,
    app: &tauri::AppHandle,
    task: &str,
    message: &str,
    resume: bool,
    note: &str,
) -> Result<(), String> {
    let data = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        pending(&conn, task, message)?
    };
    let run = data["root_run_id"].as_str().unwrap();
    let slot = state
        .browser_manager
        .managed
        .slots
        .lock()
        .map_err(|e| e.to_string())?
        .get(run)
        .cloned()
        .ok_or("BROWSER_HANDOFF_STALE: browser owner ended")?;
    let mut io = slot.io.lock().await;
    let mut data = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        pending(&conn, task, message)?
    };
    if slot.closed.load(Ordering::SeqCst) {
        return Err("BROWSER_HANDOFF_STALE: browser ended".into());
    }
    if resume && data["phase"] != "open" {
        return Err("BROWSER_HANDOFF_NOT_OPEN: open the browser before resuming".into());
    }
    let broker = io
        .as_mut()
        .ok_or("BROWSER_HANDOFF_STALE: browser is unavailable")?;
    if resume {
        // Drain while the epoch still owns the browser, then return a current
        // observation after hiding. A human effect is never automatically replayed.
        let events = control(broker, "_human_poll", message).await?;
        collect(state, task, &slot, broker, message, &events, true).await?;
        let ended = control(broker, "_human_end", message).await?;
        collect(state, task, &slot, broker, message, &ended, false).await?;
        data["resume_observation"] = ended["result"]["observation"].clone();
        data["resume_error"] = ended["result"]["observation_error"].clone();
        data["status"] = json!("approved");
        data["phase"] = json!("completed");
        data["note"] = json!(note.chars().take(2000).collect::<String>());
        save(state, app, task, message, &data)?;
        slot.human.store(false, Ordering::SeqCst);
    } else {
        control(broker, "_human_open", message).await?;
        data["phase"] = json!("open");
        save(state, app, task, message, &data)?;
    }
    publish(state, app, task, &slot.id)
}

struct WaitGuard {
    slot: Arc<Slot>,
    db: Arc<Mutex<rusqlite::Connection>>,
    app: tauri::AppHandle,
    task: String,
    message: String,
    cancel: CancellationToken,
}
impl Drop for WaitGuard {
    fn drop(&mut self) {
        if self.slot.human.load(Ordering::SeqCst) {
            self.slot.closed.store(true, Ordering::SeqCst);
            self.slot.stop.cancel();
            let message=self.db.lock().ok().and_then(|mut conn|{
                let status=if self.cancel.is_cancelled(){"cancelled"}else{"failed"};
                let tx=conn.transaction().ok()?;
                tx.execute("UPDATE messages SET content=json_set(content,'$.status',?2,'$.phase',?2,'$.note','Intervention ended before a confirmed resume; browser was stopped') WHERE id=?1 AND kind='handoff' AND json_extract(content,'$.status')='pending'",params![self.message,status]).ok()?;
                store::status(&tx,&self.slot.id,status,Some("Intervention ended without confirmed resume"),None).ok()?;
                let message=crate::chat::load_message(&tx,&self.message).ok()?;
                tx.commit().ok()?;Some(message)
            });
            if let Some(message) = message {
                crate::chat::emit_message(&self.app, &self.task, &message);
            }
            let _ = publish_db(&self.db, &self.app, &self.task, &self.slot.id);
        }
    }
}

pub async fn request_handoff(
    state: &State<'_, AppState>,
    app: &tauri::AppHandle,
    task: &str,
    run: &str,
    cancel: &CancellationToken,
    caller: &str,
    reason: &str,
) -> Result<String, String> {
    let slot = state
        .browser_manager
        .managed
        .slots
        .lock()
        .map_err(|e| e.to_string())?
        .get(run)
        .cloned()
        .ok_or(
            "BROWSER_NOT_STARTED: navigate to the relevant page before asking for intervention",
        )?;
    let mut card =
        crate::chat::new_message(task, "event", "handoff", String::new(), None, None, true);
    {
        let mut io = tokio::select! {io=slot.io.lock()=>io,_=cancel.cancelled()=>return Err("RUN_CANCELLED".into()),_=slot.stop.cancelled()=>return Err("BROWSER_SESSION_ENDED".into())};
        if cancel.is_cancelled() {
            return Err("RUN_CANCELLED".into());
        }
        {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            store::assert_running(&conn, task, run)?;
        }
        if slot.human.load(Ordering::SeqCst) || slot.closed.load(Ordering::SeqCst) {
            return Err("BROWSER_HANDOFF_PENDING: browser is unavailable or another intervention is pending".into());
        }
        {
            let owner = slot.lease.lock().map_err(|e| e.to_string())?;
            if caller != "master" && owner.as_deref().is_some_and(|owner| owner != caller) {
                return Err("BROWSER_LEASE: another caller owns the browser".into());
            }
        }
        let broker = io.as_mut().ok_or("BROWSER_NOT_STARTED: navigate first")?;
        let begin = tokio::select! {result=control(broker,"_human_begin",&card.id)=>result,_=cancel.cancelled()=>Err("RUN_CANCELLED".into())};
        if let Err(error) = begin {
            if cancel.is_cancelled() {
                broker.abort();
                slot.closed.store(true, Ordering::SeqCst);
                slot.stop.cancel();
            }
            return Err(error);
        }
        slot.human.store(true, Ordering::SeqCst);
    }
    let _guard = WaitGuard {
        slot: slot.clone(),
        db: state.db.clone(),
        app: app.clone(),
        task: task.into(),
        message: card.id.clone(),
        cancel: cancel.clone(),
    };
    card.content=json!({"status":"pending","phase":"requested","reason":reason.chars().take(2000).collect::<String>(),"root_run_id":run,"session_id":slot.id,"caller":caller,"coverage":"Page actions are recorded; browser chrome and native dialogs are outside capture."}).to_string();
    {
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        crate::chat::insert_message(&tx, &mut card)?;
        tx.execute(
            "UPDATE managed_browser_sessions SET version=version+1,updated_at=?2 WHERE id=?1",
            params![slot.id, crate::db::now_iso()],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    crate::chat::emit_message(app, task, &card);
    publish(state, app, task, &slot.id)?;
    loop {
        tokio::select! {_=cancel.cancelled()=>return Err("RUN_CANCELLED".into()),_=slot.stop.cancelled()=>return Err("BROWSER_SESSION_ENDED".into()),_=tokio::time::sleep(Duration::from_millis(400))=>{}}
        let data: Value = {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            let msg = crate::chat::load_message(&conn, &card.id)?;
            serde_json::from_str(&msg.content).map_err(|e| e.to_string())?
        };
        if data["status"] == "approved" {
            return Ok(crate::orchestrator::directive_result_message(
                &json!({"handoff":"completed","note":data["note"],"observation":data["resume_observation"],"observation_error":data["resume_error"],"instruction":"Human actions may already have completed a submission. Inspect the current state before acting; do not repeat it automatically."}),
            ));
        }
        if data["status"] != "pending" {
            return Err("BROWSER_HANDOFF_CANCELLED".into());
        }
        let mut io = tokio::select! {io=slot.io.lock()=>io,_=cancel.cancelled()=>return Err("RUN_CANCELLED".into())};
        // A Resume command may have resolved the card while this poll waited.
        if !slot.human.load(Ordering::SeqCst) {
            continue;
        }
        let broker = io.as_mut().ok_or("BROWSER_SESSION_ENDED")?;
        let response = control(broker, "_human_poll", &card.id).await?;
        collect(state, task, &slot, broker, &card.id, &response, true).await?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handoff_is_bound_to_exact_live_task_run_session_and_pending_card() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::init_schema(&c).unwrap();
        c.execute(
            "INSERT INTO tasks(id,title,created_at,updated_at) VALUES('t','test','now','now')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO runs(id,request_id,task_id,status,started_at,updated_at) VALUES('r','q','t','running','now','now')",[]).unwrap();
        let session = store::ensure_session(&c, "t", "r").unwrap();
        store::status(&c, &session, "active", None, None).unwrap();
        let mut card = crate::chat::new_message(
            "t",
            "event",
            "handoff",
            json!({"status":"pending","phase":"requested","root_run_id":"r","session_id":session})
                .to_string(),
            None,
            None,
            true,
        );
        crate::chat::insert_message(&c, &mut card).unwrap();
        assert_eq!(pending(&c, "t", &card.id).unwrap()["phase"], "requested");
        assert_eq!(
            store::session(&c, "t", &session).unwrap()["run_status"],
            "waiting_for_user"
        );
        assert!(pending(&c, "foreign", &card.id).is_err());
        c.execute("UPDATE runs SET status='completed' WHERE id='r'", [])
            .unwrap();
        assert!(pending(&c, "t", &card.id).is_err());
        c.execute("UPDATE runs SET status='running' WHERE id='r'", [])
            .unwrap();
        store::recover(&c).unwrap();
        assert!(pending(&c, "t", &card.id).is_err());
        let raw: String = c
            .query_row(
                "SELECT content FROM messages WHERE id=?1",
                [&card.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&raw).unwrap()["status"],
            "cancelled"
        );
    }
    #[test]
    fn actor_cannot_issue_supervisor_controls() {
        for op in [
            "_human_begin",
            "_human_open",
            "_human_end",
            "_human_poll",
            "_human_capture",
        ] {
            assert!(BrowserCommand {
                op: op.into(),
                params: json!({}),
                action_id: None
            }
            .validate()
            .is_err());
        }
    }
}
