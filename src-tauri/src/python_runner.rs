//! Runs Python actions inside the task workspace with a timeout, capturing
//! stdout/stderr and the exit code. The interpreter is resolved once and the
//! exact command is reported in diagnostics so users can fix PATH issues.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, atomic::{AtomicU64, Ordering}};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

tokio::task_local! {
    static BROWSER_SCRIPT_BUDGET: Arc<AtomicU64>;
}

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
        let mut probe = std::process::Command::new(candidate);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            probe.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        }
        let ok = probe
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
    run_python_action_scoped(app_handle,task_id,workspace,code,timeout_secs,browser_port,None).await
}

#[derive(Clone)]
pub struct BrowserScriptContext {
    pub run_id:String,
    pub caller:String,
    pub cancel:tokio_util::sync::CancellationToken,
}
struct IpcOwner{stop:tokio_util::sync::CancellationToken,listener:Option<tokio::task::JoinHandle<()>>,app:Option<tauri::AppHandle>,context:Option<BrowserScriptContext>}
impl Drop for IpcOwner{fn drop(&mut self){
    self.stop.cancel();if let Some(listener)=self.listener.take(){listener.abort();}
    if let (Some(app),Some(context))=(&self.app,&self.context){let state=app.state::<AppState>();
        if let Some(task)=self.context.as_ref().and_then(|_|state.db.lock().ok().and_then(|conn|conn.query_row("SELECT task_id FROM runs WHERE id=?1",[&context.run_id],|r|r.get::<_,String>(0)).ok())){
            let _=crate::managed_browser::invalidate_approvals(&state,app,&task,&context.run_id,Some(&context.caller));
        }
        state.browser_manager.managed.release(&context.run_id,&context.caller);}
}}

pub async fn run_python_action_scoped(
    app_handle:Option<tauri::AppHandle>,task_id:Option<String>,workspace:&Path,code:&str,
    timeout_secs:u64,_browser_port:Option<u16>,browser_context:Option<BrowserScriptContext>,
)->Result<ActionOutcome,String>{
    let interpreter = detect_python().ok_or_else(|| {
        "No Python interpreter found (tried `python`, `python3`, `py`). Install Python 3.11 and make sure it is on your PATH.".to_string()
    })?;

    std::fs::create_dir_all(workspace)
        .map_err(|e| format!("Failed to create the task workspace: {}", e))?;

    let tid_opt = task_id.clone();
    // The outer script clock excludes human approval waits. Share its remaining
    // active budget with IPC so a locator can fail before the script is killed.
    let script_budget=Arc::new(AtomicU64::new(timeout_secs.saturating_mul(1000)));
    let ipc_token=format!("{}{}",crate::db::new_id(),crate::db::new_id());
    let ipc_stop=browser_context.as_ref().map(|context|context.cancel.child_token()).unwrap_or_default();
    let mut ipc_owner=IpcOwner{stop:ipc_stop.clone(),listener:None,app:app_handle.clone(),context:browser_context.clone()};
    // Setup IPC server if we have context
    let mut ipc_port = 0;
    if let (Some(ref app), Some(ref tid)) = (&app_handle, &task_id) {
        if let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:0").await {
            ipc_port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
            let app_clone = app.clone();
            let tid_clone = tid.clone();
            let context=browser_context.clone();let token=ipc_token.clone();let stop=ipc_stop.clone();let budget=script_budget.clone();
            ipc_owner.listener=Some(tokio::spawn(async move {
                let mut connections=tokio::task::JoinSet::new();
                loop{tokio::select!{
                    _=stop.cancelled()=>break,
                    result=listener.accept()=>{
                        let Ok((stream,_))=result else{break};
                        if connections.len()>=16{drop(stream);continue;}
                        let app=app_clone.clone();let task=tid_clone.clone();let context=context.clone();let token=token.clone();let stop=stop.clone();let budget=budget.clone();
                        connections.spawn(async move{tokio::select!{
                            _=stop.cancelled()=>{},
                            _=handle_ipc_connection(stream,app,task,context,token,budget)=>{},
                        }});
                    },
                    _=connections.join_next(),if !connections.is_empty()=>{},
                }}
            }));
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

_zeus_task_id = os.environ.get('ZEUS_TASK_ID', '')

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
        msg['ipc_token'] = os.environ.get('ZEUS_IPC_TOKEN', '')
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
            raise PermissionError('Use zeus_browser.call instead of launching an unmanaged Playwright driver')
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
"#;

    let client=if browser_context.is_some(){
        let source=serde_json::to_string(include_str!("../browser_service/client.py")).map_err(|e|e.to_string())?;
        format!("\nimport types as _zeus_types\n_zeus_client = _zeus_types.ModuleType('zeus_browser')\n_zeus_client.__dict__['_send'] = _zeus_ipc_send\nexec({source}, _zeus_client.__dict__)\nsys.modules['zeus_browser'] = _zeus_client\n")
    }else{String::new()};
    let final_code = format!("{}\n{}\n{}", sandbox_preamble,client, code);
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
    command.env("ZEUS_IPC_TOKEN",&ipc_token).env("ZEUS_MANAGED_SCRIPT",if browser_context.is_some(){"1"}else{"0"});
    if browser_context.is_some(){command.env_remove("ZEUS_BROWSER_WS_ENDPOINT").env_remove("ZEUS_BROWSER_HTTP_ENDPOINT").env_remove("ZEUS_BROWSER_HISTORY_DIR");}
        
    if let Some(ref tid) = tid_opt { command.env("ZEUS_TASK_ID",tid); }
    command.env_remove("ZEUS_BROWSER_WS_ENDPOINT").env_remove("ZEUS_BROWSER_HTTP_ENDPOINT").env_remove("ZEUS_BROWSER_HISTORY_DIR").env_remove("ZEUS_BROWSER_SESSION_ID");

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);

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
                    script_budget.store(timeout_secs.saturating_mul(1000).saturating_sub(elapsed_active.as_millis().min(u64::MAX as u128) as u64),Ordering::Relaxed);
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

use tauri::Manager;
use crate::db::AppState;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

async fn bounded_ipc_line<R:tokio::io::AsyncBufRead+Unpin>(reader:&mut R,line:&mut String)->Result<usize,std::io::Error>{
    let mut bytes=Vec::new();
    loop{
        let chunk=reader.fill_buf().await?;if chunk.is_empty(){return Ok(0);}
        let count=chunk.iter().position(|byte|*byte==b'\n').map(|n|n+1).unwrap_or(chunk.len());
        if bytes.len()+count>1024*1024{return Err(std::io::Error::new(std::io::ErrorKind::InvalidData,"IPC frame limit"));}
        let done=chunk[count-1]==b'\n';bytes.extend_from_slice(&chunk[..count]);reader.consume(count);if done{break;}
    }
    let len=bytes.len();*line=String::from_utf8(bytes).map_err(|e|std::io::Error::new(std::io::ErrorKind::InvalidData,e))?;Ok(len)
}

/// Reserve room for browser boundary captures, IPC and interpreter cleanup.
/// This bounds defaults AND explicit timeouts; it does not shorten native
/// browser actions or automatically retry a potentially committed effect.
fn bound_browser_timeout(params:&mut serde_json::Value,remaining_ms:u64)->Result<(),String>{
    let requested=match params.get("timeout_ms"){
        None=>30000,
        Some(value)=>value.as_u64().filter(|value|(100..=60000).contains(value))
            .ok_or("BROWSER_ARGUMENT: timeout_ms must be an integer from 100 to 60000")?,
    };
    let reserve=(remaining_ms/3).clamp(1000,8000);
    let available=remaining_ms.saturating_sub(reserve);
    if available<100 {
        return Err("BROWSER_SCRIPT_BUDGET: insufficient active script budget for another browser action; no action was dispatched. Return control and use a new script or browser_action.".into());
    }
    params.as_object_mut().ok_or("BROWSER_ARGUMENT: params must be an object")?
        .insert("timeout_ms".into(),serde_json::json!(requested.min(available)));
    Ok(())
}

/// Apply the execution limit after policy/startup/queue waits, without changing
/// the canonical requested action or its idempotency/authorization hash.
pub(crate) fn browser_execution_params(params:&serde_json::Value)->Result<serde_json::Value,String>{
    let mut execution=params.clone();
    if let Ok(remaining)=BROWSER_SCRIPT_BUDGET.try_with(|budget|budget.load(Ordering::Relaxed)){
        bound_browser_timeout(&mut execution,remaining)?;
    }
    Ok(execution)
}

async fn handle_ipc_connection(
    mut stream: tokio::net::TcpStream,
    app_handle: tauri::AppHandle,
    task_id: String,
    browser_context:Option<BrowserScriptContext>,
    ipc_token:String,
    script_budget:Arc<AtomicU64>,
) {
    let (reader, mut writer) = stream.split();
    let mut reader = tokio::io::BufReader::new(reader);
    let mut line = String::new();

    while let Ok(bytes) = bounded_ipc_line(&mut reader,&mut line).await {
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

        if browser_context.is_some()&&req["ipc_token"].as_str()!=Some(&ipc_token){
            let _=writer.write_all(b"{\"ok\":false,\"error\":{\"code\":\"BROWSER_AUTH\",\"message\":\"Invalid client token\"}}\n").await;break;
        }
        if let Some(context)=&browser_context{
            if req_type=="managed_browser"{
                let response=match serde_json::from_value::<crate::managed_browser::BrowserCommand>(req["command"].clone()){
                    Ok(command)=>match crate::evaluation::directive(){
                        Ok(())=>match BROWSER_SCRIPT_BUDGET.scope(script_budget.clone(),Box::pin(crate::managed_browser::execute(&state,&app_handle,&task_id,&context.run_id,&context.cancel,&context.caller,command))).await{
                            Ok(value)=>value,Err(error)=>serde_json::json!({"ok":false,"error":{"code":error.split(':').next().unwrap_or("BROWSER_ERROR"),"message":error}}),
                        },
                        Err(error)=>serde_json::json!({"ok":false,"error":{"code":error.split(':').next().unwrap_or("BROWSER_ERROR"),"message":error}}),
                    },
                    Err(_)=>serde_json::json!({"ok":false,"error":{"code":"BROWSER_ARGUMENT","message":"Invalid browser command"}}),
                };
                let _=writer.write_all(format!("{}\n",response).as_bytes()).await;let _=writer.flush().await;line.clear();continue;
            }
            if matches!(req_type,"browser_session_started"|"browser_live_frame"|"browser_session_completed"){
                let _=writer.write_all(b"{\"ok\":false,\"error\":{\"code\":\"BROWSER_UNTRUSTED_EVENT\",\"message\":\"Actor events are not browser evidence\"}}\n").await;line.clear();continue;
            }
        }

        if matches!(req_type,"browser_session_started"|"browser_live_frame"|"browser_session_completed") {
            let _=writer.write_all(b"{\"ok\":false,\"error\":{\"code\":\"BROWSER_UNTRUSTED_EVENT\",\"message\":\"Actor events are not browser evidence\"}}\n").await;line.clear();continue;
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
                let conn = state.db.lock().unwrap();
                crate::gatekeeper::evaluate_command_action(&conn, &task_id, &cmd_str).unwrap_or(crate::gatekeeper::PermissionVerdict::Ask)
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

    #[test]
    fn browser_command_timeout_fits_the_remaining_active_script_budget() {
        let mut default=serde_json::json!({});
        bound_browser_timeout(&mut default,30000).unwrap();
        assert_eq!(default["timeout_ms"],22000);
        let mut short=serde_json::json!({"timeout_ms":500});
        bound_browser_timeout(&mut short,30000).unwrap();
        assert_eq!(short["timeout_ms"],500);
        let mut explicit=serde_json::json!({"timeout_ms":60000});
        bound_browser_timeout(&mut explicit,4000).unwrap();
        assert_eq!(explicit["timeout_ms"],2667);
        assert!(bound_browser_timeout(&mut default,1000).unwrap_err().starts_with("BROWSER_SCRIPT_BUDGET:"));
        for invalid in [serde_json::json!(0),serde_json::json!(true),serde_json::json!(1.5),serde_json::json!(60001)] {
            assert!(bound_browser_timeout(&mut serde_json::json!({"timeout_ms":invalid}),30000).unwrap_err().starts_with("BROWSER_ARGUMENT:"));
        }
    }

    #[tokio::test]
    async fn browser_execution_limits_preserve_canonical_params_and_do_not_leak_between_scripts() {
        let requested=serde_json::json!({"timeout_ms":60000});
        assert_eq!(browser_execution_params(&requested).unwrap(),requested);
        let first=BROWSER_SCRIPT_BUDGET.scope(Arc::new(AtomicU64::new(4000)),async{browser_execution_params(&requested).unwrap()});
        let second=BROWSER_SCRIPT_BUDGET.scope(Arc::new(AtomicU64::new(30000)),async{browser_execution_params(&requested).unwrap()});
        let (first,second)=tokio::join!(first,second);
        assert_eq!(first["timeout_ms"],2667);
        assert_eq!(second["timeout_ms"],22000);
        assert_eq!(requested["timeout_ms"],60000);
        assert_eq!(browser_execution_params(&requested).unwrap(),requested);
    }

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
        // The runner deliberately allows the OS temp directory. Use a separate,
        // unique target in this checkout to exercise the actual outside-prefix check.
        let target = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target")
            .join(format!("zeus_escape_{}.txt", crate::db::new_id()));
        let code = format!("with open({}, 'w', encoding='utf-8') as f: f.write('blocked')",
            serde_json::to_string(&target.to_string_lossy()).unwrap());
        let outcome = run_python_action(None, None, &workspace, &code, 30, None).await.expect("runner failed");
        
        let escaped = target.exists();
        if escaped { let _ = std::fs::remove_file(&target); }
        assert!(!escaped, "outside-prefix file was created");
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
