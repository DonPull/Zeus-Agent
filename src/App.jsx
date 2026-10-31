import { useEffect, useRef, useState } from "react";
import "./styles/App.css";
import "./styles/common.css";
import "./styles/Sidebar.css";
import "./styles/Chat.css";
import "./styles/SettingsModal.css";
import * as bridge from "./bridge";
import Sidebar from "./components/Sidebar";
import ChatMessage from "./components/ChatMessage";
import MessageMarkdown from './components/MessageMarkdown';
import ChatHeader from './components/ChatHeader';
import {titleFreeText} from './taskTitle';
import SettingsModal from "./components/SettingsModal";
import UiErrorBoundary from "./components/UiErrorBoundary";
import TaskSettingsModal from "./components/TaskSettingsModal";
import BrowserSessionReplayModal from "./components/BrowserSessionReplayModal";
import BrowserLiveViewModal from "./components/BrowserLiveViewModal";
import BrowserHistoryModal from "./components/BrowserHistoryModal";
import ChatLogModal from "./components/ChatLogModal";
import TaskPermissionsModal from "./components/TaskPermissionsModal";
import Toast from "./components/Toast";
import Modal from "./components/Modal";
import ActionPlanPanel from "./components/ActionPlanPanel";
import { mergeMessages, reconcileMessageSnapshot } from "./utils";

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
    const [replayModalState, setReplayModalState] = useState({ isOpen: false, sessionId: null, taskId: null });
    const [liveViewModalState, setLiveViewModalState] = useState({ isOpen: false, sessionId: null, taskId: null });
    const [isTaskPermsOpen, setIsTaskPermsOpen] = useState(false);
    const [isChatLogOpen, setIsChatLogOpen] = useState(false);
    const [isBrowserHistoryOpen,setIsBrowserHistoryOpen]=useState(false);
    const [isActionPlanOpen, setIsActionPlanOpen] = useState(false);
    const [inputExpanded, setInputExpanded] = useState(false);
    const [inputValue, setInputValue] = useState("");
    const [attachments, setAttachments] = useState([]);
    const [toastObj, setToastObj] = useState({ show: false, message: null, duration: 3000, type: "error", key: 0 });

    const fileInputRef = useRef(null);
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
        setToastObj({ show: true, message, type, duration, key: Date.now() });
    };

    const handleOpenReplay = (sessionId, taskId) => {
        setReplayModalState({
            isOpen: true,
            sessionId,
            taskId: taskId || activeTaskIdRef.current,
        });
    };

    const handleOpenLiveView = (sessionId, taskId) => {
        setLiveViewModalState({
            isOpen: true,
            sessionId,
            taskId: taskId || activeTaskIdRef.current,
        });
    };

    const refreshTasks = async () => {
        try {
            setTasks(await bridge.listTasks());
        } catch (err) {
            showToast(`Failed to load tasks: ${err}`);
        }
    };

    useEffect(()=>{const subscription=bridge.onTaskTitle(()=>refreshTasks());return()=>{subscription.then(stop=>stop());};},[]);

    // P0: the ONE reconcile path. Re-fetches the visible message list from the
    // DB, preserving only newer backend-versioned resource projections that
    // arrived while the snapshot was in flight, guarded by the active task.
    const reconcileMessages = async (taskId) => {
        try {
            const fresh = await bridge.getTaskMessages(taskId);
            if (activeTaskIdRef.current !== taskId) return;
            setMessages(previous=>activeTaskIdRef.current===taskId?reconcileMessageSnapshot(previous,fresh):previous);
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

            if (mode && mode.startsWith("task_")) {
                if (permData.command) {
                    cmdToSave = mode === "task_app" ? permData.command.split(" ")[0] : permData.command;
                    typeToSave = "command";
                } else if (permData.path && permData.permissionType) {
                    cmdToSave = permData.path;
                    typeToSave = permData.permissionType;
                }
            }

            if (cmdToSave && typeToSave) {
                try {
                    const scope = activeTaskIdRef.current;
                    let matchType = "prefix";
                    if (typeToSave === "command") {
                        if (mode === "task_exact" || mode === "task_full") {
                            matchType = "exact";
                        }
                    } else if (mode === "task_parent_dir") {
                        matchType = "prefix";
                    } else if (mode === "task_exact") {
                        matchType = "exact";
                    }
                    await bridge.addFilePermission(scope, cmdToSave, "allow", typeToSave, matchType);
                    showToast(`Permission saved for: ${cmdToSave}`, "success", 2000);
                } catch (err) {
                    showToast(`Failed to save permission: ${err}`);
                }
            }
        }
        
        try {
            const targetTaskId = permData?.taskId || activeTaskIdRef.current;
            await bridge.resolvePendingApprovals(targetTaskId, approved, permData && permData.messageId, note);
            await reconcileMessages(targetTaskId);
        } catch (err) {
            console.error("Failed to resolve pending approvals", err);
        }

        // If a run is already waiting on this card, flipping status is enough.
        // Starting another send_user_message would be rejected (TASK_ALREADY_RUNNING)
        // or would stack a second turn / card.
        if (!sendLockRef.current && !sending) {
            const verb = approved ? "APPROVED" : "DENIED";
            const extra = note && note.trim() ? ` Note: ${note.trim()}` : "";
            const retryInstruction = approved 
                ? " The directive has been executed natively and the results are available in your context. Please proceed using the results." 
                : " Please find an alternative approach or report failure.";
            handleSend(`[APPROVAL DECISION] ${verb}.${extra}${retryInstruction}`);
        }
    };

    const handleHandoffDecision = async (approved, note, permData) => {
        const verb = approved ? "COMPLETED" : "CANCELLED";
        const extra = note && note.trim() ? ` Note: ${note.trim()}` : "";
        const instruction = approved ? " You may now continue." : " Please abort the task or find an alternative approach.";
        
        try {
            await bridge.resolveHandoff(activeTaskIdRef.current, approved, note || "", permData && permData.messageId);
            await reconcileMessages(activeTaskIdRef.current);
        } catch (err) {
            console.error("Failed to resolve handoff", err);
        }

        if (!sendLockRef.current && !sending) {
            handleSend(`[HANDOFF ${verb}]${extra}${instruction}`);
        }
    };

    const handleChoiceDecision = async (choiceId, customText, extraArgs) => {
        const messageId = extraArgs?.messageId;
        try {
            await bridge.resolveChoice(activeTaskIdRef.current, choiceId, customText, messageId);
            await reconcileMessages(activeTaskIdRef.current);
        } catch (err) {
            console.error("Failed to resolve choice", err);
        }

        if (!sendLockRef.current && !sending) {
            const textPayload = customText ? `"${customText}"` : `choice '${choiceId}'`;
            handleSend(`[CHOICE DECISION] Selected: ${textPayload}. Please proceed with this option.`);
        }
    };

    const readFileAsBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const handlePaste = async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.indexOf("image") !== -1) {
                const file = item.getAsFile();
                if (file) {
                    e.preventDefault();
                    try {
                        const b64 = await readFileAsBase64(file);
                        const ext = file.type.split("/")[1] || "png";
                        const filename = `screenshot_${Date.now()}.${ext}`;
                        setAttachments((prev) => [
                            ...prev,
                            {
                                id: String(Date.now()) + Math.random(),
                                file,
                                name: filename,
                                size: file.size,
                                isImage: true,
                                previewUrl: b64,
                                base64Data: b64,
                            }
                        ]);
                    } catch (err) {
                        console.error("Failed to read pasted image", err);
                    }
                }
            }
        }
    };

    const handleFilesSelected = async (e) => {
        const files = Array.from(e.target.files || []);
        for (const file of files) {
            try {
                const b64 = await readFileAsBase64(file);
                const isImage = file.type.startsWith("image/");
                setAttachments((prev) => [
                    ...prev,
                    {
                        id: String(Date.now()) + Math.random(),
                        file,
                        name: file.name,
                        size: file.size,
                        isImage,
                        previewUrl: isImage ? b64 : null,
                        base64Data: b64,
                    }
                ]);
            } catch (err) {
                console.error("Failed to read selected file", err);
            }
        }
        e.target.value = "";
    };

    const removeAttachment = (id) => {
        setAttachments((prev) => prev.filter((a) => a.id !== id));
    };

    const handleSend = async (overrideContent) => {
        let rawContent = (typeof overrideContent === "string" ? overrideContent : inputValue).trim();
        const pendingAttachments = typeof overrideContent === "string" ? [] : [...attachments];
        if ((!rawContent && pendingAttachments.length === 0) || sendLockRef.current || !activeTaskId) return;

        // Lock synchronously before React commits the state update.
        sendLockRef.current = true;

        // Capture the task this invocation belongs to. Streaming and persistent
        // events are already guarded using the task ID.
        const taskAtSend = activeTaskId;

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

        let unlistenAccepted=null;
        const originalDraft=inputValue;
        try {
            const stored=[];
            for(const att of pendingAttachments){
                try {
                    const file=att.saved || await bridge.saveTaskAttachment(taskAtSend,att.name,att.base64Data);
                    stored.push(file);
                    setAttachments(previous=>previous.map(item=>item.id===att.id?{...item,saved:file,error:null}:item));
                } catch(error) {
                    setAttachments(previous=>previous.map(item=>item.id===att.id?{...item,error:String(error)}:item));
                    throw new Error(`Attachment ${att.name} was not sent: ${error}. Retry or remove it to continue.`);
                }
            }
            const requestId=createRequestId();
            unlistenAccepted=await bridge.onUserMessageAccepted(payload=>{
                if(payload.task_id!==taskAtSend||payload.request_id!==requestId)return;
                if(typeof overrideContent!=="string"&&activeTaskIdRef.current===taskAtSend){
                    setInputValue(current=>current===originalDraft?"":current);
                    const sentIds=new Set(pendingAttachments.map(file=>file.id));
                    setAttachments(previous=>previous.filter(file=>!sentIds.has(file.id)));
                }
            });
            const result=await bridge.sendUserMessage(taskAtSend,rawContent,requestId,stored.map(file=>file.id));
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
                if (activeTaskIdRef.current === taskAtSend) {
                    await Promise.all([
                        reconcileMessages(taskAtSend),
                        reconcileRunState(taskAtSend),
                    ]);
                }
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
            if(unlistenAccepted)unlistenAccepted();
            sendLockRef.current = false;
            setSending(false);
            setSendingTaskId(null);
            setStopping(false);
            if (activeTaskIdRef.current === taskAtSend) {
                await reconcileRunState(taskAtSend);
            }
        }
    };

    const handleReuseAttachment = file => {
        if(file.task_id!==activeTaskIdRef.current)return;
        setAttachments(previous=>previous.some(item=>item.saved?.id===file.id)?previous:[...previous,{
            id:file.id,name:file.filename,size:file.byte_count,isImage:file.mime_type.startsWith("image/"),
            previewUrl:file.previewUrl,saved:file,
        }]);
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
            if (activeTaskIsSending || sending || sendLockRef.current) return;
            handleSend();
        }
    };

    useEffect(() => {
        window.__ZEUS_REFRESH_TASKS__ = refreshTasks;
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
        return () => {
            delete window.__ZEUS_REFRESH_TASKS__;
        };
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

function playNotificationChime(type = "complete") {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const now = ctx.currentTime;

        if (type === "complete") {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(523.25, now);
            osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.15);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.5);
        } else if (type === "attention") {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.setValueAtTime(659.25, now + 0.12);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.45);
        }
    } catch {
        // Ignore audio errors if context is blocked
    }
}

    useEffect(() => {
        let unlistenPromise = bridge.onTaskMessage((payload) => {
            if (!payload || payload.task_id !== activeTaskIdRef.current) return;
            const msg = payload.message;
            if (msg && (msg.role === "assistant" || msg.kind === "approval" || msg.kind === "handoff" || msg.kind === "choice" || msg.kind === "action_plan")) {
                // Clear the in-flight stream buffer immediately so the newly arrived durable message
                // does not appear duplicated by the streaming bubble!
                streamTextRef.current = "";
                reasoningTextRef.current = "";
                setStreamText("");
                setReasoningText("");
                streamFlushedRef.current = false;
                directiveModeRef.current = false;
                setDirectiveMode(false);
            }
            if (msg && (msg.kind === "approval" || msg.kind === "handoff" || msg.kind === "choice")) {
                playNotificationChime("attention");
            }
            setMessages((prev) => mergeMessages(prev, msg));
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
                if (payload.run && payload.run.status === "completed") {
                    playNotificationChime("complete");
                }
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

        const pinned = distanceFromBottom <= 120;
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

        requestAnimationFrame(() => {
            if (container && scrollPinnedRef.current) {
                container.scrollTop = container.scrollHeight;
            }
        });
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
                    key={toastObj.key}
                    closeToastCallbackFunction={() => setToastObj((prev) => ({ ...prev, show: false }))}
                    position="bottom right"
                    toastMessage={toastObj.message}
                    notificationDurationInMs={toastObj.duration}
                    notificationType={toastObj.type}
                />
            )}

            <Modal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} closeOnHover={false} className="settings-dialog-window">
                <UiErrorBoundary onRecover={() => setIsSettingsOpen(false)}>
                    <SettingsModal onClose={() => setIsSettingsOpen(false)} onToast={showToast} />
                </UiErrorBoundary>
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

            <Modal isOpen={isTaskSettingsOpen} onClose={() => setIsTaskSettingsOpen(false)} closeOnHover={false} className="settings-dialog-window">
                {activeTask && (
                    <UiErrorBoundary onRecover={() => setIsTaskSettingsOpen(false)}><TaskSettingsModal
                        task={activeTask}
                        onClose={() => setIsTaskSettingsOpen(false)}
                        onToast={showToast}
                        onSave={(updatedTask) => {
                            setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
                            setIsTaskSettingsOpen(false);
                            showToast("Task settings saved", "success", 3000);
                        }}
                    /></UiErrorBoundary>
                )}
            </Modal>

            <Modal isOpen={isChatLogOpen} onClose={() => setIsChatLogOpen(false)} closeOnHover={false} className="chat-log-dialog-window">
                {activeTask && (
                    <ChatLogModal
                        taskId={activeTask.id}
                        taskTitle={activeTask.title}
                        messages={visibleMessages}
                        onClose={() => setIsChatLogOpen(false)}
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
                        <ChatHeader title={activeTask.title} spend={spend} spendRatio={spendRatio} actions={[
                            {label:'Browser history',onClick:()=>setIsBrowserHistoryOpen(true)},
                            {label:'Chat log',id:'chat-log-button',title:'View the full chat log and copy it',onClick:()=>setIsChatLogOpen(true)},
                            {label:'Permissions',title:'Chat-scoped File Permissions',onClick:()=>setIsTaskPermsOpen(true)},
                            {label:'Settings',id:'chat-task-settings-button',title:'Chat-scoped Settings',onClick:()=>setIsTaskSettingsOpen(true)},
                            {label:'Action Plan',active:isActionPlanOpen,title:'Toggle Action Plan',onClick:()=>setIsActionPlanOpen(value=>!value)}
                        ]}/>

                        <BrowserHistoryModal isOpen={isBrowserHistoryOpen} onClose={()=>setIsBrowserHistoryOpen(false)} taskId={activeTaskId} onOpenReplay={(session,task)=>{setIsBrowserHistoryOpen(false);handleOpenReplay(session,task);}}/>
                        <BrowserSessionReplayModal
                            isOpen={replayModalState.isOpen}
                            onClose={() => setReplayModalState({ isOpen: false, sessionId: null, taskId: null })}
                            taskId={replayModalState.taskId}
                            sessionId={replayModalState.sessionId}
                        />

                        <BrowserLiveViewModal
                            isOpen={liveViewModalState.isOpen}
                            onClose={() => setLiveViewModalState({ isOpen: false, sessionId: null, taskId: null })}
                            taskId={liveViewModalState.taskId}
                            sessionId={liveViewModalState.sessionId}
                            onOpenReplay={handleOpenReplay}
                        />

                        <div ref={messagesContainerRef} id="chat-messages" className="column gap-15" onScroll={handleMessagesScroll}>
                            {visibleMessages.map((message) => (
                                <ChatMessage
                                    key={message.id}
                                    message={message}
                                    onApprovalDecision={handleApprovalDecision}
                                    onHandoffDecision={handleHandoffDecision}
                                    onChoiceDecision={handleChoiceDecision}
                                    onOpenReplay={handleOpenReplay}
                                    onReuseAttachment={handleReuseAttachment}
                                    onOpenLiveView={handleOpenLiveView}
                                />
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
                                                <MessageMarkdown taskId={activeTaskId}>{titleFreeText(streamText)}</MessageMarkdown>
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

                        <div id="chat-composer" className={inputExpanded?'expanded':''}>
                        {attachments.length > 0 && (
                            <div id="attachment-tray" className="attachment-tray">
                                {attachments.map((att) => (
                                    <div key={att.id} className="attachment-chip">
                                        {att.isImage ? (
                                            <img src={att.previewUrl} alt={att.name} className="attachment-thumb" />
                                        ) : (
                                            <span className="attachment-doc-icon">📄</span>
                                        )}
                                        <span className="attachment-name" title={att.name}>{att.name}</span>
                                        {att.error&&<span role="alert" title={att.error}>Upload failed: retry send or remove</span>}
                                        <button
                                            type="button"
                                            className="attachment-remove-btn"
                                            onClick={() => removeAttachment(att.id)}
                                            title="Remove attachment"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div id="chat-input-bar" className={`align-center gap-15 ${inputExpanded ? "expanded" : ""}`}>
                            <button
                                id="chat-attach-button"
                                disabled={messages.some(message=>message.kind==='ui_showcase')}
                                type="button"
                                title="Attach files or paste screenshots. Up to 8 files / 30 MiB total; static PNG, JPEG or WebP images: 10 MiB / 25 MP each. Unsent uploads may be cleaned up after 7 days."
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <span style={{ fontSize: "22px", fontWeight: "bold", lineHeight: 1 }}>+</span>
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                style={{ display: "none" }}
                                onChange={handleFilesSelected}
                            />
                            <div id="chat-input-wrapper" className="relative">
                                <textarea
                                    id="chat-input"
                                    readOnly={messages.some(message=>message.kind==='ui_showcase')}
                                    rows={3}
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onPaste={messages.some(message=>message.kind==='ui_showcase')?event=>event.preventDefault():handlePaste}
                                    placeholder={messages.some(message=>message.kind==='ui_showcase')?'UI design gallery — examples only, no agent runs':'Describe the goal for Zeus... (Enter to send, Shift+Enter for a new line, paste images with Ctrl+V)'}
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
                                    messages.some(message=>message.kind==='ui_showcase')||(activeTaskIsSending?stopping:sending)
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
                        </div>
                    </>
                )}
            </div>

            {isActionPlanOpen && (
                <ActionPlanPanel actionPlanMarkdown={actionPlanMarkdown} onClose={() => setIsActionPlanOpen(false)} />
            )}
        </main>
    );
}

export default App;
