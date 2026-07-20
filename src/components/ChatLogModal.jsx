import { useState } from "react";
import { formatTime } from "../utils";

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

function ChatLogModal({ messages, taskTitle }) {
    const [copied, setCopied] = useState(false);
    const text = messages.map(renderEntry).join("\n----------------------------------------\n\n");

    const copyAll = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopied(false);
        }
    };

    return (
        <div id="chat-log-modal" className="column gap-15">
            <div className="align-center justify-space-between">
                <label id="chat-log-title">Chat log — {taskTitle}</label>
                <button id="chat-log-copy" className="confirm-dialog-button" onClick={copyAll}>
                    <label>{copied ? "Copied!" : "Copy all"}</label>
                </button>
            </div>
            <pre id="chat-log-body">{text}</pre>
        </div>
    );
}

export default ChatLogModal;