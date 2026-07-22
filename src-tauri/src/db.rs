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
///  - messages.visible is the SINGLE source of truth for what the UI renders.
///    The frontend never decides visibility (P0 "Bedrock").
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
    created_at TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1
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
    init_schema(&connection)?;
    Ok(connection)
}

/// Split out so tests can run the exact same schema + migrations in-memory.
pub fn init_schema(connection: &Connection) -> Result<(), String> {
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

    // P0 migration: add messages.visible to databases created before Bedrock,
    // then backfill: pipeline kinds (and legacy content-sniffed rows) become
    // hidden. This retires all frontend visibility heuristics permanently.
    let has_visible: bool = connection
        .prepare("SELECT 1 FROM pragma_table_info('messages') WHERE name = 'visible' LIMIT 1")
        .and_then(|mut s| s.exists([]))
        .unwrap_or(false);
    if !has_visible {
        connection
            .execute("ALTER TABLE messages ADD COLUMN visible INTEGER NOT NULL DEFAULT 1", [])
            .map_err(|e| format!("Failed to add the messages.visible column: {}", e))?;
    }
    connection
        .execute(
            r"UPDATE messages SET visible = 0
              WHERE kind IN ('directive', 'directive_result')
                 OR (role = 'assistant' AND content LIKE '%```zeus-directive%')
                 OR (role = 'user' AND content LIKE '[DIRECTIVE\_%' ESCAPE '\')",
            [],
        )
        .map_err(|e| format!("Failed to backfill message visibility: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        init_schema(&connection).unwrap();
        connection
    }

    fn insert_msg(c: &Connection, id: &str, role: &str, kind: &str, content: &str, visible: bool) {
        c.execute(
            "INSERT INTO messages (id, task_id, conversation, role, kind, content, created_at, visible)
             VALUES (?1, 't1', 'master', ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, role, kind, content, now_iso(), visible],
        )
        .unwrap();
    }

    #[test]
    fn visible_query_never_returns_pipeline_kinds() {
        let c = test_db();
        insert_msg(&c, "m1", "user", "chat", "hello", true);
        insert_msg(&c, "m2", "assistant", "directive", "{...}", false);
        insert_msg(&c, "m3", "user", "directive_result", "[DIRECTIVE_RESULT] {}", false);
        insert_msg(&c, "m4", "assistant", "chat", "done", true);

        let kinds: Vec<String> = c
            .prepare("SELECT kind FROM messages WHERE task_id = 't1' AND visible = 1 ORDER BY rowid ASC")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(kinds, vec!["chat", "chat"]);
    }

    #[test]
    fn migration_backfills_legacy_rows_as_hidden() {
        // Simulate a pre-Bedrock row that was inserted visible by default but
        // is pipeline-internal by kind or content shape.
        let c = test_db();
        insert_msg(&c, "m1", "assistant", "directive", "raw", true);
        insert_msg(&c, "m2", "user", "chat", "[DIRECTIVE_ERROR] bad block", true);
        init_schema(&c).unwrap(); // re-running migrations is idempotent

        let hidden: i64 = c
            .query_row("SELECT COUNT(*) FROM messages WHERE visible = 0", [], |r| r.get(0))
            .unwrap();
        assert_eq!(hidden, 2);
    }

    #[test]
    fn rowid_seq_is_strictly_increasing_and_matches_insert_order() {
        let c = test_db();
        for i in 0..5 {
            insert_msg(&c, &format!("m{}", i), "user", "chat", "x", true);
        }
        let seqs: Vec<i64> = c
            .prepare("SELECT rowid FROM messages WHERE task_id = 't1' ORDER BY rowid ASC")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!(seqs.windows(2).all(|w| w[1] > w[0]));
    }
}