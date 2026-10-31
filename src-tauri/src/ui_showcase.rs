//! A user-requested, inert design gallery. No runs, workers, approvals or browser
//! owners are created: every fixture card is explicitly persisted as ui_showcase.
use rusqlite::{params, Connection};
use serde_json::{json, Value};
pub const TASK_ID: &str = "9ea2d928-5083-4e9a-aa6a-54efb1d2aa71";
pub fn create(conn: &Connection) -> Result<Value, String> {
    if conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM tasks WHERE id=?1)",
            [TASK_ID],
            |r| r.get::<_, bool>(0),
        )
        .map_err(|e| e.to_string())?
    {
        return Ok(json!({"task_id":TASK_ID,"created":false}));
    }
    let now = crate::db::now_iso();
    conn.execute_batch("SAVEPOINT ui_showcase")
        .map_err(|e| e.to_string())?;
    let result = (|| {
        conn.execute("INSERT INTO tasks(id,title,status,created_at,updated_at) VALUES(?1,'UI showcase — card variants','active',?2,?2)",params![TASK_ID,now]).map_err(|e|e.to_string())?;
        let mut intro=crate::chat::new_message(TASK_ID,"assistant","chat","# UI design showcase\n\nThis is a persistent gallery of **synthetic examples**. Card controls are inert: they cannot approve permissions, launch browsers or run code. Return here after UI changes to compare the same variants.\n\nFinished means that the browser session ended normally; it does not independently verify the agent's goal.".into(),None,Some("Design preview".into()),true);
        crate::chat::insert_message(conn, &mut intro)?;
        let mut entries: Vec<(&str, &str, &str, Value)> = vec![];
        for (status, label) in [
            ("starting", "Preparing"),
            ("active", "In progress"),
            ("finalizing", "Finishing"),
            ("completed", "Finished"),
            ("cancelled", "Stopped"),
            ("failed", "Error"),
            ("interrupted", "Interrupted"),
        ] {
            entries.push((label,"event","managed_browser_session",json!({"task_id":TASK_ID,"session_id":crate::db::new_id(),"run_id":"preview","status":status,"action_count":12,"terminal_reason":if status=="failed"{Some("Example: browser runtime became unavailable")}else{None}})));
        }
        entries.push(("Waiting for approval","event","managed_browser_session",json!({"task_id":TASK_ID,"session_id":crate::db::new_id(),"run_id":"preview","status":"active","run_status":"waiting_for_approval","action_count":3})));
        entries.push(("Waiting for user input","event","managed_browser_session",json!({"task_id":TASK_ID,"session_id":crate::db::new_id(),"run_id":"preview","status":"active","run_status":"waiting_for_user","action_count":3})));
        for (status, label) in [
            ("pending", "Permission pending"),
            ("approved", "Permission approved"),
            ("denied", "Permission denied"),
        ] {
            entries.push((label,"event","approval",json!({"status":status,"summary":"Run command `npm install playwright`","detail":"Synthetic command approval preview. Nothing will execute.","blocked_directive":{"type":"run_command","command":"npm install playwright"}})));
        }
        entries.push(("File permission","event","approval",json!({"status":"pending","summary":"Write file `C:/Example/report.md`","detail":"Synthetic file permission preview.","blocked_directive":{"type":"write_file","path":"C:/Example/report.md","content":"Example"}})));
        for (status, label) in [
            ("pending", "Browser handoff pending"),
            ("approved", "Browser handoff acknowledged"),
            ("denied", "Browser handoff cancelled"),
        ] {
            entries.push((
                label,
                "event",
                "handoff",
                json!({"status":status,"reason":"Example: sign in to the selected account."}),
            ));
        }
        for (status, label) in [
            ("pending", "Choice pending"),
            ("resolved", "Choice resolved"),
        ] {
            entries.push((label,"event","choice",json!({"status":status,"prompt":"Which example workspace should be used?","options":[{"id":"personal","label":"Personal workspace"},{"id":"team","label":"Team workspace"}],"allow_custom_input":true,"selected_option":"team"})));
        }
        for (status, label) in [
            ("running", "Worker running"),
            ("completed", "Worker completed"),
            ("failed", "Worker failed"),
        ] {
            entries.push((label,"event","worker_update",json!({"name":"Research assistant","status":status,"objective":"Compare the example options and prepare a summary.","success_criteria":"Evidence-backed comparison with clear tradeoffs."})));
        }
        for (exit, timed, label) in [
            (0, false, "Action succeeded"),
            (1, false, "Action failed"),
            (124, true, "Action timed out"),
        ] {
            entries.push((label,"event","action",json!({"exit_code":exit,"timed_out":timed,"interpreter":"python","stdout":if exit==0{"Saved example report."}else{""},"stderr":if exit!=0{"Synthetic diagnostic output."}else{""},"code":"print('Design preview only')","success_criteria":"An example output is available."})));
        }
        entries.push(("Older recording started","event","browser_session_started",json!({"session_id":format!("sess_{}",crate::db::new_id()),"initial_url":"https://example.test/"})));
        entries.push(("Older recording ended","event","browser_session_completed",json!({"session_id":format!("sess_{}",crate::db::new_id()),"final_url":"https://example.test/","duration_ms":65000,"total_steps":12})));
        entries.push(("Error message","event","error",json!("Example: the requested operation could not be completed. Your conversation is preserved.")));
        for (label, role, kind, data) in entries {
            let mut caption = crate::chat::new_message(
                TASK_ID,
                "assistant",
                "chat",
                format!("### {label}\nSynthetic design example."),
                None,
                Some("Design preview".into()),
                true,
            );
            crate::chat::insert_message(conn, &mut caption)?;
            let mut card=crate::chat::new_message(TASK_ID,"event","ui_showcase",json!({"label":label,"card":{"role":role,"kind":kind,"content":if data.is_string(){data.as_str().unwrap().to_owned()}else{data.to_string()},"created_at":now}}).to_string(),None,None,true);
            crate::chat::insert_message(conn, &mut card)?;
        }
        let mut sample=crate::chat::new_message(TASK_ID,"event","ui_showcase",json!({"label":"User message and stored attachments","card":{"role":"user","kind":"chat","content":"Please review these sample inputs.","attachments":[{"id":"preview-image","task_id":TASK_ID,"filename":"sample-image.png","mime_type":"image/png","status":"ready"},{"id":"preview-document","task_id":TASK_ID,"filename":"report.pdf","mime_type":"application/pdf","status":"ready"}],"created_at":now}}).to_string(),None,None,true);
        crate::chat::insert_message(conn, &mut sample)?;
        let mut sample=crate::chat::new_message(TASK_ID,"event","ui_showcase",json!({"label":"Assistant answer and reasoning","reasoning":"I checked the example evidence and organized the results.","card":{"role":"assistant","kind":"chat","content":"## Example summary\n\n- First result with **emphasis**.\n- Second result with `inline code`.\n\n| Item | Status |\n|---|---|\n| Report | Ready |\n\n[Example website](https://example.test/)","model":"Design preview","credits_used":12,"created_at":now}}).to_string(),None,None,true);
        crate::chat::insert_message(conn, &mut sample)?;
        let mut plan=crate::chat::new_message(TASK_ID,"assistant","action_plan",json!({"markdown":"# Example plan\n- [Done] Gather example inputs\n- [/] Review layout\n- [ ] Finalize design\n\nDesign note: these are illustrative statuses, not an active task.","steps_source":"markdown","steps":crate::orchestrator::parse_markdown_steps("- [Done] Gather example inputs\n- [/] Review layout\n- [ ] Finalize design")}).to_string(),None,None,true);
        crate::chat::insert_message(conn, &mut plan)?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE task_id=?1 AND kind='ui_showcase'",
                [TASK_ID],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(json!({"task_id":TASK_ID,"created":true,"preview_cards":count}))
    })();
    if result.is_err() {
        let _ = conn.execute_batch("ROLLBACK TO ui_showcase");
    }
    conn.execute_batch("RELEASE ui_showcase")
        .map_err(|e| e.to_string())?;
    result
}
pub fn create_in_workspace() -> Result<Value, String> {
    let root = crate::utils::workspace_root()?;
    crate::browser_capture::validate_directory(&root)?;
    let path = root.join("zeus.db");
    if crate::file_paths::is_reparse(&path) {
        return Err("SHOWCASE_PATH: database is missing or linked".into());
    }
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(3))
        .map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys=ON")
        .map_err(|e| e.to_string())?;
    create(&conn)
}
#[cfg(test)]
mod tests {
    #[test]
    fn gallery_is_idempotent_and_has_no_executable_records() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        assert_eq!(super::create(&conn).unwrap()["created"], true);
        assert_eq!(super::create(&conn).unwrap()["created"], false);
        for table in ["runs", "workers", "managed_browser_sessions"] {
            assert_eq!(
                conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM messages WHERE kind='approval'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }
}
