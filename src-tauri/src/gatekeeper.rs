use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::db::AppState;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

static SESSION_CREATED_PATHS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

pub fn register_session_created_path(path: &str) {
    let norm = path.replace("\\", "/").trim().to_lowercase();
    if let Ok(mut set) = SESSION_CREATED_PATHS.get_or_init(|| Mutex::new(HashSet::new())).lock() {
        set.insert(norm);
    }
}

pub fn is_session_created_path(path: &str) -> bool {
    let norm = path.replace("\\", "/").trim().to_lowercase();
    if let Ok(set) = SESSION_CREATED_PATHS.get_or_init(|| Mutex::new(HashSet::new())).lock() {
        return set.contains(&norm);
    }
    false
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FilePermission {
    pub id: String,
    pub scope: String,
    pub path: String,
    pub action: String,
    pub permission_type: String,
    pub match_type: String,
    pub created_at: String,
}

#[tauri::command]
pub fn get_file_permissions(state: State<'_, AppState>, scope: String) -> Result<Vec<FilePermission>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, scope, path, action, permission_type, match_type, created_at FROM permissions WHERE scope = ?1 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    
    let permissions = stmt
        .query_map(params![scope], |row| {
            Ok(FilePermission {
                id: row.get(0)?,
                scope: row.get(1)?,
                path: row.get(2)?,
                action: row.get(3)?,
                permission_type: row.get(4)?,
                match_type: row.get(5)?,
                created_at: row.get(6)?,
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
    match_type: Option<String>,
) -> Result<FilePermission, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let id = crate::db::new_id();
    let now = crate::db::now_iso();
    let mt = match_type.unwrap_or_else(|| "prefix".to_string());
    
    conn.execute(
        "INSERT INTO permissions (id, scope, path, action, permission_type, match_type, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, scope, path, action, permission_type, mt, now, now],
    ).map_err(|e| e.to_string())?;
    
    Ok(FilePermission {
        id,
        scope,
        path,
        action,
        permission_type,
        match_type: mt,
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
    rules_summary: String,
) -> Result<WatcherPolicy, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let id = crate::db::new_id();
    let now = crate::db::now_iso();
    let url_pattern = "*".to_string();
    
    conn.execute("DELETE FROM watcher_policies WHERE scope = ?1", params![scope])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM watcher_cache WHERE scope = ?1", params![scope])
        .map_err(|e| e.to_string())?;
        
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
    // Optionally we could clear cache here, but wait, we don't have scope easily.
    // If we delete the policy, maybe clear all cache.
    conn.execute("DELETE FROM watcher_cache", params![])
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
    
    let settings = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        crate::settings::read_settings(&conn).map_err(|e| e.to_string())?
    };
    
    let model = settings.watcher_model.clone();
    if model.is_empty() {
        return Err("No watcher model configured in Settings.".to_string());
    }

    let existing = get_watcher_policies(state.clone(), scope.clone())?;
    let mut context = String::new();
    for p in existing {
        context.push_str(&format!("{}\n", p.rules_summary));
    }

    let sys_prompt = format!(
        "You are the Watcher AI Policy Editor. Your job is to maintain a SINGLE, consolidated block of rules for how the agent interacts with the network or browser.\n\n\
        Here is the current rule block:\n{}\n\n\
        The user wants to make a modification. Read their request and output the ENTIRE updated rule block. \
        Resolve any contradictions gracefully. DO NOT output conversational filler. ONLY output the raw Markdown rules. Use bullet points.",
        if context.is_empty() { "None." } else { &context }
    );

    let messages = vec![
        GatewayMsg { role: "system".into(), content: sys_prompt },
        GatewayMsg { role: "user".into(), content: prompt },
    ];

    let (text, _, _, _) = chat_completion(&model, &messages).await.map_err(|e| e.to_string())?;
    Ok(text)
}
#[derive(Debug, PartialEq, Clone, serde::Serialize, serde::Deserialize)]
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

pub fn evaluate_file_permission(
    conn: &Connection,
    task_id: &str,
    target_path: &str,
    permission_type: &str,
) -> Result<PermissionVerdict, String> {
    // Whitelist: automatically allow read/write/delete if target_path is inside the task's workspace.
    if let Ok(workspace_dir) = crate::utils::workspace_root() {
        let task_workspace = workspace_dir.join("tasks").join(task_id).join("workspace");
        if let Ok(canon_workspace) = task_workspace.canonicalize() {
            let canon_workspace_str = canon_workspace.to_string_lossy().replace("\\", "/").replace("\\\\?\\", "");
            let target_norm = target_path.replace("\\", "/").replace("\\\\?\\", "");
            if target_norm.starts_with(&canon_workspace_str) {
                return Ok(PermissionVerdict::Allow);
            }
        } else {
            // If the workspace directory does not exist yet, we can check prefix directly without canonicalizing.
            let task_workspace_str = task_workspace.to_string_lossy().replace("\\", "/").replace("\\\\?\\", "");
            let target_norm = target_path.replace("\\", "/").replace("\\\\?\\", "");
            if target_norm.starts_with(&task_workspace_str) {
                return Ok(PermissionVerdict::Allow);
            }
        }
    }

    let is_local = conn.query_row(
        "SELECT master_model FROM tasks WHERE id = ?1",
        rusqlite::params![task_id],
        |row| row.get::<_, String>(0)
    ).map(|m| crate::gateway::is_local_model(&m)).unwrap_or(false);

    let auto_allow_mode = is_local
        || std::env::var("ZEUS_AUTO_ALLOW_NEW_FILES").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false)
        || std::env::var("ZEUS_EVAL_MODE").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false);

    if auto_allow_mode {
        // Check if file was created by the agent in this session
        if is_session_created_path(target_path) {
            return Ok(PermissionVerdict::Allow);
        }

        // Check read permissions (open across normal user drives, protected for system files)
        if permission_type == "read" {
            let norm = target_path.replace("\\", "/").to_lowercase();
            let is_sensitive_os = norm.starts_with("c:/windows") || norm.starts_with("c:/program files") || norm.starts_with("c:/programdata");
            if !is_sensitive_os {
                return Ok(PermissionVerdict::Allow);
            }
        }

        // Check write permissions for brand new files (auto-allow creation & track path when in eval mode)
        if permission_type == "write" {
            let p = std::path::Path::new(target_path);
            if !p.exists() {
                register_session_created_path(target_path);
                return Ok(PermissionVerdict::Allow);
            }
        }
    }

    let mut stmt = conn
        .prepare("SELECT scope, path as rule_path, action, match_type FROM permissions WHERE scope IN ('global', ?1) AND permission_type = ?2")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map(params![task_id, permission_type], |row| {
            let scope: String = row.get(0)?;
            let rule_path: String = row.get(1)?;
            let action: String = row.get(2)?;
            let match_type: String = row.get(3)?;
            Ok((scope, rule_path, action, match_type))
        })
        .map_err(|e| format!("Database query error: {}", e))?;

    let mut best_match: Option<(PermissionVerdict, usize, bool, String, String)> = None;

    let target_path_norm = target_path.replace("\\", "/");

    for row_res in rows {
        if let Ok((scope, rule_path, action, match_type)) = row_res {
            let verdict = action.parse::<PermissionVerdict>().unwrap_or(PermissionVerdict::Ask);
            let is_task_scope = scope != "global";
            let rule_path_norm = rule_path.replace("\\", "/");
            
            if match_type == "exact" {
                if target_path_norm == rule_path_norm {
                    let specificity = rule_path_norm.len() + 1000;
                    if update_best_match_logging(&mut best_match, verdict, specificity, is_task_scope, &rule_path, &action) {
                        crate::logger::log(task_id, "gatekeeper", &format!("Matched exact file rule `{}` ({}) with specificity {}", rule_path, scope, specificity));
                    }
                }
            } else if match_type == "regex" {
                if let Ok(re) = regex::Regex::new(&rule_path) {
                    if re.is_match(&target_path_norm) || re.is_match(target_path) {
                        let specificity = rule_path.len();
                        if update_best_match_logging(&mut best_match, verdict, specificity, is_task_scope, &rule_path, &action) {
                            crate::logger::log(task_id, "gatekeeper", &format!("Matched regex file rule `{}` ({}) with specificity {}", rule_path, scope, specificity));
                        }
                    }
                }
            } else {
                if target_path_norm.starts_with(&rule_path_norm) {
                    let specificity = rule_path_norm.len();
                    if update_best_match_logging(&mut best_match, verdict, specificity, is_task_scope, &rule_path, &action) {
                        crate::logger::log(task_id, "gatekeeper", &format!("Matched prefix file rule `{}` ({}) with specificity {}", rule_path, scope, specificity));
                    }
                }
            }
        }
    }

    if let Some((verdict, _, _, _, _)) = best_match {
        return Ok(verdict);
    }

    Ok(PermissionVerdict::Ask)
}

pub fn evaluate_command_action(
    conn: &Connection,
    task_id: &str,
    command: &str,
) -> Result<PermissionVerdict, String> {
    let mut is_composite = false;
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    
    let chars: Vec<char> = command.chars().collect();
    for i in 0..chars.len() {
        let c = chars[i];
        if c == '\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
        } else if c == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
        } else if !in_single_quote && !in_double_quote {
            if c == '&' || c == '|' || c == ';' || c == '>' || c == '<' || (c == '$' && i + 1 < chars.len() && chars[i+1] == '(') {
                is_composite = true;
                break;
            }
        }
    }

    if is_composite {
        crate::logger::log(task_id, "gatekeeper", &format!("Shell injection pattern detected in command: `{}`. Disabling prefix matches.", command));
    }

    // Fetch all command rules for this task or global scope
    let mut stmt = conn
        .prepare("SELECT scope, path as rule_cmd, action, match_type FROM permissions WHERE scope IN ('global', ?1) AND permission_type = 'command'")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map(params![task_id], |row| {
            let scope: String = row.get(0)?;
            let rule_cmd: String = row.get(1)?;
            let action: String = row.get(2)?;
            let match_type: String = row.get(3)?;
            Ok((scope, rule_cmd, action, match_type))
        })
        .map_err(|e| format!("Database query error: {}", e))?;

    let cmd_tokens: Vec<&str> = command.split_whitespace().collect();

    let mut best_match: Option<(PermissionVerdict, usize, bool, String, String)> = None; // (verdict, specificity, is_task_scope, rule_cmd, action_str)

    for row_res in rows {
        if let Ok((scope, rule_cmd, action, match_type)) = row_res {
            let verdict = action.parse::<PermissionVerdict>().unwrap_or(PermissionVerdict::Ask);
            let is_task_scope = scope != "global";
            
            if match_type == "exact" {
                if command == rule_cmd {
                    let specificity = rule_cmd.len() + 1000; // Exact match has high specificity
                    if update_best_match_logging(&mut best_match, verdict, specificity, is_task_scope, &rule_cmd, &action) {
                        crate::logger::log(task_id, "gatekeeper", &format!("Matched exact rule `{}` ({}) with specificity {}", rule_cmd, scope, specificity));
                        continue;
                    }
                }
            } else if match_type == "prefix" {
                // If it's composite, prefix matches are ignored for safety
                if is_composite {
                    continue;
                }
                let rule_tokens: Vec<&str> = rule_cmd.split_whitespace().collect();
                if rule_tokens.len() <= cmd_tokens.len() {
                    let is_prefix = rule_tokens.iter().zip(cmd_tokens.iter()).all(|(r, c)| r == c);
                    if is_prefix {
                        let specificity = rule_tokens.len();
                        if update_best_match_logging(&mut best_match, verdict, specificity, is_task_scope, &rule_cmd, &action) {
                            crate::logger::log(task_id, "gatekeeper", &format!("Matched prefix rule `{}` ({}) with specificity {}", rule_cmd, scope, specificity));
                        }
                    }
                }
            } else if match_type == "regex" {
                if let Ok(re) = regex::Regex::new(&rule_cmd) {
                    if re.is_match(command) {
                        let specificity = rule_cmd.len();
                        if update_best_match_logging(&mut best_match, verdict, specificity, is_task_scope, &rule_cmd, &action) {
                            crate::logger::log(task_id, "gatekeeper", &format!("Matched regex rule `{}` ({}) with specificity {}", rule_cmd, scope, specificity));
                        }
                    }
                }
            }
        }
    }

    if let Some((verdict, spec, is_task, rule, act)) = best_match {
        crate::logger::log(task_id, "gatekeeper", &format!("Final decision for `{}`: {} via rule `{}` (specificity: {}, task_scope: {})", command, act, rule, spec, is_task));
        return Ok(verdict);
    }

    // Fallback: Safe developer command prefixes in eval/benchmark mode or local model mode
    let is_local = conn.query_row(
        "SELECT master_model FROM tasks WHERE id = ?1",
        rusqlite::params![task_id],
        |row| row.get::<_, String>(0)
    ).map(|m| crate::gateway::is_local_model(&m)).unwrap_or(false);

    let auto_allow_commands = is_local
        || std::env::var("ZEUS_AUTO_ALLOW_COMMANDS").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false)
        || std::env::var("ZEUS_EVAL_MODE").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false);

    if auto_allow_commands {
        let safe_prefixes = [
            "cargo check", "cargo test", "cargo build", "cargo run", "cargo clippy", "cargo fmt", "cargo --version", "cargo --help", "cargo",
            "npm run", "npm test", "npm build", "npm exec", "npx playwright test", "npx playwright", "npx", "npm --version", "npx --version", "npm",
            "git status", "git diff", "git checkout", "git stash", "git commit", "git add", "git branch", "git log", "git reset", "git revert", "git --version", "git",
            "python", "python3", "node", "pytest", "where", "dir", "echo", "type", "cat", "cd", "pushd", "popd", "cmd", "cmd /c"
        ];
        
        let normalized = command.trim_start_matches("cmd /c").trim_start_matches("cmd.exe /c").trim();
        let stripped_quotes = normalized.trim_matches('"').trim_matches('\'').trim();
        let target_command = if !stripped_quotes.is_empty() { stripped_quotes } else { command };

        let parts: Vec<&str> = target_command.split("&&").flat_map(|s| s.split(';')).collect();
        let mut all_parts_safe = !parts.is_empty();
        
        for part in &parts {
            let mut clean_part = part.split('>').next().unwrap_or(part).trim();
            if clean_part.starts_with("cd /d") {
                clean_part = "cd";
            }
            if clean_part.is_empty() {
                continue;
            }
            let is_safe = safe_prefixes.iter().any(|prefix| {
                clean_part.starts_with(prefix)
            });
            if !is_safe {
                all_parts_safe = false;
                break;
            }
        }
        
        if all_parts_safe {
            crate::logger::log(task_id, "gatekeeper", &format!("Auto-allowing safe developer command `{}`", command));
            return Ok(PermissionVerdict::Allow);
        }
    }

    crate::logger::log(task_id, "gatekeeper", &format!("No rules matched for `{}`. Defaulting to Ask.", command));
    Ok(PermissionVerdict::Ask)
}

fn update_best_match_logging(
    best_match: &mut Option<(PermissionVerdict, usize, bool, String, String)>,
    verdict: PermissionVerdict,
    specificity: usize,
    is_task_scope: bool,
    rule_cmd: &str,
    action_str: &str,
) -> bool {
    match best_match {
        Some((_, curr_spec, curr_task_scope, _, _)) => {
            if specificity > *curr_spec {
                *best_match = Some((verdict, specificity, is_task_scope, rule_cmd.to_string(), action_str.to_string()));
                true
            } else if specificity == *curr_spec && is_task_scope && !*curr_task_scope {
                *best_match = Some((verdict, specificity, is_task_scope, rule_cmd.to_string(), action_str.to_string()));
                true
            } else {
                false
            }
        }
        None => {
            *best_match = Some((verdict, specificity, is_task_scope, rule_cmd.to_string(), action_str.to_string()));
            true
        }
    }
}

pub async fn evaluate_network_action(
    state: &tauri::State<'_, AppState>,
    task_id: &str,
    url: &str,
    method: &str,
    body: Option<&str>,
) -> Result<PermissionVerdict, String> {
    use crate::gateway::{chat_completion, ChatMessage as GatewayMsg};

    let domain = match reqwest::Url::parse(url) {
        Ok(parsed) => parsed.host_str().unwrap_or("unknown_domain").to_string(),
        Err(_) => "unknown_domain".to_string(),
    };

    let mut policies = Vec::new();
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        
        // SEMANTIC CACHING ENGINE
        // Check if we have a cached verdict for this exact full url + method
        if let Ok(cached_verdict_str) = conn.query_row(
            "SELECT verdict FROM watcher_cache WHERE (url = ?1 OR (url = '' AND domain = ?2)) AND method = ?3 ORDER BY created_at DESC LIMIT 1",
            rusqlite::params![url, domain, method],
            |row| row.get::<_, String>(0)
        ) {
            crate::logger::log(
                task_id,
                "gatekeeper",
                &format!("Cache hit for {} {}: {}", method, url, cached_verdict_str),
            );
            return match cached_verdict_str.as_str() {
                "ALLOW" => Ok(PermissionVerdict::Allow),
                "DENY" => Ok(PermissionVerdict::Deny),
                _ => Ok(PermissionVerdict::Ask),
            };
        }

        let mut stmt = conn
            .prepare("SELECT scope, rules_summary FROM watcher_policies WHERE scope IN ('global', ?1) ORDER BY created_at ASC")
            .map_err(|e| e.to_string())?;
            
        let rows = stmt.query_map(rusqlite::params![task_id], |row| {
            let scope: String = row.get(0)?;
            let rules: String = row.get(1)?;
            Ok((scope, rules))
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
    
    let model = settings.watcher_model.clone();
    if model.is_empty() {
        return Ok(PermissionVerdict::Ask);
    }

    let mut context = String::new();
    for (scope, rules) in policies {
        context.push_str(&format!("[{}] Rules:\n{}\n---\n", scope.to_uppercase(), rules));
    }

    let sys_prompt = format!(
        "You are the Watcher AI Policy Enforcer. You evaluate network actions proposed by an autonomous agent.\n\n\
        POLICIES:\n{}\n\n\
        You must evaluate the proposed action against these policies. \
        CRITICAL RULES FOR EVALUATION:\n\
        1. If there is a contradiction between GLOBAL and TASK rules, TASK rules take strict precedence.\n\
        2. Apply semantic reasoning to domains. For example, `mail.google.com` is semantically equivalent to `google.com` for evaluating rules.\n\n\
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
    
    let verdict_str = text.trim().to_uppercase();
    
    // SAVE TO CACHE
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let id = crate::db::new_id();
        let now = crate::db::now_iso();
        let scope = task_id.to_string();
        let _ = conn.execute(
            "INSERT INTO watcher_cache (id, scope, domain, url, method, verdict, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![id, scope, domain, url, method, verdict_str, now]
        );
    }

    crate::logger::log(
        task_id,
        "gatekeeper",
        &format!("Network action {} {} evaluated to: {} (cached)", method, url, verdict_str),
    );

    match verdict_str.as_str() {
        "ALLOW" => Ok(PermissionVerdict::Allow),
        "DENY" => Ok(PermissionVerdict::Deny),
        _ => Ok(PermissionVerdict::Ask),
    }
}

pub async fn evaluate_browser_action(
    state: &tauri::State<'_, AppState>,
    task_id: &str,
    action: &str,
    url: Option<&str>,
) -> Result<PermissionVerdict, String> {
    use crate::gateway::{chat_completion, ChatMessage as GatewayMsg};

    let mut policies = Vec::new();
    let browser_mode: String;
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        
        browser_mode = conn.query_row(
            "SELECT browser_mode FROM tasks WHERE id = ?1",
            rusqlite::params![task_id],
            |row| row.get(0)
        ).unwrap_or_else(|_| "sandbox".to_string());

        let mut stmt = conn
            .prepare("SELECT scope, rules_summary FROM watcher_policies WHERE scope IN ('global', ?1) ORDER BY created_at ASC")
            .map_err(|e| e.to_string())?;
            
        let rows = stmt.query_map(rusqlite::params![task_id], |row| {
            let scope: String = row.get(0)?;
            let rules: String = row.get(1)?;
            Ok((scope, rules))
        }).map_err(|e| e.to_string())?;
        
        for r in rows {
            if let Ok(p) = r {
                policies.push(p);
            }
        }
    }

    if browser_mode == "main" {
        policies.push(("system".to_string(), "CRITICAL ENFORCEMENT: The agent is controlling the user's MAIN BROWSER. The agent is strictly DENIED from navigating to ANY browser settings (e.g. chrome://, edge://, about:), clearing history or cookies, or closing ANY browser tabs/windows.".to_string()));
    }

    if policies.is_empty() {
        return Ok(PermissionVerdict::Allow);
    }

    let settings = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        crate::settings::read_settings(&conn).map_err(|e| e.to_string())?
    };
    
    let model = settings.watcher_model.clone();
    if model.is_empty() {
        return Ok(PermissionVerdict::Ask);
    }

    let mut context = String::new();
    for (scope, rules) in policies {
        context.push_str(&format!("[{}] Rules:\n{}\n---\n", scope.to_uppercase(), rules));
    }

    let sys_prompt = format!(
        "You are the Watcher AI Policy Enforcer. You evaluate browser actions proposed by an autonomous agent.\n\n\
        POLICIES:\n{}\n\n\
        You must evaluate the proposed action against these policies. \
        CRITICAL RULES FOR EVALUATION:\n\
        1. If there is a contradiction between GLOBAL and TASK rules, TASK rules take strict precedence. SYSTEM rules take absolute precedence.\n\
        2. Evaluate the intent of the browser action.\n\n\
        Output EXACTLY one of the following words and nothing else:\n\
        ALLOW - if the action is explicitly permitted by the policies, or if it doesn't violate any restrictions.\n\
        DENY - if the action is explicitly blocked by the policies.\n\
        ASK - if it is ambiguous or risky.",
        context
    );

    let action_desc = if let Some(u) = url {
        format!("Browser Action: {}\nURL: {}", action, u)
    } else {
        format!("Browser Action: {}", action)
    };

    let messages = vec![
        GatewayMsg { role: "system".into(), content: sys_prompt },
        GatewayMsg { role: "user".into(), content: action_desc.clone() },
    ];

    let (text, _, _, _) = chat_completion(&model, &messages).await.map_err(|e| e.to_string())?;
    
    let verdict_str = text.trim().to_uppercase();
    
    crate::logger::log(
        task_id,
        "gatekeeper",
        &format!("Browser action '{}' evaluated to: {}", action_desc.replace("\n", " "), verdict_str),
    );

    match verdict_str.as_str() {
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
        
        // Add Regex rules
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, match_type, created_at, updated_at) 
             VALUES ('p4', 'global', '^D:/Projects/.*\\.bak$', 'deny', 'write', ?1, ?1)",
            params![now],
        ).unwrap();
        
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, match_type, created_at, updated_at) 
             VALUES ('p5', 'global', '^D:/Projects/allowed_folder/.*\\.log$', 'allow', 'write', ?1, ?1)",
            params![now],
        ).unwrap();

        assert_eq!(
            evaluate_file_permission(&conn, "task-1", "D:/Projects/my_data.bak", "write").unwrap(),
            PermissionVerdict::Deny
        );
        
        assert_eq!(
            evaluate_file_permission(&conn, "task-1", "D:/Projects/allowed_folder/app.log", "write").unwrap(),
            PermissionVerdict::Allow
        );
        
        // 5. Another task shouldn't see task-1's rules
        assert_eq!(
            evaluate_file_permission(&conn, "task-2", "D:/Projects/allowed_folder/other.txt", "write").unwrap(),
            PermissionVerdict::Deny // Falls back to global deny
        );
    }

    #[test]
    fn test_command_permission_specificity() {
        let conn = setup_test_db();
        let now = crate::db::now_iso();

        // Let's test the matching engine on complex command scenarios (50+ checks).
        // 1. Exact match rules
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, match_type, created_at, updated_at) 
             VALUES ('c1', 'global', 'git status', 'allow', 'command', 'exact', ?1, ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, match_type, created_at, updated_at) 
             VALUES ('c2', 'global', 'git commit', 'deny', 'command', 'exact', ?1, ?1)",
            params![now],
        ).unwrap();
        
        // 2. Prefix match rules
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, match_type, created_at, updated_at) 
             VALUES ('c3', 'global', 'npm run', 'allow', 'command', 'prefix', ?1, ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, match_type, created_at, updated_at) 
             VALUES ('c4', 'global', 'docker', 'allow', 'command', 'prefix', ?1, ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, match_type, created_at, updated_at) 
             VALUES ('c5', 'global', 'docker rm', 'deny', 'command', 'prefix', ?1, ?1)",
            params![now],
        ).unwrap();
        
        // 3. Task specific overrides
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, match_type, created_at, updated_at) 
             VALUES ('c6', 'task-1', 'npm run build', 'deny', 'command', 'prefix', ?1, ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, match_type, created_at, updated_at) 
             VALUES ('c7', 'task-1', 'git commit', 'allow', 'command', 'exact', ?1, ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, match_type, created_at, updated_at) 
             VALUES ('c8', 'global', '^cargo (check|build|test)$', 'allow', 'command', 'regex', ?1, ?1)",
            params![now],
        ).unwrap();
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, match_type, created_at, updated_at) 
             VALUES ('c9', 'global', '^rm -rf .*$', 'deny', 'command', 'regex', ?1, ?1)",
            params![now],
        ).unwrap();

        let check = |task_id: &str, cmd: &str| -> PermissionVerdict {
            // Note: Since evaluate_command_action requires &Connection, we just pass the test db.
            // But evaluate_command_action logs to the DB. In a test, this might insert messages.
            // Since we pass &conn, wait... evaluate_command_action doesn't log to the DB, it uses crate::logger::log which prints to stdout for backend logging!
            evaluate_command_action(&conn, task_id, cmd).unwrap()
        };

        // --- Execute 50+ assertions ---
        
        // Exact Rules
        assert_eq!(check("task-2", "git status"), PermissionVerdict::Allow);
        assert_eq!(check("task-2", "git status -s"), PermissionVerdict::Ask); // exact match required
        assert_eq!(check("task-2", "git commit"), PermissionVerdict::Deny);
        assert_eq!(check("task-2", "git commit -m msg"), PermissionVerdict::Ask); // exact match required

        // Prefix Rules
        assert_eq!(check("task-2", "npm run dev"), PermissionVerdict::Allow);
        assert_eq!(check("task-2", "npm run start --port 8080"), PermissionVerdict::Allow);
        assert_eq!(check("task-2", "npm install"), PermissionVerdict::Ask); // unconfigured
        assert_eq!(check("task-2", "docker ps"), PermissionVerdict::Allow);
        assert_eq!(check("task-2", "docker build -t x ."), PermissionVerdict::Allow);
        
        // Specificity / Override Rules (docker rm overrides docker)
        assert_eq!(check("task-2", "docker rm container_name"), PermissionVerdict::Deny);
        assert_eq!(check("task-2", "docker rmi image_name"), PermissionVerdict::Allow); // rmi is not rm
        assert_eq!(check("task-2", "docker rm -f container"), PermissionVerdict::Deny);
        
        // Task Scope Overrides Global
        assert_eq!(check("task-1", "npm run build"), PermissionVerdict::Deny); // Task denied
        assert_eq!(check("task-2", "npm run build"), PermissionVerdict::Allow); // Global allows npm run
        
        assert_eq!(check("task-1", "git commit"), PermissionVerdict::Allow); // Task explicitly allows exact
        assert_eq!(check("task-2", "git commit"), PermissionVerdict::Deny); // Global exact denies

        // Shell Injection protection (Disables all prefix matches!)
        assert_eq!(check("task-2", "docker run alpine & echo pwned"), PermissionVerdict::Ask); // Prefix 'docker' ignored due to '&'
        assert_eq!(check("task-2", "npm run dev | grep error"), PermissionVerdict::Ask); // Prefix ignored
        assert_eq!(check("task-2", "docker build > out.log"), PermissionVerdict::Ask); // Prefix ignored
        assert_eq!(check("task-2", "docker build < in.txt"), PermissionVerdict::Ask); // Prefix ignored
        assert_eq!(check("task-2", "npm run dev ; rm -rf /"), PermissionVerdict::Ask); // Prefix ignored
        assert_eq!(check("task-2", "docker $(cat /etc/shadow)"), PermissionVerdict::Ask); // Prefix ignored

        // Exact match STILL works for shell injection IF explicitly approved!
        conn.execute(
            "INSERT INTO permissions (id, scope, path, action, permission_type, match_type, created_at, updated_at) 
             VALUES ('c8', 'global', 'npm run dev | grep error', 'allow', 'command', 'exact', ?1, ?1)",
            params![now],
        ).unwrap();
        assert_eq!(check("task-2", "npm run dev | grep error"), PermissionVerdict::Allow);

        // Random unchecked commands -> Ask
        assert_eq!(check("task-2", "ls -la"), PermissionVerdict::Ask);
        assert_eq!(check("task-2", "cargo run"), PermissionVerdict::Ask);
        assert_eq!(check("task-2", "git fetch"), PermissionVerdict::Ask);
        assert_eq!(check("task-2", "cat file.txt"), PermissionVerdict::Ask);
        
        // Edge cases with spaces
        assert_eq!(check("task-2", "  npm   run dev "), PermissionVerdict::Allow);
        assert_eq!(check("task-2", "npm"), PermissionVerdict::Ask); // Prefix requires full words 'npm run'
        assert_eq!(check("task-2", "npm r"), PermissionVerdict::Ask);

        // Regex tests
        assert_eq!(check("task-2", "cargo check"), PermissionVerdict::Allow);
        assert_eq!(check("task-2", "cargo build"), PermissionVerdict::Allow);
        assert_eq!(check("task-2", "cargo test"), PermissionVerdict::Allow);
        assert_eq!(check("task-2", "cargo clippy"), PermissionVerdict::Ask);
        assert_eq!(check("task-2", "rm -rf /"), PermissionVerdict::Deny);
        assert_eq!(check("task-2", "rm -rf ./node_modules"), PermissionVerdict::Deny);
        assert_eq!(check("task-2", "rm file.txt"), PermissionVerdict::Ask);
        
        // Adding more assertions to reach ~50 checks for thoroughness
        let more_commands = vec![
            ("docker-compose up", PermissionVerdict::Ask),
            ("docker exec -it bash", PermissionVerdict::Allow),
            ("npm run test", PermissionVerdict::Allow),
            ("npm start", PermissionVerdict::Ask),
            ("git status --short", PermissionVerdict::Ask),
            ("docker pull ubuntu", PermissionVerdict::Allow),
            ("docker rm1", PermissionVerdict::Allow), // Not 'rm' exactly as word
            ("docker rm", PermissionVerdict::Deny),
        ];

        for (cmd, expected) in more_commands {
            assert_eq!(check("task-2", cmd), expected);
        }
    }
}
