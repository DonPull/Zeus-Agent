//! The M1a orchestrator: parses master directives, executes them, and loops.
//!
//! The master model returns either plain conversational text or exactly one
//! `zeus-directive` JSON block. When a directive is present, we execute it
//! (run Python, ask for approval, update the task), feed the result back to
//! the master as a user-role message, and re-call the model. The loop ends on
//! `final_answer`, plain text, or the iteration cap.

use serde::Deserialize;
use serde_json::json;

pub const MAX_ORCHESTRATION_ITERATIONS: usize = 8;

/// A parsed directive from the master's reply.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Directive {
    RunAction {
        action: ActionSpec,
        #[serde(default)]
        success_criteria: Option<String>,
    },
    RequestApproval {
        approval: ApprovalSpec,
    },
    TaskUpdate {
        update: TaskUpdateSpec,
    },
    FinalAnswer {
        final_answer: FinalAnswerSpec,
    },
}

#[derive(Debug, Clone, Deserialize)]
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

#[derive(Debug, Clone, Deserialize)]
pub struct ApprovalSpec {
    pub summary: String,
    #[serde(default)]
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TaskUpdateSpec {
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FinalAnswerSpec {
    pub summary: String,
}

/// What the orchestrator decided the master's reply was.
pub enum MasterReply {
    /// Plain conversational text — show it and stop.
    Text(String),
    /// A directive plus any (unexpected) surrounding text, kept for context.
    Directive(Directive, String),
}

/// The fenced block tag the master uses for directives.
const DIRECTIVE_FENCE: &str = "```zeus-directive";

/// Extracts a directive from the master's reply, if present. A directive is a
/// fenced code block tagged `zeus-directive` containing one JSON object.
pub fn parse_master_reply(text: &str) -> MasterReply {
    let trimmed = text.trim();
    if let Some(start) = trimmed.find(DIRECTIVE_FENCE) {
        let after_tag = &trimmed[start + DIRECTIVE_FENCE.len()..];
        if let Some(end) = after_tag.find("```") {
            let json_str = after_tag[..end].trim();
            match serde_json::from_str::<Directive>(json_str) {
                Ok(directive) => return MasterReply::Directive(directive, trimmed.to_string()),
                Err(_) => {
                    // Malformed directive JSON: surface the raw text so the
                    // master can correct itself on the next turn.
                    return MasterReply::Text(trimmed.to_string());
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

/// Builds the JSON result for a completed (or failed) Python action.
pub fn action_result_json(stdout: &str, stderr: &str, exit_code: i32, timed_out: bool, interpreter: &str) -> serde_json::Value {
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