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
    const [note, setNote] = useState("");
    if (!data) return null;
    const pending = data.status === "pending";
    return (
        <div className="chat-message event">
            <div className={`chat-bubble approval-card column gap-10 ${pending ? "pending" : data.status === "approved" ? "approved" : "denied"}`}>
                <div className="approval-card-header align-center justify-space-between no-user-select">
                    <span className="approval-card-title">{data.summary}</span>
                    <span className="approval-card-status">{pending ? "needs approval" : data.status}</span>
                </div>
                {data.detail && <div className="approval-card-detail">{data.detail}</div>}
                {pending ? (
                    <>
                        <input
                            className="approval-card-note"
                            placeholder="Optional note to Zeus (e.g. constraints, changes)..."
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                        />
                        <div className="align-center gap-10">
                            <button className="confirm-dialog-button danger" onClick={() => onDecision(false, note)}>
                                <label>Deny</label>
                            </button>
                            <button className="confirm-dialog-button" onClick={() => onDecision(true, note)}>
                                <label>Approve</label>
                            </button>
                        </div>
                    </>
                ) : (
                    data.note ? <div className="approval-card-note-readonly">Note: {data.note}</div> : null
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

function ChatMessage({ message, streaming = false, reasoning = "", onApprovalDecision }) {
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