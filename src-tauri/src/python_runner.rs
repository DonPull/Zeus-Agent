//! Runs Python actions inside the task workspace with a timeout, capturing
//! stdout/stderr and the exit code. The interpreter is resolved once and the
//! exact command is reported in diagnostics so users can fix PATH issues.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

pub struct ActionOutcome {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
    pub interpreter: String,
}

/// Finds a working Python interpreter. Order: `python`, `python3`, then the
/// Windows `py` launcher (which locates installed Pythons even when PATH is
/// not configured). Returns the command path string used.
fn detect_python() -> Option<String> {
    for candidate in ["python", "python3", "py"] {
        let ok = std::process::Command::new(candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return Some(candidate.to_string());
        }
    }
    None
}

/// Writes `code` to a temp file inside the workspace and executes it. Running
/// from a file (instead of `-c`) keeps tracebacks and multi-line code sane.
pub async fn run_python_action(
    workspace: &Path,
    code: &str,
    timeout_secs: u64,
) -> Result<ActionOutcome, String> {
    let interpreter = detect_python().ok_or_else(|| {
        "No Python interpreter found (tried `python`, `python3`, `py`). Install Python 3.11 and make sure it is on your PATH.".to_string()
    })?;

    std::fs::create_dir_all(workspace)
        .map_err(|e| format!("Failed to create the task workspace: {}", e))?;

    let script_path: PathBuf = workspace.join(format!("__zeus_action_{}.py", crate::db::new_id()));
    std::fs::write(&script_path, code)
        .map_err(|e| format!("Failed to write the action script: {}", e))?;

    let mut child = Command::new(&interpreter)
        .arg(&script_path)
        .current_dir(workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Python (`{}`): {}", interpreter, e))?;

    let timeout = Duration::from_secs(timeout_secs.max(5));
    let mut timed_out = false;

    // Read stdout/stderr concurrently with waiting. Pipes have a fixed OS
    // buffer; if we wait for exit before draining, output past the buffer is
    // dropped (this is what produced the "(empty)" stdout runs).
    let mut stdout_handle = child.stdout.take();
    let mut stderr_handle = child.stderr.take();

    let stdout_reader = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(ref mut out) = stdout_handle {
            let _ = out.read_to_end(&mut buf).await;
        }
        buf
    });
    let stderr_reader = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(ref mut err) = stderr_handle {
            let _ = err.read_to_end(&mut buf).await;
        }
        buf
    });

    let wait_result = tokio::time::timeout(timeout, child.wait()).await;
    let status = match wait_result {
        Ok(res) => Some(res.map_err(|e| format!("Failed to wait on the Python process: {}", e))?),
        Err(_) => {
            timed_out = true;
            let _ = child.kill().await;
            let _ = child.wait().await;
            None
        }
    };

    let stdout_bytes = stdout_reader.await.unwrap_or_default();
    let stderr_bytes = stderr_reader.await.unwrap_or_default();
    let stdout = String::from_utf8_lossy(&stdout_bytes).to_string();
    let stderr = String::from_utf8_lossy(&stderr_bytes).to_string();

    let _ = std::fs::remove_file(&script_path);

    if timed_out {
        return Ok(ActionOutcome {
            stdout,
            stderr: if stderr.is_empty() { format!("Action timed out after {}s and was killed.", timeout_secs) } else { stderr },
            exit_code: -1,
            timed_out,
            interpreter,
        });
    }

    Ok(ActionOutcome {
        stdout,
        stderr,
        exit_code: status.and_then(|s| s.code()).unwrap_or(-1),
        timed_out,
        interpreter,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Regression test for the pipe-buffer bug: stdout larger than the OS pipe
    // buffer must arrive intact (this used to come back empty).
    #[tokio::test]
    async fn large_stdout_is_not_dropped() {
        let workspace = std::env::temp_dir().join(format!("zeus_test_{}", crate::db::new_id()));
        let outcome = run_python_action(&workspace, "print('x' * 200000)", 30).await.expect("runner failed");
        assert_eq!(outcome.exit_code, 0);
        assert!(!outcome.timed_out);
        assert!(outcome.stdout.trim().len() >= 200000, "stdout was dropped: got {} bytes", outcome.stdout.len());
        let _ = std::fs::remove_dir_all(workspace);
    }

    #[tokio::test]
    async fn nonzero_exit_and_stderr_are_captured() {
        let workspace = std::env::temp_dir().join(format!("zeus_test_{}", crate::db::new_id()));
        let outcome = run_python_action(&workspace, "import sys\nsys.stderr.write('boom')\nsys.exit(3)", 30).await.expect("runner failed");
        assert_eq!(outcome.exit_code, 3);
        assert!(outcome.stderr.contains("boom"));
        let _ = std::fs::remove_dir_all(workspace);
    }
}