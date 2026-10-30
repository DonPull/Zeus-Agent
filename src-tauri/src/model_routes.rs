//! Explicit provider/model bindings. Legacy inference is confined to migration.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const ROLES: [&str; 5] = ["master", "worker", "verifier", "watcher", "vision"];
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ModelRef {
    pub connection: String,
    pub model_id: String,
    #[serde(default = "auto")]
    pub protocol: String,
    #[serde(default = "unknown")]
    pub image_input: String,
    #[serde(default = "explicit")]
    pub source: String,
}
fn auto() -> String {
    "auto".into()
}
fn unknown() -> String {
    "unknown".into()
}
fn explicit() -> String {
    "explicit".into()
}
pub type Bindings = BTreeMap<String, ModelRef>;
impl ModelRef {
    pub fn new(connection: &str, model: &str, source: &str) -> Self {
        Self {
            connection: connection.into(),
            model_id: model.into(),
            protocol: auto(),
            image_input: unknown(),
            source: source.into(),
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if !["abacus", "gemini", "xiaomi", "local", "legacy"].contains(&self.connection.as_str())
            || !["auto", "chat", "responses"].contains(&self.protocol.as_str())
            || !["unknown", "supported", "unsupported"].contains(&self.image_input.as_str())
            || self.model_id.trim().is_empty()
            || self.model_id.eq_ignore_ascii_case("none")
        {
            return Err("MODEL_ROUTE: invalid connection, protocol, capability or model".into());
        }
        Ok(())
    }
    pub fn resolved(mut self) -> Self {
        if self.connection == "legacy" {
            self.connection = legacy_connection(&self.model_id).into();
            self.source = "legacy".into();
        }
        self
    }
    pub fn images(&self) -> &'static str {
        if self.image_input == "supported" {
            return "supported";
        }
        if self.image_input == "unsupported" {
            return "unsupported";
        }
        // Small documented adapter matrix, not model-name capability inference.
        // Unknown models remain configurable, never silently text-only.
        match (self.connection.as_str(), self.model_id.as_str()) {
            (
                "abacus",
                "gpt-5-nano" | "gpt-5-mini" | "gpt-5" | "gpt-4.1-mini" | "gpt-4.1" | "gpt-4o"
                | "gpt-4o-mini" | "gpt-6-astra" | "gpt-6-luna" | "gemini-3.8-flash" | "gemini-2.5-flash"
                | "gemini-2.5-pro",
            ) => "supported",
            ("gemini", "gemini-2.5-flash" | "gemini-2.5-pro" | "gemini-3.8-flash") => "supported",
            _ => "unknown",
        }
    }
    pub fn responses(&self) -> bool {
        match self.protocol.as_str() {
            "responses" => true,
            "chat" => false,
            _ if self.source == "legacy" => {
                self.connection != "local"
                    && self.connection != "gemini"
                    && legacy_responses(&self.model_id)
            }
            _ => {
                self.connection == "abacus"
                    && [
                        "gpt-5-nano",
                        "gpt-5-mini",
                        "gpt-5",
                        "gpt-5.1",
                        "gpt-5.2",
                        "gpt-5.4",
                        "gpt-5.4-mini",
                        "gpt-6-astra",
                        "gpt-6-luna",
                        "gpt-6.1-sol",
                        "gpt-6.1-terra",
                        "o3",
                        "o3-pro",
                        "o4-mini",
                    ]
                    .contains(&self.model_id.as_str())
            }
        }
    }
}
fn legacy_responses(model: &str) -> bool {
    ["gpt-5", "o1", "o3", "o4"]
        .iter()
        .any(|part| model.to_lowercase().contains(part))
}
pub fn legacy_connection(model: &str) -> &'static str {
    if crate::gateway::is_registered_local(model) {
        "local"
    } else if crate::gateway::is_mimo_model(model) {
        "xiaomi"
    } else if model.starts_with("gemini") {
        "gemini"
    } else {
        "abacus"
    }
}

pub fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS task_model_routes (
        task_id TEXT NOT NULL REFERENCES tasks(id), role TEXT NOT NULL,
        model_id TEXT NOT NULL, binding_json TEXT NOT NULL, PRIMARY KEY(task_id,role));",
    )
    .map_err(|e| e.to_string())?;
    for role in ROLES {
        let sql = format!("SELECT id, {role}_model FROM tasks WHERE {role}_model <> '' AND lower({role}_model) <> 'none'
            AND NOT EXISTS (SELECT 1 FROM task_model_routes r WHERE r.task_id=tasks.id AND r.role=?1)");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([role], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        for (task, model) in rows {
            save(
                conn,
                &task,
                role,
                &ModelRef::new("legacy", &model, "legacy"),
            )?;
        }
    }
    Ok(())
}
pub fn load(conn: &Connection, task: &str) -> Result<Bindings, String> {
    let mut stmt = conn
        .prepare("SELECT role,binding_json FROM task_model_routes WHERE task_id=?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([task], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut result = Bindings::new();
    for row in rows {
        let (role, raw) = row.map_err(|e| e.to_string())?;
        result.insert(
            role,
            serde_json::from_str(&raw).map_err(|e| format!("MODEL_ROUTE: {e}"))?,
        );
    }
    Ok(result)
}
pub fn save(conn: &Connection, task: &str, role: &str, binding: &ModelRef) -> Result<(), String> {
    binding.validate()?;
    if !ROLES.contains(&role) {
        return Err("MODEL_ROUTE: invalid role".into());
    }
    conn.execute("INSERT INTO task_model_routes(task_id,role,model_id,binding_json) VALUES(?1,?2,?3,?4)
        ON CONFLICT(task_id,role) DO UPDATE SET model_id=excluded.model_id,binding_json=excluded.binding_json",
        params![task,role,binding.model_id,serde_json::to_string(binding).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn reconcile(
    conn: &Connection,
    task: &str,
    selections: &[(&str, &str)],
    supplied: Option<&Bindings>,
) -> Result<(), String> {
    let existing = load(conn, task)?;
    for (role, model) in selections {
        if model.is_empty() || model.eq_ignore_ascii_case("none") {
            conn.execute(
                "DELETE FROM task_model_routes WHERE task_id=?1 AND role=?2",
                params![task, role],
            )
            .map_err(|e| e.to_string())?;
            continue;
        }
        let binding = supplied
            .and_then(|map| map.get(*role))
            .cloned()
            .or_else(|| {
                existing
                    .get(*role)
                    .filter(|binding| binding.model_id == *model)
                    .cloned()
            })
            .unwrap_or_else(|| ModelRef::new("abacus", model, "explicit"));
        if binding.model_id != *model {
            return Err(format!("MODEL_ROUTE: stale {role} binding"));
        }
        save(conn, task, role, &binding)?;
    }
    Ok(())
}

tokio::task_local! { static CURRENT: Option<ModelRef>; }
pub fn current(model: &str) -> Result<Option<ModelRef>, String> {
    let value = CURRENT.try_with(Clone::clone).ok().flatten();
    if value.as_ref().is_some_and(|value| value.model_id != model) {
        return Err("MODEL_ROUTE: model differs from scoped role".into());
    }
    Ok(value)
}
pub async fn with_binding<T>(
    binding: ModelRef,
    future: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    CURRENT.scope(Some(binding), future).await
}
pub async fn scope<T>(
    db: &std::sync::Arc<std::sync::Mutex<Connection>>,
    task: Option<&str>,
    role: &str,
    future: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let binding = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        if let Some(task) = task.filter(|_| ROLES.contains(&role)) {
            let binding = load(&conn, task)?.remove(role).map(ModelRef::resolved);
            if let Some(binding) = &binding {
                save(&conn, task, role, binding)?;
            }
            binding
        } else {
            // Policy editing uses the global Watcher selection, even for task policy.
            let settings = crate::settings::read_settings(&conn)?;
            settings
                .model_bindings
                .get(if role == "policy_editor" {
                    "watcher"
                } else {
                    role
                })
                .cloned()
                .map(ModelRef::resolved)
        }
    };
    CURRENT.scope(binding, future).await
}
pub fn task_is_local(conn: &Connection, task: &str, role: &str) -> bool {
    load(conn, task)
        .ok()
        .and_then(|mut bindings| bindings.remove(role))
        .map(|binding| binding.resolved().connection == "local")
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        conn.execute("INSERT INTO tasks(id,title,created_at,updated_at,master_model) VALUES('t','t','now','now','gemini-2.5-flash')",[]).unwrap();
        conn
    }
    #[test]
    fn legacy_migration_is_additive_and_explicit_route_survives_restart() {
        let conn = db();
        init_schema(&conn).unwrap();
        assert_eq!(load(&conn, "t").unwrap()["master"].connection, "legacy");
        let binding = ModelRef::new("abacus", "gemini-2.5-flash", "explicit");
        save(&conn, "t", "master", &binding).unwrap();
        init_schema(&conn).unwrap();
        assert_eq!(load(&conn, "t").unwrap()["master"], binding);
        assert_eq!(
            ModelRef::new("legacy", "gemini-2.5-flash", "legacy")
                .resolved()
                .connection,
            "gemini"
        );
    }
    #[test]
    fn same_id_on_different_connections_and_unknown_capability_stay_distinct() {
        let hosted = ModelRef::new("abacus", "gpt-5-nano", "explicit");
        let local = ModelRef::new("local", "gpt-5-nano", "explicit");
        assert_eq!(hosted.images(), "supported");
        assert_eq!(local.images(), "unknown");
        assert!(hosted.responses());
        assert!(!local.responses());
        assert!(!ModelRef::new("local", "gpt-5-nano", "legacy").responses());
    }
    #[test]
    fn settings_reconciliation_rejects_stale_binding_and_clears_disabled_role() {
        let conn = db();
        let mut bindings = Bindings::new();
        bindings.insert(
            "master".into(),
            ModelRef::new("abacus", "other", "explicit"),
        );
        assert!(reconcile(&conn, "t", &[("master", "m")], Some(&bindings)).is_err());
        reconcile(&conn, "t", &[("master", "m")], None).unwrap();
        assert_eq!(load(&conn, "t").unwrap()["master"].connection, "abacus");
        reconcile(&conn, "t", &[("master", "None")], None).unwrap();
        assert!(load(&conn, "t").unwrap().is_empty());
    }
}
