import { useEffect, useRef, useState } from "react";
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
    const [tasks, setTasks] = useState([]);
    const [activeTaskId, setActiveTaskId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [spend, setSpend] = useState({ spent_credits: 0, budget_credits: 40000 });
    const [sending, setSending] = useState(false);
    const [thinkingStage, setThinkingStage] = useState(null); // null | "connecting" | "connected" | "generating"
    const [streamText, setStreamText] = useState("");
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [inputExpanded, setInputExpanded] = useState(false);
    const [toastObj, setToastObj] = useState({ show: false, message: null, duration: 3000, type: "error" });

    const inputRef = useRef(null);
    const messagesContainerRef = useRef(null);
    // streamed text is mirrored in a ref so the chat-stream listener always
    // sees the latest value without re-subscribing
    const streamTextRef = useRef("");
    const activeTaskIdRef = useRef(null);

    const activeTask = tasks.find((t) => t.id === activeTaskId) || null;
    const spendRatio = spend.budget_credits > 0 ? spend.spent_credits / spend.budget_credits : 0;

    const showToast = (message, type = "error", duration = 5000) => {
        setToastObj({ show: true, message, type, duration });
    };

    const refreshTasks = async () => {
        try {
            setTasks(await bridge.listTasks());
        } catch (err) {
            showToast(`Failed to load tasks: ${err}`);
        }
    };

    const handleSelectTask = async (task) => {
        setActiveTaskId(task.id);
        setSpend({ spent_credits: task.spent_credits, budget_credits: task.budget_credits });
        setStreamText("");
        streamTextRef.current = "";
        try {
            setMessages(await bridge.getTaskMessages(task.id));
        } catch (err) {
            showToast(`Failed to load messages: ${err}`);
        }
    };

    const handleNewTask = async () => {
        try {
            const task = await bridge.createTask(null);
            setTasks((prev) => [task, ...prev]);
            setActiveTaskId(task.id);
            setMessages([]);
            setSpend({ spent_credits: task.spent_credits, budget_credits: task.budget_credits });
        } catch (err) {
            showToast(`Failed to create the task: ${err}`);
        }
    };

    const handleSend = async () => {
        const content = inputRef.current.value.trim();
        if (!content || sending || !activeTaskId) return;

        inputRef.current.value = "";
        setSending(true);
        setThinkingStage("connecting");
        setStreamText("");
        streamTextRef.current = "";

        // Optimistic bubble: the user's prompt is visible immediately, before
        // any network or db work completes, so it is never "lost" visually.
        const optimisticUserMessage = {
            id: `local-${Date.now()}`,
            task_id: activeTaskId,
            role: "user",
            kind: "chat",
            content,
            created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, optimisticUserMessage]);

        try {
            const result = await bridge.sendUserMessage(activeTaskId, content);
            setMessages((prev) => [
                // swap the optimistic bubble for the persisted one, then append the reply
                ...prev.filter((m) => m.id !== optimisticUserMessage.id),
                result.user_message,
                result.assistant_message,
            ]);
            setSpend({ spent_credits: result.spent_credits, budget_credits: result.budget_credits });
            refreshTasks(); // keeps sidebar spend + auto-title in sync
        } catch (err) {
            // keep the user's bubble; surface the failure as a toast + inline event
            setMessages((prev) => [
                ...prev,
                {
                    id: `error-${Date.now()}`,
                    task_id: activeTaskId,
                    role: "event",
                    kind: "chat",
                    content: String(err).includes("BUDGET_EXCEEDED")
                        ? "This task reached its unit budget. Per-task budget editing lands soon — start a new task for now."
                        : `Zeus failed to respond: ${err}. Your message above is preserved — you can resend it.`,
                    created_at: new Date().toISOString(),
                },
            ]);
            if (String(err).includes("BUDGET_EXCEEDED")) {
                showToast("This task reached its unit budget.", "warning", 7000);
            } else {
                showToast(String(err), "error", 8000);
            }
        } finally {
            setSending(false);
            setThinkingStage(null);
            setStreamText("");
            streamTextRef.current = "";
        }
    };

    const handleInputKeyDown = (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSend();
        }
    };

    // initial load: task list + first-run API key check
    useEffect(() => {
        (async () => {
            try {
                const keySet = await bridge.hasApiKey();
                if (!keySet) {
                    setIsSettingsOpen(true);
                    showToast("Set your RouteLLM API key in Settings to start.", "info", 6000);
                }
                await refreshTasks();
            } catch (err) {
                showToast(String(err));
            }
        })();
    }, []);

    useEffect(() => {
        activeTaskIdRef.current = activeTaskId;
    }, [activeTaskId]);

    // subscribe once to the backend's token stream
    useEffect(() => {
        let unlistenPromise = bridge.onChatStream((payload) => {
            if (!payload || payload.task_id !== activeTaskIdRef.current) return;
            const event = payload.event;
            if (event.type === "status") {
                setThinkingStage(event.stage);
            } else if (event.type === "delta") {
                streamTextRef.current += event.text;
                setStreamText(streamTextRef.current);
            }
        });
        return () => {
            unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
        };
    }, []);

    // keep the message list pinned to the bottom
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (container) container.scrollTop = container.scrollHeight;
    }, [messages, sending, streamText]);

    const thinkingLabel = thinkingStage === "generating"
        ? "Zeus is generating the reply..."
        : thinkingStage === "connected"
            ? "Connected — waiting for the first tokens..."
            : "Contacting the model...";

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

            <Modal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} closeOnHover={false}>
                <SettingsModal onToast={showToast} onClose={() => setIsSettingsOpen(false)} />
            </Modal>

            <Sidebar
                tasks={tasks}
                activeTaskId={activeTaskId}
                onSelectTask={handleSelectTask}
                onNewTask={handleNewTask}
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
                            <div id="chat-spend-container" className="align-center gap-10 no-user-select" title="Units spent on this task vs. its budget">
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

                        <div ref={messagesContainerRef} id="chat-messages" className="column gap-15">
                            {messages.map((message) => (
                                <ChatMessage key={message.id} message={message} />
                            ))}
                            {sending && (
                                <div className="chat-message assistant">
                                    <div className="chat-bubble column">
                                        <label className="chat-bubble-author">Zeus</label>
                                        {streamText ? (
                                            <ChatMessage message={{ role: "assistant", content: streamText }} streaming={true} />
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