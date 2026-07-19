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
export const getTaskMessages = (taskId)     => invoke("get_task_messages",  { taskId });
export const getTaskSpend    = (taskId)     => invoke("get_task_spend",     { taskId });
export const sendUserMessage = (taskId, content) => invoke("send_user_message", { taskId, content });
export const renameTask  = (taskId, title)  => invoke("rename_task",        { taskId, title });
export const deleteTask  = (taskId)         => invoke("delete_task",        { taskId });

// ---- Settings --------------------------------------------------------------
export const getSettings        = ()              => invoke("get_settings");
export const saveSettings       = (settings)      => invoke("save_settings",        { settings });
export const setApiKey          = (apiKey)        => invoke("set_api_key",          { apiKey });
export const hasApiKey          = ()              => invoke("has_api_key");
export const fetchAvailableModels = ()            => invoke("fetch_available_models");

// ---- Events (used from M1 onward; the core emits task progress here) --------
export const onTaskEvent   = (callback) => listen("task-event",   (event) => callback(event.payload));
export const onChatStream  = (callback) => listen("chat-stream",  (event) => callback(event.payload));