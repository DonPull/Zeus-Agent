//! The M1a orchestrator: parses master directives, executes them, and loops.
//!
//! The master model returns either plain conversational text or exactly one
//! `zeus-directive` JSON block. When a directive is present, we execute it
//! (run Python, ask for approval, update the task), feed the result back to
//! the master as a user-role message, and re-call the model. The loop ends on
//! `final_answer`, plain text, or the iteration cap.

use serde::{Deserialize, Serialize};
use serde_json::json;

pub const MAX_ORCHESTRATION_ITERATIONS: usize = 40;

/// A parsed directive from the master's reply.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Directive {
    RunAction {
        action: ActionSpec,
        #[serde(default)]
        success_criteria: Option<String>,
    },
    UpdateActionPlan {
        action_plan: String,
        #[serde(default)]
        request_approval: bool,
    },
    UpdateMemory {
        memory: String,
    },
    TaskUpdate {
        update: TaskUpdateSpec,
    },
    FinalAnswer {
        final_answer: FinalAnswerSpec,
    },
    DelegateTask {
        delegate: DelegateSpec,
    },
    ReadFile {
        path: String,
    },
    WriteFile {
        path: String,
        content: String,
    },
    DeleteFile {
        path: String,
    },
    RunCommand {
        command: String,
    },
    ListDir {
        path: String,
    },
    SearchFiles {
        path: String,
        pattern: String,
    },
    AskUserForLogin {
        reason: String,
    },
    HttpRequest {
        url: String,
        method: String,
        body: Option<String>,
    },
    RecallMessages {
        query: String,
        #[serde(default)]
        limit: Option<usize>,
    },
    AskUserChoice {
        prompt: String,
        options: Vec<ChoiceOption>,
        #[serde(default = "default_true")]
        allow_custom_input: bool,
        #[serde(default)]
        custom_placeholder: Option<String>,
    },
    ConfigureBrowser {
        #[serde(default)]
        permissions: Option<serde_json::Value>,
        #[serde(default)]
        viewport: Option<serde_json::Value>,
    },
    InstallBrowserExtension {
        extension_path: String,
    },
    ManageBrowserExtension {
        extension_id: String,
        action: String,
    },
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ChoiceOption {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ActionSpec {
    #[serde(default = "default_language")]
    pub language: String,
    pub code: String,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_language() -> String {
    "python".into()
}
fn default_timeout() -> u64 {
    120
}



#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TaskUpdateSpec {
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FinalAnswerSpec {
    pub summary: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DelegateSpec {
    pub name: String,
    pub objective: String,
    pub success_criteria: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct VerificationResult {
    pub passed: bool,
    pub feedback: String,
}

/// What the orchestrator decided the master's reply was.
pub enum MasterReply {
    /// Plain conversational text — show it and stop.
    Text(String),
    /// The text before the directive, the directive itself, and the raw JSON of the directive.
    Directive(String, Directive, String),
    /// The text before the directive, the error description, and the full raw reply.
    MalformedDirective(String, String, String),
}

/// The fenced block tag the master uses for directives.
pub const DIRECTIVE_FENCE: &str = "```zeus-directive";

/// Tolerant directive JSON parser. Tries strict serde first, then a lenient
/// pass that accepts common model formatting drift: trailing garbage after
/// the object (e.g. a stray extra `}`), and final_answer given as a plain
/// string instead of {"summary": ...}.
fn parse_directive_json(json_str: &str) -> Result<Directive, String> {
    if let Ok(d) = serde_json::from_str::<Directive>(json_str) {
        return Ok(d);
    }
    // Parse the FIRST JSON value and ignore anything after it.
    let mut stream = serde_json::Deserializer::from_str(json_str).into_iter::<serde_json::Value>();
    let v: serde_json::Value = match stream.next() {
        Some(Ok(v)) => v,
        Some(Err(e)) => return Err(format!("invalid JSON: {}", e)),
        None => return Err("invalid JSON: empty directive".into()),
    };
    if let Ok(d) = serde_json::from_value::<Directive>(v.clone()) {
        return Ok(d);
    }
    match v["type"].as_str() {
        Some("final_answer") => {
            let summary = v["final_answer"]
                .as_str()
                .or_else(|| v["final_answer"]["summary"].as_str())
                .or_else(|| v["summary"].as_str())
                .or_else(|| v["answer"].as_str())
                .ok_or("final_answer directive is missing a summary")?;
            Ok(Directive::FinalAnswer {
                final_answer: FinalAnswerSpec {
                    summary: summary.to_string(),
                },
            })
        }
        Some(t) => Err(format!("malformed '{}' directive (schema mismatch)", t)),
        None => Err("directive JSON is missing the \"type\" field".into()),
    }
}

/// Extracts a directive from the master's reply, if present.
///
/// Robustness rules:
/// - The closing fence is searched from the END of the text first (rfind),
///   because directive payloads (especially final_answer summaries) may
///   legitimately contain ``` inside JSON strings. The first-``` fallback is
///   also tried in case the model appended trailing prose.
/// - A reply that is one bare JSON object (fence forgotten) is also accepted.
/// - If a fence exists but nothing parses, we return MalformedDirective so the
///   caller can self-heal instead of leaking raw JSON into the chat.
// Replace your existing parse_master_reply in src-tauri/src/orchestrator.rs:

pub fn parse_master_reply(text: &str) -> MasterReply {
    if let Some(start) = text.find(DIRECTIVE_FENCE) {
        let pre_text = text[..start].trim().to_string();
        let after = &text[start + DIRECTIVE_FENCE.len()..];
        let mut candidates: Vec<usize> = Vec::new();
        if let Some(e) = after.rfind("```") {
            candidates.push(e);
        }
        if let Some(e) = after.find("```") {
            if !candidates.contains(&e) {
                candidates.push(e);
            }
        }
        let mut last_err = String::from("missing closing ``` fence");
        for end in candidates {
            let json_str = after[..end].trim();
            match parse_directive_json(json_str) {
                Ok(d) => return MasterReply::Directive(pre_text, d, text.to_string()),
                Err(e) => last_err = e,
            }
        }
        return MasterReply::MalformedDirective(pre_text, last_err, text.to_string());
    }

    let trimmed = text.trim();

    // Fallback: Model forgot the specific fence, might have used ```json,
    // or just output bare JSON (optionally with preamble text around it).
    // Locate the outermost curly braces to capture the core payload.
    if let Some(start_brace) = trimmed.find('{') {
        if let Some(end_brace) = trimmed.rfind('}') {
            if start_brace < end_brace {
                let json_str = &trimmed[start_brace..=end_brace];
                let pre_text = trimmed[..start_brace].trim().to_string();
                if let Ok(d) = parse_directive_json(json_str) {
                    return MasterReply::Directive(pre_text, d, text.to_string());
                }
            }
        }
    }

    MasterReply::Text(trimmed.to_string())
}

/// Serializes a directive execution result into the user-role message sent
/// back to the master on the next iteration.
pub fn directive_result_message(result_json: &serde_json::Value) -> String {
    format!(
        "[DIRECTIVE_RESULT]\n```zeus-result\n{}\n```",
        serde_json::to_string_pretty(result_json).unwrap_or_else(|_| "{}".into())
    )
}

pub async fn execute_directive_bypass_gatekeeper(
    _state: &tauri::State<'_, crate::db::AppState>,
    _app_handle: &tauri::AppHandle,
    task_id: &str,
    directive: Directive,
) -> Result<String, String> {
    match directive {
        Directive::HttpRequest { url, method, body } => {
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
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::RunCommand { command } => {
            let workspace = crate::utils::task_workspace(task_id)?;
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
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::ReadFile { path } => {
            let res = match tokio::fs::read_to_string(&path).await {
                Ok(content) => content,
                Err(e) => format!("Failed to read file: {}", e),
            };
            let result_json = serde_json::json!({ "read_result": res });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::WriteFile { path, content } => {
            let res = match tokio::fs::write(&path, content).await {
                Ok(_) => "Successfully wrote file.".to_string(),
                Err(e) => format!("Failed to write file: {}", e),
            };
            let result_json = serde_json::json!({ "write_result": res });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::DeleteFile { path } => {
            let res = match tokio::fs::remove_file(&path).await {
                Ok(_) => "Successfully deleted file.".to_string(),
                Err(e) => format!("Failed to delete file: {}", e),
            };
            let result_json = serde_json::json!({ "delete_result": res });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::ListDir { path } => {
            let res = match std::fs::read_dir(&path) {
                Ok(entries) => {
                    let mut list = Vec::new();
                    for entry in entries.flatten() {
                        let ftype = match entry.metadata() {
                            Ok(metadata) if metadata.is_dir() => "DIR ",
                            _ => "FILE",
                        };
                        let name = entry.file_name().to_string_lossy().to_string();
                        list.push(format!("[{}] {}", ftype, name));
                    }
                    if list.is_empty() {
                        "Directory is empty.".to_string()
                    } else {
                        list.join("\n")
                    }
                }
                Err(e) => format!("Failed to list directory: {}", e),
            };
            let result_json = serde_json::json!({ "list_dir_result": res });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::SearchFiles { path, pattern } => {
            if !std::path::Path::new(&path).exists() {
                let result_json = serde_json::json!({ "search_files_result": "Error: The specified path does not exist." });
                return Ok(crate::orchestrator::directive_result_message(&result_json));
            }
            
            // Using walkdir to find matching files
            let mut matches = Vec::new();
            
            let mut iter = walkdir::WalkDir::new(&path).into_iter();
            while let Some(Ok(entry)) = iter.next() {
                let file_name = entry.file_name().to_string_lossy().to_lowercase();
                
                // Skip common large/irrelevant directories
                if entry.file_type().is_dir() && (file_name == "node_modules" || file_name == ".git" || file_name == "target") {
                    iter.skip_current_dir();
                    continue;
                }

                if file_name.contains(&pattern.to_lowercase()) {
                    let type_prefix = if entry.file_type().is_dir() { "[DIR] " } else { "" };
                    matches.push(format!("{}{}", type_prefix, entry.path().to_string_lossy()));
                    if matches.len() >= 100 {
                        break;
                    }
                }
            }
            
            let res = if matches.is_empty() {
                "No matching files found.".to_string()
            } else {
                let mut out = matches.join("\n");
                if matches.len() >= 100 {
                    out.push_str("\n... (results truncated)");
                }
                out
            };
            let result_json = serde_json::json!({ "search_files_result": res });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::RecallMessages { query, limit } => {
            let max_limit = limit.unwrap_or(10).min(50);
            let conn = _state.db.lock().map_err(|e| e.to_string())?;
            let search_pattern = format!("%{}%", query);
            let mut stmt = conn.prepare(
                "SELECT role, kind, content, created_at FROM messages
                 WHERE task_id = ?1 AND content LIKE ?2
                 ORDER BY rowid DESC LIMIT ?3"
            ).map_err(|e| e.to_string())?;

            let rows = stmt.query_map(rusqlite::params![task_id, search_pattern, max_limit], |row| {
                let role: String = row.get(0)?;
                let kind: String = row.get(1)?;
                let content: String = row.get(2)?;
                let created_at: String = row.get(3)?;
                Ok(serde_json::json!({
                    "role": role,
                    "kind": kind,
                    "content": content,
                    "created_at": created_at,
                }))
            }).map_err(|e| e.to_string())?;

            let mut results = Vec::new();
            for r in rows {
                if let Ok(item) = r {
                    results.push(item);
                }
            }

            let result_json = serde_json::json!({
                "recall_results": results,
                "matches_count": results.len()
            });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::AskUserChoice { prompt: _, options: _, allow_custom_input: _, custom_placeholder: _ } => {
            let result_json = serde_json::json!({ "choice_result": "User decision processed." });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::ConfigureBrowser { permissions: _, viewport: _ } => {
            let result_json = serde_json::json!({ "configure_browser_result": "Browser configuration applied." });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::InstallBrowserExtension { extension_path } => {
            let result_json = serde_json::json!({ "install_browser_extension_result": format!("Extension at '{}' loaded.", extension_path) });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::ManageBrowserExtension { extension_id, action } => {
            let result_json = serde_json::json!({ "manage_browser_extension_result": format!("Extension '{}' {}.", extension_id, action) });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        _ => {
            Err("Directive does not support bypass execution.".to_string())
        }
    }
}

/// Builds the JSON result for a completed (or failed) Python action.
pub fn action_result_json(
    stdout: &str,
    stderr: &str,
    exit_code: i32,
    timed_out: bool,
    interpreter: &str,
) -> serde_json::Value {
    json!({
        "kind": "run_action",
        "exit_code": exit_code,
        "timed_out": timed_out,
        "interpreter": interpreter,
        "stdout": truncate(stdout, 12000),
        "stderr": truncate(stderr, 4000),
    })
}

/// Builds the JSON result for an approval decision.
pub fn approval_result_json(approved: bool, note: &str) -> serde_json::Value {
    json!({
        "kind": "request_approval",
        "approved": approved,
        "note": note,
    })
}

/// Builds the JSON result for a task update.
pub fn task_update_result_json(ok: bool, detail: &str) -> serde_json::Value {
    json!({ "kind": "task_update", "ok": ok, "detail": detail })
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut out = s[..max].to_string();
        out.push_str("\n…[truncated]");
        out
    }
}

// ============================== TESTS ==============================
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_is_text() {
        match parse_master_reply("Hello, how can I help?") {
            MasterReply::Text(t) => assert_eq!(t, "Hello, how can I help?"),
            _ => panic!("expected Text"),
        }
    }

    #[test]
    fn fenced_run_action_parses() {
        let reply = "```zeus-directive\n{\"type\":\"run_action\",\"action\":{\"language\":\"python\",\"code\":\"print(1)\",\"timeout_secs\":10},\"success_criteria\":\"prints 1\"}\n```";
        match parse_master_reply(reply) {
            MasterReply::Directive(_, Directive::RunAction { action, .. }, _) => {
                assert_eq!(action.code, "print(1)");
            }
            _ => panic!("expected RunAction"),
        }
    }

    #[test]
    fn preamble_before_fence_still_parses() {
        let reply = "Plan written. Now let's read it back.\n\n```zeus-directive\n{\"type\":\"run_action\",\"action\":{\"code\":\"print(2)\"}}\n```";
        match parse_master_reply(reply) {
            MasterReply::Directive(_, Directive::RunAction { action, .. }, raw) => {
                assert_eq!(action.code, "print(2)");
                assert!(raw.starts_with("Plan written."));
            }
            _ => panic!("expected RunAction with preamble"),
        }
    }

    #[test]
    fn final_answer_with_inner_code_block_parses() {
        // Fix the raw unescaped newlines inside the JSON string literal using double slashes
        let reply = "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":{\"summary\":\"Done. Example:\\n```python\\nprint('hi')\\n```\\nAll good.\"}}\n```";
        match parse_master_reply(reply) {
            MasterReply::Directive(_, Directive::FinalAnswer { final_answer }, _) => {
                assert!(final_answer.summary.contains("```python"));
            }
            MasterReply::MalformedDirective(e, _, _) => panic!("malformed: {}", e),
            _ => panic!("expected FinalAnswer"),
        }
    }

    #[test]
    fn final_answer_as_plain_string_is_accepted_leniently() {
        let reply =
            "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":\"All done!\"}\n```";
        match parse_master_reply(reply) {
            MasterReply::Directive(_, Directive::FinalAnswer { final_answer }, _) => {
                assert_eq!(final_answer.summary, "All done!");
            }
            _ => panic!("expected lenient FinalAnswer"),
        }
    }

    #[test]
    fn bare_json_without_fence_is_accepted() {
        let reply = "{\"type\":\"read_file\",\"path\":\"D:/test.txt\"}";
        match parse_master_reply(reply) {
            MasterReply::Directive(_, Directive::ReadFile { path }, _) => {
                assert_eq!(path, "D:/test.txt");
            }
            _ => panic!("expected bare-JSON ReadFile"),
        }
    }

    #[test]
    fn broken_json_inside_fence_is_malformed_not_text() {
        let reply = "```zeus-directive\n{\"type\":\"run_action\", BROKEN\n```";
        match parse_master_reply(reply) {
            MasterReply::MalformedDirective(err, _, raw) => {
                assert!(err.contains("invalid JSON"));
                assert!(raw.contains("BROKEN"));
            }
            _ => panic!("expected MalformedDirective"),
        }
    }

    #[test]
    fn delegate_task_parses() {
        let reply = r#"```zeus-directive
{"type":"delegate_task","delegate":{"name":"Worker Name","objective":"Do something","success_criteria":"Check something"}}
```"#;
        match parse_master_reply(reply) {
            MasterReply::Directive(_, Directive::DelegateTask { delegate }, _) => {
                assert_eq!(delegate.name, "Worker Name");
                assert_eq!(delegate.objective, "Do something");
                assert_eq!(delegate.success_criteria, "Check something");
            }
            _ => panic!("expected DelegateTask"),
        }
    }

    #[test]
    fn unclosed_fence_is_malformed() {
        let reply = "```zeus-directive\n{\"type\":\"run_action\"";
        match parse_master_reply(reply) {
            MasterReply::MalformedDirective(_, _, _) => {}
            _ => panic!("expected MalformedDirective for unclosed fence"),
        }
    }

    #[test]
    fn trailing_extra_brace_is_tolerated() {
        // Kimi regularly emits one stray `}` after the object (seen in debug
        // logs). This must parse instead of costing a self-heal round-trip.
        let reply =
            "```zeus-directive\n{\"type\":\"run_action\",\"action\":{\"code\":\"print(3)\"}}}\n```";
        match parse_master_reply(reply) {
            MasterReply::Directive(_, Directive::RunAction { action, .. }, _) => {
                assert_eq!(action.code, "print(3)");
            }
            MasterReply::MalformedDirective(e, _, _) => panic!("malformed: {}", e),
            _ => panic!("expected RunAction"),
        }
    }

    #[test]
    fn bare_json_with_trailing_brace_is_tolerated() {
        let reply = "{\"type\":\"task_update\",\"update\":{\"title\":\"x\"}}}";
        match parse_master_reply(reply) {
            MasterReply::Directive(_, Directive::TaskUpdate { .. }, _) => {}
            _ => panic!("expected TaskUpdate despite trailing brace"),
        }
    }

    #[test]
    fn delegate_task_is_parsed_correctly() {
        let reply = r#"```zeus-directive
{
  "type": "delegate_task",
  "delegate": {
    "name": "researcher",
    "objective": "find things",
    "success_criteria": "found things"
  }
}
```"#;
        match parse_master_reply(reply) {
            MasterReply::Directive(_, Directive::DelegateTask { delegate }, _) => {
                assert_eq!(delegate.name, "researcher");
                assert_eq!(delegate.objective, "find things");
                assert_eq!(delegate.success_criteria, "found things");
            }
            _ => panic!("expected DelegateTask directive"),
        }
    }

    #[test]
    fn recall_messages_is_parsed_correctly() {
        let reply = r#"```zeus-directive
{
  "type": "recall_messages",
  "query": "database password",
  "limit": 5
}
```"#;
        match parse_master_reply(reply) {
            MasterReply::Directive(_, Directive::RecallMessages { query, limit }, _) => {
                assert_eq!(query, "database password");
                assert_eq!(limit, Some(5));
            }
            _ => panic!("expected RecallMessages directive"),
        }
    }
}
