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
import TaskSettingsModal from "./components/TaskSettingsModal";
import ChatLogModal from "./components/ChatLogModal";
import TaskPermissionsModal from "./components/TaskPermissionsModal";
import Toast from "./components/Toast";
import Modal from "./components/Modal";
import ActionPlanPanel from "./components/ActionPlanPanel";
import { formatCredits, mergeMessages } from "./utils";

const WARN_PROMPT_CHARS = 5000;

const createRequestId = () => {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

function App() {
    const [tasks, setTasks] = useState([]);
    const [activeTaskId, setActiveTaskId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [spend, setSpend] = useState({ spent_credits: 0, budget_credits: 3000 });
    const [sending, setSending] = useState(false);
    const [sendingTaskId, setSendingTaskId] = useState(null);
    const [stopping, setStopping] = useState(false);
    const [showJumpToLatest, setShowJumpToLatest] = useState(false);
    const [thinkingStage, setThinkingStage] = useState(null);
    const [streamText, setStreamText] = useState("");
    const [reasoningText, setReasoningText] = useState("");
    const [directiveMode, setDirectiveMode] = useState(false);

    // Modals
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isTaskSettingsOpen, setIsTaskSettingsOpen] = useState(false);
    const [isTaskPermsOpen, setIsTaskPermsOpen] = useState(false);
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
    const scrollPinnedRef = useRef(true);

    // React state is not synchronous. This ref closes the small window in which
    // two Enter/click events could both observe sending === false.
    const sendLockRef = useRef(false);

    const activeTask = tasks.find((t) => t.id === activeTaskId) || null;
    const activeTaskIsSending = sending && sendingTaskId === activeTaskId;
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

    // P0: the ONE reconcile path. Re-fetches the visible message list from the
    // DB and replaces local state wholesale, guarded by the active task.
    // Guarantees "live state" === "state after refresh" by construction.
    const reconcileMessages = async (taskId) => {
        try {
            const fresh = await bridge.getTaskMessages(taskId);
            if (activeTaskIdRef.current !== taskId) return;
            setMessages(fresh);
        } catch (err) {
            showToast(`Failed to load messages: ${err}`);
        }
    };

    const applyRunState = async (taskId, run) => {
        if (!run || activeTaskIdRef.current !== taskId) return;

        const isActive = run.status === "running" || run.status === "stopping";

        setSending(isActive);
        setSendingTaskId(isActive ? taskId : null);
        setStopping(run.status === "stopping");
        sendLockRef.current = isActive;

        if (!isActive) {
            setStopping(false);
            setThinkingStage(null);
            setStreamText("");
            setReasoningText("");
            streamTextRef.current = "";
            reasoningTextRef.current = "";
            directiveModeRef.current = false;
            streamFlushedRef.current = false;
            setDirectiveMode(false);

            await reconcileMessages(taskId);

            try {
                const freshSpend = await bridge.getTaskSpend(taskId);
                if (activeTaskIdRef.current === taskId) {
                    setSpend(freshSpend);
                }
            } catch (err) {
                showToast(`Failed to refresh task spend: ${err}`);
            }
        }
    };

    const reconcileRunState = async (taskId) => {
        try {
            const run = await bridge.getTaskRunState(taskId);
            await applyRunState(taskId, run);
        } catch (err) {
            showToast(`Failed to load task run state: ${err}`);
        }
    };

    const handleSelectTask = async (task) => {
        setActiveTaskId(task.id);
        activeTaskIdRef.current = task.id; // set synchronously so the reconcile guard passes
        setSpend({ spent_credits: task.spent_credits, budget_credits: task.budget_credits });
        setStreamText("");
        setReasoningText("");
        streamTextRef.current = "";
        reasoningTextRef.current = "";
        directiveModeRef.current = false;
        streamFlushedRef.current = false;
        setDirectiveMode(false);
        scrollPinnedRef.current = true;
        setShowJumpToLatest(false);
        setMessages([]);
        await Promise.all([
            reconcileMessages(task.id),
            reconcileRunState(task.id),
        ]);
    };

    const handleNewTask = async () => {
        try {
            const task = await bridge.createTask(null);
            setTasks((prev) => [task, ...prev]);
            setActiveTaskId(task.id);
            activeTaskIdRef.current = task.id;
            scrollPinnedRef.current = true;
            setShowJumpToLatest(false);
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
                activeTaskIdRef.current = null;
                setMessages([]);
            }
            refreshTasks();
            showToast("Task deleted.", "info", 3000);
        } catch (err) {
            showToast(`Failed to delete the task: ${err}`);
        }
    };

    const handleApprovalDecision = async (approved, note, permData) => {
        if (approved && permData) {
            let mode = permData.mode;
            let cmdToSave = null;
            let typeToSave = null;

            if (mode === "once" && permData.blocked) {
                if (permData.blocked.type === "run_command") {
                    cmdToSave = permData.blocked.command;
                    typeToSave = "command";
                } else if (permData.blocked.type === "read_file") {
                    cmdToSave = permData.blocked.path;
                    typeToSave = "read";
                } else if (permData.blocked.type === "write_file") {
                    cmdToSave = permData.blocked.path;
                    typeToSave = "write";
                }
            } else if (mode && mode.startsWith("task_") && permData.command) {
                cmdToSave = mode === "task_app" ? permData.command.split(" ")[0] : permData.command;
                typeToSave = "command";
            }

            if (cmdToSave && typeToSave) {
                try {
                    const scope = activeTaskIdRef.current;
                    await bridge.addFilePermission(scope, cmdToSave, "allow", typeToSave);
                    showToast(`Permission saved for: ${cmdToSave}`, "success", 2000);
                } catch (err) {
                    showToast(`Failed to save permission: ${err}`);
                }
            }
        }
        
        const verb = approved ? "APPROVED" : "DENIED";
        const extra = note && note.trim() ? ` Note: ${note.trim()}` : "";
        const retryInstruction = approved ? " Please retry your last directive now that permission is granted." : " Please find an alternative approach or report failure.";
        
        try {
            await bridge.resolvePendingApprovals(activeTaskIdRef.current, approved);
            await reconcileMessages(activeTaskIdRef.current);
        } catch (err) {
            console.error("Failed to resolve pending approvals", err);
        }

        handleSend(`[APPROVAL DECISION] ${verb}.${extra}${retryInstruction}`);
    };

    const handleSend = async (overrideContent) => {
        const content = (typeof overrideContent === "string" ? overrideContent : inputValue).trim();
        if (!content || sendLockRef.current || !activeTaskId) return;

        // Lock synchronously before React commits the state update.
        sendLockRef.current = true;

        // Capture the task this invocation belongs to. Streaming and persistent
        // events are already guarded using the task ID.
        const taskAtSend = activeTaskId;

        if (typeof overrideContent !== "string") setInputValue("");
        setSending(true);
        setSendingTaskId(taskAtSend);
        setThinkingStage("connecting");
        setStreamText("");
        setReasoningText("");
        streamTextRef.current = "";
        reasoningTextRef.current = "";
        directiveModeRef.current = false;
        streamFlushedRef.current = false;
        setDirectiveMode(false);

        try {
            const requestId = createRequestId();
            const result = await bridge.sendUserMessage(
                taskAtSend,
                content,
                requestId,
            );
            if (activeTaskIdRef.current === taskAtSend) {
                setSpend({ spent_credits: result.spent_credits, budget_credits: result.budget_credits });
                // Reconcile drops the optimistic echo and guarantees the list
                // matches the DB exactly (order, content, approval stamps).
                await reconcileMessages(taskAtSend);
            }
            refreshTasks();
        } catch (err) {
            const errStr = String(err);
            if (errStr.includes("RUN_CANCELLED")) {
                if (activeTaskIdRef.current === taskAtSend) {
                    await Promise.all([
                        reconcileMessages(taskAtSend),
                        reconcileRunState(taskAtSend),
                    ]);
                }
                showToast("Zeus stopped the run.", "info", 3500);
            } else if (errStr.includes("BUDGET_EXCEEDED")) {
                // Do not create a local chat event. Chat contents must come from the DB.
                showToast("This task reached its unit budget.", "warning", 7000);
            } else if (errStr.includes("REQUEST_ALREADY_EXISTS")) {
                if (activeTaskIdRef.current === taskAtSend) {
                    await Promise.all([
                        reconcileMessages(taskAtSend),
                        reconcileRunState(taskAtSend),
                    ]);
                }
                showToast(
                    "This request was already recorded; Zeus did not run it twice.",
                    "info",
                    5000,
                );
            } else if (errStr.includes("TASK_ALREADY_RUNNING")) {
                // This can occur when the webview reloads while Rust is still processing
                // the original invocation. The existing run remains authoritative.
                if (activeTaskIdRef.current === taskAtSend) {
                    await reconcileMessages(taskAtSend);
                }
                showToast("This task is already running.", "info", 4000);
            } else {
                showToast(errStr, "error", 8000);
                // The backend persists errors as events; reconcile picks them up.
                if (activeTaskIdRef.current === taskAtSend) await reconcileMessages(taskAtSend);
            }
        } finally {
            if (activeTaskIdRef.current === taskAtSend) {
                await reconcileRunState(taskAtSend);
            } else {
                sendLockRef.current = false;
                setSending(false);
                setSendingTaskId(null);
            }
        }
    };

    const handleStop = async () => {
        if (!activeTaskId || !activeTaskIsSending || stopping) return;

        const taskAtStop = activeTaskId;
        setStopping(true);

        try {
            const run = await bridge.cancelTaskRun(taskAtStop);

            if (activeTaskIdRef.current === taskAtStop) {
                await applyRunState(taskAtStop, run);
            }
        } catch (err) {
            const errStr = String(err);

            if (errStr.includes("TASK_NOT_RUNNING")) {
                await reconcileRunState(taskAtStop);
                return;
            }

            setStopping(false);
            showToast(`Failed to stop Zeus: ${errStr}`, "error", 8000);
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
                
                const d1 = full.indexOf("```zeus-directive");
                const d2 = full.indexOf("<zeus-directive>");
                const d3 = full.indexOf('{"type":');
                
                let directiveIdx = -1;
                if (d1 !== -1) directiveIdx = d1;
                if (d2 !== -1 && (directiveIdx === -1 || d2 < directiveIdx)) directiveIdx = d2;
                if (d1 === -1 && d2 === -1 && d3 !== -1) directiveIdx = d3;

                if (directiveIdx !== -1) {
                    if (!directiveModeRef.current) {
                        directiveModeRef.current = true;
                        setDirectiveMode(true);
                    }
                    setStreamText(full.slice(0, directiveIdx).trimEnd());
                    return;
                }
                if (!streamFlushedRef.current) {
                    const head = full.trimStart();
                    if (head.length >= 17 || (head.length > 0 && !"```zeus-directive".startsWith(head) && !"<zeus-directive>".startsWith(head))) {
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
            setMessages((prev) => mergeMessages(prev, payload.message));
        });
        return () => {
            unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
        };
    }, []);

    useEffect(() => {
        const unlistenPromise = bridge.onTaskEvent((payload) => {
            if (!payload) return;

            // Sidebar status belongs to every task, not just the selected one.
            refreshTasks();

            if (payload.task_id === activeTaskIdRef.current) {
                applyRunState(payload.task_id, payload.run);
            }
        });

        return () => {
            unlistenPromise
                .then((unlisten) => unlisten())
                .catch(() => {});
        };
    }, []);

    const handleMessagesScroll = () => {
        const container = messagesContainerRef.current;
        if (!container) return;

        const distanceFromBottom =
            container.scrollHeight -
            container.scrollTop -
            container.clientHeight;

        const pinned = distanceFromBottom <= 80;
        scrollPinnedRef.current = pinned;
        setShowJumpToLatest(!pinned);
    };

    const jumpToLatest = () => {
        const container = messagesContainerRef.current;
        if (!container) return;

        scrollPinnedRef.current = true;
        setShowJumpToLatest(false);
        container.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
        });
    };

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container || !scrollPinnedRef.current) return;

        container.scrollTop = container.scrollHeight;
    }, [
        messages,
        activeTaskIsSending,
        streamText,
        reasoningText,
    ]);

    const thinkingLabel =
        thinkingStage === "generating" ? "Zeus is generating the reply..." :
        thinkingStage === "reasoning"  ? "Zeus is thinking (reasoning through the problem)..." :
        thinkingStage === "connected"  ? "Connected — waiting for the first tokens..." :
                                         "Contacting the model...";

    const showReasoningPill = activeTaskIsSending && (reasoningText.length > 0 || thinkingStage === "reasoning");

    // P0: the backend owns visibility. Hidden pipeline messages still arrive
    // via events (for the debug log) but are filtered by the DB flag alone.
    const visibleMessages = messages.filter((m) => m.visible !== false && m.kind !== "action_plan");

    const actionPlanMessage = messages.filter((m) => m.kind === "action_plan").pop();
    const actionPlanMarkdown = actionPlanMessage ? actionPlanMessage.content : "";

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

            <Modal isOpen={isTaskPermsOpen} onClose={() => setIsTaskPermsOpen(false)} closeOnHover={false}>
                {activeTask && (
                    <TaskPermissionsModal
                        taskId={activeTask.id}
                        taskTitle={activeTask.title}
                        onClose={() => setIsTaskPermsOpen(false)}
                        onToast={showToast}
                    />
                )}
            </Modal>

            <Modal isOpen={isTaskSettingsOpen} onClose={() => setIsTaskSettingsOpen(false)} closeOnHover={false}>
                {activeTask && (
                    <TaskSettingsModal
                        task={activeTask}
                        onClose={() => setIsTaskSettingsOpen(false)}
                        onSave={(updatedTask) => {
                            setActiveTask(updatedTask);
                            setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
                            setIsTaskSettingsOpen(false);
                            showToast("Task settings saved", "success", 3000);
                        }}
                    />
                )}
            </Modal>

            <Modal isOpen={isChatLogOpen} onClose={() => setIsChatLogOpen(false)} closeOnHover={false} className="compact">
                {activeTask && (
                    <ChatLogModal
                        taskId={activeTask.id}
                        taskTitle={activeTask.title}
                        messages={visibleMessages}
                    />
                )}
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
                                <button className="settings-button" title="Chat-scoped File Permissions" onClick={() => setIsTaskPermsOpen(true)}>
                                    <label>Permissions</label>
                                </button>
                                <button className="settings-button" title="Chat-scoped Settings" onClick={() => setIsTaskSettingsOpen(true)}>
                                    <label>Settings</label>
                                </button>
                            </div>
                        </div>

                        <div ref={messagesContainerRef} id="chat-messages" className="column gap-15" onScroll={handleMessagesScroll}>
                            {visibleMessages.map((message) => (
                                <ChatMessage key={message.id} message={message} onApprovalDecision={handleApprovalDecision} />
                            ))}
                            {activeTaskIsSending && (
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

                        {showJumpToLatest && (
                            <button
                                id="chat-jump-to-latest"
                                onClick={jumpToLatest}
                                title="Jump to the newest message"
                            >
                                <label>↓&nbsp;&nbsp;Latest</label>
                            </button>
                        )}

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
                            <button
                                id="chat-send-button"
                                className={
                                    activeTaskIsSending
                                        ? `stop-mode ${stopping ? "is-stopping" : ""}`
                                        : ""
                                }
                                onClick={
                                    activeTaskIsSending
                                        ? handleStop
                                        : () => handleSend()
                                }
                                disabled={
                                    activeTaskIsSending
                                        ? stopping
                                        : sending
                                }
                            >
                                <label>
                                    {activeTaskIsSending
                                        ? stopping
                                            ? "Stopping..."
                                            : "Stop"
                                        : sending
                                            ? "Busy in another task"
                                            : "Send"}
                                </label>
                            </button>
                        </div>
                    </>
                )}
            </div>

            <ActionPlanPanel actionPlanMarkdown={actionPlanMarkdown} />
        </main>
    );
}

export default App;