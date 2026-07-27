use crate::db::{new_id, now_iso, AppState};
use crate::gateway::{self, ChatMessage};
use crate::orchestrator::{self, Directive};
use crate::settings;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use tokio_util::sync::CancellationToken;

pub const DEFAULT_TASK_TITLE: &str = "New agent task";

/// Owns one task's process-level orchestration lease and cancellation token.
///
/// The registry mutex is held only while inserting/removing the task entry.
/// Dropping this guard releases the task for its next run.
struct ActiveRunGuard<'a> {
    task_id: String,
    token: CancellationToken,
    active_runs: &'a std::sync::Mutex<std::collections::HashMap<String, CancellationToken>>,
}

impl<'a> ActiveRunGuard<'a> {
    fn acquire(state: &'a AppState, task_id: &str) -> Result<Self, String> {
        let mut active_runs = state
            .active_runs
            .lock()
            .map_err(|e| format!("Active-run lock error: {}", e))?;

        if active_runs.contains_key(task_id) {
            return Err("TASK_ALREADY_RUNNING".into());
        }

        let token = CancellationToken::new();
        active_runs.insert(task_id.to_string(), token.clone());

        Ok(Self {
            task_id: task_id.to_string(),
            token,
            active_runs: &state.active_runs,
        })
    }

    pub(crate) fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

impl Drop for ActiveRunGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active_runs) = self.active_runs.lock() {
            active_runs.remove(&self.task_id);
        }
    }
}

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
    /// DB rowid — the single authoritative ordering key (P0 "Bedrock").
    /// 0 until the message is persisted.
    pub seq: i64,
    pub visible: bool,
}

/// P0 contract: send_user_message no longer returns messages. Every message
/// is persisted and then delivered via 'task-message' events, so live state
/// and DB state cannot diverge.
#[derive(Serialize)]
pub struct SendResultDto {
    pub spent_credits: f64,
    pub budget_credits: i64,
}

#[derive(Serialize)]
pub struct SpendDto {
    pub spent_credits: f64,
    pub budget_credits: i64,
}

#[derive(Serialize, Clone)]
pub struct RunStateDto {
    pub id: String,
    pub request_id: String,
    pub task_id: String,
    pub status: String,
    pub error: Option<String>,
    pub started_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Serialize, Clone)]
struct TaskRunEvent {
    task_id: String,
    run: RunStateDto,
}

#[derive(Deserialize)]
struct ExistingRun {
    id: String,
    status: String,
}

fn row_to_run_state(row: &rusqlite::Row) -> rusqlite::Result<RunStateDto> {
    Ok(RunStateDto {
        id: row.get(0)?,
        request_id: row.get(1)?,
        task_id: row.get(2)?,
        status: row.get(3)?,
        error: row.get(4)?,
        started_at: row.get(5)?,
        updated_at: row.get(6)?,
        completed_at: row.get(7)?,
    })
}

const RUN_STATE_COLUMNS: &str =
    "id, request_id, task_id, status, error, started_at, updated_at, completed_at";

pub(crate) fn emit_run_state(app_handle: &tauri::AppHandle, run: &RunStateDto) {
    let _ = app_handle.emit(
        "task-event",
        TaskRunEvent {
            task_id: run.task_id.clone(),
            run: run.clone(),
        },
    );
}

fn load_run_state(connection: &Connection, run_id: &str) -> Result<RunStateDto, String> {
    connection
        .query_row(
            &format!("SELECT {} FROM runs WHERE id = ?1", RUN_STATE_COLUMNS),
            params![run_id],
            row_to_run_state,
        )
        .map_err(|e| format!("Failed to load run state: {}", e))
}

fn begin_durable_run(
    connection: &Connection,
    task_id: &str,
    request_id: &str,
) -> Result<RunStateDto, String> {
    if request_id.trim().is_empty() {
        return Err("A request ID is required.".into());
    }

    let existing: Option<ExistingRun> = connection
        .query_row(
            "SELECT id, status FROM runs WHERE request_id = ?1",
            params![request_id],
            |row| {
                Ok(ExistingRun {
                    id: row.get(0)?,
                    status: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("Failed to check request idempotency: {}", e))?;

    if let Some(existing) = existing {
        return Err(format!(
            "REQUEST_ALREADY_EXISTS:{}:{}",
            existing.id, existing.status
        ));
    }

    let now = now_iso();
    let run_id = new_id();

    connection
        .execute(
            "INSERT INTO runs (
                id, request_id, task_id, status,
                started_at, updated_at
             )
             VALUES (?1, ?2, ?3, 'running', ?4, ?4)",
            params![run_id, request_id, task_id, now],
        )
        .map_err(|e| format!("Failed to create durable run: {}", e))?;

    connection
        .execute(
            "UPDATE tasks
             SET status = 'running', updated_at = ?1
             WHERE id = ?2",
            params![now_iso(), task_id],
        )
        .map_err(|e| format!("Failed to mark task as running: {}", e))?;

    load_run_state(connection, &run_id)
}

fn attach_user_message_to_run(
    connection: &Connection,
    run_id: &str,
    message_id: &str,
) -> Result<(), String> {
    connection
        .execute(
            "UPDATE runs
             SET user_message_id = ?1, updated_at = ?2
             WHERE id = ?3",
            params![message_id, now_iso(), run_id],
        )
        .map_err(|e| format!("Failed to attach user message to run: {}", e))?;

    Ok(())
}

pub(crate) fn finish_durable_run(
    connection: &Connection,
    run_id: &str,
    task_id: &str,
    status: &str,
    error: Option<&str>,
) -> Result<RunStateDto, String> {
    let now = now_iso();

    connection
        .execute(
            "UPDATE runs
             SET status = ?1,
                 error = ?2,
                 updated_at = ?3,
                 completed_at = ?3
             WHERE id = ?4",
            params![status, error, now, run_id],
        )
        .map_err(|e| format!("Failed to finish durable run: {}", e))?;

    connection
        .execute(
            "UPDATE tasks
             SET status = 'active', updated_at = ?1
             WHERE id = ?2",
            params![now_iso(), task_id],
        )
        .map_err(|e| format!("Failed to release task run state: {}", e))?;

    load_run_state(connection, run_id)
}

pub(crate) fn finish_cancelled_run(
    state: &State<'_, AppState>,
    app_handle: &tauri::AppHandle,
    task_id: &str,
    run_id: &str,
) -> Result<(), String> {
    let mut cancellation_message = new_message(
        task_id,
        "event",
        "chat",
        "Zeus stopped this run at your request.".into(),
        None,
        None,
        true,
    );
    persist_and_emit(state, app_handle, task_id, &mut cancellation_message)?;

    let cancelled_run = {
        let connection = state
            .db
            .lock()
            .map_err(|e| format!("Database lock error: {}", e))?;

        finish_durable_run(&connection, run_id, task_id, "cancelled", None)?
    };

    emit_run_state(app_handle, &cancelled_run);
    Ok(())
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

const MESSAGE_COLUMNS: &str =
    "id, task_id, conversation, role, kind, content, credits_used, model, created_at, rowid, visible";

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
        seq: row.get(9)?,
        visible: row.get(10)?,
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

/// Builds an unsaved MessageDto. `seq` stays 0 until insert_message stamps it.
pub(crate) fn new_message(
    task_id: &str,
    role: &str,
    kind: &str,
    content: String,
    credits_used: Option<f64>,
    model: Option<String>,
    visible: bool,
) -> MessageDto {
    new_message_for_conversation(
        task_id,
        "master",
        role,
        kind,
        content,
        credits_used,
        model,
        visible,
    )
}

pub(crate) fn new_message_for_conversation(
    task_id: &str,
    conversation: &str,
    role: &str,
    kind: &str,
    content: String,
    credits_used: Option<f64>,
    model: Option<String>,
    visible: bool,
) -> MessageDto {
    MessageDto {
        id: new_id(),
        task_id: task_id.to_string(),
        conversation: conversation.to_string(),
        role: role.into(),
        kind: kind.into(),
        content,
        credits_used,
        model,
        created_at: now_iso(),
        seq: 0,
        visible,
    }
}

/// Persists the message and stamps its authoritative `seq` from the DB rowid.
fn insert_message(connection: &Connection, message: &mut MessageDto) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO messages (id, task_id, conversation, role, kind, content, credits_used, model, created_at, visible)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                message.id, message.task_id, message.conversation, message.role,
                message.kind, message.content, message.credits_used, message.model,
                message.created_at, message.visible
            ],
        )
        .map_err(|e| format!("Failed to save the message: {}", e))?;
    message.seq = connection.last_insert_rowid();
    Ok(())
}

/// Emits a message to the frontend. P0: this is the ONLY channel through which
/// messages reach the UI — send_user_message returns no message payloads.
fn emit_message(app_handle: &tauri::AppHandle, task_id: &str, message: &MessageDto) {
    let _ = app_handle.emit(
        "task-message",
        serde_json::json!({ "task_id": task_id, "message": message }),
    );
}

/// The one write path for messages: persist (stamping seq), then emit.
pub(crate) fn persist_and_emit(
    state: &State<'_, AppState>,
    app_handle: &tauri::AppHandle,
    task_id: &str,
    message: &mut MessageDto,
) -> Result<(), String> {
    {
        let connection = state
            .db
            .lock()
            .map_err(|e| format!("Database lock error: {}", e))?;
        insert_message(&connection, message)?;
    }
    // Hidden pipeline messages are still emitted: the reducer stores them and
    // the debug log sees them live, but the UI renders only visible ones.
    emit_message(app_handle, task_id, message);
    Ok(())
}

fn load_master_history(connection: &Connection, task_id: &str) -> Result<Vec<ChatMessage>, String> {
    let system_prompt = settings::load_master_prompt()?;
    let mut history = vec![ChatMessage {
        role: "system".into(),
        content: system_prompt,
    }];

    let mut statement = connection
        .prepare(
            "SELECT role, content FROM messages
             WHERE task_id = ?1 AND conversation = 'master' AND kind IN ('chat','directive','directive_result') AND role IN ('user', 'assistant', 'system', 'tool')
             ORDER BY rowid ASC",
        )
        .map_err(|e| format!("Failed to prepare the history query: {}", e))?;

    let rows = statement
        .query_map(params![task_id], |row| {
            Ok(ChatMessage {
                role: row.get(0)?,
                content: row.get(1)?,
            })
        })
        .map_err(|e| format!("Failed to load the conversation history: {}", e))?;

    for row in rows {
        history.push(row.map_err(|e| format!("Failed to read a history row: {}", e))?);
    }
    Ok(history)
}

#[tauri::command]
pub async fn create_task(
    state: State<'_, AppState>,
    title: Option<String>,
) -> Result<TaskDto, String> {
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    let app_settings = settings::read_settings(&connection)?;
    let now = now_iso();

    let task = TaskDto {
        id: new_id(),
        title: title
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_TASK_TITLE.into()),
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
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    let mut statement = connection
        .prepare("SELECT id, title, status, budget_credits, spent_credits, created_at, updated_at FROM tasks ORDER BY updated_at DESC")
        .map_err(|e| format!("Failed to prepare the task list query: {}", e))?;

    let rows = statement
        .query_map([], row_to_task)
        .map_err(|e| format!("Failed to load the task list: {}", e))?;

    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(row.map_err(|e| format!("Failed to read a task row: {}", e))?);
    }
    Ok(tasks)
}

#[tauri::command]
pub async fn get_task_messages(
    state: State<'_, AppState>,
    task_id: String,
    include_hidden: Option<bool>,
) -> Result<Vec<MessageDto>, String> {
    let include_hidden = include_hidden.unwrap_or(false);
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    let mut statement = connection
        .prepare(&format!(
            "SELECT {} FROM messages
             WHERE task_id = ?1 AND conversation = 'master' AND (?2 OR visible = 1)
             ORDER BY rowid ASC",
            MESSAGE_COLUMNS
        ))
        .map_err(|e| format!("Failed to prepare the messages query: {}", e))?;

    let rows = statement
        .query_map(params![task_id, include_hidden], row_to_message)
        .map_err(|e| format!("Failed to load the messages: {}", e))?;

    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|e| format!("Failed to read a message row: {}", e))?);
    }
    Ok(messages)
}

#[tauri::command]
pub async fn get_task_spend(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<SpendDto, String> {
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    let task = load_task(&connection, &task_id)?;
    Ok(SpendDto {
        spent_credits: task.spent_credits,
        budget_credits: task.budget_credits,
    })
}

#[tauri::command]
pub async fn get_task_run_state(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Option<RunStateDto>, String> {
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;

    connection
        .query_row(
            &format!(
                "SELECT {} FROM runs
                 WHERE task_id = ?1
                 ORDER BY started_at DESC
                 LIMIT 1",
                RUN_STATE_COLUMNS
            ),
            params![task_id],
            row_to_run_state,
        )
        .optional()
        .map_err(|e| format!("Failed to load task run state: {}", e))
}

#[tauri::command]
pub async fn cancel_task_run(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    task_id: String,
) -> Result<RunStateDto, String> {
    let token = {
        let active_runs = state
            .active_runs
            .lock()
            .map_err(|e| format!("Active-run lock error: {}", e))?;

        active_runs.get(&task_id).cloned()
    }
    .ok_or_else(|| "TASK_NOT_RUNNING".to_string())?;

    // Signal first so the executor begins shutting down immediately.
    token.cancel();

    let run = {
        let connection = state
            .db
            .lock()
            .map_err(|e| format!("Database lock error: {}", e))?;

        let latest_run_id: String = connection
            .query_row(
                "SELECT id
                 FROM runs
                 WHERE task_id = ?1
                   AND status IN ('running', 'stopping')
                 ORDER BY started_at DESC
                 LIMIT 1",
                params![task_id],
                |row| row.get(0),
            )
            .map_err(|_| "TASK_NOT_RUNNING".to_string())?;

        connection
            .execute(
                "UPDATE runs
                 SET status = 'stopping', updated_at = ?1
                 WHERE id = ?2 AND status = 'running'",
                params![now_iso(), latest_run_id],
            )
            .map_err(|e| format!("Failed to mark run as stopping: {}", e))?;

        connection
            .execute(
                "UPDATE tasks
                 SET status = 'stopping', updated_at = ?1
                 WHERE id = ?2",
                params![now_iso(), task_id],
            )
            .map_err(|e| format!("Failed to mark task as stopping: {}", e))?;

        load_run_state(&connection, &latest_run_id)?
    };

    emit_run_state(&app_handle, &run);
    Ok(run)
}

/// Records a model call in the ledger and bumps the task's spend. Returns the
/// unit cost so the caller can attach it to the assistant message.
pub(crate) fn record_spend(
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
    request_id: String,
) -> Result<SendResultDto, String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("Cannot send an empty message.".into());
    }

    // The in-memory lease prevents simultaneous execution. The durable
    // request ID prevents the same logical send from being executed again
    // after webview or process lifecycle changes.
    let active_run = ActiveRunGuard::acquire(state.inner(), &task_id)?;
    let cancellation_token = active_run.token();

    let durable_run = {
        let connection = state
            .db
            .lock()
            .map_err(|e| format!("Database lock error: {}", e))?;

        begin_durable_run(&connection, &task_id, &request_id)?
    };
    emit_run_state(&app_handle, &durable_run);
    let run_id = durable_run.id.clone();

    // 1) Lock the DB only for local reads/writes, never across network calls.
    let (history, user_message, task, master_model, mut current_spend, updated_approval) = {
        let connection = state
            .db
            .lock()
            .map_err(|e| format!("Database lock error: {}", e))?;
        let app_settings = settings::read_settings(&connection)?;
        let mut task = load_task(&connection, &task_id)?;

        if task.spent_credits >= task.budget_credits as f64 {
            return Err("BUDGET_EXCEEDED".into());
        }

        let now = now_iso();
        let mut user_message =
            new_message(&task_id, "user", "chat", content.clone(), None, None, true);
        insert_message(&connection, &mut user_message)?;

        attach_user_message_to_run(&connection, &run_id, &user_message.id)?;

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
                    &format!(
                        "SELECT {} FROM messages WHERE task_id = ?1 AND kind = 'approval'
                         ORDER BY rowid DESC LIMIT 1",
                        MESSAGE_COLUMNS
                    ),
                    params![task_id],
                    row_to_message,
                )
                .optional();
            if let Ok(Some(mut approval_msg)) = latest {
                if let Ok(mut data) =
                    serde_json::from_str::<serde_json::Value>(&approval_msg.content)
                {
                    if data["status"].as_str() == Some("pending") {
                        data["status"] = serde_json::Value::String(if approved {
                            "approved".into()
                        } else {
                            "denied".into()
                        });
                        if !note.is_empty() {
                            data["note"] = serde_json::Value::String(note);
                        }
                        approval_msg.content = data.to_string();
                        connection
                            .execute(
                                "UPDATE messages SET content = ?1 WHERE id = ?2",
                                params![approval_msg.content, approval_msg.id],
                            )
                            .map_err(|e| {
                                format!("Failed to record the approval decision: {}", e)
                            })?;
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
                .execute(
                    "UPDATE tasks SET title = ?1, updated_at = ?2 WHERE id = ?3",
                    params![title, now, task_id],
                )
                .map_err(|e| format!("Failed to update the task title: {}", e))?;
            task.title = title;
        }

        let history = load_master_history(&connection, &task_id)?;
        let current_spend = task.spent_credits;
        (
            history,
            user_message,
            task,
            app_settings.master_model,
            current_spend,
            updated_approval,
        )
    };

    // P0: the user message reaches the UI the same way as everything else.
    emit_message(&app_handle, &task_id, &user_message);
    if let Some(msg) = updated_approval {
        emit_message(&app_handle, &task_id, &msg);
    }

    let budget_units = task.budget_credits;
    let mut history = history;
    let mut produced_final = false;

    // 2) Orchestration loop. Each iteration may add directive-result messages
    //    to `history` (and persist them) before re-calling the master.
    for _iteration in 0..orchestrator::MAX_ORCHESTRATION_ITERATIONS {
        if cancellation_token.is_cancelled() {
            finish_cancelled_run(&state, &app_handle, &task_id, &run_id)?;
            return Err("RUN_CANCELLED".into());
        }

        if current_spend >= budget_units as f64 {
            let mut note = new_message(
                &task_id, "event", "chat",
                "Zeus paused because this task reached its unit budget. Increase the budget (per-task editing lands in M1b) or start a new task.".into(),
                None, None, true,
            );
            persist_and_emit(&state, &app_handle, &task_id, &mut note)?;
            produced_final = true;
            break;
        }

        // Keep the streaming future in its own scope. It immutably borrows
        // `history`, so it must be dropped before this iteration appends any
        // assistant or directive-result messages to the history.
        let stream_result = {
            let stream_handle = app_handle.clone();
            let stream_task_id = task_id.clone();
            let partial_text = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
            let partial_text_clone = partial_text.clone();

            let stream_future =
                gateway::stream_model_reply(&master_model, &history, move |event| {
                    if let gateway::StreamEventPayload::Delta { text } = &event {
                        if let Ok(mut lock) = partial_text_clone.lock() {
                            lock.push_str(text);
                        }
                    }
                    let _ = stream_handle.emit(
                        "chat-stream",
                        serde_json::json!({
                            "task_id": stream_task_id,
                            "event": event,
                        }),
                    );
                });

            tokio::pin!(stream_future);

            tokio::select! {
                result = &mut stream_future => result,
                _ = cancellation_token.cancelled() => {
                    let text = partial_text.lock().unwrap().clone();
                    if !text.is_empty() {
                        let mut partial_msg = new_message(
                            &task_id,
                            "assistant",
                            "chat",
                            text,
                            None,
                            None,
                            true,
                        );
                        let _ = persist_and_emit(&state, &app_handle, &task_id, &mut partial_msg);
                    }
                    finish_cancelled_run(
                        &state,
                        &app_handle,
                        &task_id,
                        &run_id,
                    )?;
                    return Err("RUN_CANCELLED".into());
                }
            }
        };
        let (reply_text, _reasoning_summary, usage, usage_json, model_used) = match stream_result {
            Ok(v) => v,
            Err(e) => {
                // Persist the failure as an event so it survives reloads.
                crate::logger::log(&task_id, "gateway", &format!("model call failed: {}", e));
                let mut error_message = new_message(
                    &task_id, "event", "error",
                    format!("Zeus failed to respond: {}. Your message above is preserved — you can resend it.", e),
                    None, None, true,
                );
                persist_and_emit(&state, &app_handle, &task_id, &mut error_message)?;

                let failed_run = {
                    let connection = state
                        .db
                        .lock()
                        .map_err(|lock_error| format!("Database lock error: {}", lock_error))?;

                    finish_durable_run(&connection, &run_id, &task_id, "failed", Some(&e))?
                };
                emit_run_state(&app_handle, &failed_run);

                return Err(e);
            }
        };

        let model_name = model_used.unwrap_or_else(|| master_model.clone());

        // Persist the spend for this iteration.
        let units = {
            let connection = state
                .db
                .lock()
                .map_err(|e| format!("Database lock error: {}", e))?;
            record_spend(&connection, &task_id, &model_name, &usage, &usage_json)?
        };
        current_spend += units;

        match orchestrator::parse_master_reply(&reply_text) {
            orchestrator::MasterReply::Text(text) => {
                let mut assistant_message = new_message(
                    &task_id,
                    "assistant",
                    "chat",
                    text.clone(),
                    Some(units),
                    Some(model_name.clone()),
                    true,
                );
                persist_and_emit(&state, &app_handle, &task_id, &mut assistant_message)?;
                history.push(ChatMessage {
                    role: "assistant".into(),
                    content: text,
                });
                produced_final = true;
                break;
            }
            orchestrator::MasterReply::MalformedDirective(error, raw) => {
                crate::logger::log(
                    &task_id,
                    "orchestrator",
                    &format!("MALFORMED directive: {}", error),
                );
                let feedback = format!(
                    "[DIRECTIVE_ERROR] Your directive block could not be parsed: {}. Re-emit exactly ONE valid ```zeus-directive block (single JSON object, nothing after the closing fence), or reply in plain text if no action is needed.",
                    error
                );
                let mut hidden_directive = new_message(
                    &task_id,
                    "assistant",
                    "directive",
                    raw.clone(),
                    Some(units),
                    Some(model_name.clone()),
                    false,
                );
                let mut hidden_result = new_message(
                    &task_id,
                    "user",
                    "directive_result",
                    feedback.clone(),
                    None,
                    None,
                    false,
                );
                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_directive)?;
                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                history.push(ChatMessage {
                    role: "assistant".into(),
                    content: raw,
                });
                history.push(ChatMessage {
                    role: "user".into(),
                    content: feedback,
                });
                // Loop: call the master again with the error feedback.
            }
            orchestrator::MasterReply::Directive(directive, raw) => {
                crate::logger::log(
                    &task_id,
                    "orchestrator",
                    &format!("directive parsed: {:?}", &directive),
                );
                let mut hidden_directive = new_message(
                    &task_id,
                    "assistant",
                    "directive",
                    raw.clone(),
                    Some(units),
                    Some(model_name.clone()),
                    false,
                );
                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_directive)?;
                history.push(ChatMessage {
                    role: "assistant".into(),
                    content: raw,
                });

                match directive {
                    Directive::FinalAnswer { final_answer } => {
                        let mut assistant_message = new_message(
                            &task_id,
                            "assistant",
                            "chat",
                            final_answer.summary.clone(),
                            Some(units),
                            Some(model_name.clone()),
                            true,
                        );
                        persist_and_emit(&state, &app_handle, &task_id, &mut assistant_message)?;
                        history.push(ChatMessage {
                            role: "assistant".into(),
                            content: final_answer.summary,
                        });
                        produced_final = true;
                        break;
                    }
                    Directive::TaskUpdate { update } => {
                        let detail: String;
                        if let Some(new_title) = update
                            .title
                            .as_deref()
                            .map(str::trim)
                            .filter(|t| !t.is_empty())
                        {
                            let connection = state
                                .db
                                .lock()
                                .map_err(|e| format!("Database lock error: {}", e))?;
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
                        let mut hidden_result = new_message(
                            &task_id,
                            "user",
                            "directive_result",
                            msg.clone(),
                            None,
                            None,
                            false,
                        );
                        persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                        history.push(ChatMessage {
                            role: "user".into(),
                            content: msg,
                        });
                        // Loop: call the master again with the result.
                    }
                    Directive::RequestApproval { approval } => {
                        let mut approval_message = new_message(
                            &task_id,
                            "event",
                            "approval",
                            serde_json::json!({
                                "summary": approval.summary,
                                "detail": approval.detail,
                                "status": "pending",
                            })
                            .to_string(),
                            None,
                            None,
                            true,
                        );
                        persist_and_emit(&state, &app_handle, &task_id, &mut approval_message)?;
                        // Stop the loop: the user's decision will arrive as a
                        // new send, which restarts orchestration.
                        let mut assistant_message = new_message(
                            &task_id,
                            "assistant",
                            "chat",
                            "I need your approval before continuing — see the card above.".into(),
                            Some(units),
                            Some(model_name.clone()),
                            true,
                        );
                        persist_and_emit(&state, &app_handle, &task_id, &mut assistant_message)?;
                        produced_final = true;
                        break;
                    }
                    Directive::RunAction {
                        action,
                        success_criteria,
                    } => {
                        let workspace = crate::utils::task_workspace(&task_id)?;
                        let action_future = crate::python_runner::run_python_action(
                            &workspace,
                            &action.code,
                            action.timeout_secs,
                        );

                        tokio::pin!(action_future);

                        let outcome = tokio::select! {
                            result = &mut action_future => result?,
                            _ = cancellation_token.cancelled() => {
                                // Returning from this scope drops the action
                                // future and its child, which has kill_on_drop
                                // enabled by run_python_action.
                                finish_cancelled_run(
                                    &state,
                                    &app_handle,
                                    &task_id,
                                    &run_id,
                                )?;
                                return Err("RUN_CANCELLED".into());
                            }
                        };

                        let result_json = orchestrator::action_result_json(
                            &outcome.stdout,
                            &outcome.stderr,
                            outcome.exit_code,
                            outcome.timed_out,
                            &outcome.interpreter,
                        );

                        let mut action_message = new_message(
                            &task_id,
                            "event",
                            "action",
                            serde_json::json!({
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
                            None,
                            None,
                            true,
                        );
                        persist_and_emit(&state, &app_handle, &task_id, &mut action_message)?;

                        crate::logger::log(
                            &task_id,
                            "runner",
                            &format!(
                                "action exit={} timed_out={} stdout_len={} stderr_len={}",
                                outcome.exit_code,
                                outcome.timed_out,
                                outcome.stdout.len(),
                                outcome.stderr.len()
                            ),
                        );
                        let msg = orchestrator::directive_result_message(&result_json);
                        let mut hidden_result = new_message(
                            &task_id,
                            "user",
                            "directive_result",
                            msg.clone(),
                            None,
                            None,
                            false,
                        );
                        persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                        history.push(ChatMessage {
                            role: "user".into(),
                            content: msg,
                        });
                        // Loop: call the master again with the action result.
                    }
                    Directive::DelegateTask { delegate } => {
                        let worker_future = crate::worker::run_worker(
                            &state,
                            &app_handle,
                            &task_id,
                            &run_id,
                            &cancellation_token,
                            &delegate,
                            current_spend,
                        );

                        tokio::pin!(worker_future);

                        let outcome = tokio::select! {
                            result = &mut worker_future => result,
                            _ = cancellation_token.cancelled() => {
                                finish_cancelled_run(
                                    &state,
                                    &app_handle,
                                    &task_id,
                                    &run_id,
                                )?;
                                return Err("RUN_CANCELLED".into());
                            }
                        };

                        let result_text = match outcome {
                            Ok(text) => text,
                            Err(e) => format!("Worker failed: {}", e),
                        };

                        let result_json = serde_json::json!({
                            "worker_result": result_text
                        });
                        let msg = orchestrator::directive_result_message(&result_json);
                        
                        let mut hidden_result = new_message(
                            &task_id,
                            "user",
                            "directive_result",
                            msg.clone(),
                            None,
                            None,
                            false,
                        );
                        persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                        history.push(ChatMessage {
                            role: "user".into(),
                            content: msg,
                        });
                        // Loop: call the master again with the worker result.
                    }
                    Directive::HttpRequest { url, method, body } => {
                        let verdict = match crate::gatekeeper::evaluate_network_action(&state, &task_id, &url, &method, body.as_deref()).await {
                            Ok(v) => v,
                            Err(e) => {
                                crate::logger::log(&task_id, "orchestrator", &format!("Gatekeeper error: {}", e));
                                crate::gatekeeper::PermissionVerdict::Ask
                            }
                        };
                        
                        match verdict {
                            crate::gatekeeper::PermissionVerdict::Allow => {
                                let client = reqwest::Client::new();
                                let mut req = client.request(
                                    method.parse().unwrap_or(reqwest::Method::GET),
                                    &url
                                );
                                if let Some(b) = body {
                                    req = req.body(b);
                                }
                                let res = match req.send().await {
                                    Ok(response) => {
                                        let status = response.status();
                                        let text = response.text().await.unwrap_or_default();
                                        format!("Status: {}\nBody: {}", status, text)
                                    },
                                    Err(e) => format!("Request failed: {}", e)
                                };
                                
                                let result_json = serde_json::json!({ "http_result": res });
                                let msg = orchestrator::directive_result_message(&result_json);
                                let mut hidden_result = new_message(
                                    &task_id, "user", "directive_result", msg.clone(), None, None, false,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                                history.push(ChatMessage { role: "user".into(), content: msg });
                            }
                            crate::gatekeeper::PermissionVerdict::Deny => {
                                let msg = "Gatekeeper DENIED this action based on current policies.".to_string();
                                let result_json = serde_json::json!({ "error": msg });
                                let msg = orchestrator::directive_result_message(&result_json);
                                let mut hidden_result = new_message(
                                    &task_id, "user", "directive_result", msg.clone(), None, None, false,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                                history.push(ChatMessage { role: "user".into(), content: msg });
                            }
                            crate::gatekeeper::PermissionVerdict::Ask => {
                                let summary = format!("Run Network Request: {} {}", method, url);
                                let mut approval_message = new_message(
                                    &task_id,
                                    "event",
                                    "approval",
                                    serde_json::json!({
                                        "summary": summary,
                                        "detail": body.unwrap_or_default(),
                                        "status": "pending",
                                    }).to_string(),
                                    None,
                                    None,
                                    true,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut approval_message)?;
                                
                                let mut assistant_message = new_message(
                                    &task_id,
                                    "assistant",
                                    "chat",
                                    "I need your approval before continuing — see the card above.".into(),
                                    Some(units),
                                    Some(model_name.clone()),
                                    true,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut assistant_message)?;
                                produced_final = true;
                                break;
                            }
                        }
                    }
                    _ => {
                        let msg = "Unsupported typed directive. Gatekeeper execution is not yet implemented.".to_string();
                        let result_json = serde_json::json!({ "error": msg });
                        let msg = orchestrator::directive_result_message(&result_json);
                        
                        let mut hidden_result = new_message(
                            &task_id,
                            "user",
                            "directive_result",
                            msg.clone(),
                            None,
                            None,
                            false,
                        );
                        persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                        history.push(ChatMessage {
                            role: "user".into(),
                            content: msg,
                        });
                    }
                }
            }
        }
    }

    // 3) Fallback if the iteration cap was hit without a final reply.
    if !produced_final {
        let mut fallback = new_message(
            &task_id, "assistant", "chat",
            "I reached the maximum number of orchestration steps for this turn. Tell me to continue and I'll pick up from here.".into(),
            None, Some(master_model.clone()), true,
        );
        persist_and_emit(&state, &app_handle, &task_id, &mut fallback)?;
    }

    let completed_run = {
        let connection = state
            .db
            .lock()
            .map_err(|e| format!("Database lock error: {}", e))?;

        finish_durable_run(&connection, &run_id, &task_id, "completed", None)?
    };
    emit_run_state(&app_handle, &completed_run);

    Ok(SendResultDto {
        spent_credits: current_spend,
        budget_credits: budget_units,
    })
}

#[tauri::command]
pub async fn rename_task(
    state: State<'_, AppState>,
    task_id: String,
    new_title: String,
) -> Result<(), String> {
    let title = new_title.trim();
    if title.is_empty() {
        return Err("The task title cannot be empty.".into());
    }
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    connection
        .execute(
            "UPDATE tasks SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now_iso(), task_id],
        )
        .map_err(|e| format!("Failed to rename the task: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_task(state: State<'_, AppState>, task_id: String) -> Result<(), String> {
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    connection
        .execute("DELETE FROM runs WHERE task_id = ?1", params![task_id])
        .map_err(|e| format!("Failed to delete task runs: {}", e))?;
    connection
        .execute("DELETE FROM messages WHERE task_id = ?1", params![task_id])
        .map_err(|e| format!("Failed to delete the task messages: {}", e))?;
    connection
        .execute(
            "DELETE FROM credit_events WHERE task_id = ?1",
            params![task_id],
        )
        .map_err(|e| format!("Failed to delete the task credit events: {}", e))?;
    let _ = connection.execute("DELETE FROM approvals WHERE task_id = ?1", params![task_id]);
    let _ = connection.execute("DELETE FROM workers WHERE task_id = ?1", params![task_id]);

    connection
        .execute("DELETE FROM tasks WHERE id = ?1", params![task_id])
        .map_err(|e| format!("Database error: {}", e))?;
    drop(connection);
    if let Ok(workspace) = crate::utils::task_workspace(&task_id) {
        let _ = std::fs::remove_dir_all(workspace);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::collections::HashMap;
    use std::sync::Mutex;

    fn test_state() -> AppState {
        AppState {
            db: Mutex::new(Connection::open_in_memory().unwrap()),
            active_runs: Mutex::new(HashMap::new()),
        }
    }

    #[test]
    fn task_run_guard_allows_only_one_active_run_per_task() {
        let state = test_state();

        let first = ActiveRunGuard::acquire(&state, "task-1").unwrap();
        assert!(
            ActiveRunGuard::acquire(&state, "task-1").is_err(),
            "a second run for the same task must be rejected"
        );

        // A different task may run concurrently.
        let other = ActiveRunGuard::acquire(&state, "task-2").unwrap();
        drop(other);

        // Releasing the original lease permits a later turn.
        drop(first);
        assert!(ActiveRunGuard::acquire(&state, "task-1").is_ok());
    }

    #[test]
    fn active_run_guard_exposes_cancellable_token() {
        let state = test_state();
        let guard = ActiveRunGuard::acquire(&state, "task-1").unwrap();
        let token = guard.token();

        assert!(!token.is_cancelled());

        let registered = state
            .active_runs
            .lock()
            .unwrap()
            .get("task-1")
            .cloned()
            .unwrap();

        registered.cancel();

        assert!(token.is_cancelled());
        drop(guard);
        assert!(!state.active_runs.lock().unwrap().contains_key("task-1"));
    }
}
