import { useState } from "react";
import { formatTime } from "../utils";
import * as bridge from "../bridge";

function renderEntry(m) {
    const time = m.created_at ? formatTime(m.created_at) : "";

    if (m.role === "user") {
        return `[${time}] YOU\n${m.content}\n`;
    }

    if (m.role === "assistant") {
        return `[${time}] ZEUS\n${m.content}\n`;
    }

    if (m.kind === "action") {
        try {
            const d = JSON.parse(m.content);
            return `[${time}] ACTION (exit ${d.exit_code})\n--- code ---\n${d.code}\n--- stdout ---\n${d.stdout || "(empty)"}\n--- stderr ---\n${d.stderr || "(empty)"}\n`;
        } catch {
            return `[${time}] ACTION\n${m.content}\n`;
        }
    }

    if (m.kind === "approval") {
        try {
            const d = JSON.parse(m.content);
            return `[${time}] APPROVAL (${d.status})\n${d.summary}\n${d.detail || ""}\n`;
        } catch {
            return `[${time}] APPROVAL\n${m.content}\n`;
        }
    }

    return `[${time}] EVENT\n${m.content}\n`;
}

function ChatLogModal({ taskTitle, taskId, messages }) {
    const [copied, setCopied] = useState(false);
    const [debugCopied, setDebugCopied] = useState(false);

    // The normal chat and normal chat log now consume the exact same live
    // projection. Persistent task-message events update App's array, which
    // causes this modal to update in the same render.
    const text = messages
        .map(renderEntry)
        .join("\n----------------------------------------\n\n");

    const copyAll = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopied(false);
        }
    };

    // Debug output intentionally fetches the DB independently because it needs
    // hidden pipeline messages that are excluded from the normal projection.
    const copyDebugLog = async () => {
        try {
            const [backendLog, dbMessages] = await Promise.all([
                bridge.getDebugLog(taskId),
                bridge.getTaskMessages(taskId, true),
            ]);

            const rawMessages = dbMessages
                .map(
                    (m) =>
                        `[${m.created_at}] seq=${m.seq} role=${m.role} kind=${m.kind} visible=${m.visible}\n${m.content}`
                )
                .join("\n----------------------------------------\n");

            await navigator.clipboard.writeText(
                `===== ZEUS DEBUG LOG (task ${taskId}) =====\n\n` +
                `--- BACKEND EVENTS ---\n${backendLog || "(empty)"}\n\n` +
                `--- RAW MESSAGES (incl. hidden) ---\n${rawMessages}`
            );

            setDebugCopied(true);
            setTimeout(() => setDebugCopied(false), 2000);
        } catch {
            setDebugCopied(false);
        }
    };

    return (
        <div id="chat-log-modal" className="column gap-15">
            <div className="align-center justify-space-between">
                <label id="chat-log-title">Chat log — {taskTitle}</label>

                <div className="align-center gap-10">
                    <button
                        id="chat-log-copy-debug"
                        className="confirm-dialog-button"
                        onClick={copyDebugLog}
                        title="TEMPORARY: copies internal debug info for bug reports"
                    >
                        <label>
                            {debugCopied ? "Copied!" : "Copy debug log"}
                        </label>
                    </button>

                    <button
                        id="chat-log-copy"
                        className="confirm-dialog-button"
                        onClick={copyAll}
                    >
                        <label>{copied ? "Copied!" : "Copy all"}</label>
                    </button>
                </div>
            </div>

            <pre id="chat-log-body">{text}</pre>
        </div>
    );
}

export default ChatLogModal;