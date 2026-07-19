use chrono::Utc;
use rusqlite::Connection;
use std::sync::Mutex;
use uuid::Uuid;

pub struct AppState {
    pub db: Mutex<Connection>,
}

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

/// The schema is forward-compatible with M1+:
///  - messages.conversation will hold 'master' or 'worker:<id>'
///  - messages.kind will hold 'chat' | 'plan' | 'summary' | 'event'
///  - credit_events keeps the raw usage JSON so credit parsing can be
///    adjusted later without losing data.
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    budget_credits INTEGER NOT NULL DEFAULT 40000,
    spent_credits REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    conversation TEXT NOT NULL DEFAULT 'master',
    role TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'chat',
    content TEXT NOT NULL,
    credits_used REAL,
    model TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id);

CREATE TABLE IF NOT EXISTS credit_events (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    model TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    reasoning_tokens INTEGER,
    total_tokens INTEGER,
    units REAL NOT NULL DEFAULT 0,
    tool_calls INTEGER NOT NULL DEFAULT 0,
    images INTEGER NOT NULL DEFAULT 0,
    credits REAL,
    raw_usage_json TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";

pub fn init(db_path: &std::path::Path) -> Result<Connection, String> {
    let connection = Connection::open(db_path)
        .map_err(|e| format!("Failed to open the database at {}: {}", db_path.display(), e))?;

    // One-off migration: the first build's credit_events table had a different
    // shape (prompt_tokens/completion_tokens/credits). The rename keeps the old
    // rows for reference without colliding with the new CREATE TABLE above.
    let has_old_credit_events: bool = connection
        .prepare("SELECT 1 FROM pragma_table_info('credit_events') WHERE name = 'prompt_tokens' LIMIT 1")
        .and_then(|mut s| s.exists([]))
        .unwrap_or(false);
    if has_old_credit_events {
        connection
            .execute("ALTER TABLE credit_events RENAME TO credit_events_legacy", [])
            .map_err(|e| format!("Failed to migrate the legacy credit_events table: {}", e))?;
    }

    connection
        .execute_batch(SCHEMA)
        .map_err(|e| format!("Failed to initialize the database schema: {}", e))?;
    Ok(connection)
}