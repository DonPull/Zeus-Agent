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
import ChatLogModal from "./components/ChatLogModal";
import Toast from "./components/Toast";
import Modal from "./components/Modal";
import { formatCredits, isHiddenPipelineMessage } from "./utils";

const WARN_PROMPT_CHARS = 5000;

function App() {
    const [tasks, setTasks] = useState([]);
    const [activeTaskId, setActiveTaskId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [spend, setSpend] = useState({ spent_credits: 0, budget_credits: 3000 });
    const [sending, setSending] = useState(false);
    const [thinkingStage, setThinkingStage] = useState(null);
    const [streamText, setStreamText] = useState("");
    const [reasoningText, setReasoningText] = useState("");
    const [directiveMode, setDirectiveMode] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isChatLogOpen, setIsChatLogOpen] = useState(false);
    const [inputExpanded, setInputExpanded] = useState(false);
    const [inputValue, setInputValue] = useState("");
    const [toastObj, setToastObj] = useState({ show: false, message: null, duration: 3000, type: "error" });

    const messagesContainerRef = useRef(null);
    const streamTextRef = useRef("");
    const reasoningTextRef = useRef("");
    const directiveModeRef = useRef(false);
    const streamFlushedRef = useRef(false);
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
        setReasoningText("");
        streamTextRef.current = "";
        reasoningTextRef.current = "";
        directiveModeRef.current = false;
        streamFlushedRef.current = false;
        setDirectiveMode(false);
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

    const handleRenameTask = async (taskId, newTitle) => {
        try {
            await bridge.renameTask(taskId, newTitle);
            refreshTasks();
        } catch (err) {
            showToast(`Failed to rename the task: ${err}`);
        }
    };

    const handleDeleteTask = async (taskId) => {
        try {
            await bridge.deleteTask(taskId);
            if (activeTaskId === taskId) {
                setActiveTaskId(null);
                setMessages([]);
            }
            refreshTasks();
            showToast("Task deleted.", "info", 3000);
        } catch (err) {
            showToast(`Failed to delete the task: ${err}`);
        }
    };

    const handleApprovalDecision = (approved, note) => {
        const verb = approved ? "APPROVED" : "DENIED";
        const extra = note && note.trim() ? ` Note: ${note.trim()}` : "";
        handleSend(`[APPROVAL DECISION] ${verb}.${extra}`);
    };

    const handleSend = async (overrideContent) => {
        const content = (typeof overrideContent === "string" ? overrideContent : inputValue).trim();
        if (!content || sending || !activeTaskId) return;

        if (typeof overrideContent !== "string") setInputValue("");
        setSending(true);
        setThinkingStage("connecting");
        setStreamText("");
        setReasoningText("");
        streamTextRef.current = "";
        reasoningTextRef.current = "";
        directiveModeRef.current = false;
        streamFlushedRef.current = false;
        setDirectiveMode(false);

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
            setMessages((prev) => {
                const next = prev.map((m) => (m.id === optimisticUserMessage.id ? result.user_message : m));
                next.push(result.assistant_message);
                return next;
            });
            setSpend({ spent_credits: result.spent_credits, budget_credits: result.budget_credits });
            refreshTasks();
        } catch (err) {
            const errStr = String(err);
            if (errStr.includes("BUDGET_EXCEEDED")) {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `error-${Date.now()}`,
                        task_id: activeTaskId,
                        role: "event",
                        kind: "error",
                        content: "This task reached its unit budget. Per-task budget editing lands in M1b — start a new task for now.",
                        created_at: new Date().toISOString(),
                    },
                ]);
                showToast("This task reached its unit budget.", "warning", 7000);
            } else {
                showToast(errStr, "error", 8000);
            }
        } finally {
            setSending(false);
            setThinkingStage(null);
            setStreamText("");
            setReasoningText("");
            streamTextRef.current = "";
            reasoningTextRef.current = "";
            directiveModeRef.current = false;
            streamFlushedRef.current = false;
            setDirectiveMode(false);
        }
    };

    const handleInputKeyDown = (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSend();
        }
    };

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

    useEffect(() => {
        let unlistenPromise = bridge.onChatStream((payload) => {
            if (!payload || payload.task_id !== activeTaskIdRef.current) return;
            const event = payload.event;
            if (event.type === "status") {
                setThinkingStage(event.stage);
                if (event.stage === "connected") {
                    // A new model stream iteration started. Reset buffers.
                    streamTextRef.current = "";
                    reasoningTextRef.current = "";
                    setStreamText("");
                    setReasoningText("");
                    directiveModeRef.current = false;
                    setDirectiveMode(false);
                    streamFlushedRef.current = false;
                }
            } else if (event.type === "delta") {
                streamTextRef.current += event.text;
                const full = streamTextRef.current;
                const directiveIdx = full.indexOf("```zeus-directive");
                if (directiveIdx !== -1) {
                    if (!directiveModeRef.current) {
                        directiveModeRef.current = true;
                        setDirectiveMode(true);
                    }
                    setStreamText(full.slice(0, directiveIdx));
                    return;
                }
                if (!streamFlushedRef.current) {
                    const head = full.trimStart();
                    if (head.length >= 17 || (head.length > 0 && !"```zeus-directive".startsWith(head))) {
                        streamFlushedRef.current = true;
                        setStreamText(full);
                    }
                    return;
                }
                setStreamText(full);
            } else if (event.type === "reasoning_delta") {
                reasoningTextRef.current += event.text;
                setReasoningText(reasoningTextRef.current);
            }
        });
        return () => {
            unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
        };
    }, []);

    useEffect(() => {
        let unlistenPromise = bridge.onTaskMessage((payload) => {
            if (!payload || payload.task_id !== activeTaskIdRef.current) return;
            setMessages((prev) => {
                if (prev.some((m) => m.id === payload.message.id)) {
                    return prev.map((m) => (m.id === payload.message.id ? payload.message : m));
                }
                return [...prev, payload.message];
            });
        });
        return () => {
            unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
        };
    }, []);

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (container) container.scrollTop = container.scrollHeight;
    }, [messages, sending, streamText, reasoningText]);

    const thinkingLabel =
        thinkingStage === "generating" ? "Zeus is generating the reply..." :
        thinkingStage === "reasoning"  ? "Zeus is thinking (reasoning through the problem)..." :
        thinkingStage === "connected"  ? "Connected — waiting for the first tokens..." :
                                         "Contacting the model...";

    const showReasoningPill = sending && (reasoningText.length > 0 || thinkingStage === "reasoning");

    return (
        <main id="app-container">
            {toastObj.show && (
                <Toast
                    closeToastCallbackFunction={() => setToastObj((prev) => ({ ...prev, show: false }))}
                    position="bottom right"
                    toastMessage={toastObj.message}
                    notificationDurationInMs={toastObj.duration}
                    notificationType={toastObj.type}
                />
            )}

            <Modal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} closeOnHover={false}>
                <SettingsModal onClose={() => setIsSettingsOpen(false)} onToast={showToast} />
            </Modal>

            <Modal isOpen={isChatLogOpen} onClose={() => setIsChatLogOpen(false)} closeOnHover={false} className="compact">
                {activeTask && <ChatLogModal messages={messages} taskId={activeTask.id} taskTitle={activeTask.title} />}
            </Modal>

            <Sidebar
                activeTaskId={activeTaskId}
                onDeleteTask={handleDeleteTask}
                onNewTask={handleNewTask}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onRenameTask={handleRenameTask}
                onSelectTask={handleSelectTask}
                tasks={tasks}
            />

            <div id="chat-region" className="column">
                {!activeTask ? (
                    <div id="empty-state" className="column align-center justify-center no-user-select">
                        <div id="empty-state-logo" className="align-center gap-15">
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
                            <div className="align-center gap-15">
                                <div id="chat-spend-container" className="align-center gap-10 no-user-select" title="Units spent on this task vs. its budget">
                                    <label id="chat-spend-label">{formatCredits(spend.spent_credits)} / {spend.budget_credits} units</label>
                                    <div id="chat-spend-bar">
                                        <div
                                            id="chat-spend-bar-fill"
                                            style={{ width: `${Math.min(100, spendRatio * 100)}%`, background: spendRatio >= 0.8 ? "#ff5c5c" : "" }}
                                        ></div>
                                    </div>
                                </div>
                                <button id="chat-log-button" title="View the full chat log and copy it" onClick={() => setIsChatLogOpen(true)}>
                                    <label>Chat log</label>
                                </button>
                            </div>
                        </div>

                        <div ref={messagesContainerRef} id="chat-messages" className="column gap-15">
                            {messages.filter((m) => !isHiddenPipelineMessage(m)).map((message) => (
                                <ChatMessage key={message.id} message={message} onApprovalDecision={handleApprovalDecision} />
                            ))}
                            {sending && (
                                <div className="chat-message assistant">
                                    <div className="chat-bubble column">
                                        <label className="chat-bubble-author">Zeus</label>
                                        {showReasoningPill && (
                                            <ChatMessage message={{ role: "assistant", content: "", reasoning: reasoningText, streaming: true }} />
                                        )}
                                        {streamText ? (
                                            <div className="chat-bubble-content markdown-body streaming">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown>
                                            </div>
                                        ) : !showReasoningPill ? (
                                            <div id="thinking-indicator" className="align-center gap-10 no-user-select">
                                                <div id="thinking-dots"><span></span><span></span><span></span></div>
                                                <label>{directiveMode ? "Zeus is working (executing a plan)..." : thinkingLabel}</label>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div id="chat-input-bar" className={`align-center gap-15 ${inputExpanded ? "expanded" : ""}`}>
                            <div id="chat-input-wrapper" className="relative">
                                <textarea
                                    id="chat-input"
                                    rows={3}
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
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
                            {inputValue.length > WARN_PROMPT_CHARS && (
                                <div id="chat-input-counter" title="No hard limit — automatic chunking for very long prompts is planned.">
                                    {inputValue.length} chars
                                </div>
                            )}
                            <button id="chat-send-button" className={sending ? "is-loading" : ""} onClick={() => handleSend()} disabled={sending}>
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