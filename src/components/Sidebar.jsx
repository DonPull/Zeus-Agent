import { useRef, useState } from "react";
import { formatCredits } from "../utils";
import Modal from "./Modal";

function Sidebar({ tasks, activeTaskId, onSelectTask, onNewTask, onRenameTask, onDeleteTask, onOpenSettings }) {
    const [editingTaskId, setEditingTaskId] = useState(null);
    const [editingTitle,  setEditingTitle]  = useState("");
    const [pendingDelete, setPendingDelete] = useState(null); // task object | null
    const editInputRef = useRef(null);

    const startEditing = (e, task) => {
        e.stopPropagation();
        setEditingTaskId(task.id);
        setEditingTitle(task.title);
        // small delay so the input is mounted before focus
        setTimeout(() => editInputRef.current?.focus(), 20);
    };

    const commitEdit = (taskId) => {
        const trimmed = editingTitle.trim();
        const original = tasks.find((t) => t.id === taskId)?.title;
        if (trimmed && trimmed !== original) onRenameTask(taskId, trimmed);
        setEditingTaskId(null);
    };

    const handleEditKeyDown = (e, taskId) => {
        if (e.key === "Enter") { e.preventDefault(); commitEdit(taskId); }
        else if (e.key === "Escape") setEditingTaskId(null);
    };

    const handleDeleteClick = (e, task) => {
        e.stopPropagation();
        setPendingDelete(task);
    };

    const confirmDelete = () => {
        if (pendingDelete) onDeleteTask(pendingDelete.id);
        setPendingDelete(null);
    };

    return (
        <aside id="app-sidebar" className="column">
            <div id="sidebar-logo" className="align-center gap-5 no-user-select">
                <img src={new URL("../assets/transparent-logo.png", import.meta.url).href} alt="Zeus logo" />
                <div className="column">
                    <span>Zeus</span>
                    <span>Agent</span>
                </div>
            </div>

            <button id="new-task-button" onClick={onNewTask}>
                <label>+ New Task</label>
            </button>

            <div id="sidebar-tasks" className="column gap-10">
                {tasks.length === 0 ? (
                    <label className="sidebar-empty-label">No tasks yet.</label>
                ) : (
                    tasks.map((task) => (
                        <div
                            key={task.id}
                            className={`sidebar-task column ${task.id === activeTaskId ? "active" : ""}`}
                            onClick={() => editingTaskId !== task.id && onSelectTask(task)}
                        >
                            {editingTaskId === task.id ? (
                                <input
                                    ref={editInputRef}
                                    className="sidebar-task-edit-input"
                                    value={editingTitle}
                                    onChange={(e) => setEditingTitle(e.target.value)}
                                    onBlur={() => commitEdit(task.id)}
                                    onKeyDown={(e) => handleEditKeyDown(e, task.id)}
                                    onClick={(e) => e.stopPropagation()}
                                />
                            ) : (
                                <label className="sidebar-task-title" title={task.title}>{task.title}</label>
                            )}

                            <div className="sidebar-task-footer align-center justify-space-between">
                                <span className="sidebar-task-status">{task.status}</span>
                                <div className="sidebar-task-actions align-center gap-5">
                                    <span className="sidebar-task-spend no-user-select">
                                        {formatCredits(task.spent_credits)} / {task.budget_credits} u
                                    </span>
                                    <button
                                        className="sidebar-task-icon-btn"
                                        title="Rename"
                                        onClick={(e) => startEditing(e, task)}
                                    >✎</button>
                                    <button
                                        className="sidebar-task-icon-btn danger"
                                        title="Delete"
                                        onClick={(e) => handleDeleteClick(e, task)}
                                    >✕</button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <button id="sidebar-settings-button" onClick={onOpenSettings}>
                <label>Settings</label>
            </button>

            {/* In-app delete confirmation (Esc / click-outside = Cancel) */}
            <Modal isOpen={!!pendingDelete} onClose={() => setPendingDelete(null)} closeOnHover={false} className="compact">
                {pendingDelete && (
                    <div id="delete-confirm" className="column gap-20">
                        <label id="delete-confirm-title">Delete task?</label>
                        <label id="delete-confirm-text">
                            <span className="delete-confirm-task-title">"{pendingDelete.title}"</span> and all of its messages will be permanently removed. This cannot be undone.
                        </label>
                        <div className="confirm-dialog-buttons align-center gap-15">
                            <button className="confirm-dialog-button" onClick={() => setPendingDelete(null)}>
                                <label>Cancel</label>
                            </button>
                            <button className="confirm-dialog-button danger" onClick={confirmDelete}>
                                <label>Delete</label>
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </aside>
    );
}

export default Sidebar;