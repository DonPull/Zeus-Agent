use crate::chat::{
    finish_cancelled_run, new_message_for_conversation, persist_and_emit, record_spend, MessageDto,
};
use crate::db::{new_id, now_iso, AppState};
use crate::gateway::{self, ChatMessage};
use crate::orchestrator::{self, DelegateSpec, Directive};
use crate::settings;
use rusqlite::params;
use serde_json::json;
use tauri::{AppHandle, State};
use tokio_util::sync::CancellationToken;

const WORKER_SYSTEM_PROMPT: &str = r#"You are a Zeus worker agent named {name}.
Your objective is:
{objective}

Your success criteria are:
{success_criteria}

Every reply you give MUST be exactly ONE directive: a fenced code block whose language tag is zeus-directive, containing a single JSON object. When you emit a directive, it must be the ONLY content of your reply.

## Directives
1. Run a Terminal Command:
```zeus-directive
{"type":"run_command","command":"<the command string>"}
```

2. Read a file:
```zeus-directive
{"type":"read_file","path":"<absolute_path>"}
```

3. Write to a file:
```zeus-directive
{"type":"write_file","path":"<absolute_path>","content":"<file content>"}
```

4. Delete a file:
```zeus-directive
{"type":"delete_file","path":"<absolute_path>"}
```

5. Make an HTTP Request:
```zeus-directive
{"type":"http_request","url":"<url>","method":"GET","body":null}
```

6. Run a Python script:
```zeus-directive
{"type":"run_action","action":{"language":"python","code":"<python source>","timeout_secs":60},"success_criteria":"expected result"}
```

7. Ask user to login / solve CAPTCHA in browser:
```zeus-directive
{"type":"ask_user_for_login","reason":"Please log into X so I can continue."}
```

8. Finish the task with a final answer:
```zeus-directive
{"type":"final_answer","final_answer":{"summary":"the complete answer in markdown"}}
```

## Rules
- **Relentless Agentic Behavior**: Your highest priority is to achieve the objective at any cost. If you encounter roadblocks (like permission errors, tool failures, or API limits), you must find a way around them to achieve the goal. Do NOT simply report failure. Only if you determine that the goal is fundamentally impossible to achieve after exhausting every possible avenue, you must report back with a final answer explaining exactly what went wrong.
- **Zero-Knowledge Permissions**: DO NOT try to ask the user for permission. Just emit the directive. If permission is required, the system will seamlessly intercept your directive, ask the user, and execute it once they approve.
- Never claim to have taken actions or fetched data you have not. Only report what actually ran.
- **Browser Automation**: To control the browser, write a Python script using the `playwright` package. Connect to the active browser using the `ZEUS_BROWSER_WS_ENDPOINT` environment variable like this:
  `p.chromium.connect_over_cdp(os.environ["ZEUS_BROWSER_WS_ENDPOINT"])`
  Do NOT launch a new browser instance using `p.chromium.launch()`.
- Once you have completely satisfied the success criteria, use final_answer to return your result."#;

const VERIFIER_PROMPT: &str = r#"You are the Zeus Verifier.
A worker agent was given this objective:
{objective}

The worker had to meet these success criteria:
{success_criteria}

The worker provided this final result:
{result}

You must evaluate if the worker's result completely satisfies the success criteria.
Be strict and critical. Do not accept generic, unsubstantiated answers, or answers that lack requested evidence/URLs.

Respond ONLY with a JSON object matching this schema (no markdown fences, no preamble):
{
  "passed": boolean,
  "feedback": "string explaining why it passed or failed (be specific)"
}"#;

pub async fn run_worker(
    state: &State<'_, AppState>,
    app_handle: &AppHandle,
    task_id: &str,
    run_id: &str,
    cancellation_token: &CancellationToken,
    delegate: &DelegateSpec,
    mut current_spend: f64,
) -> Result<String, String> {
    let worker_id = new_id();
    let conversation = format!("worker:{}", worker_id);
    let now = now_iso();

    // 1. Create the worker in the DB
    {
        let connection = state
            .db
            .lock()
            .map_err(|e| format!("Database lock error: {}", e))?;
        connection
            .execute(
                "INSERT INTO workers (id, task_id, name, objective, success_criteria, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?6)",
                params![worker_id, task_id, delegate.name, delegate.objective, delegate.success_criteria, now],
            )
            .map_err(|e| format!("Failed to create worker: {}", e))?;
    }

    // Emit a visible event message to the master chat so the user knows a worker started
    let mut started_msg = new_message_for_conversation(
        task_id,
        "master",
        "event",
        "worker_started",
        json!({
            "worker_id": worker_id,
            "name": delegate.name,
            "objective": delegate.objective,
            "success_criteria": delegate.success_criteria,
            "status": "running"
        })
        .to_string(),
        None,
        None,
        true, // visible to UI
    );
    persist_and_emit(state, app_handle, task_id, &mut started_msg)?;
    let started_msg_id = started_msg.id.clone();

    // 2. Setup the worker's chat history
    let system_content = WORKER_SYSTEM_PROMPT
        .replace("{name}", &delegate.name)
        .replace("{objective}", &delegate.objective)
        .replace("{success_criteria}", &delegate.success_criteria);

    let mut history = vec![
        ChatMessage {
            role: "system".into(),
            content: system_content.clone(),
        },
        ChatMessage {
            role: "user".into(),
            content: "Begin executing your assigned objective. Remember to use the RunAction directive to perform work in the workspace.".into(),
        }
    ];

    // We also persist this hidden system message in the worker's conversation
    let mut sys_msg = new_message_for_conversation(
        task_id,
        &conversation,
        "system",
        "chat",
        system_content,
        None,
        None,
        false,
    );
    persist_and_emit(state, app_handle, task_id, &mut sys_msg)?;

    let mut initial_user_msg = new_message_for_conversation(
        task_id,
        &conversation,
        "user",
        "chat",
        "Begin executing your assigned objective. Remember to use the RunAction directive to perform work in the workspace.".into(),
        None,
        None,
        false,
    );
    persist_and_emit(state, app_handle, task_id, &mut initial_user_msg)?;

    let (worker_model, verifier_model, budget_units) = {
        let conn = state.db.lock().unwrap();
        let t = crate::chat::load_task(&conn, task_id).map_err(|e| e.to_string())?;
        (t.worker_model, t.verifier_model, t.budget_credits)
    };

    let max_retries = 3;
    let mut retry_count = 0;

    loop {
        // Run the worker orchestration loop
        let mut loop_iterations = 0;
        let worker_result = loop {
            loop_iterations += 1;
            if loop_iterations > orchestrator::MAX_ORCHESTRATION_ITERATIONS {
                break Err("Worker hit iteration cap without a final answer.".to_string());
            }

            // Stream response
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
            let model_clone = worker_model.clone();
            let history_clone = history.clone();

            let payload_size = serde_json::to_string(&history_clone).map(|s| s.len()).unwrap_or(0);
            crate::logger::log(task_id, "worker", &format!("Sending payload to model ({} messages, ~{} bytes)", history_clone.len(), payload_size));

            let stream_future = gateway::chat_completion_stream(&model_clone, &history_clone, move |payload| {
                let _ = tx.send(payload);
            });
            tokio::pin!(stream_future);

            let mut reply_text = String::new();
            let mut usage = gateway::UsageInfo::default();
            let mut usage_json = String::new();
            let mut model_used = None;

            let stream_result = tokio::select! {
                res = &mut stream_future => res,
                _ = cancellation_token.cancelled() => {
                    crate::logger::log(task_id, "worker", "Cancellation token triggered. Aborting model stream.");
                    finish_cancelled_run(state, app_handle, task_id, run_id)?;
                    return Err("RUN_CANCELLED".into());
                }
            };

            match stream_result {
                Ok((t, u, uj, m)) => {
                    reply_text = t;
                    usage = u;
                    usage_json = uj;
                    model_used = m;
                }
                Err(e) => {
                    break Err(format!("Worker model error: {}", e));
                }
            }

            let actual_model = model_used.unwrap_or_else(|| worker_model.clone());
            let units = {
                let conn = state.db.lock().unwrap();
                record_spend(&conn, task_id, &actual_model, &usage, &usage_json).unwrap_or(0.0)
            };
            current_spend += units;

            if current_spend >= budget_units as f64 {
                break Err("BUDGET_EXCEEDED".to_string());
            }

            match orchestrator::parse_master_reply(&reply_text) {
                orchestrator::MasterReply::Text(text) => {
                    let mut assistant_message = new_message_for_conversation(
                        task_id, &conversation, "assistant", "chat", text.clone(), Some(units), Some(actual_model), false
                    );
                    persist_and_emit(state, app_handle, task_id, &mut assistant_message)?;
                    history.push(ChatMessage { role: "assistant".into(), content: text.clone() });
                    break Ok(text); // Worker just replied with text, we consider it their final answer.
                }
                orchestrator::MasterReply::MalformedDirective(error, _extracted, raw) => {
                    let feedback = format!("[DIRECTIVE_ERROR] {}", error);
                    let preamble = if let Some(idx) = raw.find("```zeus-directive") {
                        raw[..idx].trim().to_string()
                    } else if let Some(idx) = raw.find('{') {
                        raw[..idx].trim().to_string()
                    } else {
                        String::new()
                    };
                    if !preamble.is_empty() {
                        let mut preamble_msg = new_message_for_conversation(
                            task_id, &conversation, "assistant", "chat", preamble, None, None, false
                        );
                        persist_and_emit(state, app_handle, task_id, &mut preamble_msg)?;
                    }

                    let mut hidden_directive = new_message_for_conversation(
                        task_id, &conversation, "assistant", "directive", raw.clone(), Some(units), Some(actual_model), false
                    );
                    persist_and_emit(state, app_handle, task_id, &mut hidden_directive)?;
                    
                    let mut hidden_result = new_message_for_conversation(
                        task_id, &conversation, "user", "directive_result", feedback.clone(), None, None, false
                    );
                    persist_and_emit(state, app_handle, task_id, &mut hidden_result)?;
                    
                    history.push(ChatMessage { role: "assistant".into(), content: raw });
                    history.push(ChatMessage { role: "user".into(), content: feedback });
                }
                orchestrator::MasterReply::Directive(preamble, directive, raw) => {
                    let preamble = if let Some(idx) = raw.find("```zeus-directive") {
                        raw[..idx].trim().to_string()
                    } else if let Some(idx) = raw.find('{') {
                        raw[..idx].trim().to_string()
                    } else {
                        String::new()
                    };
                    if !preamble.is_empty() {
                        let mut preamble_msg = new_message_for_conversation(
                            task_id, &conversation, "assistant", "chat", preamble, None, None, false
                        );
                        persist_and_emit(state, app_handle, task_id, &mut preamble_msg)?;
                    }

                    let mut hidden_directive = new_message_for_conversation(
                        task_id, &conversation, "assistant", "directive", raw.clone(), Some(units), Some(actual_model.clone()), false
                    );
                    persist_and_emit(state, app_handle, task_id, &mut hidden_directive)?;
                    history.push(ChatMessage { role: "assistant".into(), content: raw });

                    match directive {
                        Directive::FinalAnswer { final_answer } => {
                            let mut assistant_message = new_message_for_conversation(
                                task_id, &conversation, "assistant", "chat", final_answer.summary.clone(), Some(units), Some(actual_model), false
                            );
                            persist_and_emit(state, app_handle, task_id, &mut assistant_message)?;
                            history.push(ChatMessage { role: "assistant".into(), content: final_answer.summary.clone() });
                            break Ok(final_answer.summary);
                        }
                        Directive::RunAction { action, success_criteria } => {
                            let workspace = crate::utils::task_workspace(task_id)?;
                            let task_data = crate::chat::load_task(&state.db.lock().unwrap(), task_id).map_err(|e| e.to_string())?;
                            let browser_port = state.browser_manager.ensure_browser(task_id, &task_data.browser_mode, &task_data.browser_executable_path).ok();
                            
                            let action_future = crate::python_runner::run_python_action(
                                Some(app_handle.clone()),
                                Some(task_id.to_string()),
                                &workspace, &action.code, action.timeout_secs,
                                browser_port
                            );
                            tokio::pin!(action_future);

                            let outcome = tokio::select! {
                                result = &mut action_future => result.map_err(|e| e.to_string())?,
                                _ = cancellation_token.cancelled() => {
                                    finish_cancelled_run(state, app_handle, task_id, run_id)?;
                                    return Err("RUN_CANCELLED".into());
                                }
                            };

                            let result_json = orchestrator::action_result_json(
                                &outcome.stdout, &outcome.stderr, outcome.exit_code, outcome.timed_out, &outcome.interpreter
                            );

                            let msg = orchestrator::directive_result_message(&result_json);
                            let mut hidden_result = new_message_for_conversation(
                                task_id, &conversation, "user", "directive_result", msg.clone(), None, None, false
                            );
                            persist_and_emit(state, app_handle, task_id, &mut hidden_result)?;
                            history.push(ChatMessage { role: "user".into(), content: msg });
                        }
                        Directive::AskUserForLogin { reason } => {
                            let mut approval = new_message_for_conversation(
                                task_id, &conversation, "event", "handoff", json!({ "status": "pending", "reason": reason }).to_string(), None, None, true
                            );
                            persist_and_emit(state, app_handle, task_id, &mut approval)?;
                            
                            // Stop headless browser, start headed, then wait for approval
                            let _ = crate::browser_manager::start_browser_handoff(state.clone(), task_id.to_string()).await;
                            
                            // Wait for user
                            let (approved, note) = crate::chat::wait_for_approval(state.clone(), app_handle.clone(), task_id, &approval.id, run_id, cancellation_token.clone()).await?;
                            
                            // Restart headless
                            let _ = crate::browser_manager::finish_browser_handoff(state.clone(), task_id.to_string()).await;
                            
                            let feedback = if approved {
                                format!("User completed the handoff. You may continue. Note: {}", note)
                            } else {
                                "User denied the handoff or it failed.".to_string()
                            };
                            
                            let mut hidden_result = new_message_for_conversation(
                                task_id, &conversation, "user", "handoff_result", feedback.clone(), None, None, false
                            );
                            persist_and_emit(state, app_handle, task_id, &mut hidden_result)?;
                            history.push(ChatMessage { role: "user".into(), content: feedback });
                        }
                        _ => {
                            // Workers cannot delegate or request approval for now
                            let feedback = "[DIRECTIVE_ERROR] This directive is not allowed for worker agents.".to_string();
                            let mut hidden_result = new_message_for_conversation(
                                task_id, &conversation, "user", "directive_result", feedback.clone(), None, None, false
                            );
                            persist_and_emit(state, app_handle, task_id, &mut hidden_result)?;
                            history.push(ChatMessage { role: "user".into(), content: feedback });
                        }
                    }
                }
            }
        };

        // Verification phase
        let final_result_text = match worker_result {
            Ok(res) => res,
            Err(e) => {
                set_worker_status(state, &worker_id, "failed", Some(&e), None)?;
                update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "failed")?;
                return Err(format!("Verifier error: {}", e));
            }
        };

        set_worker_status(state, &worker_id, "verifying", None, Some(&final_result_text))?;
        update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "verifying")?;

        let verifier_prompt = VERIFIER_PROMPT
            .replace("{objective}", &delegate.objective)
            .replace("{success_criteria}", &delegate.success_criteria)
            .replace("{result}", &final_result_text);

        let verifier_messages = vec![ChatMessage {
            role: "user".into(),
            content: verifier_prompt,
        }];

        let verification_response = tokio::select! {
            res = gateway::chat_completion(&verifier_model, &verifier_messages) => res,
            _ = cancellation_token.cancelled() => {
                finish_cancelled_run(state, app_handle, task_id, run_id)?;
                return Err("RUN_CANCELLED".into());
            }
        };

        let verifier_output = match verification_response {
            Ok((text, u, uj, m)) => {
                let actual_model = m.unwrap_or_else(|| verifier_model.clone());
                let units = {
                    let conn = state.db.lock().unwrap();
                    record_spend(&conn, task_id, &actual_model, &u, &uj).unwrap_or(0.0)
                };
                current_spend += units;
                text
            }
            Err(e) => {
                let msg = format!("Malformed verifier output: {}", e);
                set_worker_status(state, &worker_id, "failed", Some(&msg), None)?;
                update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "failed")?;
                return Err(msg);
            }
        };

        let mut clean_output = verifier_output.trim();
        if clean_output.starts_with("```json") {
            clean_output = &clean_output[7..];
        } else if clean_output.starts_with("```") {
            clean_output = &clean_output[3..];
        }
        if clean_output.ends_with("```") {
            clean_output = &clean_output[..clean_output.len() - 3];
        }
        clean_output = clean_output.trim();

        let v_res: Result<orchestrator::VerificationResult, _> = serde_json::from_str(clean_output);
        match v_res {
            Ok(vr) => {
                if vr.passed {
                    set_worker_status(state, &worker_id, "completed", None, None)?;
                    update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "completed")?;
                    return Ok(final_result_text);
                } else {
                    if retry_count >= max_retries {
                        set_worker_status(state, &worker_id, "failed", Some("Max retries exceeded"), None)?;
                        update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "failed")?;
                        return Err("Worker failed to meet success criteria after max retries.".to_string());
                    } else {
                        update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "retrying")?;
                        set_worker_status(state, &worker_id, "retrying", None, None)?;
                        let retry_msg = format!("Your result was rejected by the verifier:\n{}\n\nPlease address the feedback and try again.", vr.feedback);
                        let mut hidden_retry = new_message_for_conversation(
                            task_id, &conversation, "user", "chat", retry_msg.clone(), None, None, false
                        );
                        persist_and_emit(state, app_handle, task_id, &mut hidden_retry)?;
                        history.push(ChatMessage { role: "user".into(), content: retry_msg });
                        
                        retry_count += 1;
                    }
                }
            }
            Err(e) => {
                let err = format!("Verifier provided invalid JSON: {}", e);
                set_worker_status(state, &worker_id, "failed", Some(&err), Some(&final_result_text))?;
                update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "failed")?;
                return Err(err);
            }
        }
    }
}

fn set_worker_status(
    state: &State<'_, AppState>,
    worker_id: &str,
    status: &str,
    feedback: Option<&str>,
    result: Option<&str>,
) -> Result<(), String> {
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    
    let now = now_iso();
    let completed_at = if status == "completed" || status == "failed" { Some(&now) } else { None };

    if status == "retrying" {
        connection.execute(
            "UPDATE workers SET status = 'running', retry_count = retry_count + 1, verification_feedback = ?1, result_text = ?2, updated_at = ?3 WHERE id = ?4",
            params![feedback, result, now, worker_id],
        ).map_err(|e| format!("Failed to update worker: {}", e))?;
    } else {
        connection.execute(
            "UPDATE workers SET status = ?1, verification_feedback = ?2, result_text = ?3, updated_at = ?4, completed_at = ?5 WHERE id = ?6",
            params![status, feedback, result, now, completed_at, worker_id],
        ).map_err(|e| format!("Failed to update worker: {}", e))?;
    }
    
    Ok(())
}

fn update_worker_event_and_emit(
    state: &State<'_, AppState>,
    app_handle: &AppHandle,
    msg_id: &str,
    task_id: &str,
    worker_id: &str,
    delegate: &DelegateSpec,
    status: &str,
) -> Result<(), String> {
    let content = json!({
        "worker_id": worker_id,
        "name": delegate.name,
        "objective": delegate.objective,
        "success_criteria": delegate.success_criteria,
        "status": status
    })
    .to_string();

    let (seq, created_at) = {
        let conn = state.db.lock().unwrap();
        conn.execute(
            "UPDATE messages SET content = ?1 WHERE id = ?2",
            params![content, msg_id],
        )
        .map_err(|e| format!("DB Error: {}", e))?;

        let mut stmt = conn
            .prepare("SELECT rowid, created_at FROM messages WHERE id = ?1")
            .unwrap();
        stmt.query_row(params![msg_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("DB Error: {}", e))?
    };

    let msg = MessageDto {
        id: msg_id.to_string(),
        task_id: task_id.to_string(),
        conversation: "master".to_string(),
        role: "event".to_string(),
        kind: "worker_started".to_string(),
        content,
        credits_used: None,
        model: None,
        created_at,
        seq,
        visible: true,
    };

    use tauri::Emitter;
    app_handle
        .emit("task-message", json!({ "task_id": task_id, "message": msg }))
        .map_err(|e| format!("Failed to emit event: {}", e))?;

    Ok(())
}
