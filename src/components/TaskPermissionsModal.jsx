import { useEffect, useState } from "react";
import * as bridge from "../bridge";

function TaskPermissionsModal({ taskId, taskTitle, onToast, onClose }) {
    const [permissions, setPermissions] = useState([]);
    const [newPermPath, setNewPermPath] = useState("");
    const [newPermAction, setNewPermAction] = useState("allow");
    const [newPermType, setNewPermType] = useState("read");

    const [watcherPolicies, setWatcherPolicies] = useState([]);
    const [negotiatePrompt, setNegotiatePrompt] = useState("");
    const [negotiating, setNegotiating] = useState(false);
    const [generatedRules, setGeneratedRules] = useState("");
    const [policyUrlPattern, setPolicyUrlPattern] = useState("*");

    useEffect(() => {
        (async () => {
            try {
                setPermissions(await bridge.getFilePermissions(taskId));
                setWatcherPolicies(await bridge.getWatcherPolicies(taskId));
            } catch (err) {
                onToast(`Failed to load permissions: ${err}`);
            }
        })();
    }, [taskId]);

    const handleAddPermission = async () => {
        if (!newPermPath.trim()) return;
        try {
            const added = await bridge.addFilePermission(taskId, newPermPath.trim(), newPermAction, newPermType);
            setPermissions([added, ...permissions]);
            setNewPermPath("");
            onToast("Task permission added.", "success", 2000);
        } catch (err) {
            onToast(`Failed to add permission: ${err}`);
        }
    };

    const handleDeletePermission = async (id) => {
        try {
            await bridge.deleteFilePermission(id);
            setPermissions(permissions.filter(p => p.id !== id));
            onToast("Permission deleted.", "success", 2000);
        } catch (err) {
            onToast(`Failed to delete permission: ${err}`);
        }
    };

    const handleNegotiatePolicy = async () => {
        if (!negotiatePrompt.trim()) return;
        setNegotiating(true);
        try {
            const rules = await bridge.negotiateWatcherPolicy(taskId, negotiatePrompt);
            setGeneratedRules(rules);
            onToast("Policy rules generated.", "success", 2000);
        } catch (err) {
            onToast(`Negotiation failed: ${err}`);
        } finally {
            setNegotiating(false);
        }
    };

    const handleSavePolicy = async () => {
        if (!policyUrlPattern.trim() || !generatedRules.trim()) return;
        try {
            const added = await bridge.addWatcherPolicy(taskId, policyUrlPattern.trim(), generatedRules.trim());
            setWatcherPolicies([added, ...watcherPolicies]);
            setGeneratedRules("");
            setNegotiatePrompt("");
            onToast("Policy saved.", "success", 2000);
        } catch (err) {
            onToast(`Failed to save policy: ${err}`);
        }
    };

    const handleDeletePolicy = async (id) => {
        try {
            await bridge.deleteWatcherPolicy(id);
            setWatcherPolicies(watcherPolicies.filter(p => p.id !== id));
            onToast("Policy deleted.", "success", 2000);
        } catch (err) {
            onToast(`Failed to delete policy: ${err}`);
        }
    };

    return (
        <div className="column gap-20" style={{ minWidth: "500px" }}>
            <div className="align-center justify-space-between">
                <label style={{ fontSize: "1.2rem", fontWeight: 600 }}>Permissions for: {taskTitle}</label>
                <button className="settings-button" title="Close" onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "1.2rem" }}>
                    <label>✕</label>
                </button>
            </div>

            <div className="settings-section column gap-10">
                <label className="settings-section-label">Chat-scoped Permissions</label>
                <div className="align-center gap-10">
                    <input className="settings-input" style={{ flex: 1 }} placeholder="C:/Projects or /home/user" value={newPermPath} onChange={e => setNewPermPath(e.target.value)} />
                    <select className="settings-input" value={newPermAction} onChange={e => setNewPermAction(e.target.value)}>
                        <option value="allow">Allow</option>
                        <option value="deny">Deny</option>
                        <option value="ask">Ask</option>
                    </select>
                    <select className="settings-input" value={newPermType} onChange={e => setNewPermType(e.target.value)}>
                        <option value="read">Read</option>
                        <option value="write">Write</option>
                        <option value="delete">Delete</option>
                        <option value="command">Command</option>
                    </select>
                    <button className="settings-button" onClick={handleAddPermission} disabled={!newPermPath.trim()}>
                        <label>Add</label>
                    </button>
                </div>
                <label className="settings-hint">These override Global settings. Longest prefix matches win.</label>
                
                {permissions.length > 0 && (
                    <div className="column gap-10" style={{ marginTop: "10px", maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "10px" }}>
                        {permissions.map(p => (
                            <div key={p.id} className="align-center justify-space-between">
                                <div className="align-center gap-10">
                                    <span className={`key-status-pill ${p.action === "allow" ? "set" : p.action === "deny" ? "missing" : ""}`}>
                                        {p.action.toUpperCase()} {p.permission_type.toUpperCase()}
                                    </span>
                                    <span style={{ fontSize: "0.9rem", color: "var(--text-color)", fontFamily: "monospace" }}>{p.path}</span>
                                </div>
                                <button className="settings-button" style={{ padding: "4px 8px" }} onClick={() => handleDeletePermission(p.id)}>
                                    <label>Delete</label>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="settings-section column gap-10">
                <label className="settings-section-label">Chat-scoped Network/Browser Policies (Watcher AI)</label>
                <div className="column gap-10">
                    <textarea 
                        className="settings-input width-fill-available" 
                        rows={2} 
                        placeholder="E.g. 'I want to allow scraping any public Github repo but block modifying anything'"
                        value={negotiatePrompt}
                        onChange={(e) => setNegotiatePrompt(e.target.value)}
                    />
                    <button className={`settings-button ${negotiating ? "is-loading" : ""}`} onClick={handleNegotiatePolicy} disabled={negotiating || !negotiatePrompt.trim()}>
                        <label>{negotiating ? "Negotiating with Watcher..." : "Generate Rules"}</label>
                    </button>
                </div>
                
                {generatedRules && (
                    <div className="column gap-10" style={{ border: "1px solid var(--zeus-accent)", padding: "10px", borderRadius: "6px", background: "var(--bg-secondary)" }}>
                        <label className="settings-section-label" style={{ fontSize: "0.9rem" }}>Generated Rules Summary:</label>
                        <textarea className="settings-input width-fill-available" rows={5} value={generatedRules} onChange={(e) => setGeneratedRules(e.target.value)} />
                        
                        <div className="align-center gap-10">
                            <label>Apply to URLs matching:</label>
                            <input className="settings-input" style={{ flex: 1 }} value={policyUrlPattern} onChange={(e) => setPolicyUrlPattern(e.target.value)} placeholder="e.g. *.github.com or *" />
                            <button className="settings-button" onClick={handleSavePolicy}>
                                <label>Save Policy</label>
                            </button>
                        </div>
                    </div>
                )}

                {watcherPolicies.length > 0 && (
                    <div className="column gap-10" style={{ marginTop: "10px", maxHeight: "200px", overflowY: "auto", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "10px" }}>
                        {watcherPolicies.map(p => (
                            <div key={p.id} className="column gap-5" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "10px" }}>
                                <div className="align-center justify-space-between">
                                    <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-color)" }}>Pattern: {p.url_pattern}</span>
                                    <button className="settings-button" style={{ padding: "4px 8px" }} onClick={() => handleDeletePolicy(p.id)}>
                                        <label>Delete</label>
                                    </button>
                                </div>
                                <pre style={{ margin: 0, fontSize: "0.85rem", whiteSpace: "pre-wrap", color: "var(--text-color)", opacity: 0.8 }}>
                                    {p.rules_summary}
                                </pre>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default TaskPermissionsModal;
