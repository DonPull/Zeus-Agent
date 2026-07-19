import ReactMarkdown from "react-markdown";
import { formatCredits, formatTime } from "../utils";

function ChatMessage({ message, streaming = false }) {
    if (message.role === "user") {
        return (
            <div className="chat-message user">
                <div className="chat-bubble">
                    <div className="chat-bubble-content markdown-body">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                </div>
            </div>
        );
    }

    if (message.role === "event") {
        return (
            <div className="chat-message event">
                <div className="chat-bubble event">
                    <div className="chat-bubble-content">{message.content}</div>
                </div>
            </div>
        );
    }

    // assistant
    return (
        <div className="chat-message assistant">
            <div className="chat-bubble column">
                {!streaming && <label className="chat-bubble-author">Zeus</label>}
                <div className={`chat-bubble-content markdown-body ${streaming ? "streaming" : ""}`}>
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
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