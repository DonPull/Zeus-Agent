import MessageAttachments from "./MessageAttachments";
import ManagedBrowserSessionCard from "./ManagedBrowserSessionCard";
import CompletionCard from './CompletionCard';
import { useMemo, useState } from "react";
import MessageMarkdown from './MessageMarkdown';
import * as bridge from '../bridge';
import { formatCredits, formatTime } from "../utils";

function parseEventContent(message) {
    try {
        return JSON.parse(message.content);
    } catch {
        return null;
    }
}

function isDirectiveMessage(content) {
    // Any assistant content carrying a directive fence is pipeline-internal.
    // No JSON validation: a malformed directive must be hidden too, never
    // rendered as raw JSON (App.jsx filters first; this is defense-in-depth).
    return typeof content === "string" && content.includes("```zeus-directive");
}

function ActionCard({ message }) {
    const data = useMemo(() => parseEventContent(message), [message]);
    const [showCode, setShowCode] = useState(false);
    if (!data) {
        return (
            <div className="chat-message event">
                <div className="chat-bubble event"><div className="chat-bubble-content">{message.content}</div></div>
            </div>
        );
    }
    const ok = data.exit_code === 0 && !data.timed_out;
    return (
        <div className="chat-message event">
            <div className={`chat-bubble action-card column gap-10 ${ok ? "" : "failed"}`}>
                <div className="action-card-header align-center justify-space-between no-user-select">
                    <span className="action-card-title">
                        {data.timed_out ? "Action timed out" : ok ? "Action completed" : "Action failed"}
                    </span>
                    <span className={`action-card-exit ${ok ? "ok" : "bad"}`}>exit {data.exit_code}</span>
                </div>
                <div className="action-card-meta align-center gap-10 no-user-select">
                    <span className="chat-meta-pill mono">{data.interpreter}</span>
                    {data.success_criteria && <span className="action-card-criteria" title={data.success_criteria}>Stated criteria</span>}
                </div>
                {data.stdout && <pre className="action-card-output">{data.stdout}</pre>}
                {data.stderr && <pre className="action-card-output stderr">{data.stderr}</pre>}
                <button className="action-card-toggle" onClick={() => setShowCode((s) => !s)}>
                    <label>{showCode ? "Hide code" : "Show code"}</label>
                </button>
                {showCode && <pre className="action-card-code">{data.code}</pre>}
            </div>
        </div>
    );
}

function ApprovalCard({ message, onDecision }) {
    const data = useMemo(() => parseEventContent(message), [message]);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [feedbackOpen, setFeedbackOpen] = useState(false);
    const [feedbackText, setFeedbackText] = useState("");
    
    if (!data) return null;
    const pending = data.status === "pending";

    const summaryStr = data.summary || "";
    const isCommand = summaryStr.toLowerCase().includes("run command");
    const cmdMatch = summaryStr.match(/`([^`]+)`/);
    const cmd = cmdMatch ? cmdMatch[1] : null;
    
    const baseApp = cmd ? cmd.split(" ")[0] : null;
    const isComposite = cmd ? /[&|;><]|(\$\()/.test(cmd) : false;

    // File request logic
    const isFileRequest = data.blocked_directive && (data.blocked_directive.type === "read_file" || data.blocked_directive.type === "write_file");
    const isPythonFileRequest = summaryStr.startsWith("Python Access: ");
    const hasFileAccess = isFileRequest || isPythonFileRequest;
    
    let filePath = null;
    let fileAction = null;
    if (isFileRequest) {
        filePath = data.blocked_directive.path;
        fileAction = data.blocked_directive.type === "read_file" ? "read" : "write";
    } else if (isPythonFileRequest) {
        const match = summaryStr.match(/Python Access: (\w+) `([^`]+)`/);
        if (match) {
            fileAction = match[1];
            filePath = match[2];
        }
    }

    let parentDir = null;
    if (filePath) {
        const parts = filePath.replace(/\\/g, "/").split("/");
        if (parts.length > 1) {
            parts.pop();
            parentDir = parts.join("/");
        }
    }

    const showDropdown = isCommand || hasFileAccess;

    return (
        <div className="chat-message event">
            <div className={`chat-bubble approval-card column gap-10 ${pending ? "pending" : data.status === "approved" ? "approved" : "denied"}`} data-message-id={message.id} data-task-id={message.task_id}>
                {data.blocked_directive && (
                    <div className="approval-card-blocked-directive" style={{ display: "none" }}>
                        {JSON.stringify(data.blocked_directive)}
                    </div>
                )}
                <div className="approval-card-header align-center justify-space-between no-user-select">
                    <span className="approval-card-title">{data.summary}</span>
                    <span className="approval-card-status">{pending ? "needs approval" : data.status}</span>
                </div>
                {data.detail && <div className="approval-card-detail">{data.detail}</div>}
                
                {pending ? (
                    <div className="column gap-10">
                        <div className="align-center gap-10">
                            <button className="confirm-dialog-button danger" onClick={() => onDecision(false, null, { mode: "once", messageId: message.id, taskId: message.task_id })}>
                                <label>Deny</label>
                            </button>

                            <button 
                                className="confirm-dialog-button" 
                                style={{ backgroundColor: feedbackOpen ? "var(--border-color, #333)" : "transparent", border: "1px solid var(--border-color, #444)" }}
                                onClick={() => setFeedbackOpen(!feedbackOpen)}
                            >
                                <label>{feedbackOpen ? "Cancel Feedback" : "Deny with Feedback"}</label>
                            </button>
                            
                            <div style={{ position: "relative" }} className="align-center">
                                <button className="confirm-dialog-button" onClick={() => onDecision(true, null, { mode: "once", blocked: data.blocked_directive, messageId: message.id, taskId: message.task_id })}>
                                    <label>Approve (Once)</label>
                                </button>
                                {showDropdown && (
                                    <button className="settings-button" style={{ marginLeft: "5px", padding: "4px 8px" }} onClick={() => setDropdownOpen(!dropdownOpen)} title="More options">
                                        <label>▾</label>
                                    </button>
                                )}
                                
                                {dropdownOpen && isCommand && cmd && (
                                    <div className="approval-dropdown column">
                                        <div className="approval-dropdown-item" onClick={() => { setDropdownOpen(false); onDecision(true, null, { messageId: message.id, mode: "task_exact", command: cmd }); }}>
                                            🟢 Always Allow Exact `{cmd}` (Task)
                                        </div>
                                        {!isComposite && (
                                            <div className="approval-dropdown-item" onClick={() => { setDropdownOpen(false); onDecision(true, null, { messageId: message.id, mode: "task_prefix", command: cmd }); }}>
                                                🟢 Always Allow Prefix `{cmd}` (Task)
                                            </div>
                                        )}
                                        {!isComposite && baseApp && baseApp !== cmd && (
                                            <div className="approval-dropdown-item" onClick={() => { setDropdownOpen(false); onDecision(true, null, { messageId: message.id, mode: "task_prefix", command: baseApp }); }}>
                                                🟢 Always Allow Prefix `{baseApp}` (Task)
                                            </div>
                                        )}
                                        <div className="approval-dropdown-item danger" onClick={() => { setDropdownOpen(false); onDecision(false, null, { messageId: message.id, mode: "task_exact", command: cmd }); }}>
                                            🔴 Always Deny Exact `{cmd}` (Task)
                                        </div>
                                        {!isComposite && baseApp && (
                                            <div className="approval-dropdown-item danger" onClick={() => { setDropdownOpen(false); onDecision(false, null, { messageId: message.id, mode: "task_prefix", command: baseApp }); }}>
                                                🔴 Always Deny Prefix `{baseApp}` (Task)
                                            </div>
                                        )}
                                    </div>
                                )}

                                {dropdownOpen && hasFileAccess && filePath && (
                                    <div className="approval-dropdown column">
                                        <div className="approval-dropdown-item" onClick={() => { setDropdownOpen(false); onDecision(true, null, { messageId: message.id, mode: "task_exact", path: filePath, permissionType: fileAction }); }}>
                                            🟢 Always Allow Access to This File (Task)
                                        </div>
                                        {parentDir && (
                                            <div className="approval-dropdown-item" onClick={() => { setDropdownOpen(false); onDecision(true, null, { messageId: message.id, mode: "task_parent_dir", path: parentDir, permissionType: fileAction }); }}>
                                                🟢 Always Allow Access to Parent Directory (Task)
                                            </div>
                                        )}
                                        <div className="approval-dropdown-item danger" onClick={() => { setDropdownOpen(false); onDecision(false, null, { messageId: message.id, mode: "task_exact", path: filePath, permissionType: fileAction }); }}>
                                            🔴 Always Deny Access to This File (Task)
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {feedbackOpen && (
                            <div className="column gap-10" style={{ marginTop: "6px", padding: "10px", backgroundColor: "rgba(0,0,0,0.25)", borderRadius: "6px", border: "1px solid var(--border-color, #333)" }}>
                                <span style={{ fontSize: "0.85em", opacity: 0.8 }}>Specify guidance or alternative instructions for the agent:</span>
                                <input
                                    type="text"
                                    className="settings-input"
                                    placeholder="e.g. Do not touch that file, use in-memory SQLite instead..."
                                    value={feedbackText}
                                    onChange={(e) => setFeedbackText(e.target.value)}
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && feedbackText.trim()) {
                                            onDecision(false, feedbackText.trim(), { mode: "once", messageId: message.id, taskId: message.task_id, note: feedbackText.trim() });
                                        }
                                    }}
                                />
                                <div className="align-center gap-10">
                                    <button
                                        className="confirm-dialog-button danger"
                                        disabled={!feedbackText.trim()}
                                        style={{
                                            opacity: feedbackText.trim() ? 1 : 0.4,
                                            cursor: feedbackText.trim() ? "pointer" : "not-allowed"
                                        }}
                                        onClick={() => onDecision(false, feedbackText.trim(), { mode: "once", messageId: message.id, taskId: message.task_id, note: feedbackText.trim() })}
                                    >
                                        <label>Submit Deny & Feedback</label>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function WorkerCard({ message }) {
    const data = useMemo(() => parseEventContent(message), [message]);
    if (!data) return null;

    return (
        <div className="chat-message event">
            <div className={`chat-bubble worker-card column gap-10 ${data.status}`}>
                <div className="worker-card-header align-center justify-space-between no-user-select">
                    <span className="worker-card-title">Worker: {data.name}</span>
                    <span className={`worker-card-status ${data.status}`}>{data.status}</span>
                </div>
                {data.objective && (
                    <div className="worker-card-body">
                        <strong>Objective:</strong> {data.objective}
                    </div>
                )}
                {data.success_criteria && (
                    <div className="worker-card-body">
                        <strong>Criteria:</strong> {data.success_criteria}
                    </div>
                )}
            </div>
        </div>
    );
}

function HandoffCard({ message, onDecision, preview=false }) {
    const data = useMemo(() => parseEventContent(message), [message]);
    const [busy,setBusy]=useState(false),[error,setError]=useState('');
    if (!data) return null;

    const pending = data.status === "pending";
    const opened=data.phase==='open';
    const act=async action=>{if(preview||busy)return;setBusy(true);setError('');try{await action();}catch(reason){setError(String(reason));}finally{setBusy(false);}};

    return (
        <div className="chat-message event">
            <div role="group" aria-label="Browser intervention" className={`chat-bubble approval-card column gap-10 ${pending ? "pending" : data.status === "approved" ? "approved" : "denied"}`}>
                <div className="approval-card-header align-center justify-space-between">
                    <span className="approval-card-title">Browser needs your help</span>
                    <span className="approval-card-status">{pending ? opened?'your turn':'waiting for you' : data.status==='approved'?'completed':data.status}</span>
                </div>
                
                <div className="approval-card-body handoff-body">
                    {pending?(opened?'Complete the requested task in the browser, then resume Zeus.':'Open the browser to complete the requested task. Zeus will wait here.'):data.status==='approved'?'Your intervention is complete. Zeus resumed from the current page.':'This browser intervention has ended.'}
                    {data.reason && <div className="handoff-reason"><strong>Reason: </strong>{data.reason}</div>}
                </div>
                
                {pending ? (
                    <div className="align-center gap-10" style={{ marginTop: "10px" }}>
                        <button disabled={busy||preview} className="confirm-dialog-button danger" onClick={() => act(()=>onDecision(false, null, { messageId: message.id, taskId:message.task_id }))}>
                            <label>Stop run</label>
                        </button>
                        
                        <button disabled={busy||preview} className="confirm-dialog-button" onClick={() => act(()=>bridge.openBrowserHandoff(message.task_id,message.id))}>
                            <label>{busy?'Working…':opened?'Show browser':'Open browser'}</label>
                        </button>
                        {opened&&<button disabled={busy||preview} className="confirm-dialog-button" onClick={()=>act(()=>onDecision(true,null,{messageId:message.id,taskId:message.task_id}))}><label>Resume Zeus</label></button>}
                    </div>
                ) : null}
                {error&&<div className="browser-viewer-notice" role="alert">{error}</div>}
            </div>
        </div>
    );
}

function InteractiveChoiceCard({ message, onDecision }) {
    const data = useMemo(() => parseEventContent(message), [message]);
    const [selectedId, setSelectedId] = useState(null);
    const [customText, setCustomText] = useState("");
    if (!data) return null;

    const pending = data.status === "pending";
    const options = data.options || [];

    const handleSelectOption = (optId) => {
        if (!pending) return;
        setSelectedId(optId);
    };

    const handleSubmit = () => {
        if (!pending || (!selectedId && !customText.trim())) return;
        if (onDecision) {
            onDecision(selectedId || "custom", customText.trim(), { messageId: message.id });
        }
    };

    return (
        <div className="chat-message event">
            <div className={`chat-bubble approval-card column gap-10 ${pending ? "pending" : "approved"}`}>
                <div className="approval-card-header align-center justify-space-between no-user-select">
                    <span className="approval-card-title">Decision Required</span>
                    <span className="approval-card-status">{pending ? "waiting for selection" : "resolved"}</span>
                </div>
                
                <div className="approval-card-body">
                    <strong>{data.prompt || "Please select an option:"}</strong>
                </div>

                <div className="choice-options-list column gap-8" style={{ marginTop: "6px" }}>
                    {options.map((opt) => (
                        <div
                            key={opt.id}
                            className={`choice-option-item align-center gap-10 ${selectedId === opt.id ? "selected" : ""}`}
                            onClick={() => handleSelectOption(opt.id)}
                            style={{
                                padding: "10px 14px",
                                borderRadius: "8px",
                                border: selectedId === opt.id ? "1.5px solid var(--accent-color, #4f46e5)" : "1px solid rgba(255,255,255,0.1)",
                                background: selectedId === opt.id ? "rgba(79, 70, 229, 0.15)" : "rgba(255,255,255,0.03)",
                                cursor: pending ? "pointer" : "default",
                                transition: "all 0.15s ease"
                            }}
                        >
                            <input
                                type="radio"
                                name={`choice-${message.id}`}
                                checked={selectedId === opt.id || (!pending && data.selected_option === opt.id)}
                                onChange={() => handleSelectOption(opt.id)}
                                disabled={!pending}
                            />
                            <div className="column">
                                <span style={{ fontWeight: 600, fontSize: "0.92rem" }}>{opt.label}</span>
                                {opt.description && <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>{opt.description}</span>}
                            </div>
                        </div>
                    ))}
                </div>

                {data.allow_custom_input && pending && (
                    <div className="choice-custom-input column gap-5" style={{ marginTop: "6px" }}>
                        <input
                            type="text"
                            placeholder={data.custom_placeholder || "Or type custom input / instructions..."}
                            value={customText}
                            onChange={(e) => {
                                setCustomText(e.target.value);
                                if (e.target.value.trim()) setSelectedId(null);
                            }}
                            style={{
                                padding: "8px 12px",
                                borderRadius: "6px",
                                border: "1px solid rgba(255,255,255,0.15)",
                                background: "rgba(0,0,0,0.2)",
                                color: "inherit",
                                fontSize: "0.88rem"
                            }}
                        />
                    </div>
                )}

                {pending ? (
                    <div className="align-center justify-end" style={{ marginTop: "10px" }}>
                        <button
                            className="confirm-dialog-button"
                            disabled={!selectedId && !customText.trim()}
                            onClick={handleSubmit}
                        >
                            <label>Submit Choice</label>
                        </button>
                    </div>
                ) : (
                    <div style={{ fontSize: "0.82rem", opacity: 0.7, marginTop: "4px" }}>
                        Selected: {data.selected_option} {data.custom_input ? `("${data.custom_input}")` : ""}
                    </div>
                )}
            </div>
        </div>
    );
}

function ReasoningPill({ reasoning, streaming }) {
    const [open, setOpen] = useState(true);
    if (!reasoning) return null;
    return (
        <div className={`reasoning-pill column ${open ? "open" : ""}`}>
            <button className="reasoning-pill-header align-center gap-10 no-user-select" onClick={() => setOpen((o) => !o)}>
                <span className="reasoning-pill-label">{streaming ? "Zeus is thinking..." : "Zeus's reasoning"}</span>
                <span className="reasoning-pill-count">{reasoning.length} chars</span>
                <span className="reasoning-pill-caret">{open ? "▾" : "▸"}</span>
            </button>
            {open && <div className="reasoning-pill-body markdown-body"><MessageMarkdown>{reasoning}</MessageMarkdown></div>}
        </div>
    );
}

function BrowserSessionStartedCard({ message, onOpenReplay }) {
    const data = useMemo(() => parseEventContent(message), [message]);
    if (!data) return null;
    const sessionId = data.session_id || "";
    const displayId = sessionId.length > 14 ? `${sessionId.slice(0, 12)}…` : sessionId;

    return (
        <div className="chat-message event">
            <div className="chat-bubble browser-session-card column gap-10">
                <div className="browser-session-header align-center justify-space-between no-user-select">
                    <div className="align-center gap-10">
                        <span className="browser-session-title">Older browser recording</span>
                    </div>
                    {sessionId && <span className="browser-session-id mono">{displayId}</span>}
                </div>
                <div className="browser-session-body align-center justify-space-between gap-15">
                    <div className="browser-session-info column gap-4">
                        <span className="browser-session-subtext">
                            Limited evidence; this record does not establish current activity.
                        </span>
                        {data.initial_url && (
                            <span className="browser-session-url mono truncate-url" title={data.initial_url}>
                                🌐 {data.initial_url}
                            </span>
                        )}
                    </div>
                    <button
                        id="browser-session-live-view-btn"
                        className="browser-session-action-btn live-btn align-center gap-6 no-user-select"
                        title="Open older recording"
                        onClick={() => onOpenReplay && onOpenReplay(sessionId, message.task_id)}
                    >
                        <span>👁️</span>
                        <span>Recording</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

function BrowserSessionCompletedCard({ message, onOpenReplay }) {
    const data = useMemo(() => parseEventContent(message), [message]);
    if (!data) return null;
    const sessionId = data.session_id || "";
    const totalSteps = data.total_steps || 0;
    const durationSec = data.duration_ms ? (data.duration_ms / 1000).toFixed(1) : null;
    const displayId = sessionId.length > 14 ? `${sessionId.slice(0, 12)}…` : sessionId;

    return (
        <div className="chat-message event">
            <div className="chat-bubble browser-session-card completed column gap-10">
                <div className="browser-session-header align-center justify-space-between no-user-select">
                    <div className="align-center gap-10">
                        <span className="browser-session-title">Older recording ended</span>
                    </div>
                    {sessionId && <span className="browser-session-id mono">{displayId}</span>}
                </div>
                <div className="browser-session-metrics align-center gap-15 no-user-select">
                    <div className="browser-metric-pill">
                        <span className="metric-label">Actions</span>
                        <span className="metric-value">{totalSteps}</span>
                    </div>
                    {durationSec && (
                        <div className="browser-metric-pill">
                            <span className="metric-label">Duration</span>
                            <span className="metric-value">{durationSec}s</span>
                        </div>
                    )}
                    {data.final_url && (
                        <div className="browser-metric-pill url-pill" title={data.final_url}>
                            <span className="metric-label">Final URL</span>
                            <span className="metric-value mono truncate-url">{data.final_url}</span>
                        </div>
                    )}
                </div>
                <div className="browser-session-footer align-center justify-space-between gap-10">
                    <span className="browser-session-subtext">Limited recording; action outcomes and images may be incomplete.</span>
                    <button
                        id="browser-session-replay-btn"
                        className="browser-session-action-btn replay-btn align-center gap-6 no-user-select"
                        title="Open interactive session replay"
                        onClick={() => onOpenReplay && onOpenReplay(sessionId, message.task_id)}
                    >
                        <span>🎬</span>
                        <span>View Session Replay</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

function ChatMessage({
    message,
    streaming = false,
    reasoning = "",
    onApprovalDecision,
    onHandoffDecision,
    onChoiceDecision,
    onOpenLiveView,
    onOpenReplay,
    onReuseAttachment,
    preview=false,
}) {
    if(message.kind==='ui_showcase'){
        if(preview)return null;const data=parseEventContent(message);if(!data?.card)return null;
        const card={...data.card,id:message.id,task_id:message.task_id,visible:true};
        return <section className="ui-showcase-example"><span className="ui-showcase-caption">Design preview · {data.label} · Controls are inactive</span><div inert=""><ChatMessage message={card} preview reasoning={data.reasoning||''} onReuseAttachment={()=>{}} onApprovalDecision={()=>{}} onHandoffDecision={()=>{}} onChoiceDecision={()=>{}}/></div></section>;
    }
    if (message.role === "user") {
        return (
            <div className="chat-message user">
                <div className="chat-bubble">
                    <div className="chat-bubble-content markdown-body">
                        <MessageMarkdown taskId={message.task_id} messageId={message.id}>{message.content}</MessageMarkdown>
                    </div>
                    <MessageAttachments files={message.attachments} onReuse={onReuseAttachment} preview={preview}/>
                </div>
            </div>
        );
    }

    if (message.role === "event") {
        if(message.kind==='completion_report')return <CompletionCard message={message}/>;
        if(message.kind==='managed_browser_session')return <ManagedBrowserSessionCard message={message} onOpenLiveView={onOpenLiveView} onOpenReplay={onOpenReplay} preview={preview}/>;
        if (message.kind === "action") return <ActionCard message={message} />;
        if (message.kind === "approval") return <ApprovalCard message={message} onDecision={onApprovalDecision} />;
        if (message.kind === "handoff") return <HandoffCard message={message} onDecision={onHandoffDecision} preview={preview}/>;
        if (message.kind === "choice") return <InteractiveChoiceCard message={message} onDecision={onChoiceDecision} />;
        if (message.kind === "worker_started" || message.kind === "worker_update") return <WorkerCard message={message} />;
        if (message.kind === "browser_session_started") return <BrowserSessionStartedCard message={message} onOpenReplay={onOpenReplay} />;
        if (message.kind === "browser_session_completed") return <BrowserSessionCompletedCard message={message} onOpenReplay={onOpenReplay} />;
        return (
            <div className="chat-message event">
                <div className="chat-bubble event"><div className="chat-bubble-content">{message.content}</div></div>
            </div>
        );
    }

    if (isDirectiveMessage(message.content)) return null;

    // assistant
    return (
        <div className="chat-message assistant">
            <div className="chat-bubble column">
                {!streaming && <label className="chat-bubble-author">Zeus</label>}
                {(reasoning || streaming) && (
                    <ReasoningPill reasoning={reasoning} streaming={streaming && !message.content} />
                )}
                {message.content ? (
                    <div className={`chat-bubble-content markdown-body ${streaming ? "streaming" : ""}`}>
                        <MessageMarkdown taskId={message.task_id} messageId={streaming?null:message.id}>{message.content}</MessageMarkdown>
                    </div>
                ) : null}
                {!streaming && (
                    <div className="chat-bubble-footer align-center gap-10 no-user-select">
                        {message.model && <span className="chat-meta-pill mono">{message.model}</span>}
                        <span className="chat-meta-pill credits">
                            {message.credits_used !== null && message.credits_used !== undefined
                                ? `${formatCredits(message.credits_used)} units`
                                : "units n/a"}
                        </span>
                        {message.created_at && <span className="chat-meta-time">{formatTime(message.created_at)}</span>}
                    </div>
                )}
            </div>
        </div>
    );
}

export default ChatMessage;
