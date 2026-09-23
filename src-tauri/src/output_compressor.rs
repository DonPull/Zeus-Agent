use std::fs;
use std::sync::OnceLock;
use regex::Regex;

pub const COMPRESSION_THRESHOLD_CHARS: usize = 2000;
pub const HEAD_LINES_PRESERVE: usize = 15;
pub const TAIL_LINES_PRESERVE: usize = 30;

fn ansi_regex() -> &'static Regex {
    static ANSI_RE: OnceLock<Regex> = OnceLock::new();
    ANSI_RE.get_or_init(|| {
        Regex::new(r"\x1B\[[0-?]*[ -/]*[@-~]").unwrap()
    })
}

/// Strips ANSI terminal escape codes and normalizes carriage return progress updates.
pub fn strip_ansi_codes(input: &str) -> String {
    let re = ansi_regex();
    let stripped = re.replace_all(input, "");
    
    // Normalize \r\n to \n, and clean trailing or standalone \r from spinner loops
    let mut clean_lines: Vec<String> = Vec::new();
    for line in stripped.split('\n') {
        let trimmed_line = line.trim_end_matches('\r');
        // If line has internal carriage returns (e.g. progress bar rewriting itself), keep the last part
        if let Some(last_segment) = trimmed_line.split('\r').last() {
            clean_lines.push(last_segment.to_string());
        } else {
            clean_lines.push(trimmed_line.to_string());
        }
    }
    clean_lines.join("\n")
}

/// Compresses command or tool output if it exceeds COMPRESSION_THRESHOLD_CHARS.
/// If compression occurs:
/// 1. The full raw uncompressed output is saved to `.zeus/task_workspaces/{task_id}/artifacts/tool_output_{ts}_{tool_name}.txt`.
/// 2. The first 15 lines and last 30 lines are preserved, with an explicit omission notice linking to the artifact.
pub fn compress_tool_output(
    task_id: &str,
    tool_name: &str,
    raw_output: &str,
    exit_code: Option<i32>,
) -> String {
    let clean = strip_ansi_codes(raw_output);

    if clean.len() <= COMPRESSION_THRESHOLD_CHARS {
        return clean;
    }

    // Save full raw output to workspace artifacts directory
    let artifact_rel_path = save_raw_artifact(task_id, tool_name, raw_output);

    let lines: Vec<&str> = clean.lines().collect();
    let total_lines = lines.len();

    let exit_code_str = match exit_code {
        Some(code) => format!(" | Exit Code: {}", code),
        None => String::new(),
    };

    if total_lines <= (HEAD_LINES_PRESERVE + TAIL_LINES_PRESERVE) {
        // Few lines, but very wide text: truncate lines longer than 500 chars
        let truncated_lines: Vec<String> = lines
            .into_iter()
            .map(|l| {
                if l.len() > 500 {
                    let prefix = crate::utils::safe_truncate_str(l, 500);
                    format!("{}... [line truncated]", prefix)
                } else {
                    l.to_string()
                }
            })
            .collect();
        return format!(
            "--- [Tool: {}{} (Output compressed)] ---\n{}\n--- [Full raw output ({} chars) saved to artifact: {} — use read_file if needed] ---",
            tool_name,
            exit_code_str,
            truncated_lines.join("\n"),
            raw_output.len(),
            artifact_rel_path
        );
    }

    let head = lines[..HEAD_LINES_PRESERVE].join("\n");
    let tail = lines[total_lines - TAIL_LINES_PRESERVE..].join("\n");
    let omitted_count = total_lines - (HEAD_LINES_PRESERVE + TAIL_LINES_PRESERVE);

    format!(
        "--- [Tool: {}{}] ---\n--- Output (first {} lines) ---\n{}\n--- [... {} lines omitted. Full raw output ({} lines, {} chars) saved to artifact: {} — use read_file if you need to inspect full details] ---\n--- Output (last {} lines - errors & summary) ---\n{}",
        tool_name,
        exit_code_str,
        HEAD_LINES_PRESERVE,
        head,
        omitted_count,
        total_lines,
        raw_output.len(),
        artifact_rel_path,
        TAIL_LINES_PRESERVE,
        tail
    )
}

fn save_raw_artifact(task_id: &str, tool_name: &str, raw_output: &str) -> String {
    let sanitized_tool: String = tool_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    let ts = chrono::Utc::now().timestamp_millis();
    let filename = format!("tool_output_{}_{}.txt", ts, sanitized_tool);

    if let Ok(workspace) = crate::utils::task_workspace(task_id) {
        let artifacts_dir = workspace.join("artifacts");
        let _ = fs::create_dir_all(&artifacts_dir);
        let artifact_path = artifacts_dir.join(&filename);
        if fs::write(&artifact_path, raw_output).is_ok() {
            return format!(".zeus/task_workspaces/{}/artifacts/{}", task_id, filename);
        }
    }

    format!("artifacts/{}", filename)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_ansi() {
        let colored = "\x1B[32mPASS\x1B[0m: test_one\n\x1B[31mFAIL\x1B[0m: test_two\r\nProgress: 50%\rProgress: 100%";
        let clean = strip_ansi_codes(colored);
        assert!(clean.contains("PASS: test_one"));
        assert!(clean.contains("FAIL: test_two"));
        assert!(clean.contains("Progress: 100%"));
        assert!(!clean.contains("\x1B"));
    }

    #[test]
    fn test_short_output_untouched() {
        let short = "Everything passed. 2 tests ran.";
        let res = compress_tool_output("test_task", "cargo_test", short, Some(0));
        assert_eq!(res, short);
    }

    #[test]
    fn test_large_output_compressed() {
        let mut lines = Vec::new();
        for i in 1..=200 {
            lines.push(format!("Line {}: running subtest iteration with lots of verbose debugging output {}", i, i));
        }
        let raw = lines.join("\n");
        assert!(raw.len() > COMPRESSION_THRESHOLD_CHARS);

        let res = compress_tool_output("test_task", "run_command", &raw, Some(1));
        assert!(res.contains("first 15 lines"));
        assert!(res.contains("last 30 lines"));
        assert!(res.contains("lines omitted"));
        assert!(res.contains("Exit Code: 1"));
        assert!(res.contains("tool_output_"));
    }
}
