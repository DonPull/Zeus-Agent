use crate::db::{new_id, now_iso, AppState};
use crate::gateway::{self, ChatMessage};
use crate::orchestrator::{self, Directive};
use crate::settings;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{Emitter, State};

pub const DEFAULT_TASK_TITLE: &str = "New agent task";

#[derive(Serialize)]
pub struct TaskDto {
    pub id: String,
    pub title: String,
    pub status: String,
    pub budget_credits: i64,
    pub spent_credits: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Clone)]
pub struct MessageDto {
    pub id: String,
    pub task_id: String,
    pub conversation: String,
    pub role: String,
    pub kind: String,
    pub content: String,
    pub credits_used: Option<f64>,
    pub model: Option<String>,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct SendResultDto {
    pub user_message: MessageDto,
    pub assistant_message: MessageDto,
    pub spent_credits: f64,
    pub budget_credits: i64,
}

#[derive(Serialize)]
pub struct SpendDto {
    pub spent_units: f64,
    pub budget_units: i64,
}

fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<TaskDto> {
    Ok(TaskDto {
        id: row.get(0)?,
        title: row.get(1)?,
        status: row.get(2)?,
        budget_credits: row.get(3)?,
        spent_credits: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn row_to_message(row: &rusqlite::Row) -> rusqlite::Result<MessageDto> {
    Ok(MessageDto {
        id: row.get(0)?,
        task_id: row.get(1)?,
        conversation: row.get(2)?,
        role: row.get(3)?,
        kind: row.get(4)?,
        content: row.get(5)?,
        credits_used: row.get(6)?,
        model: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn load_task(connection: &Connection, task_id: &str) -> Result<TaskDto, String> {
    connection
        .query_row(
            "SELECT id, title, status, budget_credits, spent_credits, created_at, updated_at FROM tasks WHERE id = ?1",
            params![task_id],
            row_to_task,
        )
        .map_err(|_| format!("Task not found: {}", task_id))
}

fn insert_message(connection: &Connection, message: &MessageDto) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO messages (id, task_id, conversation, role, kind, content, credits_used, model, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                message.id, message.task_id, message.conversation, message.role,
                message.kind, message.content, message.credits_used, message.model, message.created_at
            ],
        )
        .map_err(|e| format!("Failed to save the message: {}", e))?;
    Ok(())
}

/// Persists a hidden pipeline message (directive / directive_result) and
/// returns it. These are model-context messages the UI never renders.
fn insert_hidden_message(
    connection: &Connection,
    task_id: &str,
    role: &str,
    kind: &str,
    content: &str,
    credits_used: Option<f64>,
    model: Option<String>,
) -> Result<MessageDto, String> {
    let message = MessageDto {
        id: new_id(),
        task_id: task_id.to_string(),
        conversation: "master".into(),
        role: role.into(),
        kind: kind.into(),
        content: content.to_string(),
        credits_used,
        model,
        created_at: now_iso(),
    };
    insert_message(connection, &message)?;
    Ok(message)
}

/// Emits a message to the frontend immediately so action cards appear live.
fn emit_message(app_handle: &tauri::AppHandle, task_id: &str, message: &MessageDto) {
    let _ = app_handle.emit(
        "task-message",
        serde_json::json!({ "task_id": task_id, "message": message }),
    );
}

fn load_master_history(connection: &Connection, task_id: &str) -> Result<Vec<ChatMessage>, String> {
    let system_prompt = settings::load_master_prompt()?;
    let mut history = vec![ChatMessage { role: "system".into(), content: system_prompt }];

    let mut statement = connection
        .prepare(
            "SELECT role, content FROM messages
             WHERE task_id = ?1 AND conversation = 'master' AND kind IN ('chat','directive','directive_result')
             ORDER BY rowid ASC",
        )
        .map_err(|e| format!("Failed to prepare the history query: {}", e))?;

    let rows = statement
        .query_map(params![task_id], |row| Ok(ChatMessage { role: row.get(0)?, content: row.get(1)? }))
        .map_err(|e| format!("Failed to load the conversation history: {}", e))?;

    for row in rows {
        history.push(row.map_err(|e| format!("Failed to read a history row: {}", e))?);
    }
    Ok(history)
}

#[tauri::command]
pub async fn create_task(state: State<'_, AppState>, title: Option<String>) -> Result<TaskDto, String> {
    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let app_settings = settings::read_settings(&connection)?;
    let now = now_iso();

    let task = TaskDto {
        id: new_id(),
        title: title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| DEFAULT_TASK_TITLE.into()),
        status: "active".into(),
        budget_credits: app_settings.default_budget_credits,
        spent_credits: 0.0,
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    connection
        .execute(
            "INSERT INTO tasks (id, title, status, budget_credits, spent_credits, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![task.id, task.title, task.status, task.budget_credits, task.spent_credits, task.created_at, task.updated_at],
        )
        .map_err(|e| format!("Failed to create the task: {}", e))?;

    let _ = crate::utils::task_workspace(&task.id);

    Ok(task)
}

#[tauri::command]
pub async fn list_tasks(state: State<'_, AppState>) -> Result<Vec<TaskDto>, String> {
    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let mut statement = connection
        .prepare("SELECT id, title, status, budget_credits, spent_credits, created_at, updated_at FROM tasks ORDER BY updated_at DESC")
        .map_err(|e| format!("Failed to prepare the task list query: {}", e))?;

    let rows = statement.query_map([], row_to_task).map_err(|e| format!("Failed to load the task list: {}", e))?;

    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(row.map_err(|e| format!("Failed to read a task row: {}", e))?);
    }
    Ok(tasks)
}

#[tauri::command]
pub async fn get_task_messages(state: State<'_, AppState>, task_id: String) -> Result<Vec<MessageDto>, String> {
    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let mut statement = connection
        .prepare(
            "SELECT id, task_id, conversation, role, kind, content, credits_used, model, created_at
             FROM messages WHERE task_id = ?1 AND conversation = 'master'
             ORDER BY rowid ASC",
        )
        .map_err(|e| format!("Failed to prepare the messages query: {}", e))?;

    let rows = statement.query_map(params![task_id], row_to_message).map_err(|e| format!("Failed to load the messages: {}", e))?;

    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|e| format!("Failed to read a message row: {}", e))?);
    }
    Ok(messages)
}

#[tauri::command]
pub async fn get_task_spend(state: State<'_, AppState>, task_id: String) -> Result<SpendDto, String> {
    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let task = load_task(&connection, &task_id)?;
    Ok(SpendDto { spent_units: task.spent_credits, budget_units: task.budget_credits })
}

/// Records a model call in the ledger and bumps the task's spend. Returns the
/// unit cost so the caller can attach it to the assistant message.
fn record_spend(
    connection: &Connection,
    task_id: &str,
    model: &str,
    usage: &gateway::UsageInfo,
    usage_json: &str,
) -> Result<f64, String> {
    let units = usage.units();
    let now = now_iso();
    connection
        .execute(
            "INSERT INTO credit_events (id, task_id, model, input_tokens, output_tokens, reasoning_tokens, total_tokens, units, tool_calls, images, credits, raw_usage_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12)",
            params![
                new_id(), task_id, model,
                usage.input_tokens, usage.output_tokens, usage.reasoning_tokens, usage.total_tokens,
                units, usage.tool_calls, usage.images, usage_json, now
            ],
        )
        .map_err(|e| format!("Failed to log the credit event: {}", e))?;

    connection
        .execute(
            "UPDATE tasks SET spent_credits = spent_credits + ?1, updated_at = ?2 WHERE id = ?3",
            params![units, now_iso(), task_id],
        )
        .map_err(|e| format!("Failed to update the task spend: {}", e))?;

    Ok(units)
}

#[tauri::command]
pub async fn send_user_message(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    task_id: String,
    content: String,
) -> Result<SendResultDto, String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("Cannot send an empty message.".into());
    }

    // 1) Lock the db only for local reads/writes, never across network calls.
    let (history, user_message, task, master_model, mut current_spend, updated_approval) = {
        let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let app_settings = settings::read_settings(&connection)?;
        let mut task = load_task(&connection, &task_id)?;

        if task.spent_credits >= task.budget_credits as f64 {
            return Err("BUDGET_EXCEEDED".into());
        }

        let now = now_iso();
        let user_message = MessageDto {
            id: new_id(),
            task_id: task_id.clone(),
            conversation: "master".into(),
            role: "user".into(),
            kind: "chat".into(),
            content: content.clone(),
            credits_used: None,
            model: None,
            created_at: now.clone(),
        };
        insert_message(&connection, &user_message)?;

        // If this message carries an approval decision, stamp the latest pending
        // approval card so it deactivates and the decision survives reloads.
        let mut updated_approval: Option<MessageDto> = None;
        if content.starts_with("[APPROVAL DECISION]") {
            let approved = content.contains("APPROVED");
            let note = content
                .split_once(". Note:")
                .map(|(_, n)| n.trim().to_string())
                .unwrap_or_default();
            let latest = connection
                .query_row(
                    "SELECT id, task_id, conversation, role, kind, content, credits_used, model, created_at
                     FROM messages WHERE task_id = ?1 AND kind = 'approval'
                     ORDER BY rowid DESC LIMIT 1",
                    params![task_id],
                    row_to_message,
                )
                .optional();
            if let Ok(Some(mut approval_msg)) = latest {
                if let Ok(mut data) = serde_json::from_str::<serde_json::Value>(&approval_msg.content) {
                    if data["status"].as_str() == Some("pending") {
                        data["status"] = serde_json::Value::String(if approved { "approved".into() } else { "denied".into() });
                        if !note.is_empty() {
                            data["note"] = serde_json::Value::String(note);
                        }
                        approval_msg.content = data.to_string();
                        connection
                            .execute("UPDATE messages SET content = ?1 WHERE id = ?2", params![approval_msg.content, approval_msg.id])
                            .map_err(|e| format!("Failed to record the approval decision: {}", e))?;
                        updated_approval = Some(approval_msg);
                    }
                }
            }
        }

        if task.title == DEFAULT_TASK_TITLE {
            let mut title: String = content.chars().take(48).collect();
            if content.chars().count() > 48 {
                title.push('…');
            }
            connection
                .execute("UPDATE tasks SET title = ?1, updated_at = ?2 WHERE id = ?3", params![title, now, task_id])
                .map_err(|e| format!("Failed to update the task title: {}", e))?;
            task.title = title;
        }

        let history = load_master_history(&connection, &task_id)?;
        let current_spend = task.spent_credits;
        (history, user_message, task, app_settings.master_model, current_spend, updated_approval)
    };

    if let Some(msg) = updated_approval {
        emit_message(&app_handle, &task_id, &msg);
    }

    let budget_units = task.budget_credits;
    let mut history = history;
    let mut final_assistant: Option<MessageDto> = None;

    // 2) Orchestration loop. Each iteration may add directive-result messages
    //    to `history` (and persist them) before re-calling the master.
    for _iteration in 0..orchestrator::MAX_ORCHESTRATION_ITERATIONS {
        if current_spend >= budget_units as f64 {
            let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
            let note = MessageDto {
                id: new_id(),
                task_id: task_id.clone(),
                conversation: "master".into(),
                role: "event".into(),
                kind: "chat".into(),
                content: "Zeus paused because this task reached its unit budget. Increase the budget (per-task editing lands in M1b) or start a new task.".into(),
                credits_used: None,
                model: None,
                created_at: now_iso(),
            };
            insert_message(&connection, &note)?;
            emit_message(&app_handle, &task_id, &note);
            drop(connection);
            break;
        }

        let stream_handle = app_handle.clone();
        let stream_task_id = task_id.clone();
        let stream_result = gateway::stream_model_reply(&master_model, &history, move |event| {
                let _ = stream_handle.emit("chat-stream", serde_json::json!({
                    "task_id": stream_task_id,
                    "event": event,
                }));
            })
            .await;
        let (reply_text, _reasoning_summary, usage, usage_json, model_used) = match stream_result {
            Ok(v) => v,
            Err(e) => {
                // Persist the failure as an event so it survives reloads —
                // previously it lived only in frontend state and vanished on refresh.
                crate::logger::log(&task_id, "gateway", &format!("model call failed: {}", e));
                let error_message = MessageDto {
                    id: new_id(),
                    task_id: task_id.clone(),
                    conversation: "master".into(),
                    role: "event".into(),
                    kind: "error".into(),
                    content: format!("Zeus failed to respond: {}. Your message above is preserved — you can resend it.", e),
                    credits_used: None,
                    model: None,
                    created_at: now_iso(),
                };
                {
                    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
                    insert_message(&connection, &error_message)?;
                }
                emit_message(&app_handle, &task_id, &error_message);
                return Err(e);
            }
        };

        let model_name = model_used.unwrap_or_else(|| master_model.clone());

        // Persist the spend + assistant reply for this iteration.
        let units = {
            let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
            record_spend(&connection, &task_id, &model_name, &usage, &usage_json)?
        };
        current_spend += units;

        match orchestrator::parse_master_reply(&reply_text) {
            orchestrator::MasterReply::Text(text) => {
                let assistant_message = MessageDto {
                    id: new_id(),
                    task_id: task_id.clone(),
                    conversation: "master".into(),
                    role: "assistant".into(),
                    kind: "chat".into(),
                    content: text.clone(),
                    credits_used: Some(units),
                    model: Some(model_name.clone()),
                    created_at: now_iso(),
                };
                {
                    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
                    insert_message(&connection, &assistant_message)?;
                }
                history.push(ChatMessage { role: "assistant".into(), content: text });
                final_assistant = Some(assistant_message);
                break;
            }
            orchestrator::MasterReply::MalformedDirective(error, raw) => {
                // Never show raw directive JSON to the user. Persist it hidden,
                // tell the model what went wrong, and loop so it can self-heal.
                crate::logger::log(&task_id, "orchestrator", &format!("MALFORMED directive: {}", error));
                let feedback = format!(
                    "[DIRECTIVE_ERROR] Your directive block could not be parsed: {}. Re-emit exactly ONE valid ```zeus-directive block (single JSON object, nothing after the closing fence), or reply in plain text if no action is needed.",
                    error
                );
                {
                    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
                    insert_hidden_message(&connection, &task_id, "assistant", "directive", &raw, Some(units), Some(model_name.clone()))?;
                    insert_hidden_message(&connection, &task_id, "user", "directive_result", &feedback, None, None)?;
                }
                history.push(ChatMessage { role: "assistant".into(), content: raw });
                history.push(ChatMessage { role: "user".into(), content: feedback });
                // Loop: call the master again with the error feedback.
            }
            orchestrator::MasterReply::Directive(directive, raw) => {
                // Persist the directive reply as kind 'directive' — model
                // context only, hidden from the UI and the chat log.
                crate::logger::log(&task_id, "orchestrator", &format!("directive parsed: {:?}", &directive));
                {
                    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
                    insert_hidden_message(&connection, &task_id, "assistant", "directive", &raw, Some(units), Some(model_name.clone()))?;
                }
                history.push(ChatMessage { role: "assistant".into(), content: raw });

                match directive {
                    Directive::FinalAnswer { final_answer } => {
                        let assistant_message = MessageDto {
                            id: new_id(),
                            task_id: task_id.clone(),
                            conversation: "master".into(),
                            role: "assistant".into(),
                            kind: "chat".into(),
                            content: final_answer.summary.clone(),
                            credits_used: Some(units),
                            model: Some(model_name.clone()),
                            created_at: now_iso(),
                        };
                        {
                            let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
                            insert_message(&connection, &assistant_message)?;
                        }
                        history.push(ChatMessage { role: "assistant".into(), content: final_answer.summary });
                        final_assistant = Some(assistant_message);
                        break;
                    }
                    Directive::TaskUpdate { update } => {
                        let detail: String;
                        if let Some(new_title) = update.title.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
                            let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
                            let res = connection.execute(
                                "UPDATE tasks SET title = ?1, updated_at = ?2 WHERE id = ?3",
                                params![new_title, now_iso(), task_id],
                            );
                            detail = match res {
                                Ok(_) => format!("title set to \"{}\"", new_title),
                                Err(e) => format!("failed to set title: {}", e),
                            };
                        } else {
                            detail = "no changes requested".into();
                        }
                        let result_json = orchestrator::task_update_result_json(true, &detail);
                        let msg = orchestrator::directive_result_message(&result_json);
                        {
                            let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
                            insert_hidden_message(&connection, &task_id, "user", "directive_result", &msg, None, None)?;
                        }
                        history.push(ChatMessage { role: "user".into(), content: msg });
                        // Loop: call the master again with the result.
                    }
                    Directive::RequestApproval { approval } => {
                        let approval_message = MessageDto {
                            id: new_id(),
                            task_id: task_id.clone(),
                            conversation: "master".into(),
                            role: "event".into(),
                            kind: "approval".into(),
                            content: serde_json::json!({
                                "summary": approval.summary,
                                "detail": approval.detail,
                                "status": "pending",
                            })
                            .to_string(),
                            credits_used: None,
                            model: None,
                            created_at: now_iso(),
                        };
                        {
                            let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
                            insert_message(&connection, &approval_message)?;
                        }
                        emit_message(&app_handle, &task_id, &approval_message);
                        // Stop the loop: the user's decision will arrive as a
                        // new send, which restarts orchestration.
                        let assistant_message = MessageDto {
                            id: new_id(),
                            task_id: task_id.clone(),
                            conversation: "master".into(),
                            role: "assistant".into(),
                            kind: "chat".into(),
                            content: "I need your approval before continuing — see the card above.".into(),
                            credits_used: Some(units),
                            model: Some(model_name.clone()),
                            created_at: now_iso(),
                        };
                        {
                            let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
                            insert_message(&connection, &assistant_message)?;
                        }
                        final_assistant = Some(assistant_message);
                        break;
                    }
                    Directive::RunAction { action, success_criteria } => {
                        let workspace = crate::utils::task_workspace(&task_id)?;
                        let outcome = crate::python_runner::run_python_action(
                            &workspace,
                            &action.code,
                            action.timeout_secs,
                        )
                        .await?;

                        let result_json = orchestrator::action_result_json(
                            &outcome.stdout,
                            &outcome.stderr,
                            outcome.exit_code,
                            outcome.timed_out,
                            &outcome.interpreter,
                        );

                        let action_message = MessageDto {
                            id: new_id(),
                            task_id: task_id.clone(),
                            conversation: "master".into(),
                            role: "event".into(),
                            kind: "action".into(),
                            content: serde_json::json!({
                                "language": action.language,
                                "code": action.code,
                                "success_criteria": success_criteria,
                                "exit_code": outcome.exit_code,
                                "timed_out": outcome.timed_out,
                                "interpreter": outcome.interpreter,
                                "stdout": outcome.stdout,
                                "stderr": outcome.stderr,
                            })
                            .to_string(),
                            credits_used: None,
                            model: None,
                            created_at: now_iso(),
                        };
                        {
                            let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
                            insert_message(&connection, &action_message)?;
                        }
                        emit_message(&app_handle, &task_id, &action_message);

                        crate::logger::log(&task_id, "runner", &format!("action exit={} timed_out={} stdout_len={} stderr_len={}", outcome.exit_code, outcome.timed_out, outcome.stdout.len(), outcome.stderr.len()));
                        let msg = orchestrator::directive_result_message(&result_json);
                        {
                            let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
                            insert_hidden_message(&connection, &task_id, "user", "directive_result", &msg, None, None)?;
                        }
                        history.push(ChatMessage { role: "user".into(), content: msg });
                        // Loop: call the master again with the action result.
                    }
                }
            }
        }
    }

    // 3) Resolve the final assistant message (fallback if the cap was hit).
    let assistant_message = match final_assistant {
        Some(m) => m,
        None => {
            let m = MessageDto {
                id: new_id(),
                task_id: task_id.clone(),
                conversation: "master".into(),
                role: "assistant".into(),
                kind: "chat".into(),
                content: "I reached the maximum number of orchestration steps for this turn. Tell me to continue and I'll pick up from here.".into(),
                credits_used: None,
                model: Some(master_model.clone()),
                created_at: now_iso(),
            };
            let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
            insert_message(&connection, &m)?;
            m
        }
    };

    Ok(SendResultDto {
        user_message,
        spent_credits: current_spend,
        budget_credits: budget_units,
        assistant_message,
    })
}

#[tauri::command]
pub async fn rename_task(state: State<'_, AppState>, task_id: String, new_title: String) -> Result<(), String> {
    let title = new_title.trim();
    if title.is_empty() {
        return Err("The task title cannot be empty.".into());
    }
    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    connection
        .execute("UPDATE tasks SET title = ?1, updated_at = ?2 WHERE id = ?3", params![title, now_iso(), task_id])
        .map_err(|e| format!("Failed to rename the task: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_task(state: State<'_, AppState>, task_id: String) -> Result<(), String> {
    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    connection
        .execute("DELETE FROM messages WHERE task_id = ?1", params![task_id])
        .map_err(|e| format!("Failed to delete the task messages: {}", e))?;
    connection
        .execute("DELETE FROM credit_events WHERE task_id = ?1", params![task_id])
        .map_err(|e| format!("Failed to delete the task credit events: {}", e))?;
    let _ = connection.execute("DELETE FROM approvals WHERE task_id = ?1", params![task_id]);
    connection
        .execute("DELETE FROM tasks WHERE id = ?1", params![task_id])
        .map_err(|e| format!("Failed to delete the task: {}", e))?;
    drop(connection);
    if let Ok(workspace) = crate::utils::task_workspace(&task_id) {
        let _ = std::fs::remove_dir_all(workspace);
    }
    Ok(())
}