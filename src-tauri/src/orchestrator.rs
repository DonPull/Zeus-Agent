//! The M1a orchestrator: parses master directives, executes them, and loops.
//!
//! The master model returns either plain conversational text or exactly one
//! `zeus-directive` JSON block. When a directive is present, we execute it
//! (run Python, ask for approval, update the task), feed the result back to
//! the master as a user-role message, and re-call the model. The loop ends on
//! `final_answer`, plain text, or the iteration cap.

use serde::{Deserialize, Serialize};
use serde_json::json;

pub const MAX_ORCHESTRATION_ITERATIONS: usize = 300;

pub fn max_orchestration_iterations() -> usize {
    if std::env::var("ZEUS_UNLIMITED_ITERATIONS").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false)
        || std::env::var("ZEUS_EVAL_MODE").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false)
    {
        return usize::MAX;
    }
    if let Ok(val) = std::env::var("ZEUS_MAX_ITERATIONS") {
        if let Ok(n) = val.parse::<usize>() {
            if n == 0 {
                return usize::MAX;
            }
            return n;
        }
    }
    MAX_ORCHESTRATION_ITERATIONS
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ActionPlanStep {
    #[serde(default)]
    pub id: String,
    pub title: String,
    pub status: String, // "pending", "in_progress", "completed", "failed", "interrupted"
}

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
        steps: Option<Vec<ActionPlanStep>>,
        #[serde(default)]
        request_approval: bool,
    },
    AnalyzeVisual {
        image_path: String,
        query: String,
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
        #[serde(default)]
        start_line: Option<usize>,
        #[serde(default)]
        end_line: Option<usize>,
        #[serde(default)]
        limit: Option<usize>,
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
        #[serde(default)]
        cwd: Option<String>,
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
    #[serde(alias = "result", alias = "answer")]
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
    /// Specific defects the worker must fix (empty if passed).
    #[serde(default)]
    pub blockers: Vec<String>,
    /// Optional rubric dimensions 0-10 (accuracy, tools, safety, efficiency).
    #[serde(default)]
    pub scores: std::collections::HashMap<String, f64>,
    /// Grounding evidence the verifier claims to have checked (commands, files, screenshots).
    #[serde(default)]
    pub evidence: Vec<String>,
    /// True when failure looks structural (missing backend, wrong contract) — escalate to Master.
    #[serde(default)]
    pub needs_master_replan: bool,
}

impl Default for VerificationResult {
    fn default() -> Self {
        Self {
            passed: false,
            feedback: String::new(),
            blockers: Vec::new(),
            scores: std::collections::HashMap::new(),
            evidence: Vec::new(),
            needs_master_replan: false,
        }
    }
}

/// What the orchestrator decided the master's reply was.
pub enum MasterReply {
    /// Plain conversational text — show it and stop.
    Text(String),
    /// The text before the directive, the directive itself, and the raw JSON of the directive.
    Directive(String, Directive, String),
    /// The text before the directive, the error description, and the full raw reply.
    MalformedDirective {
        preamble: String,
        error: String,
        raw: String,
    },
}

/// The fenced block tag the master uses for directives.
pub const DIRECTIVE_FENCE: &str = "```zeus-directive";

/// Helper to strip trailing commas before closing braces/brackets in JSON strings.
pub fn strip_trailing_commas(json_str: &str) -> String {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r",\s*([\}\]])").unwrap());
    re.replace_all(json_str, "$1").to_string()
}

/// Tolerant verifier JSON parser. Robust against trailing commas, markdown fences,
/// and surrounding prose from the verifier model.
pub fn parse_verification_json(raw: &str) -> Result<VerificationResult, String> {
    let content = if let Some(start) = raw.find("```json") {
        let after = &raw[start + 7..];
        if let Some(end) = after.find("```") {
            &after[..end]
        } else {
            after
        }
    } else if let Some(start) = raw.find("```") {
        let after = &raw[start + 3..];
        if let Some(end) = after.find("```") {
            &after[..end]
        } else {
            after
        }
    } else {
        raw
    };

    let trimmed = content.trim();

    // 1. Direct strict parse
    if let Ok(vr) = serde_json::from_str::<VerificationResult>(trimmed) {
        return Ok(vr);
    }

    // 2. Find first '{' and matching or last '}'
    if let Some(first_brace) = trimmed.find('{') {
        let candidate = if let Some(last_brace) = trimmed.rfind('}') {
            if last_brace > first_brace {
                &trimmed[first_brace..=last_brace]
            } else {
                &trimmed[first_brace..]
            }
        } else {
            &trimmed[first_brace..]
        };

        if let Ok(vr) = serde_json::from_str::<VerificationResult>(candidate) {
            return Ok(vr);
        }

        // 3. Strip trailing commas before closing braces/brackets
        let stripped = strip_trailing_commas(candidate);
        if let Ok(vr) = serde_json::from_str::<VerificationResult>(&stripped) {
            return Ok(vr);
        }

        // 4. Try parsing as generic serde_json::Value to extract fields leniently
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&stripped) {
            let passed = val.get("passed")
                .and_then(|p| p.as_bool())
                .unwrap_or_else(|| {
                    val.get("status")
                        .and_then(|s| s.as_str())
                        .map(|s| s.eq_ignore_ascii_case("passed") || s.eq_ignore_ascii_case("pass") || s.eq_ignore_ascii_case("success"))
                        .unwrap_or(false)
                });
            let feedback = val.get("feedback")
                .or_else(|| val.get("critique"))
                .or_else(|| val.get("reason"))
                .or_else(|| val.get("summary"))
                .and_then(|f| f.as_str())
                .unwrap_or("")
                .to_string();
            let blockers = val.get("blockers")
                .and_then(|b| b.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let evidence = val.get("evidence")
                .and_then(|b| b.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let mut scores = std::collections::HashMap::new();
            if let Some(obj) = val.get("scores").and_then(|s| s.as_object()) {
                for (k, v) in obj {
                    if let Some(n) = v.as_f64() {
                        scores.insert(k.clone(), n);
                    }
                }
            }
            let needs_master_replan = val.get("needs_master_replan")
                .and_then(|p| p.as_bool())
                .unwrap_or(false)
                || val.get("escalate")
                    .and_then(|p| p.as_bool())
                    .unwrap_or(false)
                || feedback.to_lowercase().contains("structural")
                || feedback.to_lowercase().contains("escalate to master");
            return Ok(VerificationResult {
                passed,
                feedback,
                blockers,
                scores,
                evidence,
                needs_master_replan,
            });
        }
    }

    // 5. Fallback: check if the verifier text explicitly contains "passed": true
    let lower = trimmed.to_lowercase();
    if lower.contains("\"passed\": true") || lower.contains("\"passed\":true") {
        return Ok(VerificationResult {
            passed: true,
            feedback: "Verified successfully (extracted from raw output).".to_string(),
            ..Default::default()
        });
    }

    serde_json::from_str::<VerificationResult>(trimmed)
        .map_err(|e| format!("Verifier provided invalid JSON: {}", e))
}

/// Tolerant directive JSON parser. Tries strict serde first, then a lenient
/// pass that accepts common model formatting drift: trailing garbage after
/// the object (e.g. a stray extra `}`), trailing commas, and final_answer
/// given as a plain string instead of {"summary": ...}.
fn parse_directive_json(json_str: &str) -> Result<Directive, String> {
    if let Ok(d) = serde_json::from_str::<Directive>(json_str) {
        return Ok(d);
    }
    // Lenient: try stripping trailing commas
    let de_trailed = strip_trailing_commas(json_str);
    if let Ok(d) = serde_json::from_str::<Directive>(&de_trailed) {
        return Ok(d);
    }
    // Lenient: try trimming trailing characters (e.g. stray `}`)
    let trimmed = de_trailed.trim();
    if trimmed.ends_with('}') && trimmed.len() > 1 {
        let stripped = trimmed[..trimmed.len() - 1].trim();
        if let Ok(d) = serde_json::from_str::<Directive>(stripped) {
            return Ok(d);
        }
    }
    // Parse the FIRST JSON value and ignore trailing prose/whitespace
    let mut stream = serde_json::Deserializer::from_str(trimmed).into_iter::<serde_json::Value>();
    if let Some(Ok(v)) = stream.next() {
        if let Ok(d) = serde_json::from_value::<Directive>(v.clone()) {
            return Ok(d);
        }
        if v["type"].as_str() == Some("final_answer") {
            let summary = v["result"]
                .as_str()
                .or_else(|| v["summary"].as_str())
                .or_else(|| v["answer"].as_str())
                .or_else(|| v["final_answer"].as_str())
                .or_else(|| v["final_answer"]["summary"].as_str())
                .or_else(|| v["final_answer"]["result"].as_str())
                .unwrap_or("Task completed successfully.");
            return Ok(Directive::FinalAnswer {
                final_answer: FinalAnswerSpec {
                    summary: summary.to_string(),
                },
            });
        }
    }
    // Return the serde error for diagnostics
    serde_json::from_str::<Directive>(trimmed).map_err(|e| e.to_string())
}

/// Extracts a directive from the master's reply, if present.
///
/// Robustness rules:
/// - If multiple ```zeus-directive blocks are emitted in a single turn, returns MalformedDirective
///   requesting the model emit exactly ONE directive so intermediate execution results can be returned.
/// - The closing fence is searched from the END of the text first (rfind),
///   because directive payloads (especially final_answer summaries) may
///   legitimately contain ``` inside JSON strings. The first-``` fallback is
///   also tried in case the model appended trailing prose.
/// - A reply that is one bare JSON object (fence forgotten) is also accepted.
/// - If a fence exists but nothing parses, we return MalformedDirective so the
///   caller can self-heal instead of leaking raw JSON into the chat.
pub fn parse_master_reply(text: &str) -> MasterReply {
    let fence_count = text.matches(DIRECTIVE_FENCE).count();
    if fence_count > 1 {
        let pre_text = text
            .find(DIRECTIVE_FENCE)
            .map(|idx| text[..idx].trim().to_string())
            .unwrap_or_default();
        return MasterReply::MalformedDirective {
            preamble: pre_text,
            error: "Multiple ```zeus-directive blocks detected in a single response. NONE of your directives were executed and no files or actions were performed. Emit exactly ONE directive per turn so the engine can execute it and return real results before you proceed.".to_string(),
            raw: text.to_string(),
        };
    }

    if let Some(start) = text.find(DIRECTIVE_FENCE) {
        let pre_text = text[..start].trim().to_string();
        let after = &text[start + DIRECTIVE_FENCE.len()..];
        let mut candidates: Vec<usize> = Vec::new();
        if let Some(e) = after.find("```") {
            candidates.push(e);
        }
        if let Some(e) = after.rfind("```") {
            if !candidates.contains(&e) {
                candidates.push(e);
            }
        }
        // Fallback candidates: model closed the JSON with '}' or reached end of stream
        // without emitting the closing ``` fence
        if let Some(brace) = after.rfind('}') {
            let end = brace + 1;
            if !candidates.contains(&end) {
                candidates.push(end);
            }
        }
        if !candidates.contains(&after.len()) {
            candidates.push(after.len());
        }

        let mut last_err = String::from("missing closing ``` fence");
        for end in candidates {
            let json_str = after[..end].trim();
            match parse_directive_json(json_str) {
                Ok(d) => return MasterReply::Directive(pre_text, d, text.to_string()),
                Err(e) => last_err = e,
            }
        }
        return MasterReply::MalformedDirective {
            preamble: pre_text,
            error: last_err,
            raw: text.to_string(),
        };
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
                    let truncated_text = if text.len() > 6000 {
                        let prefix = crate::utils::safe_truncate_str(&text, 6000);
                        format!("{}... [truncated remaining {} characters]", prefix, text.len() - prefix.len())
                    } else {
                        text
                    };
                    format!("Status: {}\nBody: {}", status, truncated_text)
                },
                Err(e) => format!("Request failed: {}", e)
            };
            let result_json = serde_json::json!({ "http_result": res });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::RunCommand { command, cwd } => {
            let execution_dir = match &cwd {
                Some(custom_dir) if !custom_dir.trim().is_empty() => std::path::PathBuf::from(custom_dir),
                _ => crate::utils::task_workspace(task_id)?,
            };
            let output_future = tokio::process::Command::new("cmd")
                .args(&["/c", &command])
                .current_dir(execution_dir)
                .output();
            
            let output_result = tokio::time::timeout(
                std::time::Duration::from_secs(1800),
                output_future
            ).await;

            let res = match output_result {
                Ok(Ok(out)) => {
                    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    let raw = format!("Exit Code: {}\nStdout: {}\nStderr: {}", out.status.code().unwrap_or(-1), stdout, stderr);
                    crate::output_compressor::compress_tool_output(task_id, "run_command", &raw, out.status.code())
                }
                Ok(Err(e)) => format!("Failed to execute command: {}", e),
                Err(_) => "Command timed out after 1800 seconds.".to_string(),
            };
            let result_json = serde_json::json!({ "command_result": res });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::ReadFile { path, start_line, end_line, limit } => {
            let full_path = if std::path::Path::new(&path).is_absolute() {
                std::path::PathBuf::from(&path)
            } else {
                crate::utils::task_workspace(task_id)?.join(&path)
            };
            let res = match tokio::fs::read_to_string(&full_path).await {
                Ok(content) => {
                    let total_lines = content.lines().count();
                    if start_line.is_none() && end_line.is_none() && limit.is_none() {
                        if total_lines <= 500 {
                            content
                        } else {
                            let head: Vec<&str> = content.lines().take(500).collect();
                            format!(
                                "[Read first 500 lines of {} total lines from `{}`. Specify start_line and end_line in read_file to read other ranges.]\n{}",
                                total_lines, full_path.display(), head.join("\n")
                            )
                        }
                    } else {
                        let start = start_line.unwrap_or(1).max(1);
                        let end = if let Some(e) = end_line {
                            e.min(total_lines)
                        } else if let Some(l) = limit {
                            (start + l - 1).min(total_lines)
                        } else {
                            total_lines
                        };

                        if start > total_lines {
                            format!("[Specified start_line {} exceeds total file lines ({}) in `{}`]", start, total_lines, full_path.display())
                        } else {
                            let take_count = if end >= start { end - start + 1 } else { 0 };
                            let sliced: Vec<&str> = content.lines().skip(start - 1).take(take_count).collect();
                            format!(
                                "[Read lines {}-{} of {} total lines from `{}`]\n{}",
                                start, end, total_lines, full_path.display(), sliced.join("\n")
                            )
                        }
                    }
                }
                Err(e) => format!("Failed to read file: {}", e),
            };
            let result_json = serde_json::json!({ "read_result": res });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::WriteFile { path, content } => {
            let full_path = if std::path::Path::new(&path).is_absolute() {
                std::path::PathBuf::from(&path)
            } else {
                crate::utils::task_workspace(task_id)?.join(&path)
            };
            if let Some(parent) = full_path.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            let res = match tokio::fs::write(&full_path, content).await {
                Ok(_) => "Successfully wrote file.".to_string(),
                Err(e) => format!("Failed to write file: {}", e),
            };
            let result_json = serde_json::json!({ "write_result": res });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::DeleteFile { path } => {
            let full_path = if std::path::Path::new(&path).is_absolute() {
                std::path::PathBuf::from(&path)
            } else {
                crate::utils::task_workspace(task_id)?.join(&path)
            };
            let res = match tokio::fs::remove_file(&full_path).await {
                Ok(_) => "Successfully deleted file.".to_string(),
                Err(e) => format!("Failed to delete file: {}", e),
            };
            let result_json = serde_json::json!({ "delete_result": res });
            Ok(crate::orchestrator::directive_result_message(&result_json))
        }
        Directive::ListDir { path } => {
            let full_path = if std::path::Path::new(&path).is_absolute() {
                std::path::PathBuf::from(&path)
            } else if path.trim().is_empty() || path == "." {
                crate::utils::task_workspace(task_id)?
            } else {
                crate::utils::task_workspace(task_id)?.join(&path)
            };
            let res = match std::fs::read_dir(&full_path) {
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
            let full_path = if std::path::Path::new(&path).is_absolute() {
                std::path::PathBuf::from(&path)
            } else if path.trim().is_empty() || path == "." {
                crate::utils::task_workspace(task_id)?
            } else {
                crate::utils::task_workspace(task_id)?.join(&path)
            };
            if !full_path.exists() {
                let result_json = serde_json::json!({ "search_files_result": "Error: The specified path does not exist." });
                return Ok(crate::orchestrator::directive_result_message(&result_json));
            }
            
            // Using walkdir to find matching files
            let mut matches = Vec::new();
            
            let mut iter = walkdir::WalkDir::new(&full_path).into_iter();
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
        Directive::AnalyzeVisual { image_path, query } => {
            let (vision_model, vision_effort) = {
                let conn = _state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
                conn.query_row(
                    "SELECT vision_model, vision_effort FROM tasks WHERE id = ?1",
                    rusqlite::params![task_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                ).unwrap_or_else(|_| ("gemini-3.8-flash".to_string(), "default".to_string()))
            };
            let res = match crate::gateway::analyze_visual(&vision_model, task_id, &image_path, &query, Some(&vision_effort)).await {
                Ok((analysis, usage, usage_json)) => {
                    if let Ok(conn) = _state.db.lock() {
                        let _ = crate::chat::record_spend(&conn, task_id, &vision_model, &usage, &usage_json);
                    }
                    analysis
                }
                Err(e) => format!("Visual analysis failed: {}", e),
            };
            let result_json = serde_json::json!({ "visual_analysis_result": res });
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
    crate::utils::safe_truncate(s, max)
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
            MasterReply::MalformedDirective { error, .. } => panic!("malformed: {}", error),
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
            MasterReply::Directive(_, Directive::ReadFile { path, .. }, _) => {
                assert_eq!(path, "D:/test.txt");
            }
            _ => panic!("expected bare-JSON ReadFile"),
        }
    }

    #[test]
    fn broken_json_inside_fence_is_malformed_not_text() {
        let reply = "```zeus-directive\n{\"type\":\"run_action\", BROKEN\n```";
        match parse_master_reply(reply) {
            MasterReply::MalformedDirective { error, raw, .. } => {
                assert!(error.contains("invalid JSON") || error.contains("missing") || error.contains("expected"));
                assert!(raw.contains("BROKEN"));
            }
            _ => panic!("expected MalformedDirective"),
        }
    }

    #[test]
    fn multiple_directives_rejected_with_actionable_error() {
        let reply = "I will plan and run:\n```zeus-directive\n{\"type\":\"update_action_plan\",\"action_plan\":\"step 1\"}\n```\nAnd now run:\n```zeus-directive\n{\"type\":\"run_command\",\"command\":\"ls\"}\n```";
        match parse_master_reply(reply) {
            MasterReply::MalformedDirective { error, raw, .. } => {
                assert!(error.contains("Multiple ```zeus-directive blocks detected"));
                assert!(raw.contains("update_action_plan"));
                assert!(raw.contains("run_command"));
            }
            _ => panic!("expected MalformedDirective for multiple directives"),
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
            MasterReply::MalformedDirective { .. } => {}
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
            MasterReply::MalformedDirective { error, .. } => panic!("malformed: {}", error),
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

    #[test]
    fn test_parse_markdown_steps() {
        let md = r#"# Implementation Plan
- [x] Step 1: Initialize project setup
- [/] Step 2: Implement core functionality
- [ ] Step 3: Run comprehensive verification tests
"#;
        let steps = parse_markdown_steps(md);
        assert_eq!(steps.len(), 3);
        assert_eq!(steps[0].status, "completed");
        assert_eq!(steps[1].status, "in_progress");
        assert_eq!(steps[2].status, "pending");
        assert!(steps[0].title.contains("Initialize project"));
    }
}

pub fn parse_markdown_steps(markdown: &str) -> Vec<ActionPlanStep> {
    let mut steps = Vec::new();
    let mut idx = 1;
    for line in markdown.lines() {
        let trimmed = line.trim();
        // Check for checkbox format: - [x], - [ ], - [/], * [x], etc.
        if trimmed.starts_with("- [")
            || trimmed.starts_with("* [")
            || trimmed.starts_with("+ [")
            || (trimmed.len() > 3
                && trimmed.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
                && trimmed.contains(". ["))
        {
            let lower = trimmed.to_lowercase();
            let status = if trimmed.contains("[x]") || trimmed.contains("[X]") {
                "completed"
            } else if trimmed.contains("[/]")
                || trimmed.contains("[-]")
                || lower.contains("(in progress)")
                || lower.contains("[in progress]")
                || lower.contains("(active)")
            {
                "in_progress"
            } else {
                "pending"
            };
            if let Some(bracket_end) = trimmed.find(']') {
                let raw_title = trimmed[bracket_end + 1..].trim().trim_start_matches(':').trim();
                let title = raw_title
                    .replace("(in progress)", "")
                    .replace("(In Progress)", "")
                    .replace("[in progress]", "")
                    .replace("[In Progress]", "")
                    .trim()
                    .to_string();
                if !title.is_empty() {
                    steps.push(ActionPlanStep {
                        id: format!("step-{}", idx),
                        title,
                        status: status.to_string(),
                    });
                    idx += 1;
                }
            }
        } else if trimmed.to_lowercase().starts_with("step ")
            || (trimmed.len() > 2
                && trimmed.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
                && trimmed.contains('.'))
        {
            let lower = trimmed.to_lowercase();
            let status = if lower.contains("[done]") || lower.contains("[completed]") || lower.contains("(done)") {
                "completed"
            } else if lower.contains("[in progress]") || lower.contains("(in progress)") || lower.contains("[active]") {
                "in_progress"
            } else {
                "pending"
            };
            let cleaned = trimmed
                .trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c == ' ')
                .trim_start_matches("Step ")
                .trim_start_matches(|c: char| c.is_ascii_digit() || c == ':' || c == ' ')
                .replace("[DONE]", "")
                .replace("[done]", "")
                .replace("[COMPLETED]", "")
                .replace("[completed]", "")
                .replace("[IN PROGRESS]", "")
                .replace("[in progress]", "")
                .trim()
                .to_string();
            if !cleaned.is_empty() {
                steps.push(ActionPlanStep {
                    id: format!("step-{}", idx),
                    title: cleaned,
                    status: status.to_string(),
                });
                idx += 1;
            }
        }
    }
    steps
}
