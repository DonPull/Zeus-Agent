import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./styles/App.css";
import "./styles/common.css";
import "./styles/Sidebar.css";
import "./styles/Chat.css";
import "./styles/SettingsModal.css";
import * as bridge from "./bridge";
import Sidebar from "./components/Sidebar";
import ChatMessage from "./components/ChatMessage";
import SettingsModal from "./components/SettingsModal";
import Toast from "./components/Toast";
import Modal from "./components/Modal";
import { formatCredits } from "./utils";

function App() {
    const [tasks, setTasks]       = useState([]);
    const [activeTaskId, setActiveTaskId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [spend, setSpend]       = useState({ spent_credits: 0, budget_credits: 40000 });
    const [sending, setSending]   = useState(false);
    const [thinkingStage, setThinkingStage] = useState(null); // null | "connecting" | "connected" | "generating"
    const [streamText, setStreamText] = useState("");
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isChatLogOpen,  setIsChatLogOpen]  = useState(false);
    const [inputExpanded,  setInputExpanded]  = useState(false);
    const [toastObj, setToastObj] = useState({ show: false, message: null, duration: 3000, type: "error" });

    const inputRef            = useRef(null);
    const messagesContainerRef = useRef(null);
    const streamTextRef       = useRef("");
    const activeTaskIdRef     = useRef(null);

    const activeTask  = tasks.find((t) => t.id === activeTaskId) || null;
    const spendRatio  = spend.budget_credits > 0 ? spend.spent_credits / spend.budget_credits : 0;

    const showToast = (message, type = "error", duration = 5000) =>
        setToastObj({ show: true, message, type, duration });

    const refreshTasks = async () => {
        try { setTasks(await bridge.listTasks()); }
        catch (err) { showToast(`Failed to load tasks: ${err}`); }
    };

    const handleSelectTask = async (task) => {
        setActiveTaskId(task.id);
        setSpend({ spent_credits: task.spent_credits, budget_credits: task.budget_credits });
        setStreamText(""); streamTextRef.current = "";
        try { setMessages(await bridge.getTaskMessages(task.id)); }
        catch (err) { showToast(`Failed to load messages: ${err}`); }
    };

    const handleNewTask = async () => {
        try {
            const task = await bridge.createTask(null);
            setTasks((prev) => [task, ...prev]);
            setActiveTaskId(task.id);
            setMessages([]);
            setSpend({ spent_credits: task.spent_credits, budget_credits: task.budget_credits });
        } catch (err) { showToast(`Failed to create the task: ${err}`); }
    };

    const handleRenameTask = async (taskId, newTitle) => {
        try {
            await bridge.renameTask(taskId, newTitle);
            setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, title: newTitle } : t));
        } catch (err) { showToast(`Failed to rename task: ${err}`); }
    };

    const handleDeleteTask = async (taskId) => {
        try {
            await bridge.deleteTask(taskId);
            setTasks((prev) => prev.filter((t) => t.id !== taskId));
            if (activeTaskId === taskId) {
                setActiveTaskId(null);
                setMessages([]);
                setSpend({ spent_credits: 0, budget_credits: 40000 });
            }
        } catch (err) { showToast(`Failed to delete task: ${err}`); }
    };

    const handleSend = async () => {
        const content = inputRef.current.value.trim();
        if (!content || sending || !activeTaskId) return;

        inputRef.current.value = "";
        setSending(true);
        setThinkingStage("connecting");
        setStreamText(""); streamTextRef.current = "";

        // Optimistic bubble: visible immediately so the prompt is never "lost"
        const optimisticUserMessage = {
            id: `local-${Date.now()}`,
            task_id: activeTaskId,
            role: "user", kind: "chat",
            content,
            created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimisticUserMessage]);

        try {
            const result = await bridge.sendUserMessage(activeTaskId, content);
            setMessages((prev) => [
                ...prev.filter((m) => m.id !== optimisticUserMessage.id),
                result.user_message,
                result.assistant_message,
            ]);
            setSpend({ spent_credits: result.spent_credits, budget_credits: result.budget_credits });
            refreshTasks();
        } catch (err) {
            setMessages((prev) => [...prev, {
                id: `error-${Date.now()}`, task_id: activeTaskId,
                role: "event", kind: "chat",
                content: String(err).includes("BUDGET_EXCEEDED")
                    ? "This task reached its unit budget. Start a new task for now."
                    : `Zeus failed to respond: ${err}. Your message above is preserved — you can resend it.`,
                created_at: new Date().toISOString(),
            }]);
            if (String(err).includes("BUDGET_EXCEEDED")) showToast("This task reached its unit budget.", "warning", 7000);
            else showToast(String(err), "error", 8000);
        } finally {
            setSending(false);
            setThinkingStage(null);
            setStreamText(""); streamTextRef.current = "";
        }
    };

    const handleInputKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    const buildChatLogText = () =>
        messages
            .filter((m) => m.role !== "event")
            .map((m) => {
                const who  = m.role === "user" ? "You" : "Zeus";
                const time = m.created_at ? new Date(m.created_at).toLocaleString() : "";
                return `[${who}] ${time}\n${m.content}`;
            })
            .join("\n\n---\n\n");

    const handleCopyChatLog = () => {
        navigator.clipboard.writeText(buildChatLogText())
            .then(()  => showToast("Chat log copied to clipboard.", "success", 3000))
            .catch(()  => showToast("Failed to copy to clipboard.", "error", 4000));
    };

    // ---- lifecycle hooks ----
    useEffect(() => {
        (async () => {
            try {
                const keySet = await bridge.hasApiKey();
                if (!keySet) { setIsSettingsOpen(true); showToast("Set your RouteLLM API key in Settings to start.", "info", 6000); }
                await refreshTasks();
            } catch (err) { showToast(String(err)); }
        })();
    }, []);

    useEffect(() => { activeTaskIdRef.current = activeTaskId; }, [activeTaskId]);

    useEffect(() => {
        let unlistenPromise = bridge.onChatStream((payload) => {
            if (!payload || payload.task_id !== activeTaskIdRef.current) return;
            const event = payload.event;
            if (event.type === "status")      setThinkingStage(event.stage);
            else if (event.type === "delta")  { streamTextRef.current += event.text; setStreamText(streamTextRef.current); }
        });
        return () => { unlistenPromise.then((u) => u()).catch(() => {}); };
    }, []);

    useEffect(() => {
        const c = messagesContainerRef.current;
        if (c) c.scrollTop = c.scrollHeight;
    }, [messages, sending, streamText]);

    const thinkingLabel =
        thinkingStage === "generating" ? "Zeus is generating the reply..." :
        thinkingStage === "reasoning"  ? "Zeus is reasoning through the problem (thinking models do this before writing the answer)..." :
        thinkingStage === "connected"  ? "Connected — waiting for the first tokens..." :
                                         "Contacting the model...";

    return (
        <main id="app-container">
            {toastObj.show && (
                <Toast
                    possition="bottom right"
                    closeToastCallbackFunction={() => setToastObj((prev) => ({ ...prev, show: false }))}
                    toastMessage={toastObj.message}
                    notificationDurationInMs={toastObj.duration}
                    notificationType={toastObj.type}
                />
            )}

            {/* Settings modal */}
            <Modal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} closeOnHover={false}>
                <SettingsModal onToast={showToast} onClose={() => setIsSettingsOpen(false)} />
            </Modal>

            {/* Chat log modal */}
            <Modal isOpen={isChatLogOpen} onClose={() => setIsChatLogOpen(false)} closeOnHover={false}>
                <div id="chat-log-modal" className="column gap-15">
                    <div className="align-center justify-space-between">
                        <label id="chat-log-title">Chat Log</label>
                        <div className="align-center gap-10">
                            <button className="settings-button" onClick={handleCopyChatLog}>
                                <label>Copy all</label>
                            </button>
                            <button className="chat-log-close-btn" title="Close" onClick={() => setIsChatLogOpen(false)}>
                                <label>✕</label>
                            </button>
                        </div>
                    </div>
                    <div id="chat-log-entries" className="column gap-15">
                        {messages.filter((m) => m.role !== "event").map((m) => (
                            <div key={m.id} className={`chat-log-entry column gap-5 ${m.role}`}>
                                <div className="align-center gap-10 no-user-select">
                                    <span className="chat-log-role">{m.role === "user" ? "You" : "Zeus"}</span>
                                    {m.model && <span className="chat-meta-pill mono">{m.model}</span>}
                                    {m.credits_used != null && (
                                        <span className="chat-meta-pill credits">{formatCredits(m.credits_used)} units</span>
                                    )}
                                </div>
                                <pre className="chat-log-content">{m.content}</pre>
                            </div>
                        ))}
                    </div>
                </div>
            </Modal>

            <Sidebar
                tasks={tasks}
                activeTaskId={activeTaskId}
                onSelectTask={handleSelectTask}
                onNewTask={handleNewTask}
                onRenameTask={handleRenameTask}
                onDeleteTask={handleDeleteTask}
                onOpenSettings={() => setIsSettingsOpen(true)}
            />

            <div id="chat-region" className="column">
                {!activeTask ? (
                    <div id="empty-state" className="column align-center justify-center no-user-select">
                        <div id="empty-state-logo" className="align-center gap-5">
                            <img src={new URL("./assets/transparent-logo.png", import.meta.url).href} alt="Zeus logo" />
                            <div className="column">
                                <span>Zeus</span>
                                <span>Agent</span>
                            </div>
                        </div>
                        <label id="empty-state-hint">Create a task and Zeus will plan, spawn workers and build actions for you.</label>
                        <button id="empty-state-new-task-button" onClick={handleNewTask}>
                            <label>+ New Task</label>
                        </button>
                    </div>
                ) : (
                    <>
                        <div id="chat-top-bar" className="align-center">
                            <label id="chat-task-title" title={activeTask.title}>{activeTask.title}</label>
                            <div className="align-center gap-15 no-user-select">
                                <button id="chat-log-button" title="View full chat log" onClick={() => setIsChatLogOpen(true)}>
                                    <label>Chat Log</label>
                                </button>
                                <div id="chat-spend-container" className="align-center gap-10" title="Units spent on this task vs. its budget">
                                    <label id="chat-spend-label">{formatCredits(spend.spent_credits)} / {spend.budget_credits} units</label>
                                    <div id="chat-spend-bar">
                                        <div
                                            id="chat-spend-bar-fill"
                                            style={{
                                                width: `${Math.min(100, spendRatio * 100)}%`,
                                                background: spendRatio >= 0.8 ? "#ff5c5c" : ""
                                            }}
                                        ></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div ref={messagesContainerRef} id="chat-messages" className="column gap-15">
                            {messages.map((message) => (
                                <ChatMessage key={message.id} message={message} />
                            ))}
                            {sending && (
                                <div className="chat-message assistant">
                                    <div className="chat-bubble column">
                                        <label className="chat-bubble-author">Zeus</label>
                                        {/* Fix: render markdown content directly — do NOT nest ChatMessage here
                                            (ChatMessage wraps in its own .chat-message.assistant > .chat-bubble,
                                             creating a double-nested bubble) */}
                                        {streamText ? (
                                            <div className="chat-bubble-content markdown-body streaming">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown>
                                            </div>
                                        ) : (
                                            <div id="thinking-indicator" className="align-center gap-10 no-user-select">
                                                <div id="thinking-dots"><span></span><span></span><span></span></div>
                                                <label>{thinkingLabel}</label>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div id="chat-input-bar" className={`align-center gap-15 ${inputExpanded ? "expanded" : ""}`}>
                            <div id="chat-input-wrapper" className="relative">
                                <textarea
                                    ref={inputRef}
                                    id="chat-input"
                                    rows={3}
                                    placeholder="Describe the goal for Zeus... (Enter to send, Shift+Enter for a new line)"
                                    onKeyDown={handleInputKeyDown}
                                ></textarea>
                                <button
                                    id="chat-input-expand-button"
                                    title={inputExpanded ? "Shrink the prompt box" : "Expand the prompt box"}
                                    onClick={() => setInputExpanded((prev) => !prev)}
                                >
                                    <label>{inputExpanded ? "⤡" : "⤢"}</label>
                                </button>
                            </div>
                            <button id="chat-send-button" className={sending ? "is-loading" : ""} onClick={handleSend} disabled={sending}>
                                <label>{sending ? "Working..." : "Send"}</label>
                            </button>
                        </div>
                    </>
                )}
            </div>
        </main>
    );
}

export default App;