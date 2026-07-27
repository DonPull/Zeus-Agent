use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::db::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct FilePermission {
    pub id: String,
    pub scope: String,
    pub path: String,
    pub action: String,
    pub permission_type: String,
    pub created_at: String,
}

#[tauri::command]
pub fn get_file_permissions(state: State<'_, AppState>, scope: String) -> Result<Vec<FilePermission>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, scope, path, action, permission_type, created_at FROM permissions WHERE scope = ?1 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    
    let permissions = stmt
        .query_map(params![scope], |row| {
            Ok(FilePermission {
                id: row.get(0)?,
                scope: row.get(1)?,
                path: row.get(2)?,
                action: row.get(3)?,
                permission_type: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
        
    Ok(permissions)
}

#[tauri::command]
pub fn add_file_permission(
    state: State<'_, AppState>,
    scope: String,
    path: String,
    action: String,
    permission_type: String,
) -> Result<FilePermission, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let id = crate::db::new_id();
    let now = crate::db::now_iso();
    
    conn.execute(
        "INSERT INTO permissions (id, scope, path, action, permission_type, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, scope, path, action, permission_type, now, now],
    ).map_err(|e| e.to_string())?;
    
    Ok(FilePermission {
        id,
        scope,
        path,
        action,
        permission_type,
        created_at: now,
    })
}

#[tauri::command]
pub fn delete_file_permission(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM permissions WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WatcherPolicy {
    pub id: String,
    pub scope: String,
    pub url_pattern: String,
    pub rules_summary: String,
    pub created_at: String,
}

#[tauri::command]
pub fn get_watcher_policies(state: State<'_, AppState>, scope: String) -> Result<Vec<WatcherPolicy>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, scope, url_pattern, rules_summary, created_at FROM watcher_policies WHERE scope = ?1 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    
    let policies = stmt
        .query_map(params![scope], |row| {
            Ok(WatcherPolicy {
                id: row.get(0)?,
                scope: row.get(1)?,
                url_pattern: row.get(2)?,
                rules_summary: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
        
    Ok(policies)
}

#[tauri::command]
pub fn add_watcher_policy(
    state: State<'_, AppState>,
    scope: String,
    url_pattern: String,
    rules_summary: String,
) -> Result<WatcherPolicy, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let id = crate::db::new_id();
    let now = crate::db::now_iso();
    
    conn.execute(
        "INSERT INTO watcher_policies (id, scope, url_pattern, rules_summary, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, scope, url_pattern, rules_summary, now, now],
    ).map_err(|e| e.to_string())?;
    
    Ok(WatcherPolicy {
        id,
        scope,
        url_pattern,
        rules_summary,
        created_at: now,
    })
}

#[tauri::command]
pub fn delete_watcher_policy(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM watcher_policies WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn negotiate_watcher_policy(
    state: State<'_, AppState>,
    scope: String,
    prompt: String,
) -> Result<String, String> {
    use crate::gateway::{chat_completion, ChatMessage as GatewayMsg};
    
    // 1. Get settings for the verifier model (which is the Watcher)
    let settings = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        crate::settings::read_settings(&conn).map_err(|e| e.to_string())?
    };
    
    let model = settings.verifier_model.clone();
    if model.is_empty() {
        return Err("No verifier model configured in Settings.".to_string());
    }

    // 2. Get existing policies to feed as context
    let existing = get_watcher_policies(state.clone(), scope.clone())?;
    let mut context = String::new();
    for p in existing {
        context.push_str(&format!("URL Pattern: {}\nRules: {}\n---\n", p.url_pattern, p.rules_summary));
    }

    let sys_prompt = format!(
        "You are the Watcher AI Policy Negotiator. The user wants to add or update rules for how the Zeus agent interacts with the network or browser.\n\n\
        Existing policies for this scope:\n{}\n\n\
        Your job is to read the user's request and output a CONCISE, markdown-formatted rules summary that captures their intent. \
        DO NOT output conversational filler. ONLY output the rules. Use bullet points.",
        if context.is_empty() { "None." } else { &context }
    );

    let messages = vec![
        GatewayMsg { role: "system".into(), content: sys_prompt },
        GatewayMsg { role: "user".into(), content: prompt },
    ];

    let (text, _, _, _) = chat_completion(&model, &messages).await.map_err(|e| e.to_string())?;
    Ok(text)
}
pub enum PermissionVerdict {
    Allow,
    Deny,
    Ask,
}

impl std::str::FromStr for PermissionVerdict {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "allow" => Ok(PermissionVerdict::Allow),
            "deny" => Ok(PermissionVerdict::Deny),
            "ask" => Ok(PermissionVerdict::Ask),
            _ => Err(format!("Unknown permission action: {}", s)),
        }
    }
}

/// Evaluates file permissions based on path specificity.
/// Returns Allow, Deny, or Ask. Default is Ask if no matching rule is found.
pub fn evaluate_file_permission(
    conn: &Connection,
    task_id: &str,
    target_path: &str,
    permission_type: &str,
) -> Result<PermissionVerdict, String> {
    // We look for rules in 'global' scope or the specific task's scope.
    // The query checks if target_path starts with the rule's path.
    // It orders by length of rule's path descending, so the longest (most specific) match wins.
    let mut stmt = conn
        .prepare(
            "SELECT action FROM permissions 
             WHERE scope IN ('global', ?1) 
             AND permission_type = ?2
             AND ?3 LIKE path || '%'
             ORDER BY length(path) DESC 
             LIMIT 1",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let mut rows = stmt
        .query(params![task_id, permission_type, target_path])
        .map_err(|e| format!("Database query error: {}", e))?;

    if let Some(row) = rows.next().map_err(|e| format!("Row error: {}", e))? {
        let action: String = row.get(0).map_err(|e| format!("Column error: {}", e))?;
        return action.parse::<PermissionVerdict>();
    }

    // Default if no rule matched
    Ok(PermissionVerdict::Ask)
}

pub async fn evaluate_network_action(
    state: &tauri::State<'_, AppState>,
    task_id: &str,
    url: &str,
    method: &str,
    body: Option<&str>,
) -> Result<PermissionVerdict, String> {
    use crate::gateway::{chat_completion, ChatMessage as GatewayMsg};

    let mut policies = Vec::new();
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        
        // Break infinite loops: if the user JUST approved, allow it as a one-off.
        let last_user_msg: String = conn.query_row(
            "SELECT content FROM messages WHERE task_id = ?1 AND role = 'user' ORDER BY rowid DESC LIMIT 1",
            rusqlite::params![task_id],
            |row| row.get(0)
        ).unwrap_or_default();
        if last_user_msg.starts_with("[APPROVAL DECISION] APPROVED") {
            return Ok(PermissionVerdict::Allow);
        }

        let mut stmt = conn
            .prepare("SELECT url_pattern, rules_summary FROM watcher_policies WHERE scope IN ('global', ?1) ORDER BY created_at ASC")
            .map_err(|e| e.to_string())?;
            
        let rows = stmt.query_map(rusqlite::params![task_id], |row| {
            let pattern: String = row.get(0)?;
            let rules: String = row.get(1)?;
            Ok((pattern, rules))
        }).map_err(|e| e.to_string())?;
        
        for r in rows {
            if let Ok(p) = r {
                policies.push(p);
            }
        }
    }

    if policies.is_empty() {
        return Ok(PermissionVerdict::Ask);
    }

    let settings = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        crate::settings::read_settings(&conn).map_err(|e| e.to_string())?
    };
    
    let model = settings.verifier_model.clone();
    if model.is_empty() {
        return Ok(PermissionVerdict::Ask);
    }

    let mut context = String::new();
    for (pattern, rules) in policies {
        context.push_str(&format!("URL Pattern: {}\nRules: {}\n---\n", pattern, rules));
    }

    let sys_prompt = format!(
        "You are the Watcher AI Policy Enforcer. You evaluate network actions proposed by an autonomous agent.\n\n\
        POLICIES:\n{}\n\n\
        You must evaluate the proposed action against these policies. \
        Output EXACTLY one of the following words and nothing else:\n\
        ALLOW - if the action is explicitly permitted by the policies.\n\
        DENY - if the action is explicitly blocked by the policies.\n\
        ASK - if it is ambiguous, risky, or not covered by the policies.",
        context
    );

    let action_desc = format!("Action: HTTP {}\nURL: {}\nBody: {}", method, url, body.unwrap_or("None"));

    let messages = vec![
        GatewayMsg { role: "system".into(), content: sys_prompt },
        GatewayMsg { role: "user".into(), content: action_desc },
    ];

    let (text, _, _, _) = chat_completion(&model, &messages).await.map_err(|e| e.to_string())?;
    
    match text.trim().to_uppercase().as_str() {
        "ALLOW" => Ok(PermissionVerdict::Allow),
        "DENY" => Ok(PermissionVerdict::Deny),
        _ => Ok(PermissionVerdict::Ask),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init;

    fn setup_test_db() -> Connection {
        let conn = init(std::path::Path::new(":memory:")).unwrap();
        crate::db::init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn test_file_permission_specificity() {
        let conn = setup_test_db();
        let now = crate::db::now_iso();

        // Global deny on D:/Projects
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, created_at, updated_at) 
             VALUES ('p1', 'global', 'D:/Projects', 'deny', 'write', ?1, ?1)",
            params![now],
        ).unwrap();

        // Chat-scoped allow on D:/Projects/allowed_folder
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, created_at, updated_at) 
             VALUES ('p2', 'task-1', 'D:/Projects/allowed_folder', 'allow', 'write', ?1, ?1)",
            params![now],
        ).unwrap();

        // Chat-scoped deny on specific file inside allowed_folder
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, created_at, updated_at) 
             VALUES ('p3', 'task-1', 'D:/Projects/allowed_folder/secret.txt', 'deny', 'write', ?1, ?1)",
            params![now],
        ).unwrap();

        // 1. Should be Ask outside any specified path
        assert_eq!(
            evaluate_file_permission(&conn, "task-1", "C:/Windows", "write").unwrap(),
            PermissionVerdict::Ask
        );

        // 2. Should hit the global deny
        assert_eq!(
            evaluate_file_permission(&conn, "task-1", "D:/Projects/some_file.txt", "write").unwrap(),
            PermissionVerdict::Deny
        );

        // 3. Should hit the chat allow (more specific than global deny)
        assert_eq!(
            evaluate_file_permission(&conn, "task-1", "D:/Projects/allowed_folder/other.txt", "write").unwrap(),
            PermissionVerdict::Allow
        );

        // 4. Should hit the specific file deny (most specific)
        assert_eq!(
            evaluate_file_permission(&conn, "task-1", "D:/Projects/allowed_folder/secret.txt", "write").unwrap(),
            PermissionVerdict::Deny
        );
        
        // 5. Another task shouldn't see task-1's rules
        assert_eq!(
            evaluate_file_permission(&conn, "task-2", "D:/Projects/allowed_folder/other.txt", "write").unwrap(),
            PermissionVerdict::Deny // Falls back to global deny
        );
    }
}
