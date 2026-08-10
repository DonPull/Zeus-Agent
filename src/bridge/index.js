// ============================================================================
// ZEUS AGENT - UI <-> CORE BRIDGE
// The ONLY module allowed to talk to the Rust core. Components never import
// @tauri-apps/api directly. To swap the UI later, reimplement against this
// module (documented in BRIDGE.md) and nothing else changes.
// ============================================================================
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ---- Tasks ---------------------------------------------------------------
export const createTask  = (title)          => invoke("create_task",       { title });
export const listTasks   = ()               => invoke("list_tasks");
export const getTaskMessages = (taskId, includeHidden = false) => invoke("get_task_messages", { taskId, includeHidden });
export const getTaskSpend = (taskId) => invoke("get_task_spend", { taskId });
export const getTaskRunState = (taskId) => invoke("get_task_run_state", { taskId });
export const cancelTaskRun = (taskId) => invoke("cancel_task_run", { taskId });
export const sendUserMessage = (taskId, content, requestId) => invoke("send_user_message", { taskId, content, requestId });
export const resolvePendingApprovals = (taskId, approved) => invoke("resolve_pending_approvals", { taskId, approved });
export const resolveHandoff = (taskId, approved, note) => invoke("resolve_handoff", { taskId, approved, note });
export const renameTask  = (taskId, title)  => invoke("rename_task",        { taskId, newTitle: title });
export const updateTaskSettings = (taskId, settings) => invoke("update_task_settings", { taskId, settings });
export const deleteTask  = (taskId)         => invoke("delete_task",        { taskId });
export const getBrowserHistory = (taskId)   => invoke("get_browser_history", { taskId });

// ---- Settings --------------------------------------------------------------
export const getSettings        = ()              => invoke("get_settings");
export const saveSettings       = (settings)      => invoke("save_settings",        { settings });
export const setApiKey          = (apiKey)        => invoke("set_api_key",          { apiKey });
export const hasApiKey          = ()              => invoke("has_api_key");
export const setGeminiApiKey    = (apiKey)        => invoke("set_gemini_api_key",   { apiKey });
export const hasGeminiApiKey    = ()              => invoke("has_gemini_api_key");
export const fetchAvailableModels = ()            => invoke("fetch_available_models");
export const getDebugLog       = (taskId)         => invoke("get_debug_log", { taskId });

// ---- Gatekeeper ------------------------------------------------------------
export const getFilePermissions    = (scope)      => invoke("get_file_permissions", { scope });
export const addFilePermission     = (scope, path, action, permissionType, matchType) => invoke("add_file_permission", { scope, path, action, permissionType, matchType });
export const deleteFilePermission  = (id)         => invoke("delete_file_permission", { id });

export const getWatcherPolicies       = (scope)                                 => invoke("get_watcher_policies", { scope });
export const addWatcherPolicy         = (scope, rulesSummary)                   => invoke("add_watcher_policy", { scope, rulesSummary });
export const deleteWatcherPolicy      = (id)                                    => invoke("delete_watcher_policy", { id });
export const negotiateWatcherPolicy   = (scope, prompt)                         => invoke("negotiate_watcher_policy", { scope, prompt });

// ---- Events (used from M1 onward; the core emits task progress here) --------
export const onTaskEvent   = (callback) => listen("task-event",   (event) => callback(event.payload));
export const onChatStream  = (callback) => listen("chat-stream",  (event) => callback(event.payload));

// ---- Live task messages (action cards, approvals) ---------------------------
export const onTaskMessage = (callback) =>
  listen("task-message", (event) => callback(event.payload));