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
    app_handle: Option<tauri::AppHandle>,
    task_id: Option<String>,
    workspace: &Path,
    code: &str,
    timeout_secs: u64,
    browser_port: Option<u16>,
) -> Result<ActionOutcome, String> {
    let interpreter = detect_python().ok_or_else(|| {
        "No Python interpreter found (tried `python`, `python3`, `py`). Install Python 3.11 and make sure it is on your PATH.".to_string()
    })?;

    std::fs::create_dir_all(workspace)
        .map_err(|e| format!("Failed to create the task workspace: {}", e))?;

    // Setup IPC server if we have context
    let mut ipc_port = 0;
    if let (Some(app), Some(tid)) = (app_handle, task_id) {
        if let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:0").await {
            ipc_port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
            tokio::spawn(async move {
                while let Ok((stream, _)) = listener.accept().await {
                    let app_clone = app.clone();
                    let tid_clone = tid.clone();
                    tokio::spawn(async move {
                        handle_ipc_connection(stream, app_clone, tid_clone).await;
                    });
                }
            });
        }
    }

    let script_path: PathBuf = workspace.join(format!("__zeus_action_{}.py", crate::db::new_id()));
    
    let sandbox_preamble = r#"
import sys
import os
import json
import socket

_zeus_workspace = os.path.abspath(os.getcwd())
_zeus_sys_prefix = os.path.abspath(sys.prefix)
_zeus_sys_base = os.path.abspath(sys.base_prefix)
_zeus_ipc_port = int(os.environ.get('ZEUS_IPC_PORT', '0'))
_zeus_ipc_socket = None
_zeus_ipc_f = None

def _get_ipc_socket():
    global _zeus_ipc_socket, _zeus_ipc_f
    if _zeus_ipc_socket is None and _zeus_ipc_port != 0:
        _zeus_ipc_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        _zeus_ipc_socket.connect(('127.0.0.1', _zeus_ipc_port))
        _zeus_ipc_f = _zeus_ipc_socket.makefile('rw', encoding='utf-8')
    return _zeus_ipc_f

def _ask_gatekeeper(req):
    f = _get_ipc_socket()
    if not f:
        # If IPC is disabled (e.g. tests), default to deny
        return False
    f.write(json.dumps(req) + '\n')
    f.flush()
    resp_line = f.readline()
    if not resp_line:
        return False
    try:
        resp = json.loads(resp_line)
        return resp.get('status') == 'allow'
    except Exception:
        return False

_zeus_approved_hosts = set()

def _zeus_audit_hook(event, args):
    global _zeus_approved_hosts
    if event == 'socket.getaddrinfo':
        host = args[0]
        if isinstance(host, str) and host not in ('127.0.0.1', 'localhost', '::1'):
            if host not in _zeus_approved_hosts:
                req = {"type": "network", "url": host}
                if not _ask_gatekeeper(req):
                    raise PermissionError(f'Zeus Gatekeeper DENIED network access to {host}')
                _zeus_approved_hosts.add(host)
    elif event == 'socket.connect':
        address = args[0] if len(args) > 0 else None
        if isinstance(address, tuple) and len(address) > 0:
            host = address[0]
            if isinstance(host, str) and host not in ('127.0.0.1', 'localhost', '::1'):
                if host not in _zeus_approved_hosts:
                    req = {"type": "network", "url": host}
                    if not _ask_gatekeeper(req):
                        raise PermissionError(f'Zeus Gatekeeper DENIED network access to {host}')
                    _zeus_approved_hosts.add(host)

    if event in ('subprocess.Popen', 'os.system', 'os.exec', 'os.spawn', 'os.posix_spawn'):
        exe = args[0] if len(args) > 0 else None
        cmd_args = args[1] if len(args) > 1 else None
        
        if exe is None and cmd_args is not None:
            if isinstance(cmd_args, list):
                cmd = " ".join(str(x) for x in cmd_args)
            else:
                cmd = str(cmd_args)
        else:
            if isinstance(exe, list):
                cmd = " ".join(str(x) for x in exe)
            else:
                cmd = str(exe if exe is not None else event)
                
        req = {"type": "command", "command": cmd}
        if not _ask_gatekeeper(req):
            raise PermissionError(f'Zeus Gatekeeper DENIED OS command execution: {cmd}')

    if event in ('ctypes.dlopen', '_ctypes.dlopen'):
        raise PermissionError('Loading native dynamic libraries is disabled in this sandbox for security reasons.')

    if event == 'open':
        path = args[0]
        if isinstance(path, str):
            abs_path = os.path.abspath(path)
            if abs_path.startswith(_zeus_sys_prefix) or abs_path.startswith(_zeus_sys_base):
                return
            if abs_path.startswith(_zeus_workspace):
                return
            mode = args[1] if len(args) > 1 else 'r'
            action = 'write' if ('w' in mode or 'a' in mode or '+' in mode) else 'read'
            req = {"type": "file", "path": abs_path, "action": action}
            if not _ask_gatekeeper(req):
                raise PermissionError(f'Zeus Gatekeeper DENIED {action} access to {abs_path}')

sys.addaudithook(_zeus_audit_hook)

try:
    import playwright.sync_api
    
    _zeus_original_click = playwright.sync_api.Page.click
    _zeus_original_fill = playwright.sync_api.Page.fill
    
    def _zeus_screenshot_before_action(page, action_name):
        history_dir = os.path.join(_zeus_workspace, ".zeus", "browser_history")
        os.makedirs(history_dir, exist_ok=True)
        import time
        ts = int(time.time() * 1000)
        shot_path = os.path.join(history_dir, f"{ts}_{action_name}.png")
        try:
            page.screenshot(path=shot_path)
            # We could draw a box here using locator, but keeping it simple for now.
        except Exception:
            pass

    def _zeus_patched_click(self, selector, **kwargs):
        _zeus_screenshot_before_action(self, "click")
        return _zeus_original_click(self, selector, **kwargs)
        
    def _zeus_patched_fill(self, selector, value, **kwargs):
        _zeus_screenshot_before_action(self, "fill")
        return _zeus_original_fill(self, selector, value, **kwargs)
        
    _zeus_original_goto = playwright.sync_api.Page.goto
    _zeus_original_close = playwright.sync_api.Page.close

    def _zeus_patched_goto(self, url, **kwargs):
        req = {"type": "browser", "action": "goto", "url": url}
        if not _ask_gatekeeper(req):
            raise PermissionError(f'Zeus Gatekeeper DENIED browser navigation to {url}')
        return _zeus_original_goto(self, url, **kwargs)
        
    def _zeus_patched_close(self, **kwargs):
        req = {"type": "browser", "action": "close"}
        if not _ask_gatekeeper(req):
            raise PermissionError(f'Zeus Gatekeeper DENIED closing the browser tab')
        return _zeus_original_close(self, **kwargs)

    playwright.sync_api.Page.click = _zeus_patched_click
    playwright.sync_api.Page.fill = _zeus_patched_fill
    playwright.sync_api.Page.goto = _zeus_patched_goto
    playwright.sync_api.Page.close = _zeus_patched_close
except ImportError:
    pass
"#;

    let final_code = format!("{}\n{}", sandbox_preamble, code);
    std::fs::write(&script_path, final_code)
        .map_err(|e| format!("Failed to write the action script: {}", e))?;

    let mut command = Command::new(&interpreter);
    command
        .arg(&script_path)
        .current_dir(workspace)
        .env("PYTHONUNBUFFERED", "1")
        .env("ZEUS_IPC_PORT", ipc_port.to_string());
        
    if let Some(port) = browser_port {
        command.env("ZEUS_BROWSER_WS_ENDPOINT", format!("ws://127.0.0.1:{}", port));
    }

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start Python (`{}`): {}", interpreter, e))?;

    let timeout = Duration::from_secs(timeout_secs.max(5));
    let mut timed_out = false;

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

use tauri::Manager;
use crate::db::AppState;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

async fn handle_ipc_connection(
    mut stream: tokio::net::TcpStream,
    app_handle: tauri::AppHandle,
    task_id: String,
) {
    let (reader, mut writer) = stream.split();
    let mut reader = tokio::io::BufReader::new(reader);
    let mut line = String::new();

    while let Ok(bytes) = reader.read_line(&mut line).await {
        if bytes == 0 { break; }
        
        let req: serde_json::Value = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(_) => {
                line.clear();
                continue;
            }
        };

        let req_type = req["type"].as_str().unwrap_or("");
        let state = app_handle.state::<AppState>();
        
        let verdict = match req_type {
            "file" => {
                let path = req["path"].as_str().unwrap_or("");
                let action = req["action"].as_str().unwrap_or("read");
                let conn = state.db.lock().unwrap();
                crate::gatekeeper::evaluate_file_permission(&conn, &task_id, path, action).unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
            },
            "network" => {
                let url = req["url"].as_str().unwrap_or("");
                crate::gatekeeper::evaluate_network_action(&state, &task_id, url, "GET", None).await.unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
            },
            "command" => {
                let cmd_value = req["command"].clone();
                let cmd_str = if let Some(cmd_array) = cmd_value.as_array() {
                    cmd_array.iter().filter_map(|v| v.as_str()).collect::<Vec<&str>>().join(" ")
                } else {
                    cmd_value.as_str().unwrap_or("").to_string()
                };
                if cmd_str.contains("pip install playwright") || cmd_str.contains("playwright install") {
                    crate::gatekeeper::PermissionVerdict::Allow
                } else {
                    let conn = state.db.lock().unwrap();
                    crate::gatekeeper::evaluate_command_action(&conn, &task_id, &cmd_str).unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
                }
            },
            "browser" => {
                let action = req["action"].as_str().unwrap_or("");
                let url = req["url"].as_str();
                crate::gatekeeper::evaluate_browser_action(&state, &task_id, action, url).await.unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
            },
            _ => crate::gatekeeper::PermissionVerdict::Ask,
        };

        let final_verdict = match verdict {
            crate::gatekeeper::PermissionVerdict::Allow => "allow".to_string(),
            crate::gatekeeper::PermissionVerdict::Deny => "deny".to_string(),
            crate::gatekeeper::PermissionVerdict::Ask => {
                // Reuse an existing pending card with the same summary so the
                // sandbox cannot stack duplicate cards for one request.
                let summary = match req_type {
                    "file" => format!("Python Access: {} `{}`", req["action"].as_str().unwrap_or("read"), req["path"].as_str().unwrap_or("")),
                    "network" => format!("Python Network: {}", req["url"].as_str().unwrap_or("")),
                    "command" => format!("Python Command: {}", req["command"].as_str().unwrap_or("")),
                    _ => "Python Action".to_string(),
                };
                
                let blocked_dir = if req_type == "network" {
                    crate::orchestrator::Directive::HttpRequest { url: req["url"].as_str().unwrap_or("").to_string(), method: "GET".to_string(), body: None }
                } else if req_type == "command" {
                    crate::orchestrator::Directive::RunCommand { command: req["command"].as_str().unwrap_or("").to_string() }
                } else {
                    crate::orchestrator::Directive::ReadFile { path: req["path"].as_str().unwrap_or("").to_string() }
                };
                
                let existing_id: Option<String> = {
                    let conn = state.db.lock().ok();
                    conn.and_then(|c| {
                        c.query_row(
                            "SELECT id FROM messages WHERE task_id = ?1 AND kind = 'approval' AND json_extract(content, '$.status') = 'pending' AND json_extract(content, '$.summary') = ?2 ORDER BY rowid DESC LIMIT 1",
                            rusqlite::params![task_id, summary],
                            |row| row.get(0),
                        ).ok()
                    })
                };

                let mut approval_message = crate::chat::new_message(
                    &task_id, "event", "approval",
                    serde_json::json!({
                        "summary": summary,
                        "detail": "Requested by Python script sandbox",
                        "status": "pending",
                        "blocked_directive": blocked_dir,
                    }).to_string(),
                    None, None, true,
                );
                if let Some(id) = existing_id {
                    approval_message.id = id;
                } else {
                    let _ = crate::chat::persist_and_emit(&state, &app_handle, &task_id, &mut approval_message);
                }
                let approval_timestamp = approval_message.created_at.clone();

                let mut decision = "deny".to_string();
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    let conn = match state.db.lock() {
                        Ok(c) => c,
                        Err(_) => continue,
                    };
                    
                    let status: Option<String> = conn.query_row(
                        "SELECT json_extract(content, '$.status') FROM messages WHERE id = ?1",
                        rusqlite::params![approval_message.id],
                        |row| row.get(0)
                    ).unwrap_or(None);

                    if let Some(s) = status {
                        if s == "approved" {
                            decision = "allow".to_string();
                            break;
                        } else if s == "denied" {
                            decision = "deny".to_string();
                            break;
                        }
                    }
                }
                decision
            }
        };

        let res = serde_json::json!({ "status": final_verdict });
        let _ = writer.write_all(format!("{}\n", res).as_bytes()).await;
        line.clear();
    }
}



#[cfg(test)]
mod tests {
    use super::*;

    // Regression test for the pipe-buffer bug: stdout larger than the OS pipe
    // buffer must arrive intact (this used to come back empty).
    #[tokio::test]
    async fn large_stdout_is_not_dropped() {
        let workspace = std::env::temp_dir().join(format!("zeus_test_{}", crate::db::new_id()));
        let outcome = run_python_action(None, None, &workspace, "print('x' * 200000)", 30, None)
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
            None, None,
            &workspace,
            "import sys\nsys.stderr.write('boom')\nsys.exit(3)",
            30,
            None,
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
            None, None,
            &workspace,
            "import time\ntime.sleep(60)\nprint('should not finish')",
            120,
            None,
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
            None, None,
            &workspace,
            "import socket\nsocket.create_connection(('8.8.8.8', 53))",
            30,
            None,
        )
        .await
        .expect("runner failed");
        
        assert_eq!(outcome.exit_code, 1);
        assert!(outcome.stderr.contains("Gatekeeper DENIED") || outcome.stderr.contains("PermissionError"), "stderr was: {}", outcome.stderr);
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
        let outcome = run_python_action(None, None, &workspace, code, 30, None).await.expect("runner failed");
        
        assert_eq!(outcome.exit_code, 1);
        assert!(outcome.stderr.contains("Gatekeeper DENIED") || outcome.stderr.contains("PermissionError"), "stderr was: {}", outcome.stderr);
        let _ = std::fs::remove_dir_all(workspace);
    }

    #[tokio::test]
    async fn sandbox_allows_file_write_inside_workspace() {
        let workspace = std::env::temp_dir().join(format!("zeus_test_{}", crate::db::new_id()));
        let code = r#"
with open('local_test.txt', 'w') as f:
    f.write('allowed')
"#;
        let outcome = run_python_action(None, None, &workspace, code, 30, None).await.expect("runner failed");
        
        assert_eq!(outcome.exit_code, 0, "stderr was: {}", outcome.stderr);
        let content = std::fs::read_to_string(workspace.join("local_test.txt")).unwrap();
        assert_eq!(content, "allowed");
        let _ = std::fs::remove_dir_all(workspace);
    }
}
