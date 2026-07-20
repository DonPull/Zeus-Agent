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

    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(res) => res.map_err(|e| format!("Failed to wait on the Python process: {}", e))?,
        Err(_) => {
            timed_out = true;
            let _ = child.kill().await;
            // Reap the process so we can read the pipes.
            let _ = child.wait().await;
            return Ok(ActionOutcome {
                stdout: String::new(),
                stderr: format!("Action timed out after {}s and was killed.", timeout_secs),
                exit_code: -1,
                timed_out,
                interpreter,
            });
        }
    };

    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut stdout).await;
    }
    if let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_string(&mut stderr).await;
    }

    let _ = std::fs::remove_file(&script_path);

    Ok(ActionOutcome {
        stdout,
        stderr,
        exit_code: status.code().unwrap_or(-1),
        timed_out,
        interpreter,
    })
}