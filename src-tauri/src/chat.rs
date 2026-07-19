use crate::db::{new_id, now_iso, AppState};
use crate::gateway::{self, ChatMessage};
use crate::settings;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

pub const DEFAULT_TASK_TITLE: &str = "New agent task";

/// The M0 master prompt. M1 replaces the conversational part with the
/// structured directive protocol; the identity and honesty rules stay.
pub const MASTER_SYSTEM_PROMPT: &str = "You are ZEUS, the Master orchestrator of the Zeus Agent desktop app.
The user brings you goals. Think like an orchestrator, not a chatbot.

How to operate:
- If the goal is underspecified in a way that changes the plan materially, ask the user for exactly the missing information (list each item plainly). Do not ask for things you can reasonably infer.
- If you and the user appear aligned, do NOT end with an open-ended offer (\"let me know if you want X\"). Instead, immediately lay out the final action plan yourself: a numbered plan where each step says what happens, what external access or credentials it needs, and what it roughly costs; then ask for explicit go-ahead (\"Reply GO to start\").
- During execution (coming in a later build) you will emit structured JSON directives the app runs: spawn workers, run code actions, request approvals. Your plans should already be written with that execution in mind.
- Never claim to have taken actions or fetched data you have not. Be direct and practical.";

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

#[derive(Serialize)]
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

/// Builds the message array sent to the master model: system prompt first,
/// then the full master conversation in order.
fn load_master_history(connection: &Connection, task_id: &str) -> Result<Vec<ChatMessage>, String> {
    let mut history = vec![ChatMessage {
        role: "system".into(),
        content: MASTER_SYSTEM_PROMPT.into(),
    }];

    let mut statement = connection
        .prepare(
            "SELECT role, content FROM messages
             WHERE task_id = ?1 AND conversation = 'master' AND kind = 'chat'
             ORDER BY rowid ASC",
        )
        .map_err(|e| format!("Failed to prepare the history query: {}", e))?;

    let rows = statement
        .query_map(params![task_id], |row| {
            Ok(ChatMessage { role: row.get(0)?, content: row.get(1)? })
        })
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

    // Create the per-task workspace folder so later milestones can assume it exists
    let _ = crate::utils::task_workspace(&task.id);

    Ok(task)
}

#[tauri::command]
pub async fn list_tasks(state: State<'_, AppState>) -> Result<Vec<TaskDto>, String> {
    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let mut statement = connection
        .prepare(
            "SELECT id, title, status, budget_credits, spent_credits, created_at, updated_at
             FROM tasks ORDER BY updated_at DESC",
        )
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
pub async fn get_task_messages(state: State<'_, AppState>, task_id: String) -> Result<Vec<MessageDto>, String> {
    let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
    let mut statement = connection
        .prepare(
            "SELECT id, task_id, conversation, role, kind, content, credits_used, model, created_at
             FROM messages WHERE task_id = ?1 AND conversation = 'master'
             ORDER BY rowid ASC",
        )
        .map_err(|e| format!("Failed to prepare the messages query: {}", e))?;

    let rows = statement
        .query_map(params![task_id], row_to_message)
        .map_err(|e| format!("Failed to load the messages: {}", e))?;

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

#[tauri::command]
pub async fn send_user_message(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    task_id: String,
    content: String,
) -> Result<SendResultDto, String> {
    use tauri::Emitter;
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("Cannot send an empty message.".into());
    }

    // 1) Lock the db only for local reads/writes, never across the network call
    let (history, user_message, task, master_model) = {
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

        // Auto-title the task from the first user message
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
        (history, user_message, task, app_settings.master_model)
    };

    // 2) Stream the master reply, forwarding deltas to the frontend (no lock held)
    let stream_task_id = task_id.clone();
    let stream_handle = app_handle.clone();
    let (reply_text, usage, usage_json, model_used) =
        gateway::chat_completion_stream(&master_model, &history, move |event| {
            let _ = stream_handle.emit("chat-stream", serde_json::json!({
                "task_id": stream_task_id,
                "event": event,
            }));
        })
        .await?;

    // 3) Persist the assistant reply, the ledger event and the task spend
    let units = usage.units();
    let assistant_message = {
        let connection = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let now = now_iso();

        let assistant_message = MessageDto {
            id: new_id(),
            task_id: task_id.clone(),
            conversation: "master".into(),
            role: "assistant".into(),
            kind: "chat".into(),
            content: reply_text,
            credits_used: Some(units),
            model: Some(model_used.unwrap_or_else(|| master_model.clone())),
            created_at: now.clone(),
        };
        insert_message(&connection, &assistant_message)?;

        connection
            .execute(
                "INSERT INTO credit_events (id, task_id, model, input_tokens, output_tokens, reasoning_tokens, total_tokens, units, tool_calls, images, credits, raw_usage_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12)",
                params![
                    new_id(), task_id, master_model,
                    usage.input_tokens, usage.output_tokens, usage.reasoning_tokens, usage.total_tokens,
                    units, usage.tool_calls, usage.images,
                    usage_json, now
                ],
            )
            .map_err(|e| format!("Failed to log the credit event: {}", e))?;

        connection
            .execute(
                "UPDATE tasks SET spent_credits = spent_credits + ?1, updated_at = ?2 WHERE id = ?3",
                params![units, now_iso(), task_id],
            )
            .map_err(|e| format!("Failed to update the task spend: {}", e))?;

        assistant_message
    };

    Ok(SendResultDto {
        user_message,
        spent_credits: task.spent_credits + units,
        budget_credits: task.budget_credits,
        assistant_message,
    })
}