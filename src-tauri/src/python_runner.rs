//! Runs Python actions inside the task workspace with a timeout, capturing
//! stdout/stderr and the exit code. The interpreter is resolved once and the
//! exact command is reported in diagnostics so users can fix PATH issues.

use std::path::{Path, PathBuf};
use std::process::Stdio;
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

    let tid_opt = task_id.clone();
    let session_id = format!("sess_{}", crate::db::new_id());
    let history_dir = if let Some(ref tid) = tid_opt {
        crate::utils::workspace_root()
            .ok()
            .map(|r| r.join(".zeus").join("browser_history").join(tid).join(&session_id))
    } else {
        None
    };

    // Setup IPC server if we have context
    let mut ipc_port = 0;
    if let (Some(ref app), Some(ref tid)) = (&app_handle, &task_id) {
        if let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:0").await {
            ipc_port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
            let app_clone = app.clone();
            let tid_clone = tid.clone();
            tokio::spawn(async move {
                while let Ok((stream, _)) = listener.accept().await {
                    let app_conn = app_clone.clone();
                    let tid_conn = tid_clone.clone();
                    tokio::spawn(async move {
                        handle_ipc_connection(stream, app_conn, tid_conn).await;
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
import tempfile
import atexit
import time
import base64

_zeus_workspace = os.path.abspath(os.getcwd())
_zeus_sys_prefix = os.path.abspath(sys.prefix)
_zeus_sys_base = os.path.abspath(sys.base_prefix)
_zeus_temp_dir = os.path.abspath(tempfile.gettempdir())
_zeus_env_temp = os.path.abspath(os.environ.get('TEMP', '')) if os.environ.get('TEMP') else None
_zeus_env_tmp = os.path.abspath(os.environ.get('TMP', '')) if os.environ.get('TMP') else None

_zeus_history_dir = os.environ.get('ZEUS_BROWSER_HISTORY_DIR', '')
_zeus_task_id = os.environ.get('ZEUS_TASK_ID', '')
_zeus_session_id = os.environ.get('ZEUS_BROWSER_SESSION_ID', '')

_zeus_allowed_prefixes = [
    os.path.normcase(_zeus_workspace),
    os.path.normcase(_zeus_sys_prefix),
    os.path.normcase(_zeus_sys_base),
    os.path.normcase(_zeus_temp_dir),
]
if _zeus_env_temp:
    _zeus_allowed_prefixes.append(os.path.normcase(_zeus_env_temp))
if _zeus_env_tmp:
    _zeus_allowed_prefixes.append(os.path.normcase(_zeus_env_tmp))
if _zeus_history_dir:
    _zeus_allowed_prefixes.append(os.path.normcase(os.path.abspath(_zeus_history_dir)))

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

def _zeus_ipc_send(msg):
    f = _get_ipc_socket()
    if not f:
        return None
    try:
        f.write(json.dumps(msg) + '\n')
        f.flush()
        resp_line = f.readline()
        if resp_line:
            return json.loads(resp_line)
    except Exception:
        pass
    return None

def _ask_gatekeeper(req):
    resp = _zeus_ipc_send(req)
    if resp and isinstance(resp, dict):
        return resp.get('status') == 'allow'
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
        if isinstance(address, tuple) and len(address) >= 1:
            host = address[0]
            if isinstance(host, str) and host not in ('127.0.0.1', 'localhost', '::1'):
                if host not in _zeus_approved_hosts:
                    req = {"type": "network", "url": host}
                    if not _ask_gatekeeper(req):
                        raise PermissionError(f'Zeus Gatekeeper DENIED connection to {host}')
                    _zeus_approved_hosts.add(host)

    if event in ('os.system', 'subprocess.Popen'):
        cmd_arg = args[0] if len(args) > 0 else ''
        if (cmd_arg is None or cmd_arg == '') and len(args) > 1:
            cmd_arg = args[1]
        cmd_str = ''
        if isinstance(cmd_arg, (list, tuple)):
            cmd_str = ' '.join(str(x) for x in cmd_arg)
        elif isinstance(cmd_arg, (str, bytes)):
            cmd_str = cmd_arg.decode('utf-8', errors='replace') if isinstance(cmd_arg, bytes) else str(cmd_arg)
        cmd_str_clean = cmd_str.strip()
        if not cmd_str_clean:
            return
        cmd_lower = cmd_str_clean.lower()
        if 'playwright' in cmd_lower and ('driver' in cmd_lower or 'node' in cmd_lower):
            return
        req = {"type": "command", "command": cmd_str_clean}
        if not _ask_gatekeeper(req):
            raise PermissionError(f'Zeus Gatekeeper DENIED process execution: {cmd_str_clean}')

    if event == 'ctypes.dlopen':
        raise PermissionError('Loading native dynamic libraries is disabled in this sandbox for security reasons.')

    if event == 'open':
        path = args[0]
        if isinstance(path, (str, bytes, os.PathLike)):
            try:
                raw_path = os.fspath(path)
                if isinstance(raw_path, bytes):
                    raw_path = raw_path.decode('utf-8', errors='replace')
                abs_path = os.path.abspath(raw_path)
                norm_path = os.path.normcase(abs_path)
                for pfx in _zeus_allowed_prefixes:
                    if norm_path.startswith(pfx):
                        return
                mode = args[1] if len(args) > 1 else 'r'
                action = 'write' if ('w' in mode or 'a' in mode or '+' in mode) else 'read'
                req = {"type": "file", "path": abs_path, "action": action}
                if not _ask_gatekeeper(req):
                    raise PermissionError(f'Zeus Gatekeeper DENIED {action} access to {abs_path}')
            except (PermissionError, SystemExit):
                raise
            except Exception:
                pass

sys.addaudithook(_zeus_audit_hook)

# --- Browser Session Tracking & Capture State ---
_zeus_session_started = False
_zeus_step_counter = 0
_zeus_steps = []
_zeus_start_time = None
_zeus_last_url = ""
_zeus_current_page = None

def _zeus_ensure_session_started(page=None):
    global _zeus_session_started, _zeus_start_time, _zeus_last_url, _zeus_current_page
    if page:
        _zeus_current_page = page
    if not _zeus_session_started:
        _zeus_session_started = True
        _zeus_start_time = int(time.time() * 1000)
        if _zeus_history_dir:
            try:
                os.makedirs(_zeus_history_dir, exist_ok=True)
            except Exception:
                pass
        curr_url = ""
        try:
            if page:
                curr_url = page.url or ""
        except Exception:
            pass
        _zeus_last_url = curr_url
        if _zeus_session_id:
            _zeus_ipc_send({
                "type": "browser_session_started",
                "session_id": _zeus_session_id,
                "timestamp": _zeus_start_time,
                "initial_url": curr_url
            })

def _zeus_extract_bounding_box(page, selector):
    if not page or not selector:
        return None
    try:
        loc = page.locator(selector).first
        box = loc.bounding_box(timeout=1000)
        if box:
            return {
                "x": float(box.get("x", 0)),
                "y": float(box.get("y", 0)),
                "width": float(box.get("width", 0)),
                "height": float(box.get("height", 0))
            }
    except Exception:
        pass
    return None

def _zeus_record_step(page, action_name, selector=None, value=None, pre_box=None):
    global _zeus_step_counter, _zeus_last_url, _zeus_current_page
    if not _zeus_history_dir or not _zeus_session_id:
        return
    if page:
        _zeus_current_page = page
    elif _zeus_current_page:
        page = _zeus_current_page
    _zeus_ensure_session_started(page)
    _zeus_step_counter += 1
    ts = int(time.time() * 1000)
    curr_url = ""
    try:
        if page:
            curr_url = page.url or ""
        if not curr_url and action_name == "goto" and selector:
            curr_url = selector
        if not curr_url:
            curr_url = _zeus_last_url
        if curr_url:
            _zeus_last_url = curr_url
    except Exception:
        curr_url = _zeus_last_url
    
    shot_filename = f"{_zeus_step_counter}_{action_name}.png"
    shot_path = os.path.join(_zeus_history_dir, shot_filename)
    try:
        if page:
            page.screenshot(path=shot_path)
    except Exception:
        shot_path = ""

    step_info = {
        "step": _zeus_step_counter,
        "action": action_name,
        "target": selector,
        "value": value,
        "url": curr_url,
        "timestamp": ts,
        "bounding_box": pre_box,
        "screenshot_path": shot_filename
    }
    _zeus_steps.append(step_info)
    _zeus_write_manifest()

    shot_b64 = ""
    if shot_path and os.path.exists(shot_path):
        try:
            with open(shot_path, "rb") as sf:
                shot_b64 = "data:image/png;base64," + base64.b64encode(sf.read()).decode("ascii")
        except Exception:
            pass

    _zeus_ipc_send({
        "type": "browser_live_frame",
        "session_id": _zeus_session_id,
        "step": _zeus_step_counter,
        "action": action_name,
        "target": selector,
        "value": value,
        "url": curr_url,
        "timestamp": ts,
        "screenshot_path": shot_b64 if shot_b64 else shot_path,
        "screenshot_base64": shot_b64,
        "bounding_box": pre_box
    })

def _zeus_write_manifest():
    if not _zeus_history_dir or not _zeus_session_id:
        return
    try:
        now = int(time.time() * 1000)
        start_ts = _zeus_start_time or now
        manifest = {
            "session_id": _zeus_session_id,
            "task_id": _zeus_task_id,
            "started_at": start_ts,
            "completed_at": now,
            "duration_ms": max(0, now - start_ts),
            "final_url": _zeus_last_url,
            "total_steps": len(_zeus_steps),
            "steps": _zeus_steps
        }
        manifest_path = os.path.join(_zeus_history_dir, "manifest.json")
        with open(manifest_path, "w", encoding="utf-8") as mf:
            json.dump(manifest, mf, indent=2)
    except Exception:
        pass

def _zeus_finalize_session():
    global _zeus_session_started
    if not _zeus_session_started or len(_zeus_steps) == 0:
        return
    _zeus_session_started = False
    _zeus_write_manifest()
    now = int(time.time() * 1000)
    start_ts = _zeus_start_time or now
    if _zeus_session_id:
        _zeus_ipc_send({
            "type": "browser_session_completed",
            "session_id": _zeus_session_id,
            "total_steps": len(_zeus_steps),
            "duration_ms": max(0, now - start_ts),
            "final_url": _zeus_last_url,
            "timestamp": now
        })

atexit.register(_zeus_finalize_session)

try:
    import playwright.sync_api
    import random
    
    _zeus_original_click = playwright.sync_api.Page.click
    _zeus_original_fill = playwright.sync_api.Page.fill
    _zeus_original_press = getattr(playwright.sync_api.Page, "press", None)
    _zeus_original_goto = playwright.sync_api.Page.goto
    _zeus_original_close = playwright.sync_api.Page.close
    _zeus_original_connect = playwright.sync_api.BrowserType.connect_over_cdp

    def _zeus_patched_click(self, selector, **kwargs):
        box = _zeus_extract_bounding_box(self, selector)
        _zeus_record_step(self, "click", selector=selector, pre_box=box)
        return _zeus_original_click(self, selector, **kwargs)
        
    def _zeus_patched_fill(self, selector, value, **kwargs):
        box = _zeus_extract_bounding_box(self, selector)
        res = _zeus_original_fill(self, selector, value, **kwargs)
        _zeus_record_step(self, "fill", selector=selector, value=str(value), pre_box=box)
        return res

    def _zeus_patched_press(self, selector, key, **kwargs):
        box = _zeus_extract_bounding_box(self, selector)
        res = None
        if _zeus_original_press:
            res = _zeus_original_press(self, selector, key, **kwargs)
        _zeus_record_step(self, "press", selector=selector, value=str(key), pre_box=box)
        return res

    def _zeus_stealth_init(page):
        stealth_js = """
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        if (!window.chrome) {
            window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
        }
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
        });
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en']
        });
        """
        try:
            page.add_init_script(stealth_js)
        except Exception:
            pass

    def _zeus_patched_connect(self, endpoint_url, **kwargs):
        if isinstance(endpoint_url, str) and endpoint_url.startswith('ws://127.0.0.1:') and '/devtools/' not in endpoint_url:
            endpoint_url = 'http://' + endpoint_url[5:]
        browser = _zeus_original_connect(self, endpoint_url, **kwargs)
        for context in browser.contexts:
            for page in context.pages:
                _zeus_stealth_init(page)
            context.on("page", lambda p: _zeus_stealth_init(p))
        return browser

    def _zeus_patched_goto(self, url, **kwargs):
        req = {"type": "browser", "action": "goto", "url": url}
        if not _ask_gatekeeper(req):
            raise PermissionError(f'Zeus Gatekeeper DENIED browser navigation to {url}')
        _zeus_stealth_init(self)
        _zeus_ensure_session_started(self)
        res = _zeus_original_goto(self, url, **kwargs)
        _zeus_record_step(self, "goto", selector=url)
        return res
        
    def _zeus_patched_close(self, **kwargs):
        req = {"type": "browser", "action": "close"}
        if not _ask_gatekeeper(req):
            raise PermissionError('Zeus Gatekeeper DENIED closing the browser tab')
        _zeus_finalize_session()
        return _zeus_original_close(self, **kwargs)

    playwright.sync_api.Page.click = _zeus_patched_click
    playwright.sync_api.Page.fill = _zeus_patched_fill
    if _zeus_original_press:
        playwright.sync_api.Page.press = _zeus_patched_press
    playwright.sync_api.Page.goto = _zeus_patched_goto
    playwright.sync_api.Page.close = _zeus_patched_close
    playwright.sync_api.BrowserType.connect_over_cdp = _zeus_patched_connect

    # Patch Locator if available
    try:
        _zeus_orig_loc_click = playwright.sync_api.Locator.click
        def _zeus_patched_loc_click(self, **kwargs):
            sel = getattr(self, "_selector", str(self))
            box = None
            try:
                raw_box = self.bounding_box(timeout=1000)
                if raw_box:
                    box = {
                        "x": float(raw_box.get("x", 0)),
                        "y": float(raw_box.get("y", 0)),
                        "width": float(raw_box.get("width", 0)),
                        "height": float(raw_box.get("height", 0))
                    }
            except Exception:
                pass
            _zeus_record_step(self.page, "click", selector=sel, pre_box=box)
            return _zeus_orig_loc_click(self, **kwargs)
        playwright.sync_api.Locator.click = _zeus_patched_loc_click

        _zeus_orig_loc_fill = playwright.sync_api.Locator.fill
        def _zeus_patched_loc_fill(self, value, **kwargs):
            sel = getattr(self, "_selector", str(self))
            box = None
            try:
                raw_box = self.bounding_box(timeout=1000)
                if raw_box:
                    box = {
                        "x": float(raw_box.get("x", 0)),
                        "y": float(raw_box.get("y", 0)),
                        "width": float(raw_box.get("width", 0)),
                        "height": float(raw_box.get("height", 0))
                    }
            except Exception:
                pass
            res = _zeus_orig_loc_fill(self, value, **kwargs)
            _zeus_record_step(self.page, "fill", selector=sel, value=str(value), pre_box=box)
            return res
        playwright.sync_api.Locator.fill = _zeus_patched_loc_fill
    except Exception:
        pass

    try:
        _zeus_orig_kb_press = getattr(playwright.sync_api.Keyboard, "press", None)
        if _zeus_orig_kb_press:
            def _zeus_patched_kb_press(self, key, **kwargs):
                res = _zeus_orig_kb_press(self, key, **kwargs)
                k_lower = str(key).lower()
                if k_lower in ("enter", "return", "tab", "escape"):
                    _zeus_record_step(_zeus_current_page, "press", value=str(key))
                return res
            playwright.sync_api.Keyboard.press = _zeus_patched_kb_press
    except Exception:
        pass

    def human_type(page, selector, text):
        box = _zeus_extract_bounding_box(page, selector)
        _zeus_record_step(page, "human_type", selector=selector, value=str(text), pre_box=box)
        page.focus(selector)
        for char in text:
            page.keyboard.type(char)
            time.sleep(random.uniform(0.04, 0.12))

    def human_click(page, selector):
        box = _zeus_extract_bounding_box(page, selector)
        _zeus_record_step(page, "human_click", selector=selector, pre_box=box)
        if box:
            x = box['x'] + box['width'] * random.uniform(0.3, 0.7)
            y = box['y'] + box['height'] * random.uniform(0.3, 0.7)
            page.mouse.move(x, y, steps=random.randint(5, 12))
            time.sleep(random.uniform(0.05, 0.15))
            page.mouse.down()
            time.sleep(random.uniform(0.04, 0.09))
            page.mouse.up()
        else:
            page.click(selector)

except Exception:
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
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .env("ZEUS_IPC_PORT", ipc_port.to_string());
        
    if let Some(ref tid) = tid_opt {
        command.env("ZEUS_TASK_ID", tid);
        command.env("ZEUS_BROWSER_SESSION_ID", &session_id);
        if let Some(ref hdir) = history_dir {
            command.env("ZEUS_BROWSER_HISTORY_DIR", hdir);
        }
    }

    if let Some(port) = browser_port {
        command.env("ZEUS_BROWSER_WS_ENDPOINT", format!("http://127.0.0.1:{}", port));
        command.env("ZEUS_BROWSER_HTTP_ENDPOINT", format!("http://127.0.0.1:{}", port));
    }

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start Python (`{}`): {}", interpreter, e))?;

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

    let timeout_duration = std::time::Duration::from_secs(timeout_secs);
    let mut elapsed_active = std::time::Duration::ZERO;
    let mut last_tick = tokio::time::Instant::now();

    let status = loop {
        tokio::select! {
            res = child.wait() => {
                match res {
                    Ok(exit_status) => break Some(exit_status),
                    Err(e) => return Err(format!("Failed to wait on the Python process: {}", e)),
                }
            }
            _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {
                let now = tokio::time::Instant::now();
                let delta = now.duration_since(last_tick);
                last_tick = now;

                // Check if this task currently has a pending Gatekeeper approval
                let has_pending_approval = if let (Some(ref app), Some(ref tid)) = (app_handle.as_ref(), task_id.as_ref()) {
                    let state = app.state::<AppState>();
                    let is_pending = if let Ok(conn) = state.db.lock() {
                        conn.query_row(
                            "SELECT 1 FROM messages WHERE task_id = ?1 AND kind = 'approval' AND json_extract(content, '$.status') = 'pending' LIMIT 1",
                            rusqlite::params![tid],
                            |_| Ok(true)
                        ).unwrap_or(false)
                    } else {
                        false
                    };
                    is_pending
                } else {
                    false
                };

                // Only accumulate active execution time if NOT waiting on human approval!
                if !has_pending_approval {
                    elapsed_active += delta;
                    if elapsed_active >= timeout_duration {
                        timed_out = true;
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                        break None;
                    }
                }
            }
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

use tauri::{Emitter, Manager};
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

        if req_type == "browser_session_started" {
            let session_id = req["session_id"].as_str().unwrap_or("").to_string();
            let initial_url = req["initial_url"].as_str().unwrap_or("").to_string();
            let timestamp = req["timestamp"].as_u64().unwrap_or(0);

            let content = serde_json::json!({
                "session_id": session_id,
                "initial_url": initial_url,
                "timestamp": timestamp,
                "status": "active"
            }).to_string();

            let mut msg = crate::chat::new_message(
                &task_id,
                "event",
                "browser_session_started",
                content,
                None,
                None,
                true,
            );
            let _ = crate::chat::persist_and_emit(&state, &app_handle, &task_id, &mut msg);

            let res = serde_json::json!({ "status": "ok" });
            let _ = writer.write_all(format!("{}\n", res).as_bytes()).await;
            let _ = writer.flush().await;
            line.clear();
            continue;
        }

        if req_type == "browser_live_frame" {
            let _ = app_handle.emit("browser_live_frame", &req);

            let res = serde_json::json!({ "status": "ok" });
            let _ = writer.write_all(format!("{}\n", res).as_bytes()).await;
            let _ = writer.flush().await;
            line.clear();
            continue;
        }

        if req_type == "browser_session_completed" {
            let session_id = req["session_id"].as_str().unwrap_or("").to_string();
            let total_steps = req["total_steps"].as_u64().unwrap_or(0);
            let duration_ms = req["duration_ms"].as_u64().unwrap_or(0);
            let final_url = req["final_url"].as_str().unwrap_or("").to_string();
            let timestamp = req["timestamp"].as_u64().unwrap_or(0);

            let content = serde_json::json!({
                "session_id": session_id,
                "total_steps": total_steps,
                "duration_ms": duration_ms,
                "final_url": final_url,
                "timestamp": timestamp,
                "status": "completed"
            }).to_string();

            let mut msg = crate::chat::new_message(
                &task_id,
                "event",
                "browser_session_completed",
                content,
                None,
                None,
                true,
            );
            let _ = crate::chat::persist_and_emit(&state, &app_handle, &task_id, &mut msg);
            let _ = app_handle.emit("browser_session_completed", &req);

            let res = serde_json::json!({ "status": "ok" });
            let _ = writer.write_all(format!("{}\n", res).as_bytes()).await;
            let _ = writer.flush().await;
            line.clear();
            continue;
        }
        
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
                    crate::orchestrator::Directive::RunCommand { command: req["command"].as_str().unwrap_or("").to_string(), cwd: None }
                } else {
                    crate::orchestrator::Directive::ReadFile {
                        path: req["path"].as_str().unwrap_or("").to_string(),
                        start_line: req["start_line"].as_u64().map(|v| v as usize),
                        end_line: req["end_line"].as_u64().map(|v| v as usize),
                        limit: req["limit"].as_u64().map(|v| v as usize),
                    }
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
                let _approval_timestamp = approval_message.created_at.clone();

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
                            break "allow".to_string();
                        } else if s == "denied" {
                            break "deny".to_string();
                        }
                    }
                }
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
