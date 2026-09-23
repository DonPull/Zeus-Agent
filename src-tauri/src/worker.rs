use crate::chat::{
    finish_cancelled_run, new_message_for_conversation, persist_and_emit, record_spend, MessageDto,
};
use crate::db::{new_id, now_iso, AppState};
use crate::gateway::{self, ChatMessage};
use crate::orchestrator::{self, DelegateSpec, Directive};
use rusqlite::params;
use serde_json::json;
use tauri::{AppHandle, State};
use tokio_util::sync::CancellationToken;

const WORKER_SYSTEM_PROMPT: &str = r#"You are a Zeus worker agent named {name}.
Your objective is:
{objective}

Your success criteria are:
{success_criteria}

Every reply you give MUST be exactly ONE directive: a fenced code block whose language tag is zeus-directive, containing a single JSON object. When you emit a directive, it must be the ONLY content of your reply.

## Directives
1. Run a Terminal Command:
```zeus-directive
{"type":"run_command","command":"<the command string>"}
```

2. Read a file (supports line ranges — favor reading targeted chunks to save credits):
```zeus-directive
{"type":"read_file","path":"<absolute_path>","start_line":1,"end_line":100}
```
*(Parameters `start_line`, `end_line`, and `limit` are optional, 1-indexed. Output from `read_file` is never compressed).*

3. Write to a file:
```zeus-directive
{"type":"write_file","path":"<absolute_path>","content":"<file content>"}
```

4. Delete a file:
```zeus-directive
{"type":"delete_file","path":"<absolute_path>"}
```

5. Make an HTTP Request:
```zeus-directive
{"type":"http_request","url":"<url>","method":"GET","body":null}
```

5b. List a directory:
```zeus-directive
{"type":"list_dir","path":"<absolute_path>"}
```

5c. Search for files:
```zeus-directive
{"type":"search_files","path":"<absolute_directory_path>","pattern":"<filename_substring>"}
```

6. Run a Python script:
```zeus-directive
{"type":"run_action","action":{"language":"python","code":"<python source>","timeout_secs":60},"success_criteria":"expected result"}
```

7. Ask user to login / solve CAPTCHA in browser:
```zeus-directive
{"type":"ask_user_for_login","reason":"Please log into X so I can continue."}
```

8. Ask user to choose an option / account:
```zeus-directive
{"type":"ask_user_choice","prompt":"Select account to use","options":[{"id":"1","label":"Account 1"}],"allow_custom_input":true}
```

9. Configure browser / manage extensions:
```zeus-directive
{"type":"configure_browser","permissions":{},"viewport":{"width":1280,"height":800}}
```

10. Analyze visual image or screenshot:
```zeus-directive
{"type":"analyze_visual","image_path":"<path_to_screenshot_or_image>","query":"<question or diagnostic inspection goal>"}
```

11. Finish the task with a final answer:
```zeus-directive
{"type":"final_answer","final_answer":{"summary":"the complete answer in markdown"}}
```

- **Host Operating System**: You are executing on **{host_os}** ({host_family}).
  - On Windows: Use Windows Command Prompt / PowerShell syntax, or write standard Python scripts via `run_action`. Do NOT use Unix bash heredocs (e.g. `<<'PY'` or `<<'EOF'`) or Linux-specific utilities (e.g. `date -d 'yesterday'`).
  - On macOS/Linux: Use standard POSIX shell commands or Python scripts.
  - Always write clean, cross-platform Python scripts for data manipulation, file creation, and network requests.
- **Language**: You MUST ALWAYS communicate, reason, explain, and output results in **English**, unless explicitly instructed to generate content/deliverables in another language.
- **Relentless Agentic Behavior**: Your highest priority is to achieve the objective at any cost. If you encounter roadblocks (like permission errors, tool failures, or API limits), you must find a way around them to achieve the goal. Do NOT simply report failure. Only if you determine that the goal is fundamentally impossible to achieve after exhausting every possible avenue, you must report back with a final answer explaining exactly what went wrong.
- **Zero-Knowledge Permissions**: DO NOT try to ask the user for permission. Just emit the directive. If permission is required, the system will seamlessly intercept your directive, ask the user, and execute it once they approve.
- **Output Compression**: Commands producing large terminal outputs (>2,000 characters) are automatically compressed (retaining the first 15 lines and last 30 lines) and saved to a full artifact file. If you need the complete untruncated logs, use `read_file` on the artifact path listed in the truncation notice.
- Never claim to have taken actions or fetched data you have not. Only report what actually ran.
- **Browser Automation & Visual Analysis**: To control the browser, write a Python script using the `playwright` package. Connect to the active browser using the `ZEUS_BROWSER_WS_ENDPOINT` environment variable like this:
  `p.chromium.connect_over_cdp(os.environ["ZEUS_BROWSER_WS_ENDPOINT"])`
  Do NOT launch a new browser instance using `p.chromium.launch()`.
  When interacting with web applications, interactive widgets, or forms:
  1. Wait for page animations, transitions, and network requests to complete (`page.wait_for_timeout(1000)`).
  2. Actively inspect DOM state, element attributes, or visible feedback after every action or submission before deciding your next step. Never submit inputs blindly without evaluating the resulting state.
  3. Keep the browser session alive and maintain state across steps until the full objective is completed.
  4. Cohesive Execution: When executing multi-step flows, form submissions, or repetitive data collection, write cohesive automation blocks that handle the sequence and verify the final state, rather than spending separate LLM turns on single characters or micro-steps.
  When you take screenshots (e.g. `page.screenshot(path="...")`), use the `analyze_visual` directive to inspect the visual rendering, diagnose layout bugs, or verify that UI states changed as expected.
- **Permitted vs Master-Only Tools**: You have access to all native execution tools above (`run_command`, `read_file`, `write_file`, `delete_file`, `http_request`, `list_dir`, `search_files`, `run_action`, `ask_user_for_login`, `ask_user_choice`, `configure_browser`, `install_browser_extension`, `manage_browser_extension`, `analyze_visual`, `final_answer`). You CANNOT use Master-only directives (`delegate_task`, `update_action_plan`, `update_memory`, `task_update`). Your focus is hands-on execution.
- Once you have completely satisfied the success criteria, use final_answer to return your result."#;

const VERIFIER_PROMPT: &str = r#"You are the Zeus Verifier (adversarial QA — your success is finding real defects, not praising the worker).

A worker agent was given this objective:
{objective}

The worker had to meet these success criteria:
{success_criteria}

The worker provided this final result:
{result}

Workspace evidence (files the harness observed — treat as ground truth when present):
{workspace_evidence}

Optional tool transcript from verification probes:
{tool_evidence}

## How to judge (evidence before opinion)
1. Prefer ground truth over the worker's self-report. If evidence contradicts the result, the result fails.
2. For code/SWE work: require tests or a run command to have succeeded; probe scale/lifecycle edge cases when relevant (empty, large N, missing files) — but do NOT invent failure modes that do not apply to this task type.
3. For operational/browser work: verify artifacts, counts, and visual/UI requirements in the evidence — not meta unit-tests of the agent.
4. UI/visual objectives: require visual evidence was inspected and layout/design requirements hold without obvious defects.

## Structured verdict
Be strict and critical. Do not accept generic, unsubstantiated answers, or answers that lack requested evidence/URLs.

Respond ONLY with a JSON object matching this schema (no markdown fences, no preamble):
{
  "passed": boolean,
  "feedback": "specific why it passed or failed",
  "blockers": ["concrete defect 1", "concrete defect 2"],
  "scores": { "accuracy": 0-10, "tools": 0-10, "safety": 0-10, "efficiency": 0-10 },
  "evidence": ["command or file or check you relied on"],
  "needs_master_replan": false
}

Set "needs_master_replan": true ONLY when the failure is structural (wrong architecture/contract, missing dependency the worker cannot fix in its scope, or the subtask objective itself is wrong). Use blockers for local implementation defects the worker can fix."#;

pub async fn run_worker(
    state: &State<'_, AppState>,
    app_handle: &AppHandle,
    task_id: &str,
    run_id: &str,
    cancellation_token: &CancellationToken,
    delegate: &DelegateSpec,
    mut current_spend: f64,
) -> Result<String, String> {
    let worker_id = new_id();
    let conversation = format!("worker:{}", worker_id);
    let now = now_iso();

    // 1. Create the worker in the DB
    {
        let connection = state
            .db
            .lock()
            .map_err(|e| format!("Database lock error: {}", e))?;
        connection
            .execute(
                "INSERT INTO workers (id, task_id, name, objective, success_criteria, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?6)",
                params![worker_id, task_id, delegate.name, delegate.objective, delegate.success_criteria, now],
            )
            .map_err(|e| format!("Failed to create worker: {}", e))?;
    }

    // Emit a visible event message to the master chat so the user knows a worker started
    let mut started_msg = new_message_for_conversation(
        task_id,
        "master",
        "event",
        "worker_started",
        json!({
            "worker_id": worker_id,
            "name": delegate.name,
            "objective": delegate.objective,
            "success_criteria": delegate.success_criteria,
            "status": "running"
        })
        .to_string(),
        None,
        None,
        true, // visible to UI
    );
    persist_and_emit(state, app_handle, task_id, &mut started_msg)?;
    let started_msg_id = started_msg.id.clone();

    // 2. Setup the worker's chat history
    let system_content = WORKER_SYSTEM_PROMPT
        .replace("{name}", &delegate.name)
        .replace("{objective}", &delegate.objective)
        .replace("{success_criteria}", &delegate.success_criteria)
        .replace("{host_os}", std::env::consts::OS)
        .replace("{host_family}", std::env::consts::FAMILY);

    let mut history = vec![
        ChatMessage {
            role: "system".into(),
            content: system_content.clone(),
        },
        ChatMessage {
            role: "user".into(),
            content: "Begin executing your assigned objective. Use native directives (read_file, write_file, run_command, list_dir, search_files, http_request) when they fit; use run_action (Python) for browser automation or multi-step scripts.".into(),
        }
    ];

    // We also persist this hidden system message in the worker's conversation
    let mut sys_msg = new_message_for_conversation(
        task_id,
        &conversation,
        "system",
        "chat",
        system_content,
        None,
        None,
        false,
    );
    persist_and_emit(state, app_handle, task_id, &mut sys_msg)?;

    let mut initial_user_msg = new_message_for_conversation(
        task_id,
        &conversation,
        "user",
        "chat",
        "Begin executing your assigned objective. Use native directives (read_file, write_file, run_command, list_dir, search_files, http_request) when they fit; use run_action (Python) for browser automation or multi-step scripts.".into(),
        None,
        None,
        false,
    );
    persist_and_emit(state, app_handle, task_id, &mut initial_user_msg)?;

    let (worker_model, verifier_model, budget_units, worker_effort, verifier_effort) = {
        let conn = state.db.lock().unwrap();
        let t = crate::chat::load_task(&conn, task_id).map_err(|e| e.to_string())?;
        (t.worker_model, t.verifier_model, t.budget_credits, t.worker_effort, t.verifier_effort)
    };

    let max_retries = 3;
    let mut retry_count = 0;

    loop {
        // Run the worker orchestration loop
        let mut loop_iterations = 0;
        let mut transient_retries = 0;
        let worker_result = loop {
            loop_iterations += 1;
            if loop_iterations > orchestrator::max_orchestration_iterations() {
                break Err("Worker hit iteration cap without a final answer.".to_string());
            }

            // Stream response
            let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
            let model_clone = worker_model.clone();
            let history_clone = history.clone();
            let effort_clone = worker_effort.clone();

            let payload_size = serde_json::to_string(&history_clone).map(|s| s.len()).unwrap_or(0);
            crate::logger::log(task_id, "worker", &format!("Sending payload to model ({} messages, ~{} bytes)", history_clone.len(), payload_size));

            let stream_future = gateway::chat_completion_stream(&model_clone, &history_clone, Some(&effort_clone), move |payload| {
                let _ = tx.send(payload);
            });
            tokio::pin!(stream_future);

            let stream_result = tokio::select! {
                res = &mut stream_future => res,
                _ = cancellation_token.cancelled() => {
                    crate::logger::log(task_id, "worker", "Cancellation token triggered. Aborting model stream.");
                    finish_cancelled_run(state, app_handle, task_id, run_id)?;
                    return Err("RUN_CANCELLED".into());
                }
            };

            let (reply_text, _reasoning_text, usage, usage_json, model_used) = match stream_result {
                Ok(tuple) => {
                    transient_retries = 0;
                    tuple
                }
                Err(e) => {
                    if (e.contains("timed out") || e.contains("connection") || e.contains("stream read failed")) && transient_retries < 2 {
                        transient_retries += 1;
                        crate::logger::log(task_id, "worker", &format!("Transient LLM stream error ({}), retrying iteration (attempt {}/2)...", e, transient_retries));
                        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                        continue;
                    }
                    break Err(format!("Worker model error: {}", e));
                }
            };

            let actual_model = model_used.unwrap_or_else(|| worker_model.clone());
            let units = {
                let conn = state.db.lock().unwrap();
                record_spend(&conn, task_id, &actual_model, &usage, &usage_json).unwrap_or(0.0)
            };
            current_spend += units;

            if current_spend >= budget_units as f64 {
                break Err("BUDGET_EXCEEDED".to_string());
            }

            match orchestrator::parse_master_reply(&reply_text) {
                orchestrator::MasterReply::Text(text) => {
                    let mut assistant_message = new_message_for_conversation(
                        task_id, &conversation, "assistant", "chat", text.clone(), Some(units), Some(actual_model), false
                    );
                    persist_and_emit(state, app_handle, task_id, &mut assistant_message)?;
                    history.push(ChatMessage { role: "assistant".into(), content: text.clone() });
                    break Ok(text); // Worker just replied with text, we consider it their final answer.
                }
                orchestrator::MasterReply::MalformedDirective { preamble, error, raw } => {
                    let feedback = format!("[DIRECTIVE_ERROR] {}", error);
                    let preamble = if !preamble.is_empty() {
                        preamble
                    } else if let Some(idx) = raw.find("```zeus-directive") {
                        raw[..idx].trim().to_string()
                    } else if let Some(idx) = raw.find('{') {
                        raw[..idx].trim().to_string()
                    } else {
                        String::new()
                    };
                    if !preamble.is_empty() {
                        let mut preamble_msg = new_message_for_conversation(
                            task_id, &conversation, "assistant", "chat", preamble, Some(units), Some(actual_model.clone()), false
                        );
                        persist_and_emit(state, app_handle, task_id, &mut preamble_msg)?;
                    }

                    let mut hidden_directive = new_message_for_conversation(
                        task_id, &conversation, "assistant", "directive", raw.clone(), None, Some(actual_model.clone()), false
                    );
                    persist_and_emit(state, app_handle, task_id, &mut hidden_directive)?;
                    
                    let mut hidden_result = new_message_for_conversation(
                        task_id, &conversation, "user", "directive_result", feedback.clone(), None, None, false
                    );
                    persist_and_emit(state, app_handle, task_id, &mut hidden_result)?;
                    
                    history.push(ChatMessage { role: "assistant".into(), content: raw });
                    history.push(ChatMessage { role: "user".into(), content: feedback });
                }
                orchestrator::MasterReply::Directive(_preamble, directive, raw) => {
                    let preamble = if let Some(idx) = raw.find("```zeus-directive") {
                        raw[..idx].trim().to_string()
                    } else if let Some(idx) = raw.find('{') {
                        raw[..idx].trim().to_string()
                    } else {
                        String::new()
                    };
                    if !preamble.is_empty() {
                        let mut preamble_msg = new_message_for_conversation(
                            task_id, &conversation, "assistant", "chat", preamble, Some(units), Some(actual_model.clone()), false
                        );
                        persist_and_emit(state, app_handle, task_id, &mut preamble_msg)?;
                    }

                    let mut hidden_directive = new_message_for_conversation(
                        task_id, &conversation, "assistant", "directive", raw.clone(), None, Some(actual_model.clone()), false
                    );
                    persist_and_emit(state, app_handle, task_id, &mut hidden_directive)?;
                    history.push(ChatMessage { role: "assistant".into(), content: raw });

                    match directive {
                        Directive::FinalAnswer { final_answer } => {
                            let mut assistant_message = new_message_for_conversation(
                                task_id, &conversation, "assistant", "chat", final_answer.summary.clone(), Some(units), Some(actual_model), false
                            );
                            persist_and_emit(state, app_handle, task_id, &mut assistant_message)?;
                            history.push(ChatMessage { role: "assistant".into(), content: final_answer.summary.clone() });
                            break Ok(final_answer.summary);
                        }
                        Directive::RunAction { action, success_criteria: _ } => {
                            let workspace = crate::utils::task_workspace(task_id)?;
                            let task_data = crate::chat::load_task(&state.db.lock().unwrap(), task_id).map_err(|e| e.to_string())?;
                            let browser_port = state.browser_manager.ensure_browser(task_id, &task_data.browser_mode, &task_data.browser_executable_path).ok();
                            
                            let action_future = crate::python_runner::run_python_action(
                                Some(app_handle.clone()),
                                Some(task_id.to_string()),
                                &workspace, &action.code, action.timeout_secs,
                                browser_port
                            );
                            tokio::pin!(action_future);

                            let outcome = tokio::select! {
                                result = &mut action_future => result.map_err(|e| e.to_string())?,
                                _ = cancellation_token.cancelled() => {
                                    finish_cancelled_run(state, app_handle, task_id, run_id)?;
                                    return Err("RUN_CANCELLED".into());
                                }
                            };

                            let result_json = orchestrator::action_result_json(
                                &outcome.stdout, &outcome.stderr, outcome.exit_code, outcome.timed_out, &outcome.interpreter
                            );

                            let msg = orchestrator::directive_result_message(&result_json);
                            let mut hidden_result = new_message_for_conversation(
                                task_id, &conversation, "user", "directive_result", msg.clone(), None, None, false
                            );
                            persist_and_emit(state, app_handle, task_id, &mut hidden_result)?;
                            history.push(ChatMessage { role: "user".into(), content: msg });
                        }
                        Directive::AskUserForLogin { reason } => {
                            let mut approval = new_message_for_conversation(
                                task_id, &conversation, "event", "handoff", json!({ "status": "pending", "reason": reason }).to_string(), None, None, true
                            );
                            persist_and_emit(state, app_handle, task_id, &mut approval)?;
                            
                            // Stop headless browser, start headed, then wait for approval
                            let _ = crate::browser_manager::start_browser_handoff(state.clone(), task_id.to_string()).await;
                            
                            // Wait for user
                            let (approved, note) = crate::chat::wait_for_approval(state.inner(), app_handle, task_id, &approval.id, run_id, cancellation_token).await?;
                            
                            // Restart headless
                            let _ = crate::browser_manager::finish_browser_handoff(state.clone(), task_id.to_string()).await;
                            
                            let feedback = if approved {
                                format!("User completed the handoff. You may continue. Note: {}", note)
                            } else {
                                "User denied the handoff or it failed.".to_string()
                            };
                            
                            let mut hidden_result = new_message_for_conversation(
                                task_id, &conversation, "user", "handoff_result", feedback.clone(), None, None, false
                            );
                            persist_and_emit(state, app_handle, task_id, &mut hidden_result)?;
                            history.push(ChatMessage { role: "user".into(), content: feedback });
                        }
                        Directive::ReadFile { .. }
                        | Directive::WriteFile { .. }
                        | Directive::DeleteFile { .. }
                        | Directive::RunCommand { .. }
                        | Directive::HttpRequest { .. }
                        | Directive::ListDir { .. }
                        | Directive::SearchFiles { .. }
                        | Directive::RecallMessages { .. }
                        | Directive::AskUserChoice { .. }
                        | Directive::ConfigureBrowser { .. }
                        | Directive::InstallBrowserExtension { .. }
                        | Directive::ManageBrowserExtension { .. }
                        | Directive::AnalyzeVisual { .. } => {
                            let msg = crate::chat::execute_gated_native_directive(
                                state,
                                app_handle,
                                task_id,
                                run_id,
                                cancellation_token,
                                directive,
                            ).await?;
                            let mut hidden_result = new_message_for_conversation(
                                task_id, &conversation, "user", "directive_result", msg.clone(), None, None, false
                            );
                            persist_and_emit(state, app_handle, task_id, &mut hidden_result)?;
                            history.push(ChatMessage { role: "user".into(), content: msg });
                        }
                        _ => {
                            // Master-only: delegate, memory, action plan, task title.
                            let feedback = "[DIRECTIVE_ERROR] This directive is reserved for the Master agent (planning / user-facing). Use native file/command/http tools or run_action instead.".to_string();
                            let mut hidden_result = new_message_for_conversation(
                                task_id, &conversation, "user", "directive_result", feedback.clone(), None, None, false
                            );
                            persist_and_emit(state, app_handle, task_id, &mut hidden_result)?;
                            history.push(ChatMessage { role: "user".into(), content: feedback });
                        }
                    }
                }
            }
        };

        // Verification phase
        let final_result_text = match worker_result {
            Ok(res) => res,
            Err(e) => {
                set_worker_status(state, &worker_id, "failed", Some(&e), None)?;
                update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "failed")?;
                return Err(format!("Verifier error: {}", e));
            }
        };

        set_worker_status(state, &worker_id, "verifying", None, Some(&final_result_text))?;
        update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "verifying")?;

        // Grounded verification: collect workspace evidence + optional test probes
        // before the verifier LLM judges (evidence before opinion).
        let workspace_evidence = collect_workspace_evidence(task_id);
        let tool_evidence = run_verifier_probes(state, task_id, &delegate.objective, &delegate.success_criteria, &final_result_text).await;

        let verifier_prompt = VERIFIER_PROMPT
            .replace("{objective}", &delegate.objective)
            .replace("{success_criteria}", &delegate.success_criteria)
            .replace("{result}", &final_result_text)
            .replace("{workspace_evidence}", &workspace_evidence)
            .replace("{tool_evidence}", &tool_evidence);

        let verifier_messages = vec![ChatMessage {
            role: "user".into(),
            content: verifier_prompt,
        }];

        let verification_response = tokio::select! {
            res = gateway::chat_completion(&verifier_model, &verifier_messages, Some(&verifier_effort)) => res,
            _ = cancellation_token.cancelled() => {
                finish_cancelled_run(state, app_handle, task_id, run_id)?;
                return Err("RUN_CANCELLED".into());
            }
        };

        let verifier_output = match verification_response {
            Ok((text, u, uj, m)) => {
                let actual_model = m.unwrap_or_else(|| verifier_model.to_string());
                let units = {
                    let conn = state.db.lock().unwrap();
                    record_spend(&conn, task_id, &actual_model, &u, &uj).unwrap_or(0.0)
                };
                current_spend += units;
                text
            }
            Err(e) => {
                let msg = format!("Malformed verifier output: {}", e);
                set_worker_status(state, &worker_id, "failed", Some(&msg), None)?;
                update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "failed")?;
                return Err(msg);
            }
        };

        let v_res = orchestrator::parse_verification_json(&verifier_output);
        match v_res {
            Ok(vr) => {
                if vr.passed {
                    set_worker_status(state, &worker_id, "completed", None, None)?;
                    update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "completed")?;
                    return Ok(final_result_text);
                } else {
                    let blockers_text = if vr.blockers.is_empty() {
                        String::new()
                    } else {
                        format!("\n\nBlockers to fix:\n{}", vr.blockers.iter().enumerate().map(|(i, b)| format!("{}. {}", i + 1, b)).collect::<Vec<_>>().join("\n"))
                    };
                    let evidence_text = if vr.evidence.is_empty() {
                        String::new()
                    } else {
                        format!("\n\nVerifier evidence checked:\n{}", vr.evidence.join("\n"))
                    };

                    if vr.needs_master_replan {
                        let escalate = format!(
                            "WORKER_ESCALATION: Structural failure — subtask cannot be completed in this worker's scope.\nObjective: {}\nVerifier feedback: {}{}\n\nMaster: re-plan the overall task. Consider splitting contracts across workers (e.g. backend before frontend), changing the subtask objective, or doing this work yourself with full context.",
                            delegate.objective, vr.feedback, blockers_text
                        );
                        set_worker_status(state, &worker_id, "failed", Some(&vr.feedback), Some(&final_result_text))?;
                        update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "failed")?;
                        return Err(escalate);
                    }

                    if retry_count >= max_retries {
                        let exhausted = format!(
                            "WORKER_EXHAUSTED: Failed success criteria after {} retries.\nObjective: {}\nVerifier feedback: {}{}\n{}\n\nMaster: re-plan with a different approach or split the work. Do not blindly re-delegate the identical brief.",
                            max_retries, delegate.objective, vr.feedback, blockers_text, evidence_text
                        );
                        set_worker_status(state, &worker_id, "failed", Some("Max retries exceeded"), None)?;
                        update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "failed")?;
                        return Err(exhausted);
                    } else {
                        update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "retrying")?;
                        set_worker_status(state, &worker_id, "retrying", None, None)?;
                        let retry_msg = format!(
                            "Your result was rejected by the verifier:\n{}{}\n{}\n\nPlease address every blocker above and try again.",
                            vr.feedback, blockers_text, evidence_text
                        );
                        let mut hidden_retry = new_message_for_conversation(
                            task_id, &conversation, "user", "chat", retry_msg.clone(), None, None, false
                        );
                        persist_and_emit(state, app_handle, task_id, &mut hidden_retry)?;
                        history.push(ChatMessage { role: "user".into(), content: retry_msg });

                        retry_count += 1;
                    }
                }
            }
            Err(e) => {
                let err = format!("Verifier provided invalid JSON: {}", e);
                set_worker_status(state, &worker_id, "failed", Some(&err), Some(&final_result_text))?;
                update_worker_event_and_emit(state, app_handle, &started_msg_id, task_id, &worker_id, delegate, "failed")?;
                return Err(err);
            }
        }
    }
}

/// Snapshot of workspace files for grounded verification (paths + sizes).
fn collect_workspace_evidence(task_id: &str) -> String {
    let Ok(ws) = crate::utils::task_workspace(task_id) else {
        return "(workspace unavailable)".to_string();
    };
    let mut lines = vec![format!("Workspace: {}", ws.display())];
    if let Ok(entries) = std::fs::read_dir(&ws) {
        let mut files: Vec<String> = Vec::new();
        for entry in entries.flatten() {
            let meta = entry.metadata().ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let kind = if meta.as_ref().map(|m| m.is_dir()).unwrap_or(false) { "dir" } else { "file" };
            files.push(format!("  [{}] {} ({} bytes)", kind, entry.file_name().to_string_lossy(), size));
        }
        files.sort();
        lines.extend(files.into_iter().take(80));
        if lines.len() > 81 {
            lines.push(format!("  ... and {} more entries", lines.len() - 81));
        }
    } else {
        lines.push("  (empty or unreadable)".to_string());
    }
    lines.join("\n")
}

/// Lightweight verification probes: run safe tests/commands when the objective
/// looks like SWE work. Returns a transcript for the verifier LLM.
async fn run_verifier_probes(
    _state: &State<'_, AppState>,
    task_id: &str,
    objective: &str,
    success_criteria: &str,
    result: &str,
) -> String {
    let hay = format!("{} {} {}", objective, success_criteria, result).to_lowercase();
    let looks_like_code = ["test", "pytest", "bug", "fix", "script", "pipeline", "python", "node", "code"]
        .iter()
        .any(|k| hay.contains(k));
    if !looks_like_code {
        return "(no code probes — operational/other task; rely on workspace evidence)".to_string();
    }

    let Ok(ws) = crate::utils::task_workspace(task_id) else {
        return "(workspace unavailable for probes)".to_string();
    };

    let mut transcript = Vec::new();
    // Prefer deterministic project checks when present.
    let candidates: &[(&str, &str)] = &[
        ("pytest", "python -m pytest -q"),
        ("package.json test", "npm test --silent"),
    ];

    let mut ran_any = false;
    for (label, cmd) in candidates {
        let has_marker = match *label {
            "pytest" => ws.join("pytest.ini").exists()
                || ws.join("pyproject.toml").exists()
                || ws.join("conftest.py").exists()
                || dir_has_suffix(&ws, ".py", 30),
            "package.json test" => ws.join("package.json").exists(),
            _ => false,
        };
        if !has_marker {
            continue;
        }
        // Only run if it looks safe and local to the workspace.
        let output_future = tokio::process::Command::new("cmd")
            .args(["/c", cmd])
            .current_dir(&ws)
            .output();
        let out = match tokio::time::timeout(std::time::Duration::from_secs(120), output_future).await {
            Ok(Ok(o)) => {
                ran_any = true;
                let stdout = String::from_utf8_lossy(&o.stdout);
                let stderr = String::from_utf8_lossy(&o.stderr);
                let code = o.status.code().unwrap_or(-1);
                format!(
                    "[probe {}] exit={} \nstdout: {}\nstderr: {}",
                    label,
                    code,
                    crate::utils::safe_truncate_str(&stdout, 1500),
                    crate::utils::safe_truncate_str(&stderr, 800)
                )
            }
            Ok(Err(e)) => format!("[probe {}] failed to spawn: {}", label, e),
            Err(_) => format!("[probe {}] timed out after 120s", label),
        };
        transcript.push(out);
    }

    if !ran_any {
        return "(no safe test command detected in workspace)".to_string();
    }
    transcript.join("\n\n")
}

fn dir_has_suffix(root: &std::path::Path, suffix: &str, max_depth: usize) -> bool {
    fn walk(p: &std::path::Path, suffix: &str, depth: usize, max_depth: usize) -> bool {
        if depth > max_depth {
            return false;
        }
        let Ok(entries) = std::fs::read_dir(p) else {
            return false;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name == "node_modules" || name == "target" || name == ".git" {
                    continue;
                }
                if walk(&path, suffix, depth + 1, max_depth) {
                    return true;
                }
            } else if path.extension().and_then(|e| e.to_str()) == Some(suffix.trim_start_matches('.')) {
                return true;
            }
        }
        false
    }
    walk(root, suffix, 0, max_depth)
}

fn set_worker_status(
    state: &State<'_, AppState>,
    worker_id: &str,
    status: &str,
    feedback: Option<&str>,
    result: Option<&str>,
) -> Result<(), String> {
    let connection = state
        .db
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    
    let now = now_iso();
    let completed_at = if status == "completed" || status == "failed" { Some(&now) } else { None };

    if status == "retrying" {
        connection.execute(
            "UPDATE workers SET status = 'running', retry_count = retry_count + 1, verification_feedback = ?1, result_text = ?2, updated_at = ?3 WHERE id = ?4",
            params![feedback, result, now, worker_id],
        ).map_err(|e| format!("Failed to update worker: {}", e))?;
    } else {
        connection.execute(
            "UPDATE workers SET status = ?1, verification_feedback = ?2, result_text = ?3, updated_at = ?4, completed_at = ?5 WHERE id = ?6",
            params![status, feedback, result, now, completed_at, worker_id],
        ).map_err(|e| format!("Failed to update worker: {}", e))?;
    }
    
    Ok(())
}

fn update_worker_event_and_emit(
    state: &State<'_, AppState>,
    app_handle: &AppHandle,
    msg_id: &str,
    task_id: &str,
    worker_id: &str,
    delegate: &DelegateSpec,
    status: &str,
) -> Result<(), String> {
    let content = json!({
        "worker_id": worker_id,
        "name": delegate.name,
        "objective": delegate.objective,
        "success_criteria": delegate.success_criteria,
        "status": status
    })
    .to_string();

    let (seq, created_at) = {
        let conn = state.db.lock().unwrap();
        conn.execute(
            "UPDATE messages SET content = ?1 WHERE id = ?2",
            params![content, msg_id],
        )
        .map_err(|e| format!("DB Error: {}", e))?;

        let mut stmt = conn
            .prepare("SELECT rowid, created_at FROM messages WHERE id = ?1")
            .unwrap();
        stmt.query_row(params![msg_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("DB Error: {}", e))?
    };

    let msg = MessageDto {
        id: msg_id.to_string(),
        task_id: task_id.to_string(),
        conversation: "master".to_string(),
        role: "event".to_string(),
        kind: "worker_started".to_string(),
        content,
        credits_used: None,
        model: None,
        created_at,
        seq,
        visible: true,
    };

    use tauri::Emitter;
    app_handle
        .emit("task-message", json!({ "task_id": task_id, "message": msg }))
        .map_err(|e| format!("Failed to emit event: {}", e))?;

    Ok(())
}
