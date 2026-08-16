import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
                    {data.success_criteria && <span className="action-card-criteria" title={data.success_criteria}>✓ criteria</span>}
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
            <div className={`chat-bubble approval-card column gap-10 ${pending ? "pending" : data.status === "approved" ? "approved" : "denied"}`}>
                <div className="approval-card-header align-center justify-space-between no-user-select">
                    <span className="approval-card-title">{data.summary}</span>
                    <span className="approval-card-status">{pending ? "needs approval" : data.status}</span>
                </div>
                {data.detail && <div className="approval-card-detail">{data.detail}</div>}
                
                {pending ? (
                    <div className="align-center gap-10">
                        <button className="confirm-dialog-button danger" onClick={() => onDecision(false, null, { mode: "once", messageId: message.id })}>
                            <label>Deny</label>
                        </button>
                        
                        <div style={{ position: "relative" }} className="align-center">
                            <button className="confirm-dialog-button" onClick={() => onDecision(true, null, { mode: "once", blocked: data.blocked_directive, messageId: message.id })}>
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

function HandoffCard({ message, onDecision }) {
    const data = useMemo(() => parseEventContent(message), [message]);
    if (!data) return null;

    const pending = data.status === "pending";

    return (
        <div className="chat-message event">
            <div className={`chat-bubble approval-card column gap-10 ${pending ? "pending" : data.status === "approved" ? "approved" : "denied"}`}>
                <div className="approval-card-header align-center justify-space-between no-user-select">
                    <span className="approval-card-title">Browser Handoff Needed</span>
                    <span className="approval-card-status">{pending ? "waiting for user" : data.status}</span>
                </div>
                
                <div className="approval-card-body">
                    Zeus needs you to complete a manual task in the browser before it can continue.
                    {data.reason && <div style={{ marginTop: "10px", padding: "10px", background: "rgba(0,0,0,0.1)", borderRadius: "6px" }}><strong>Reason:</strong> {data.reason}</div>}
                </div>
                
                {pending ? (
                    <div className="align-center gap-10" style={{ marginTop: "10px" }}>
                        <button className="confirm-dialog-button danger" onClick={() => onDecision(false, null, { messageId: message.id, mode: "once" })}>
                            <label>Cancel Task</label>
                        </button>
                        
                        <button className="confirm-dialog-button" onClick={() => onDecision(true, null, { messageId: message.id, mode: "once" })}>
                            <label>Done, Resume Agent</label>
                        </button>
                    </div>
                ) : null}
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
            {open && <div className="reasoning-pill-body markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{reasoning}</ReactMarkdown></div>}
        </div>
    );
}

function ChatMessage({ message, streaming = false, reasoning = "", onApprovalDecision, onHandoffDecision, onChoiceDecision }) {
    if (message.role === "user") {
        return (
            <div className="chat-message user">
                <div className="chat-bubble">
                    <div className="chat-bubble-content markdown-body">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                    </div>
                </div>
            </div>
        );
    }

    if (message.role === "event") {
        if (message.kind === "action") return <ActionCard message={message} />;
        if (message.kind === "approval") return <ApprovalCard message={message} onDecision={onApprovalDecision} />;
        if (message.kind === "handoff") return <HandoffCard message={message} onDecision={onHandoffDecision} />;
        if (message.kind === "choice") return <InteractiveChoiceCard message={message} onDecision={onChoiceDecision} />;
        if (message.kind === "worker_started" || message.kind === "worker_update") return <WorkerCard message={message} />;
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
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
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