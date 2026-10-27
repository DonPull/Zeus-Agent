//! Request-scoped accounting. No database guard is held while awaiting a provider.
use crate::db::{new_id, now_iso};
use crate::gateway::UsageInfo;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct Context {
    db: Arc<Mutex<Connection>>,
    task_id: Option<String>,
    run_id: Option<String>,
    role: String,
}

tokio::task_local! { static CONTEXT: Context; }

pub async fn scope<T>(db: &Arc<Mutex<Connection>>, task_id: Option<&str>, role: &str,
    future: impl std::future::Future<Output = T>) -> T {
    let run_id = task_id.and_then(|id| db.lock().ok().and_then(|conn| conn.query_row(
        "SELECT id FROM runs WHERE task_id = ?1 AND status = 'running' ORDER BY rowid DESC LIMIT 1",
        [id], |row| row.get(0)).ok()));
    CONTEXT.scope(Context { db: db.clone(), task_id: task_id.map(str::to_owned), run_id, role: role.into() }, future).await
}

pub struct RequestGuard {
    context: Context,
    id: String,
    requested_model: String,
    completed: bool,
}

pub fn begin(model: &str, endpoint: &str) -> Result<Option<RequestGuard>, String> {
    let Ok(context) = CONTEXT.try_with(Clone::clone) else { return Ok(None); };
    let id = new_id();
    {
        let conn = context.db.lock().map_err(|e| e.to_string())?;
        let provider = reqwest::Url::parse(endpoint).map(|url| url.origin().ascii_serialization())
            .unwrap_or_else(|_| "unknown".into());
        conn.execute("INSERT INTO credit_events (id, request_id, task_id, run_id, role, model, requested_model, provider,
            units, usage_known, request_status, raw_usage_json, created_at)
            VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?5, ?6, 0, 0, 'in_flight', '', ?7)",
            params![id, context.task_id, context.run_id, context.role, model, provider, now_iso()]).map_err(|e| e.to_string())?;
    }
    Ok(Some(RequestGuard { context, id, requested_model: model.into(), completed: false }))
}

pub fn observe(guard: &mut Option<RequestGuard>, usage: &mut UsageInfo, raw: &str, reported_model: Option<&str>) -> Result<(), String> {
    if let Some(guard) = guard {
        usage.request_id = Some(guard.id.clone());
        let conn = guard.context.db.lock().map_err(|e| e.to_string())?;
        record_usage(&conn, guard.context.task_id.as_deref(), guard.context.run_id.as_deref(), &guard.context.role,
            &guard.requested_model, reported_model.unwrap_or(&guard.requested_model), usage, raw)?;
    }
    Ok(())
}

pub fn complete(guard: &mut Option<RequestGuard>, usage: &mut UsageInfo) -> Result<(), String> {
    if let Some(guard) = guard {
        // Even a successful response with missing usage belongs to this request.
        // Attaching its ID prevents a caller from creating a second unknown row.
        usage.request_id = Some(guard.id.clone());
        let conn = guard.context.db.lock().map_err(|e| e.to_string())?;
        conn.execute("UPDATE credit_events SET request_status = 'completed' WHERE id = ?1", [&guard.id])
            .map_err(|e| e.to_string())?;
        guard.completed = true;
    }
    Ok(())
}

impl Drop for RequestGuard {
    fn drop(&mut self) {
        if !self.completed {
            if let Ok(conn) = self.context.db.lock() {
                // Dropping a model future on cancellation still leaves an unknown-usage request.
                let _ = conn.execute("UPDATE credit_events SET request_status = 'interrupted' WHERE id = ?1", [&self.id]);
            }
        }
    }
}

pub fn record_usage(conn: &Connection, task_id: Option<&str>, run_id: Option<&str>, role: &str,
    requested_model: &str, reported_model: &str, usage: &UsageInfo, raw: &str) -> Result<f64, String> {
    let id = usage.request_id.clone().unwrap_or_else(new_id);
    let units = usage.units();
    // Savepoint works with the immutable Connection reference and inside existing transactions.
    conn.execute_batch("SAVEPOINT record_usage").map_err(|e| e.to_string())?;
    let result = (|| -> rusqlite::Result<()> {
        let existing = conn.query_row("SELECT task_id, units FROM credit_events WHERE request_id = ?1", [&id],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, f64>(1)?))).optional()?;
        if let Some((owner, _)) = &existing {
            if owner.as_deref() != task_id { return Err(rusqlite::Error::InvalidParameterName("request belongs to another task".into())); }
        }
        let previous = existing.map(|(_, value)| value).unwrap_or(0.0);
        conn.execute("INSERT INTO credit_events (id, request_id, task_id, run_id, role, model, requested_model,
                provider_request_id, input_tokens, output_tokens, reasoning_tokens, total_tokens, cached_tokens,
                units, tool_calls, images, credits, raw_usage_json, usage_known, request_status, created_at)
            VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, NULL, ?16, ?17, 'completed', ?18)
            ON CONFLICT(request_id) DO UPDATE SET model=excluded.model, provider_request_id=excluded.provider_request_id,
                input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens, reasoning_tokens=excluded.reasoning_tokens,
                total_tokens=excluded.total_tokens, cached_tokens=excluded.cached_tokens, units=excluded.units,
                tool_calls=excluded.tool_calls, images=excluded.images, raw_usage_json=excluded.raw_usage_json,
                usage_known=excluded.usage_known",
            params![id, task_id, run_id, role, reported_model, requested_model, usage.provider_request_id,
                usage.input_tokens, usage.output_tokens, usage.reasoning_tokens, usage.total_tokens, usage.cached_tokens,
                units, usage.tool_calls, usage.images, raw, usage.usage_known, now_iso()])?;
        if let Some(task) = task_id {
            let changed = conn.execute("UPDATE tasks SET spent_credits = spent_credits + ?1, updated_at = ?2 WHERE id = ?3",
                params![units - previous, now_iso(), task])?;
            if changed != 1 { return Err(rusqlite::Error::QueryReturnedNoRows); }
        }
        Ok(())
    })();
    match result {
        Ok(()) => { conn.execute_batch("RELEASE record_usage").map_err(|e| e.to_string())?; Ok(units) }
        Err(error) => {
            conn.execute_batch("ROLLBACK TO record_usage; RELEASE record_usage").map_err(|e| e.to_string())?;
            Err(format!("Failed to record usage atomically: {}", error))
        }
    }
}

#[derive(Debug, Serialize)]
pub struct UsageSummary {
    pub requests: i64,
    pub unknown_requests: i64,
    pub known_tokens: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_tokens: i64,
    pub cached_tokens: i64,
    pub provider_credits: Option<f64>,
    pub unit_kind: &'static str,
    pub requests_by_role: std::collections::BTreeMap<String, i64>,
    pub requests_by_provider: std::collections::BTreeMap<String, i64>,
}

pub fn summarize(conn: &Connection, task: &str) -> Result<UsageSummary, String> {
    let groups = |field: &str| -> Result<std::collections::BTreeMap<String, i64>, String> {
        let mut statement = conn.prepare(&format!("SELECT COALESCE({}, 'historical/unclassified'), COUNT(*) FROM credit_events WHERE task_id=?1 GROUP BY {}", field, field))
            .map_err(|e| e.to_string())?;
        let rows = statement.query_map([task], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    };
    let by_role = groups("role")?;
    let by_provider = groups("provider")?;
    conn.query_row("SELECT COUNT(*), COALESCE(SUM(CASE WHEN usage_known=1 THEN 0 ELSE 1 END),0),
        COALESCE(SUM(CASE WHEN usage_known=1 THEN total_tokens ELSE 0 END),0), COALESCE(SUM(input_tokens),0),
        COALESCE(SUM(output_tokens),0), COALESCE(SUM(reasoning_tokens),0), COALESCE(SUM(cached_tokens),0)
        FROM credit_events WHERE task_id = ?1", [task], |r| Ok(UsageSummary {
        requests: r.get(0)?, unknown_requests: r.get(1)?, known_tokens: r.get(2)?, input_tokens: r.get(3)?,
        output_tokens: r.get(4)?, reasoning_tokens: r.get(5)?, cached_tokens: r.get(6)?,
        provider_credits: None, unit_kind: "tokens_not_provider_credits",
        requests_by_role: by_role, requests_by_provider: by_provider,
    })).map_err(|e| e.to_string())
}

pub fn task_spend(conn: &Connection, task: &str) -> Result<f64, String> {
    conn.query_row("SELECT spent_credits FROM tasks WHERE id = ?1", [task], |r| r.get(0)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database() -> Connection {
        let conn = crate::db::init(std::path::Path::new(":memory:")).unwrap();
        conn.execute("INSERT INTO tasks (id,title,created_at,updated_at) VALUES ('task','Test','now','now')", []).unwrap();
        conn
    }
    fn usage(id: &str) -> UsageInfo {
        UsageInfo { input_tokens: 75, output_tokens: 1186, reasoning_tokens: 1024, total_tokens: 1261,
            usage_known: true, request_id: Some(id.into()), ..Default::default() }
    }
    #[test]
    fn requests_are_idempotent_but_distinct_billed_retries_are_not() {
        let conn = database();
        for id in ["first", "first", "retry"] {
            record_usage(&conn, Some("task"), None, "master", "requested", "reported", &usage(id), "{}").unwrap();
        }
        assert_eq!(task_spend(&conn, "task").unwrap(), 2522.0);
        assert_eq!(summarize(&conn, "task").unwrap().requests, 2);
    }
    #[test]
    fn usage_and_task_total_roll_back_together_on_update_failure() {
        let conn = database();
        conn.execute_batch("CREATE TRIGGER fail_spend BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
        assert!(record_usage(&conn, Some("task"), None, "worker", "m", "m", &usage("failed"), "{}").is_err());
        assert_eq!(summarize(&conn, "task").unwrap().requests, 0);
        assert_eq!(task_spend(&conn, "task").unwrap(), 0.0);
    }
    #[test]
    fn all_roles_share_the_same_authoritative_budget() {
        let conn = database();
        for role in ["master", "worker", "verifier", "watcher", "vision"] {
            record_usage(&conn, Some("task"), None, role, "m", "m", &usage(role), "{}").unwrap();
        }
        assert_eq!(task_spend(&conn, "task").unwrap(), 6305.0);
    }

    #[test]
    fn additive_migration_preserves_legacy_raw_usage_and_history() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE credit_events (
            id TEXT PRIMARY KEY, task_id TEXT, model TEXT NOT NULL, input_tokens INTEGER,
            output_tokens INTEGER, reasoning_tokens INTEGER, total_tokens INTEGER, units REAL,
            tool_calls INTEGER, images INTEGER, credits REAL, raw_usage_json TEXT, created_at TEXT);
            INSERT INTO credit_events (id,model,raw_usage_json,units) VALUES ('old','old-model','{\"custom\":42}',2285);").unwrap();
        crate::db::init_schema(&conn).unwrap();
        crate::db::init_schema(&conn).unwrap();
        let (raw, units, request): (String, f64, Option<String>) = conn.query_row(
            "SELECT raw_usage_json,units,request_id FROM credit_events WHERE id='old'", [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!(raw, "{\"custom\":42}");
        assert_eq!(units, 2285.0); // Do not silently reprice historical measurements.
        assert_eq!(request, None);
    }
    #[tokio::test]
    async fn cancelled_request_preserves_unknown_usage() {
        let db = Arc::new(Mutex::new(database()));
        scope(&db, Some("task"), "watcher", async {
            let guard = begin("m", "http://127.0.0.1:1234").unwrap(); drop(guard);
        }).await;
        let summary = summarize(&db.lock().unwrap(), "task").unwrap();
        assert_eq!(summary.unknown_requests, 1);
        assert_eq!(summary.provider_credits, None);
    }
}
