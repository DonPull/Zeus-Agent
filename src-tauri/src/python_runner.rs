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
    
    let sandbox_preamble = r#"
import sys
import os

_zeus_workspace = os.path.abspath(os.getcwd())
_zeus_sys_prefix = os.path.abspath(sys.prefix)
_zeus_sys_base = os.path.abspath(sys.base_prefix)

def _zeus_audit_hook(event, args):
    if event == 'socket.connect' or event == 'socket.getaddrinfo':
        raise PermissionError('Native network access is disabled in this sandbox. You MUST use the Zeus API tools (e.g. HttpRequest, BrowserNavigate) instead of Python network libraries.')
    
    if event == 'open':
        path = args[0]
        if isinstance(path, str):
            abs_path = os.path.abspath(path)
            # Allow internal python libraries
            if abs_path.startswith(_zeus_sys_prefix) or abs_path.startswith(_zeus_sys_base):
                return
            # Allow workspace files
            if abs_path.startswith(_zeus_workspace):
                return
            # Otherwise, block reads and writes outside the workspace
            mode = args[1] if len(args) > 1 else 'r'
            if 'w' in mode or 'a' in mode or '+' in mode:
                raise PermissionError(f'Native file writes outside the workspace are disabled. Use the Zeus WriteFile tool. Blocked: {abs_path}')
            else:
                raise PermissionError(f'Native file reads outside the workspace are disabled. Use the Zeus ReadFile tool. Blocked: {abs_path}')

sys.addaudithook(_zeus_audit_hook)
"#;

    let final_code = format!("{}\n{}", sandbox_preamble, code);
    std::fs::write(&script_path, final_code)
        .map_err(|e| format!("Failed to write the action script: {}", e))?;

    let mut command = Command::new(&interpreter);
    command
        .arg(&script_path)
        .current_dir(workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command
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
            stderr: if stderr.is_empty() {
                format!("Action timed out after {}s and was killed.", timeout_secs)
            } else {
                stderr
            },
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
        let outcome = run_python_action(&workspace, "print('x' * 200000)", 30)
            .await
            .expect("runner failed");
        assert_eq!(outcome.exit_code, 0);
        assert!(!outcome.timed_out);
        assert!(
            outcome.stdout.trim().len() >= 200000,
            "stdout was dropped: got {} bytes",
            outcome.stdout.len()
        );
        let _ = std::fs::remove_dir_all(workspace);
    }

    #[tokio::test]
    async fn nonzero_exit_and_stderr_are_captured() {
        let workspace = std::env::temp_dir().join(format!("zeus_test_{}", crate::db::new_id()));
        let outcome = run_python_action(
            &workspace,
            "import sys\nsys.stderr.write('boom')\nsys.exit(3)",
            30,
        )
        .await
        .expect("runner failed");
        assert_eq!(outcome.exit_code, 3);
        assert!(outcome.stderr.contains("boom"));
        let _ = std::fs::remove_dir_all(workspace);
    }

    #[tokio::test]
    async fn dropping_action_future_cancels_long_running_child() {
        let workspace = std::env::temp_dir().join(format!("zeus_test_{}", crate::db::new_id()));

        let mut future = Box::pin(run_python_action(
            &workspace,
            "import time\ntime.sleep(60)\nprint('should not finish')",
            120,
        ));

        tokio::select! {
            result = &mut future => {
                panic!(
                    "long-running action unexpectedly completed: {:?}",
                    result.err()
                );
            }
            _ = tokio::time::sleep(
                std::time::Duration::from_millis(300)
            ) => {}
        }

        // Dropping the owned boxed future drops the Child configured with
        // kill_on_drop(true), rather than merely dropping a pinned reference.
        drop(future);

        tokio::time::sleep(std::time::Duration::from_millis(300)).await;

        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[tokio::test]
    async fn sandbox_blocks_network_socket() {
        let workspace = std::env::temp_dir().join(format!("zeus_test_{}", crate::db::new_id()));
        let outcome = run_python_action(
            &workspace,
            "import socket\nsocket.create_connection(('8.8.8.8', 53))",
            30,
        )
        .await
        .expect("runner failed");
        
        assert_eq!(outcome.exit_code, 1);
        assert!(outcome.stderr.contains("Native network access is disabled in this sandbox"));
        let _ = std::fs::remove_dir_all(workspace);
    }

    #[tokio::test]
    async fn sandbox_blocks_file_write_outside_workspace() {
        let workspace = std::env::temp_dir().join(format!("zeus_test_{}", crate::db::new_id()));
        // Try to write to a file explicitly outside the workspace (e.g. up one directory)
        let code = r#"
import os
parent_dir = os.path.dirname(os.getcwd())
test_file = os.path.join(parent_dir, 'zeus_hack_test.txt')
with open(test_file, 'w') as f:
    f.write('hacked')
"#;
        let outcome = run_python_action(&workspace, code, 30).await.expect("runner failed");
        
        assert_eq!(outcome.exit_code, 1);
        assert!(outcome.stderr.contains("Native file writes outside the workspace are disabled"));
        let _ = std::fs::remove_dir_all(workspace);
    }

    #[tokio::test]
    async fn sandbox_allows_file_write_inside_workspace() {
        let workspace = std::env::temp_dir().join(format!("zeus_test_{}", crate::db::new_id()));
        let code = r#"
with open('local_test.txt', 'w') as f:
    f.write('allowed')
"#;
        let outcome = run_python_action(&workspace, code, 30).await.expect("runner failed");
        
        assert_eq!(outcome.exit_code, 0, "stderr was: {}", outcome.stderr);
        let content = std::fs::read_to_string(workspace.join("local_test.txt")).unwrap();
        assert_eq!(content, "allowed");
        let _ = std::fs::remove_dir_all(workspace);
    }
}
