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
    /// A directive plus the full raw reply, kept for model context.
    Directive(Directive, String),
    /// A directive fence was present but could not be parsed.
    /// (error description, full raw reply). The caller must NOT show the raw
    /// reply to the user — it feeds the error back to the model instead.
    MalformedDirective(String, String),
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
                Ok(d) => return MasterReply::Directive(d, text.to_string()),
                Err(e) => last_err = e,
            }
        }
        return MasterReply::MalformedDirective(last_err, text.to_string());
    }

    let trimmed = text.trim();

    // Fallback: Model forgot the specific fence, might have used ```json,
    // or just output bare JSON (optionally with preamble text around it).
    // Locate the outermost curly braces to capture the core payload.
    if let Some(start_brace) = trimmed.find('{') {
        if let Some(end_brace) = trimmed.rfind('}') {
            if start_brace < end_brace {
                let json_str = &trimmed[start_brace..=end_brace];
                if let Ok(d) = parse_directive_json(json_str) {
                    return MasterReply::Directive(d, text.to_string());
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
            MasterReply::Directive(Directive::RunAction { action, .. }, _) => {
                assert_eq!(action.code, "print(1)");
            }
            _ => panic!("expected RunAction"),
        }
    }

    #[test]
    fn preamble_before_fence_still_parses() {
        let reply = "Plan written. Now let's read it back.\n\n```zeus-directive\n{\"type\":\"run_action\",\"action\":{\"code\":\"print(2)\"}}\n```";
        match parse_master_reply(reply) {
            MasterReply::Directive(Directive::RunAction { action, .. }, raw) => {
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
            MasterReply::Directive(Directive::FinalAnswer { final_answer }, _) => {
                assert!(final_answer.summary.contains("```python"));
            }
            MasterReply::MalformedDirective(e, _) => panic!("malformed: {}", e),
            _ => panic!("expected FinalAnswer"),
        }
    }

    #[test]
    fn final_answer_as_plain_string_is_accepted_leniently() {
        let reply =
            "```zeus-directive\n{\"type\":\"final_answer\",\"final_answer\":\"All done!\"}\n```";
        match parse_master_reply(reply) {
            MasterReply::Directive(Directive::FinalAnswer { final_answer }, _) => {
                assert_eq!(final_answer.summary, "All done!");
            }
            _ => panic!("expected lenient FinalAnswer"),
        }
    }

    #[test]
    fn bare_json_without_fence_is_accepted() {
        let reply = "{\"type\":\"request_approval\",\"approval\":{\"summary\":\"Create x\",\"detail\":\"why\"}}";
        match parse_master_reply(reply) {
            MasterReply::Directive(Directive::RequestApproval { approval }, _) => {
                assert_eq!(approval.summary, "Create x");
            }
            _ => panic!("expected bare-JSON RequestApproval"),
        }
    }

    #[test]
    fn broken_json_inside_fence_is_malformed_not_text() {
        let reply = "```zeus-directive\n{\"type\":\"run_action\", BROKEN\n```";
        match parse_master_reply(reply) {
            MasterReply::MalformedDirective(err, raw) => {
                assert!(err.contains("invalid JSON"));
                assert!(raw.contains("BROKEN"));
            }
            _ => panic!("expected MalformedDirective"),
        }
    }

    #[test]
    fn unclosed_fence_is_malformed() {
        let reply = "```zeus-directive\n{\"type\":\"run_action\"";
        match parse_master_reply(reply) {
            MasterReply::MalformedDirective(_, _) => {}
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
            MasterReply::Directive(Directive::RunAction { action, .. }, _) => {
                assert_eq!(action.code, "print(3)");
            }
            MasterReply::MalformedDirective(e, _) => panic!("malformed: {}", e),
            _ => panic!("expected RunAction"),
        }
    }

    #[test]
    fn bare_json_with_trailing_brace_is_tolerated() {
        let reply = "{\"type\":\"task_update\",\"update\":{\"title\":\"x\"}}}";
        match parse_master_reply(reply) {
            MasterReply::Directive(Directive::TaskUpdate { .. }, _) => {}
            _ => panic!("expected TaskUpdate despite trailing brace"),
        }
    }
}
