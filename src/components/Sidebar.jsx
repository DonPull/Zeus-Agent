import { formatCredits } from "../utils";

function Sidebar({ tasks, activeTaskId, onSelectTask, onNewTask, onOpenSettings }) {
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
                            onClick={() => onSelectTask(task)}
                        >
                            <label className="sidebar-task-title" title={task.title}>{task.title}</label>
                            <div className="sidebar-task-meta align-center justify-space-between">
                                <span className="sidebar-task-status">{task.status}</span>
                                <span className="sidebar-task-spend">{formatCredits(task.spent_credits)} / {task.budget_credits} u</span>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <button id="sidebar-settings-button" onClick={onOpenSettings}>
                <label>Settings</label>
            </button>
        </aside>
    );
}

export default Sidebar;