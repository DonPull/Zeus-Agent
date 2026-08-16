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
    pub master_model: String,
    pub worker_model: String,
    pub verifier_model: String,
    pub watcher_model: String,
    pub browser_mode: String,
    pub browser_executable_path: Option<String>,
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
        master_model: row.get(7)?,
        worker_model: row.get(8)?,
        verifier_model: row.get(9)?,
        watcher_model: row.get(10)?,
        browser_mode: row.get(11)?,
        browser_executable_path: row.get(12)?,
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

pub fn load_task(connection: &Connection, task_id: &str) -> Result<TaskDto, String> {
    connection
        .query_row(
            "SELECT id, title, status, budget_credits, spent_credits, created_at, updated_at, master_model, worker_model, verifier_model, watcher_model, browser_mode, browser_executable_path FROM tasks WHERE id = ?1",
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

/// Compacts conversation history when it grows long to preserve token budget and
/// reasoning sharpness, while keeping the system prompt, initial user prompt,
/// task memory, and the most recent K turns intact.
pub fn compact_master_history(history: Vec<ChatMessage>) -> Vec<ChatMessage> {
    const MAX_COMPACT_MESSAGES: usize = 16;
    const MAX_COMPACT_CHARS: usize = 24_000;
    const RECENT_MESSAGES_TO_KEEP: usize = 6;

    let total_chars: usize = history.iter().map(|m| m.content.len()).sum();
    if history.len() <= MAX_COMPACT_MESSAGES && total_chars <= MAX_COMPACT_CHARS {
        return history;
    }

    if history.len() <= 3 {
        return history;
    }

    let system_msg = history[0].clone();
    let initial_user_msg = history[1].clone();

    let recent_count = RECENT_MESSAGES_TO_KEEP.min(history.len().saturating_sub(2));
    let split_index = history.len() - recent_count;

    if split_index <= 2 {
        return history;
    }

    let intermediate_messages = &history[2..split_index];
    let mut summary_lines = Vec::new();
    summary_lines.push("[CONVERSATION MILESTONES (COMPACTED)]".to_string());
    summary_lines.push("Older conversation turns have been summarized to save context. Use the `recall_messages` directive if you need exact details from earlier steps.".to_string());

    for msg in intermediate_messages {
        let role_label = match msg.role.as_str() {
            "assistant" => "Assistant",
            "user" => "User/Tool",
            _ => "System",
        };
        let trimmed = msg.content.trim();
        let first_line = trimmed.lines().next().unwrap_or("");
        let snippet: String = if first_line.len() > 180 {
            format!("{}...", &first_line[..180])
        } else if trimmed.len() > first_line.len() {
            format!("{}... [more]", first_line)
        } else {
            first_line.to_string()
        };
        if !snippet.is_empty() {
            summary_lines.push(format!("- [{}] {}", role_label, snippet));
        }
    }

    let summary_msg = ChatMessage {
        role: "system".into(),
        content: summary_lines.join("\n"),
    };

    let mut compacted = Vec::with_capacity(3 + recent_count);
    compacted.push(system_msg);
    compacted.push(initial_user_msg);
    compacted.push(summary_msg);
    compacted.extend_from_slice(&history[split_index..]);

    compacted
}

fn load_master_history(connection: &Connection, task_id: &str) -> Result<Vec<ChatMessage>, String> {
    let mut system_prompt = settings::load_master_prompt()?;
    if let Ok(Some(memory)) = crate::db::get_chat_memory(connection, task_id) {
        system_prompt.push_str("\n\n[TASK MEMORY - PRESERVE THIS CONTEXT]\n");
        system_prompt.push_str(&memory);
    }
    let mut history = vec![ChatMessage {
        role: "system".into(),
        content: system_prompt,
    }];

    let mut statement = connection
        .prepare(
            "SELECT role, content, kind FROM messages
             WHERE task_id = ?1 AND conversation = 'master' AND kind IN ('chat','directive','directive_result') AND role IN ('user', 'assistant', 'system', 'tool')
             ORDER BY rowid ASC",
        )
        .map_err(|e| format!("Failed to prepare the history query: {}", e))?;

    let rows = statement
        .query_map(params![task_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("Failed to load the conversation history: {}", e))?;

    let mut raw_history: Vec<(String, String, String)> = Vec::new();
    for row in rows {
        raw_history.push(row.map_err(|e| format!("Failed to read a history row: {}", e))?);
    }

    // Filter out assistant 'chat' messages that immediately precede a 'directive' message
    // because the 'directive' message already contains the complete raw output (preamble + directive JSON).
    for i in 0..raw_history.len() {
        let (role, content, kind) = &raw_history[i];
        if role == "assistant" && kind == "chat" {
            let next_is_directive = raw_history.get(i + 1).map(|(r, _, k)| r == "assistant" && k == "directive").unwrap_or(false);
            if next_is_directive {
                continue;
            }
        }
        history.push(ChatMessage {
            role: role.clone(),
            content: content.clone(),
        });
    }

    Ok(compact_master_history(history))
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
        master_model: app_settings.master_model,
        worker_model: app_settings.worker_model,
        verifier_model: app_settings.verifier_model,
        watcher_model: app_settings.watcher_model,
        browser_mode: app_settings.browser_mode,
        browser_executable_path: app_settings.browser_executable_path,
    };

    connection
        .execute(
            "INSERT INTO tasks (id, title, status, budget_credits, spent_credits, created_at, updated_at, master_model, worker_model, verifier_model, watcher_model, browser_mode, browser_executable_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![task.id, task.title, task.status, task.budget_credits, task.spent_credits, task.created_at, task.updated_at, task.master_model, task.worker_model, task.verifier_model, task.watcher_model, task.browser_mode, task.browser_executable_path],
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
        .prepare("SELECT id, title, status, budget_credits, spent_credits, created_at, updated_at, master_model, worker_model, verifier_model, watcher_model, browser_mode, browser_executable_path FROM tasks ORDER BY updated_at DESC")
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
pub async fn resolve_pending_approvals(
    state: State<'_, AppState>,
    task_id: String,
    approved: bool,
    message_id: Option<String>,
) -> Result<(), String> {
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;

    let status = if approved { "approved" } else { "denied" };

    if let Some(id) = message_id.filter(|s| !s.trim().is_empty()) {
        connection
            .execute(
                "UPDATE messages
                 SET content = json_set(content, '$.status', ?1)
                 WHERE id = ?2 AND task_id = ?3 AND kind = 'approval'
                   AND json_extract(content, '$.status') = 'pending'",
                rusqlite::params![status, id, task_id],
            )
            .map_err(|e| format!("Failed to update approval: {}", e))?;
    } else {
        return Err("message_id is required to resolve an approval card.".into());
    }

    Ok(())
}

#[tauri::command]
pub async fn resolve_choice(
    state: State<'_, AppState>,
    task_id: String,
    choice_id: String,
    custom_text: Option<String>,
    message_id: Option<String>,
) -> Result<(), String> {
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    
    let custom = custom_text.unwrap_or_default();
    if let Some(id) = message_id.filter(|s| !s.trim().is_empty()) {
        connection
            .execute(
                "UPDATE messages
                 SET content = json_set(json_set(json_set(content, '$.status', 'resolved'), '$.selected_option', ?1), '$.custom_input', ?2)
                 WHERE id = ?3 AND task_id = ?4 AND kind = 'choice' AND json_extract(content, '$.status') = 'pending'",
                rusqlite::params![choice_id, custom, id, task_id],
            )
            .map_err(|e| format!("Failed to update choice: {}", e))?;
    } else {
        connection
            .execute(
                "UPDATE messages
                 SET content = json_set(json_set(json_set(content, '$.status', 'resolved'), '$.selected_option', ?1), '$.custom_input', ?2)
                 WHERE task_id = ?3 AND kind = 'choice' AND json_extract(content, '$.status') = 'pending'",
                rusqlite::params![choice_id, custom, task_id],
            )
            .map_err(|e| format!("Failed to update choice: {}", e))?;
    }
    Ok(())
}

pub(crate) fn count_pending_approvals(connection: &Connection, task_id: &str) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM messages
             WHERE task_id = ?1 AND kind IN ('approval', 'handoff', 'choice')
               AND json_extract(content, '$.status') = 'pending'",
            params![task_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to count pending approvals: {}", e))
}

/// Block until every pending approval/handoff card for this task is resolved.
pub(crate) async fn wait_until_no_pending_approvals(
    state: &AppState,
    task_id: &str,
    cancellation_token: &CancellationToken,
) -> Result<(), String> {
    loop {
        if cancellation_token.is_cancelled() {
            return Err("Task cancelled".into());
        }
        let pending = {
            let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
            count_pending_approvals(&conn, task_id)?
        };
        if pending == 0 {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    }
}

#[tauri::command]
pub async fn resolve_handoff(
    state: State<'_, AppState>,
    task_id: String,
    approved: bool,
    note: String,
    message_id: Option<String>,
) -> Result<(), String> {
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
        
    let status = if approved { "approved" } else { "denied" };
    
    if let Some(id) = message_id.filter(|s| !s.trim().is_empty()) {
        connection
            .execute(
                "UPDATE messages 
                 SET content = json_set(json_set(content, '$.status', ?1), '$.note', ?2) 
                 WHERE id = ?3 AND task_id = ?4 AND kind = 'handoff' AND json_extract(content, '$.status') = 'pending'",
                rusqlite::params![status, note, id, task_id],
            )
            .map_err(|e| format!("Failed to update handoff: {}", e))?;
    } else {
        connection
            .execute(
                "UPDATE messages 
                 SET content = json_set(json_set(content, '$.status', ?1), '$.note', ?2) 
                 WHERE task_id = ?3 AND kind = 'handoff' AND json_extract(content, '$.status') = 'pending'",
                rusqlite::params![status, note, task_id],
            )
            .map_err(|e| format!("Failed to update handoff: {}", e))?;
    }
        
    Ok(())
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
        let mut task = load_task(&connection, &task_id)?;

        if task.spent_credits >= task.budget_credits as f64 {
            let mut warning = new_message(
                &task_id, "assistant", "chat",
                "Zeus paused because this task reached its unit budget. Increase the budget (per-task editing lands in M1b) or start a new task.".into(),
                None, None, true,
            );
            insert_message(&connection, &mut warning)?;
            emit_message(&app_handle, &task_id, &warning);
            
            let completed_run = finish_durable_run(&connection, &run_id, &task_id, "completed", None)?;
            emit_run_state(&app_handle, &completed_run);
            
            return Ok(SendResultDto {
                spent_credits: task.spent_credits,
                budget_credits: task.budget_credits,
            });
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
                    let executed = data.get("executed").and_then(|v| v.as_bool()).unwrap_or(false);
                    if !executed {
                        data["status"] = serde_json::Value::String(if approved {
                            "approved".into()
                        } else {
                            "denied".into()
                        });
                        if !note.is_empty() {
                            data["note"] = serde_json::Value::String(note);
                        }
                        data["executed"] = serde_json::Value::Bool(true);
                        
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
        } else if content.starts_with("[CHOICE DECISION]") {
            let latest = connection
                .query_row(
                    &format!(
                        "SELECT {} FROM messages WHERE task_id = ?1 AND kind = 'choice'
                         ORDER BY rowid DESC LIMIT 1",
                        MESSAGE_COLUMNS
                    ),
                    params![task_id],
                    row_to_message,
                )
                .optional();
            if let Ok(Some(mut choice_msg)) = latest {
                if let Ok(mut data) = serde_json::from_str::<serde_json::Value>(&choice_msg.content) {
                    let executed = data.get("executed").and_then(|v| v.as_bool()).unwrap_or(false);
                    if !executed {
                        data["status"] = serde_json::Value::String("resolved".into());
                        data["executed"] = serde_json::Value::Bool(true);
                        choice_msg.content = data.to_string();
                        let _ = connection.execute(
                            "UPDATE messages SET content = ?1 WHERE id = ?2",
                            params![choice_msg.content, choice_msg.id],
                        );
                        updated_approval = Some(choice_msg);
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
        let master_model = task.master_model.clone();
        (
            history,
            user_message,
            task,
            master_model,
            current_spend,
            updated_approval,
        )
    };

    // P0: the user message reaches the UI the same way as everything else.
    emit_message(&app_handle, &task_id, &user_message);
    if let Some(msg) = &updated_approval {
        emit_message(&app_handle, &task_id, msg);
    }

    let budget_units = task.budget_credits;
    let mut history = history;
    let mut produced_final = false;
    let mut steps_since_action_plan: usize = 0;
    let mut plain_text_nudges: usize = 0;

    if let Some(msg) = &updated_approval {
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&msg.content) {
            if let (Some(status), Some(directive_val)) = (data.get("status").and_then(|s| s.as_str()), data.get("blocked_directive")) {
                if let Ok(directive) = serde_json::from_value::<orchestrator::Directive>(directive_val.clone()) {
                    let feedback = if status == "approved" || status == "resolved" {
                        if matches!(directive, orchestrator::Directive::AskUserChoice { .. }) {
                            let opt = data.get("selected_option").and_then(|s| s.as_str()).unwrap_or("");
                            let custom = data.get("custom_input").and_then(|s| s.as_str()).unwrap_or("");
                            let result_text = if !custom.is_empty() {
                                format!("User selected option: {} (custom input: '{}')", opt, custom)
                            } else {
                                format!("User selected option: {}", opt)
                            };
                            orchestrator::directive_result_message(&serde_json::json!({ "choice_result": result_text }))
                        } else {
                            match orchestrator::execute_directive_bypass_gatekeeper(&state, &app_handle, &task_id, directive).await {
                                Ok(text) => text,
                                Err(e) => orchestrator::directive_result_message(&serde_json::json!({ "error": e }))
                            }
                        }
                    } else if status == "denied" {
                        let note = data.get("note").and_then(|n| n.as_str()).unwrap_or("");
                        let reason = if note.is_empty() { "User DENIED the permission request.".to_string() } else { format!("User DENIED the permission request. Note: {}", note) };
                        orchestrator::directive_result_message(&serde_json::json!({ "error": reason }))
                    } else {
                        String::new()
                    };

                    if !feedback.is_empty() {
                        let mut hidden_result = new_message(
                            &task_id, "user", "directive_result", feedback.clone(), None, None, false
                        );
                        if let Ok(_) = persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result) {
                            history.push(ChatMessage { role: "user".into(), content: feedback });
                        }
                    }
                }
            }
        }
    }

    // 2) Orchestration loop. Each iteration may add directive-result messages
    //    to `history` (and persist them) before re-calling the master.
    for iteration in 0..orchestrator::MAX_ORCHESTRATION_ITERATIONS {
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
            
            let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
            let completed_run = finish_durable_run(&connection, &run_id, &task_id, "completed", None)?;
            emit_run_state(&app_handle, &completed_run);
            
            break;
        }

        // Compact history if conversation has grown long to preserve token budget
        history = compact_master_history(history);

        let mut injected_reminder = false;
        if steps_since_action_plan >= 4 {
            history.push(ChatMessage {
                role: "system".into(),
                content: "[SYSTEM REMINDER]: You have performed 4 consecutive actions without updating the Action Plan. If milestones were completed or tasks adjusted, call `update_action_plan` to keep the plan current for the user.".into(),
            });
            injected_reminder = true;
        }

        // Re-anchor this model call on the latest action plan without growing durable history.
        let injected_plan = {
            let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
            conn.query_row(
                "SELECT content FROM messages WHERE task_id = ?1 AND kind = 'action_plan' ORDER BY rowid DESC LIMIT 1",
                params![task_id],
                |row| row.get::<_, String>(0),
            ).optional().ok().flatten()
        };
        if let Some(plan) = &injected_plan {
            history.push(ChatMessage {
                role: "system".into(),
                content: format!("[CURRENT ACTION PLAN — source of truth for remaining work. Update it with update_action_plan if this is stale.]\n{}", plan),
            });
        }

        // Keep the streaming future in its own scope. It immutably borrows
        // `history`, so it must be dropped before this iteration appends any
        // assistant or directive-result messages to the history.
        let stream_result = {
            let stream_handle = app_handle.clone();
            let stream_task_id = task_id.clone();
            let partial_text = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
            let partial_text_clone = partial_text.clone();

            let payload_size = serde_json::to_string(&history).map(|s| s.len()).unwrap_or(0);
            crate::logger::log(&task_id, "orchestrator", &format!("Sending payload to master model ({} messages, ~{} bytes)", history.len(), payload_size));

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
                    crate::logger::log(&task_id, "orchestrator", "Cancellation token triggered. Aborting model stream.");
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
        if injected_plan.is_some() {
            let _ = history.pop();
        }
        if injected_reminder {
            let _ = history.pop();
        }

        let (reply_text, _reasoning_summary, usage, usage_json, model_used) = match stream_result {
            Ok(v) => v,
            Err(e) => {
                if e == "BUDGET_EXCEEDED" {
                    let mut note = new_message(
                        &task_id, "event", "chat",
                        "Zeus paused because this task reached its unit budget. Increase the budget (per-task editing lands in M1b) or start a new task.".into(),
                        None, None, true,
                    );
                    persist_and_emit(&state, &app_handle, &task_id, &mut note)?;
                    produced_final = true;
                    break;
                }

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
                crate::logger::log(
                    &task_id,
                    "orchestrator",
                    &format!("Master output plain text (no directive, len={}): {}", text.len(), text.chars().take(120).collect::<String>()),
                );

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
                    content: text.clone(),
                });

                // If this plain text occurred in the middle of a multi-step execution run (iteration > 0),
                // didn't ask a question (no '?'), and we haven't already nudged, give the model an auto-continuation nudge
                // so an in-flight plan does not abruptly halt without executing remaining steps.
                if iteration > 0 && plain_text_nudges == 0 && !text.contains('?') {
                    plain_text_nudges += 1;
                    crate::logger::log(
                        &task_id,
                        "orchestrator",
                        "Intermediate narration without directive detected. Triggering auto-continuation nudge.",
                    );
                    let nudge_msg = "[SYSTEM AUTO-CONTINUATION]: You provided intermediate narration without a ```zeus-directive block. If you have more steps to execute (reading files, listing directories, delegating, running actions), emit the ```zeus-directive block now. If all work for this task is completely finished, emit the `final_answer` directive or summarize the completion.".to_string();
                    let mut hidden_result = new_message(
                        &task_id,
                        "user",
                        "directive_result",
                        nudge_msg.clone(),
                        None,
                        None,
                        false,
                    );
                    persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                    history.push(ChatMessage {
                        role: "user".into(),
                        content: nudge_msg,
                    });
                    continue;
                }

                produced_final = true;
                break;
            }
            orchestrator::MasterReply::MalformedDirective(error, _extracted, raw) => {
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
            orchestrator::MasterReply::Directive(preamble, directive, raw) => {
                crate::logger::log(
                    &task_id,
                    "orchestrator",
                    &format!("directive parsed: {:?}", &directive),
                );
                
                plain_text_nudges = 0;

                if matches!(directive, Directive::UpdateActionPlan { .. }) {
                    steps_since_action_plan = 0;
                } else {
                    steps_since_action_plan += 1;
                }

                let preamble_trimmed = preamble.trim();
                if !preamble_trimmed.is_empty() {
                    let mut preamble_msg = new_message(
                        &task_id,
                        "assistant",
                        "chat",
                        preamble_trimmed.to_string(),
                        None,
                        Some(model_name.clone()),
                        true,
                    );
                    let _ = persist_and_emit(&state, &app_handle, &task_id, &mut preamble_msg);
                }

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
                    Directive::UpdateMemory { memory } => {
                        let conn = state.db.lock().map_err(|e| e.to_string())?;
                        crate::db::update_chat_memory(&conn, &task_id, &memory).map_err(|e| e.to_string())?;
                        drop(conn);

                        let result_json = serde_json::json!({ "status": "success", "detail": "Memory updated" });
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
                    Directive::RunAction {
                        action,
                        success_criteria,
                    } => {
                        let workspace = crate::utils::task_workspace(&task_id)?;
                        let action_future = crate::python_runner::run_python_action(
                            Some(app_handle.clone()),
                            Some(task_id.clone()),
                            &workspace,
                            &action.code,
                            action.timeout_secs,
                            None,
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
                    Directive::UpdateActionPlan { action_plan, request_approval } => {
                        let prior_plans: i64 = {
                            let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
                            conn.query_row(
                                "SELECT COUNT(*) FROM messages WHERE task_id = ?1 AND kind = 'action_plan'",
                                params![task_id],
                                |row| row.get(0),
                            ).unwrap_or(0)
                        };

                        let mut msg = new_message(
                            &task_id, "assistant", "action_plan",
                            action_plan.clone(),
                            None, None, true,
                        );
                        persist_and_emit(&state, &app_handle, &task_id, &mut msg)?;

                        let is_alignment_plan = request_approval || prior_plans == 0;
                        let result_json = if is_alignment_plan {
                            serde_json::json!({ "update_action_plan_result": "Action Plan saved and shown to the user. STOP and wait. Do not start work until the user replies (proceed, or request changes)." })
                        } else {
                            serde_json::json!({ "update_action_plan_result": "Action Plan updated. Continue the current work." })
                        };
                        let res_msg = orchestrator::directive_result_message(&result_json);
                        let mut hidden_result = new_message(&task_id, "user", "directive_result", res_msg.clone(), None, None, false);
                        persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                        history.push(ChatMessage { role: "user".into(), content: res_msg });

                        if is_alignment_plan {
                            let mut pause = new_message(
                                &task_id, "assistant", "chat",
                                "I've written an implementation plan (see the Action Plan panel). Review it and tell me to proceed, or say what to change.".into(),
                                None, Some(model_name.clone()), true,
                            );
                            persist_and_emit(&state, &app_handle, &task_id, &mut pause)?;
                            produced_final = true;
                            break;
                        }
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
                                let blocked_dir = Directive::HttpRequest { url: url.clone(), method: method.clone(), body: body.clone() };
                                let mut approval_message = new_message(
                                    &task_id,
                                    "event",
                                    "approval",
                                    serde_json::json!({
                                        "summary": summary,
                                        "detail": body.unwrap_or_default(),
                                        "status": "pending",
                                        "blocked_directive": blocked_dir,
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
                                apply_resolved_approval(
                                    &state,
                                    &app_handle,
                                    &task_id,
                                    &run_id,
                                    &cancellation_token,
                                    &approval_message.id,
                                    blocked_dir,
                                    &mut history,
                                ).await?;
                            }
                        }
                    }
                    Directive::RunCommand { command } => {
                        let verdict = {
                            let conn = state.db.lock().map_err(|e| e.to_string())?;
                            match crate::gatekeeper::evaluate_command_action(&conn, &task_id, &command) {
                                Ok(v) => v,
                                Err(e) => {
                                    crate::logger::log(&task_id, "orchestrator", &format!("Gatekeeper error: {}", e));
                                    crate::gatekeeper::PermissionVerdict::Ask
                                }
                            }
                        };
                        match verdict {
                            crate::gatekeeper::PermissionVerdict::Allow => {
                                let workspace = crate::utils::task_workspace(&task_id)?;
                                let output_future = tokio::process::Command::new("cmd")
                                    .args(&["/c", &command])
                                    .current_dir(workspace)
                                    .output();
                                
                                let output_result = tokio::time::timeout(
                                    std::time::Duration::from_secs(300),
                                    output_future
                                ).await;

                                let res = match output_result {
                                    Ok(Ok(out)) => {
                                        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                                        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                                        format!("Exit Code: {}\nStdout: {}\nStderr: {}", out.status.code().unwrap_or(-1), stdout, stderr)
                                    }
                                    Ok(Err(e)) => format!("Failed to execute command: {}", e),
                                    Err(_) => "Command timed out after 300 seconds.".to_string(),
                                };
                                let result_json = serde_json::json!({ "command_result": res });
                                let msg = orchestrator::directive_result_message(&result_json);
                                let mut hidden_result = new_message(&task_id, "user", "directive_result", msg.clone(), None, None, false);
                                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                                history.push(ChatMessage { role: "user".into(), content: msg });
                            }
                            crate::gatekeeper::PermissionVerdict::Deny => {
                                let msg = "Gatekeeper DENIED this command based on current policies.".to_string();
                                let result_json = serde_json::json!({ "error": msg });
                                let msg = orchestrator::directive_result_message(&result_json);
                                let mut hidden_result = new_message(&task_id, "user", "directive_result", msg.clone(), None, None, false);
                                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                                history.push(ChatMessage { role: "user".into(), content: msg });
                            }
                            crate::gatekeeper::PermissionVerdict::Ask => {
                                let summary = format!("Run Command: `{}`", command);
                                let blocked_dir = Directive::RunCommand { command: command.clone() };
                                let mut approval_message = new_message(
                                    &task_id, "event", "approval",
                                    serde_json::json!({ "summary": summary, "detail": "", "status": "pending", "blocked_directive": blocked_dir }).to_string(),
                                    None, None, true,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut approval_message)?;
                                let mut assistant_message = new_message(
                                    &task_id, "assistant", "chat",
                                    "I need your approval before continuing — see the card above.".into(),
                                    Some(units), Some(model_name.clone()), true,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut assistant_message)?;
                                apply_resolved_approval(
                                    &state,
                                    &app_handle,
                                    &task_id,
                                    &run_id,
                                    &cancellation_token,
                                    &approval_message.id,
                                    blocked_dir,
                                    &mut history,
                                ).await?;
                            }
                        }
                    }
                    Directive::ReadFile { path } => {
                        let verdict = {
                            let conn = state.db.lock().map_err(|e| e.to_string())?;
                            crate::gatekeeper::evaluate_file_permission(&conn, &task_id, &path, "read").unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
                        };
                        match verdict {
                            crate::gatekeeper::PermissionVerdict::Allow => {
                                let res = match tokio::fs::read_to_string(&path).await {
                                    Ok(content) => content,
                                    Err(e) => format!("Failed to read file: {}", e),
                                };
                                let result_json = serde_json::json!({ "read_result": res });
                                let msg = orchestrator::directive_result_message(&result_json);
                                let mut hidden_result = new_message(&task_id, "user", "directive_result", msg.clone(), None, None, false);
                                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                                history.push(ChatMessage { role: "user".into(), content: msg });
                            }
                            crate::gatekeeper::PermissionVerdict::Deny => {
                                let msg = "Gatekeeper DENIED read access based on current policies.".to_string();
                                let result_json = serde_json::json!({ "error": msg });
                                let msg = orchestrator::directive_result_message(&result_json);
                                let mut hidden_result = new_message(&task_id, "user", "directive_result", msg.clone(), None, None, false);
                                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                                history.push(ChatMessage { role: "user".into(), content: msg });
                            }
                            crate::gatekeeper::PermissionVerdict::Ask => {
                                let summary = format!("Read File: `{}`", path);
                                let blocked_dir = Directive::ReadFile { path: path.clone() };
                                let mut approval_message = new_message(
                                    &task_id, "event", "approval",
                                    serde_json::json!({ "summary": summary, "detail": "", "status": "pending", "blocked_directive": blocked_dir }).to_string(),
                                    None, None, true,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut approval_message)?;
                                let mut assistant_message = new_message(
                                    &task_id, "assistant", "chat",
                                    "I need your approval before continuing — see the card above.".into(),
                                    Some(units), Some(model_name.clone()), true,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut assistant_message)?;
                                apply_resolved_approval(
                                    &state,
                                    &app_handle,
                                    &task_id,
                                    &run_id,
                                    &cancellation_token,
                                    &approval_message.id,
                                    blocked_dir,
                                    &mut history,
                                ).await?;
                            }
                        }
                    }
                    Directive::WriteFile { path, content } => {
                        let verdict = {
                            let conn = state.db.lock().map_err(|e| e.to_string())?;
                            crate::gatekeeper::evaluate_file_permission(&conn, &task_id, &path, "write").unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
                        };
                        match verdict {
                            crate::gatekeeper::PermissionVerdict::Allow => {
                                let res = match tokio::fs::write(&path, content).await {
                                    Ok(_) => "Successfully wrote file.".to_string(),
                                    Err(e) => format!("Failed to write file: {}", e),
                                };
                                let result_json = serde_json::json!({ "write_result": res });
                                let msg = orchestrator::directive_result_message(&result_json);
                                let mut hidden_result = new_message(&task_id, "user", "directive_result", msg.clone(), None, None, false);
                                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                                history.push(ChatMessage { role: "user".into(), content: msg });
                            }
                            crate::gatekeeper::PermissionVerdict::Deny => {
                                let msg = "Gatekeeper DENIED write access based on current policies.".to_string();
                                let result_json = serde_json::json!({ "error": msg });
                                let msg = orchestrator::directive_result_message(&result_json);
                                let mut hidden_result = new_message(&task_id, "user", "directive_result", msg.clone(), None, None, false);
                                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                                history.push(ChatMessage { role: "user".into(), content: msg });
                            }
                            crate::gatekeeper::PermissionVerdict::Ask => {
                                let summary = format!("Write File: `{}`", path);
                                let blocked_dir = Directive::WriteFile { path: path.clone(), content: content.clone() };
                                let mut approval_message = new_message(
                                    &task_id, "event", "approval",
                                    serde_json::json!({ "summary": summary, "detail": "", "status": "pending", "blocked_directive": blocked_dir }).to_string(),
                                    None, None, true,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut approval_message)?;
                                let mut assistant_message = new_message(
                                    &task_id, "assistant", "chat",
                                    "I need your approval before continuing — see the card above.".into(),
                                    Some(units), Some(model_name.clone()), true,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut assistant_message)?;
                                apply_resolved_approval(
                                    &state,
                                    &app_handle,
                                    &task_id,
                                    &run_id,
                                    &cancellation_token,
                                    &approval_message.id,
                                    blocked_dir,
                                    &mut history,
                                ).await?;
                            }
                        }
                    }
                    Directive::DeleteFile { path } => {
                        let verdict = {
                            let conn = state.db.lock().map_err(|e| e.to_string())?;
                            crate::gatekeeper::evaluate_file_permission(&conn, &task_id, &path, "delete").unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
                        };
                        match verdict {
                            crate::gatekeeper::PermissionVerdict::Allow => {
                                let res = match tokio::fs::remove_file(&path).await {
                                    Ok(_) => "Successfully deleted file.".to_string(),
                                    Err(e) => format!("Failed to delete file: {}", e),
                                };
                                let result_json = serde_json::json!({ "delete_result": res });
                                let msg = orchestrator::directive_result_message(&result_json);
                                let mut hidden_result = new_message(&task_id, "user", "directive_result", msg.clone(), None, None, false);
                                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                                history.push(ChatMessage { role: "user".into(), content: msg });
                            }
                            crate::gatekeeper::PermissionVerdict::Deny => {
                                let msg = "Gatekeeper DENIED delete access based on current policies.".to_string();
                                let result_json = serde_json::json!({ "error": msg });
                                let msg = orchestrator::directive_result_message(&result_json);
                                let mut hidden_result = new_message(&task_id, "user", "directive_result", msg.clone(), None, None, false);
                                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                                history.push(ChatMessage { role: "user".into(), content: msg });
                            }
                            crate::gatekeeper::PermissionVerdict::Ask => {
                                let summary = format!("Delete File: `{}`", path);
                                let blocked_dir = Directive::DeleteFile { path: path.clone() };
                                let mut approval_message = new_message(
                                    &task_id, "event", "approval",
                                    serde_json::json!({ "summary": summary, "detail": "", "status": "pending", "blocked_directive": blocked_dir }).to_string(),
                                    None, None, true,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut approval_message)?;
                                let mut assistant_message = new_message(
                                    &task_id, "assistant", "chat",
                                    "I need your approval before continuing — see the card above.".into(),
                                    Some(units), Some(model_name.clone()), true,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut assistant_message)?;
                                apply_resolved_approval(
                                    &state,
                                    &app_handle,
                                    &task_id,
                                    &run_id,
                                    &cancellation_token,
                                    &approval_message.id,
                                    blocked_dir,
                                    &mut history,
                                ).await?;
                            }
                        }
                    }
                    Directive::ListDir { ref path } => {
                        let mut verdict = {
                            let conn = state.db.lock().map_err(|e| e.to_string())?;
                            crate::gatekeeper::evaluate_file_permission(&conn, &task_id, &path, "read").unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
                        };
                        if verdict == crate::gatekeeper::PermissionVerdict::Ask {
                            verdict = crate::gatekeeper::PermissionVerdict::Allow;
                        }
                        match verdict {
                            crate::gatekeeper::PermissionVerdict::Allow => {
                                let feedback = match crate::orchestrator::execute_directive_bypass_gatekeeper(&state, &app_handle, &task_id, directive.clone()).await {
                                    Ok(text) => text,
                                    Err(e) => crate::orchestrator::directive_result_message(&serde_json::json!({ "error": e }))
                                };
                                let mut hidden_result = new_message(&task_id, "user", "directive_result", feedback.clone(), None, None, false);
                                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                                history.push(ChatMessage { role: "user".into(), content: feedback });
                            }
                            crate::gatekeeper::PermissionVerdict::Deny => {
                                let msg = "Gatekeeper DENIED read access based on current policies.".to_string();
                                let result_json = serde_json::json!({ "error": msg });
                                let msg = orchestrator::directive_result_message(&result_json);
                                let mut hidden_result = new_message(&task_id, "user", "directive_result", msg.clone(), None, None, false);
                                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                                history.push(ChatMessage { role: "user".into(), content: msg });
                            }
                            crate::gatekeeper::PermissionVerdict::Ask => {
                                let summary = format!("List Directory: `{}`", path);
                                let blocked_dir = Directive::ListDir { path: path.clone() };
                                let mut approval_message = new_message(
                                    &task_id, "event", "approval",
                                    serde_json::json!({ "summary": summary, "detail": "", "status": "pending", "blocked_directive": blocked_dir }).to_string(),
                                    None, None, true,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut approval_message)?;
                                let mut assistant_message = new_message(
                                    &task_id, "assistant", "chat",
                                    "I need your approval before continuing — see the card above.".into(),
                                    Some(units), Some(model_name.clone()), true,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut assistant_message)?;
                                apply_resolved_approval(
                                    &state,
                                    &app_handle,
                                    &task_id,
                                    &run_id,
                                    &cancellation_token,
                                    &approval_message.id,
                                    blocked_dir,
                                    &mut history,
                                ).await?;
                            }
                        }
                    }
                    Directive::SearchFiles { ref path, ref pattern } => {
                        let mut verdict = {
                            let conn = state.db.lock().map_err(|e| e.to_string())?;
                            crate::gatekeeper::evaluate_file_permission(&conn, &task_id, &path, "read").unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
                        };
                        if verdict == crate::gatekeeper::PermissionVerdict::Ask {
                            verdict = crate::gatekeeper::PermissionVerdict::Allow;
                        }
                        match verdict {
                            crate::gatekeeper::PermissionVerdict::Allow => {
                                let feedback = match crate::orchestrator::execute_directive_bypass_gatekeeper(&state, &app_handle, &task_id, directive.clone()).await {
                                    Ok(text) => text,
                                    Err(e) => crate::orchestrator::directive_result_message(&serde_json::json!({ "error": e }))
                                };
                                let mut hidden_result = new_message(&task_id, "user", "directive_result", feedback.clone(), None, None, false);
                                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                                history.push(ChatMessage { role: "user".into(), content: feedback });
                            }
                            crate::gatekeeper::PermissionVerdict::Deny => {
                                let msg = "Gatekeeper DENIED read access based on current policies.".to_string();
                                let result_json = serde_json::json!({ "error": msg });
                                let msg = orchestrator::directive_result_message(&result_json);
                                let mut hidden_result = new_message(&task_id, "user", "directive_result", msg.clone(), None, None, false);
                                persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                                history.push(ChatMessage { role: "user".into(), content: msg });
                            }
                            crate::gatekeeper::PermissionVerdict::Ask => {
                                let summary = format!("Search Files in `{}` for `{}`", path, pattern);
                                let blocked_dir = Directive::SearchFiles { path: path.clone(), pattern: pattern.clone() };
                                let mut approval_message = new_message(
                                    &task_id, "event", "approval",
                                    serde_json::json!({ "summary": summary, "detail": "", "status": "pending", "blocked_directive": blocked_dir }).to_string(),
                                    None, None, true,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut approval_message)?;
                                let mut assistant_message = new_message(
                                    &task_id, "assistant", "chat",
                                    "I need your approval before continuing — see the card above.".into(),
                                    Some(units), Some(model_name.clone()), true,
                                );
                                persist_and_emit(&state, &app_handle, &task_id, &mut assistant_message)?;
                                apply_resolved_approval(
                                    &state,
                                    &app_handle,
                                    &task_id,
                                    &run_id,
                                    &cancellation_token,
                                    &approval_message.id,
                                    blocked_dir,
                                    &mut history,
                                ).await?;
                            }
                        }
                    }
                    Directive::AskUserForLogin { reason } => {
                        let summary = format!("Login Required: {}", reason);
                        let blocked_dir = Directive::AskUserForLogin { reason: reason.clone() };
                        let mut approval_message = new_message(
                            &task_id, "event", "approval",
                            serde_json::json!({ "summary": summary, "detail": reason, "status": "pending", "blocked_directive": blocked_dir }).to_string(),
                            None, None, true,
                        );
                        persist_and_emit(&state, &app_handle, &task_id, &mut approval_message)?;
                        let mut assistant_message = new_message(
                            &task_id, "assistant", "chat",
                            "I need you to log in before continuing — see the card above.".into(),
                            Some(units), Some(model_name.clone()), true,
                        );
                        persist_and_emit(&state, &app_handle, &task_id, &mut assistant_message)?;
                        apply_resolved_approval(
                            &state,
                            &app_handle,
                            &task_id,
                            &run_id,
                            &cancellation_token,
                            &approval_message.id,
                            blocked_dir,
                            &mut history,
                        ).await?;
                    }
                    Directive::RecallMessages { query, limit } => {
                        let feedback = match crate::orchestrator::execute_directive_bypass_gatekeeper(&state, &app_handle, &task_id, Directive::RecallMessages { query, limit }).await {
                            Ok(text) => text,
                            Err(e) => crate::orchestrator::directive_result_message(&serde_json::json!({ "error": e }))
                        };
                        let mut hidden_result = new_message(&task_id, "user", "directive_result", feedback.clone(), None, None, false);
                        persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                        history.push(ChatMessage { role: "user".into(), content: feedback });
                    }
                    Directive::AskUserChoice { prompt, options, allow_custom_input, custom_placeholder } => {
                        let blocked_dir = Directive::AskUserChoice {
                            prompt: prompt.clone(),
                            options: options.clone(),
                            allow_custom_input,
                            custom_placeholder: custom_placeholder.clone(),
                        };
                        let mut choice_message = new_message(
                            &task_id, "event", "choice",
                            serde_json::json!({
                                "prompt": prompt,
                                "options": options,
                                "allow_custom_input": allow_custom_input,
                                "custom_placeholder": custom_placeholder,
                                "status": "pending",
                                "blocked_directive": blocked_dir,
                            }).to_string(),
                            None, None, true,
                        );
                        persist_and_emit(&state, &app_handle, &task_id, &mut choice_message)?;
                        let mut assistant_message = new_message(
                            &task_id, "assistant", "chat",
                            "Please select an option above to proceed.".into(),
                            Some(units), Some(model_name.clone()), true,
                        );
                        persist_and_emit(&state, &app_handle, &task_id, &mut assistant_message)?;
                        apply_resolved_approval(
                            &state,
                            &app_handle,
                            &task_id,
                            &run_id,
                            &cancellation_token,
                            &choice_message.id,
                            blocked_dir,
                            &mut history,
                        ).await?;
                    }
                    Directive::ConfigureBrowser { permissions: _, viewport: _ } => {
                        let res_json = serde_json::json!({
                            "configure_browser_result": "Browser configuration applied successfully."
                        });
                        let feedback = orchestrator::directive_result_message(&res_json);
                        let mut hidden_result = new_message(&task_id, "user", "directive_result", feedback.clone(), None, None, false);
                        persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                        history.push(ChatMessage { role: "user".into(), content: feedback });
                    }
                    Directive::InstallBrowserExtension { extension_path } => {
                        let path_exists = std::path::Path::new(&extension_path).exists();
                        let res_json = if path_exists {
                            serde_json::json!({
                                "install_browser_extension_result": format!("Browser extension at '{}' will be loaded on next browser launch.", extension_path)
                            })
                        } else {
                            serde_json::json!({
                                "error": format!("Extension path does not exist: {}", extension_path)
                            })
                        };
                        let feedback = orchestrator::directive_result_message(&res_json);
                        let mut hidden_result = new_message(&task_id, "user", "directive_result", feedback.clone(), None, None, false);
                        persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                        history.push(ChatMessage { role: "user".into(), content: feedback });
                    }
                    Directive::ManageBrowserExtension { extension_id, action } => {
                        let res_json = serde_json::json!({
                            "manage_browser_extension_result": format!("Extension '{}' action '{}' processed.", extension_id, action)
                        });
                        let feedback = orchestrator::directive_result_message(&res_json);
                        let mut hidden_result = new_message(&task_id, "user", "directive_result", feedback.clone(), None, None, false);
                        persist_and_emit(&state, &app_handle, &task_id, &mut hidden_result)?;
                        history.push(ChatMessage { role: "user".into(), content: feedback });
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

#[derive(serde::Deserialize)]
pub struct TaskSettingsDto {
    pub master_model: String,
    pub worker_model: String,
    pub verifier_model: String,
    pub watcher_model: String,
    pub budget_credits: i64,
}

#[tauri::command]
pub fn update_task_settings(state: State<'_, AppState>, task_id: String, settings: TaskSettingsDto) -> Result<(), String> {
    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    connection.execute(
        "UPDATE tasks SET master_model = ?1, worker_model = ?2, verifier_model = ?3, watcher_model = ?4, budget_credits = ?5 WHERE id = ?6",
        params![settings.master_model, settings.worker_model, settings.verifier_model, settings.watcher_model, settings.budget_credits, task_id],
    ).map_err(|e| format!("Failed to update task settings: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_task(state: State<'_, AppState>, task_id: String) -> Result<(), String> {
    // Ensure any active run is cancelled so it doesn't continue processing
    if let Some(token) = state.active_runs.lock().unwrap().remove(&task_id) {
        token.cancel();
    }

    let mut connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;

    let tx = connection
        .transaction()
        .map_err(|e| format!("Failed to start transaction: {}", e))?;

    tx.execute("DELETE FROM runs WHERE task_id = ?1", params![task_id])
        .map_err(|e| format!("Failed to delete task runs: {}", e))?;
    tx.execute("DELETE FROM messages WHERE task_id = ?1", params![task_id])
        .map_err(|e| format!("Failed to delete task messages: {}", e))?;
    tx.execute("DELETE FROM credit_events WHERE task_id = ?1", params![task_id])
        .map_err(|e| format!("Failed to delete task credit events: {}", e))?;
    tx.execute("DELETE FROM workers WHERE task_id = ?1", params![task_id])
        .map_err(|e| format!("Failed to delete task workers: {}", e))?;
    tx.execute("DELETE FROM chat_memory WHERE task_id = ?1", params![task_id])
        .map_err(|e| format!("Failed to delete task chat memory: {}", e))?;
    tx.execute("DELETE FROM permissions WHERE scope = ?1", params![task_id])
        .map_err(|e| format!("Failed to delete task permissions: {}", e))?;
    tx.execute("DELETE FROM watcher_policies WHERE scope = ?1", params![task_id])
        .map_err(|e| format!("Failed to delete task watcher policies: {}", e))?;
    tx.execute("DELETE FROM watcher_cache WHERE scope = ?1", params![task_id])
        .map_err(|e| format!("Failed to delete task watcher cache: {}", e))?;
    
    tx.execute("DELETE FROM tasks WHERE id = ?1", params![task_id])
        .map_err(|e| format!("Failed to delete task: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Transaction commit error: {}", e))?;

    drop(connection);
    if let Ok(workspace) = crate::utils::task_workspace(&task_id) {
        let _ = std::fs::remove_dir_all(workspace);
    }
    Ok(())
}


/// Evaluate Gatekeeper for a native mutating/read directive, wait if asked,
/// then return the directive_result text. Approval cards are always visible
/// on the master conversation so the UI can show them.
pub(crate) async fn execute_gated_native_directive(
    state: &tauri::State<'_, AppState>,
    app_handle: &tauri::AppHandle,
    task_id: &str,
    run_id: &str,
    cancellation_token: &CancellationToken,
    directive: Directive,
) -> Result<String, String> {
    let verdict = match &directive {
        Directive::HttpRequest { url, method, body } => {
            crate::gatekeeper::evaluate_network_action(state, task_id, url, method, body.as_deref())
                .await
                .unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
        }
        Directive::RunCommand { command } => {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            crate::gatekeeper::evaluate_command_action(&conn, task_id, command)
                .unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
        }
        Directive::ReadFile { path } => {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            crate::gatekeeper::evaluate_file_permission(&conn, task_id, path, "read")
                .unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
        }
        Directive::WriteFile { path, .. } => {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            crate::gatekeeper::evaluate_file_permission(&conn, task_id, path, "write")
                .unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
        }
        Directive::DeleteFile { path } => {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            crate::gatekeeper::evaluate_file_permission(&conn, task_id, path, "delete")
                .unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
        }
        Directive::ListDir { path } | Directive::SearchFiles { path, .. } => {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            let mut v = crate::gatekeeper::evaluate_file_permission(&conn, task_id, path, "read")
                .unwrap_or(crate::gatekeeper::PermissionVerdict::Ask);
            if v == crate::gatekeeper::PermissionVerdict::Ask {
                v = crate::gatekeeper::PermissionVerdict::Allow;
            }
            v
        }
        Directive::RecallMessages { .. } => crate::gatekeeper::PermissionVerdict::Allow,
        _ => return Err("Not a gated native directive".into()),
    };

    match verdict {
        crate::gatekeeper::PermissionVerdict::Allow => {
            orchestrator::execute_directive_bypass_gatekeeper(state, app_handle, task_id, directive).await
        }
        crate::gatekeeper::PermissionVerdict::Deny => {
            Ok(orchestrator::directive_result_message(&serde_json::json!({
                "error": "Gatekeeper DENIED this action based on current policies."
            })))
        }
        crate::gatekeeper::PermissionVerdict::Ask => {
            let summary = match &directive {
                Directive::HttpRequest { url, method, .. } => format!("Run Network Request: {} {}", method, url),
                Directive::RunCommand { command } => format!("Run Command: `{}`", command),
                Directive::ReadFile { path } => format!("Read File: `{}`", path),
                Directive::WriteFile { path, .. } => format!("Write File: `{}`", path),
                Directive::DeleteFile { path } => format!("Delete File: `{}`", path),
                Directive::ListDir { path } => format!("List Directory: `{}`", path),
                Directive::SearchFiles { path, pattern } => format!("Search Files in `{}` for `{}`", path, pattern),
                _ => "Permission required".into(),
            };
            let mut approval_message = new_message(
                task_id,
                "event",
                "approval",
                serde_json::json!({
                    "summary": summary,
                    "detail": "",
                    "status": "pending",
                    "blocked_directive": directive,
                })
                .to_string(),
                None,
                None,
                true,
            );
            persist_and_emit(state, app_handle, task_id, &mut approval_message)?;

            let (approved, note) = match wait_for_approval(
                state.inner(),
                app_handle,
                task_id,
                &approval_message.id,
                run_id,
                cancellation_token,
            )
            .await
            {
                Ok(v) => v,
                Err(e) if e == "Task cancelled" || cancellation_token.is_cancelled() => {
                    finish_cancelled_run(state, app_handle, task_id, run_id)?;
                    return Err("RUN_CANCELLED".into());
                }
                Err(e) => return Err(e),
            };
            match wait_until_no_pending_approvals(state.inner(), task_id, cancellation_token).await {
                Ok(()) => {}
                Err(e) if e == "Task cancelled" || cancellation_token.is_cancelled() => {
                    finish_cancelled_run(state, app_handle, task_id, run_id)?;
                    return Err("RUN_CANCELLED".into());
                }
                Err(e) => return Err(e),
            }

            if approved {
                orchestrator::execute_directive_bypass_gatekeeper(state, app_handle, task_id, directive).await
            } else {
                let reason = if note.is_empty() {
                    "User DENIED the permission request.".to_string()
                } else {
                    format!("User DENIED the permission request. Note: {}", note)
                };
                Ok(orchestrator::directive_result_message(&serde_json::json!({ "error": reason })))
            }
        }
    }
}

async fn apply_resolved_approval(
    state: &tauri::State<'_, AppState>,
    app_handle: &tauri::AppHandle,
    task_id: &str,
    run_id: &str,
    cancellation_token: &CancellationToken,
    approval_id: &str,
    blocked: Directive,
    history: &mut Vec<ChatMessage>,
) -> Result<(), String> {
    let (approved, note) = match wait_for_approval(
        state.inner(),
        app_handle,
        task_id,
        approval_id,
        run_id,
        cancellation_token,
    ).await {
        Ok(v) => v,
        Err(e) if e == "Task cancelled" || cancellation_token.is_cancelled() => {
            finish_cancelled_run(state, app_handle, task_id, run_id)?;
            return Err("RUN_CANCELLED".into());
        }
        Err(e) => return Err(e),
    };
    match wait_until_no_pending_approvals(state.inner(), task_id, cancellation_token).await {
        Ok(()) => {}
        Err(e) if e == "Task cancelled" || cancellation_token.is_cancelled() => {
            finish_cancelled_run(state, app_handle, task_id, run_id)?;
            return Err("RUN_CANCELLED".into());
        }
        Err(e) => return Err(e),
    }

    let feedback = if approved {
        match blocked {
            Directive::AskUserChoice { .. } => {
                let (opt, custom) = {
                    let conn = state.db.lock().unwrap();
                    let content: String = conn.query_row(
                        "SELECT content FROM messages WHERE id = ?1",
                        rusqlite::params![approval_id],
                        |row| row.get(0),
                    ).unwrap_or_default();
                    if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
                        (
                            data.get("selected_option").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                            data.get("custom_input").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                        )
                    } else {
                        (String::new(), String::new())
                    }
                };
                let result_text = if !custom.is_empty() {
                    format!("User selected option: {} (custom input: '{}')", opt, custom)
                } else {
                    format!("User selected option: {}", opt)
                };
                orchestrator::directive_result_message(&serde_json::json!({ "choice_result": result_text }))
            }
            Directive::AskUserForLogin { .. } => {
                orchestrator::directive_result_message(&serde_json::json!({
                    "login_result": if note.is_empty() { "User completed the requested login.".to_string() } else { note.clone() }
                }))
            }
            other => match orchestrator::execute_directive_bypass_gatekeeper(state, app_handle, task_id, other).await {
                Ok(text) => text,
                Err(e) => orchestrator::directive_result_message(&serde_json::json!({ "error": e })),
            },
        }
    } else {
        let reason = if note.is_empty() {
            "User DENIED the permission request.".to_string()
        } else {
            format!("User DENIED the permission request. Note: {}", note)
        };
        orchestrator::directive_result_message(&serde_json::json!({ "error": reason }))
    };

    if !feedback.is_empty() {
        let mut hidden_result = new_message(
            task_id, "user", "directive_result", feedback.clone(), None, None, false,
        );
        persist_and_emit(state, app_handle, task_id, &mut hidden_result)?;
        history.push(ChatMessage { role: "user".into(), content: feedback });
    }
    Ok(())
}

pub async fn wait_for_approval(
    state: &AppState,
    _app_handle: &tauri::AppHandle,
    _task_id: &str,
    approval_id: &str,
    _run_id: &str,
    cancellation_token: &CancellationToken,
) -> Result<(bool, String), String> {
    loop {
        if cancellation_token.is_cancelled() {
            return Err("Task cancelled".into());
        }
        let msg = {
            let conn = state.db.lock().unwrap();
            conn.query_row(
                &format!("SELECT {} FROM messages WHERE id = ?1", MESSAGE_COLUMNS),
                rusqlite::params![approval_id],
                row_to_message,
            ).map_err(|e| format!("Message not found: {}", e))?
        };
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&msg.content) {
            if let Some(status) = data.get("status").and_then(|s| s.as_str()) {
                if status == "approved" || status == "resolved" {
                    let note = data.get("note").and_then(|n| n.as_str()).unwrap_or("").to_string();
                    return Ok((true, note));
                } else if status == "denied" {
                    let note = data.get("note").and_then(|n| n.as_str()).unwrap_or("").to_string();
                    return Ok((false, note));
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
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
            browser_manager: crate::browser_manager::BrowserManager::new(),
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

    #[test]
    fn count_pending_approvals_counts_only_pending() {
        let state = test_state();
        {
            let conn = state.db.lock().unwrap();
            crate::db::init_schema(&conn).unwrap();
            conn.execute(
                "INSERT INTO tasks (id, title, status, budget_credits, spent_credits, created_at, updated_at, master_model, worker_model, verifier_model, watcher_model, browser_mode)
                 VALUES ('t1', 't', 'active', 10, 0, 'n', 'n', '', '', '', '', 'sandbox')",
                [],
            ).ok();
            conn.execute(
                r#"INSERT INTO messages (id, task_id, conversation, role, kind, content, created_at, visible)
                 VALUES ('a1', 't1', 'master', 'event', 'approval', '{"status":"pending"}', 'n', 1)"#,
                [],
            ).unwrap();
            conn.execute(
                r#"INSERT INTO messages (id, task_id, conversation, role, kind, content, created_at, visible)
                 VALUES ('a2', 't1', 'master', 'event', 'approval', '{"status":"approved"}', 'n', 1)"#,
                [],
            ).unwrap();
            assert_eq!(count_pending_approvals(&conn, "t1").unwrap(), 1);
        }
    }

    #[test]
    fn compact_master_history_keeps_small_history_unaltered() {
        let history = vec![
            ChatMessage { role: "system".into(), content: "system".into() },
            ChatMessage { role: "user".into(), content: "do task".into() },
            ChatMessage { role: "assistant".into(), content: "ok".into() },
        ];
        let compacted = compact_master_history(history.clone());
        assert_eq!(compacted.len(), 3);
        assert_eq!(compacted[1].content, "do task");
    }

    #[test]
    fn compact_master_history_compacts_large_history() {
        let mut history = vec![
            ChatMessage { role: "system".into(), content: "system prompt with memory".into() },
            ChatMessage { role: "user".into(), content: "original initial task request".into() },
        ];
        // Add 20 intermediate turns
        for i in 0..20 {
            history.push(ChatMessage {
                role: if i % 2 == 0 { "assistant".into() } else { "user".into() },
                content: format!("Step {} action or tool output with lots of details", i),
            });
        }
        assert_eq!(history.len(), 22);
        let compacted = compact_master_history(history);
        // Should keep system (0), initial user (1), compacted summary (2), and last 6 recent turns (3..9) = 9 total
        assert_eq!(compacted.len(), 9);
        assert_eq!(compacted[0].content, "system prompt with memory");
        assert_eq!(compacted[1].content, "original initial task request");
        assert!(compacted[2].content.contains("[CONVERSATION MILESTONES (COMPACTED)]"));
        assert!(compacted[2].content.contains("recall_messages"));
        assert_eq!(compacted.last().unwrap().content, "Step 19 action or tool output with lots of details");
    }
}
