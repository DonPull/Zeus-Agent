import { useEffect, useState } from "react";
import * as bridge from "../bridge";

function SettingsModal({ onToast, onClose }) {
    const [settings, setSettings] = useState(null);
    const [apiKeyInput, setApiKeyInput] = useState("");
    const [keyIsSet, setKeyIsSet] = useState(false);
    const [geminiApiKeyInput, setGeminiApiKeyInput] = useState("");
    const [geminiKeyIsSet, setGeminiKeyIsSet] = useState(false);
    const [availableModels, setAvailableModels] = useState([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [saving, setSaving] = useState(false);
    const [permissions, setPermissions] = useState([]);
    const [newPermPath, setNewPermPath] = useState("");
    const [newPermAction, setNewPermAction] = useState("allow");
    const [newPermType, setNewPermType] = useState("read");
    
    // Watcher Policies
    const [watcherPolicies, setWatcherPolicies] = useState([]);
    const [negotiatePrompt, setNegotiatePrompt] = useState("");
    const [negotiating, setNegotiating] = useState(false);
    const [generatedRules, setGeneratedRules] = useState("");
    const [policyUrlPattern, setPolicyUrlPattern] = useState("*");

    useEffect(() => {
        (async () => {
            try {
                setSettings(await bridge.getSettings());
                setKeyIsSet(await bridge.hasApiKey());
                setGeminiKeyIsSet(await bridge.hasGeminiApiKey());
                setPermissions(await bridge.getFilePermissions("global"));
                setWatcherPolicies(await bridge.getWatcherPolicies("global"));
            } catch (err) {
                onToast(`Failed to load settings: ${err}`);
            }
        })();
    }, []);

    const handleSaveApiKey = async () => {
        try {
            await bridge.setApiKey(apiKeyInput);
            setApiKeyInput("");
            setKeyIsSet(true);
            onToast("API key saved to the Windows Credential Manager.", "success", 3000);
        } catch (err) {
            onToast(String(err));
        }
    };

    const handleSaveGeminiApiKey = async () => {
        try {
            await bridge.setGeminiApiKey(geminiApiKeyInput);
            setGeminiApiKeyInput("");
            setGeminiKeyIsSet(true);
            onToast("Gemini API key saved to the Windows Credential Manager.", "success", 3000);
        } catch (err) {
            onToast(String(err));
        }
    };

    const handleSaveSettings = async () => {
        setSaving(true);
        try {
            await bridge.saveSettings(settings);
            onToast("Settings saved.", "success", 3000);
        } catch (err) {
            onToast(String(err));
        } finally {
            setSaving(false);
        }
    };

    const handleLoadModels = async () => {
        setLoadingModels(true);
        try {
            const models = await bridge.fetchAvailableModels();
            setAvailableModels(models);
            onToast(`Loaded ${models.length} models from RouteLLM.`, "success", 3000);
        } catch (err) {
            onToast(String(err), "error", 8000);
        } finally {
            setLoadingModels(false);
        }
    };

    const handleAddPermission = async () => {
        if (!newPermPath.trim()) return;
        try {
            const added = await bridge.addFilePermission("global", newPermPath.trim(), newPermAction, newPermType);
            setPermissions([added, ...permissions]);
            setNewPermPath("");
            onToast("Global permission added.", "success", 2000);
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
            const rules = await bridge.negotiateWatcherPolicy("global", negotiatePrompt);
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
            const added = await bridge.addWatcherPolicy("global", policyUrlPattern.trim(), generatedRules.trim());
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

    if (!settings) {
        return (
            <div className="column align-center justify-center" style={{ height: "100%" }}>
                <div className="simple-spinner"><span></span></div>
            </div>
        );
    }

    const updateSetting = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));

    return (
        <div id="settings-modal-content" className="column gap-20">
            <div id="settings-header" className="align-center justify-space-between">
                <label id="settings-title">Settings</label>
                <button id="settings-close-button" title="Close settings" onClick={onClose}>
                    <label>✕</label>
                </button>
            </div>

            <div className="settings-section column gap-10">
                <label className="settings-section-label">RouteLLM API key</label>
                <div className="align-center gap-10">
                    <input
                        type="password"
                        className="settings-input width-fill-available"
                        placeholder="Paste your RouteLLM API key"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                    />
                    <button className="settings-button" onClick={handleSaveApiKey} disabled={!apiKeyInput.trim()}>
                        <label>Save key</label>
                    </button>
                    <span className={`key-status-pill ${keyIsSet ? "set" : "missing"}`}>{keyIsSet ? "Key set" : "No key"}</span>
                </div>
                <label className="settings-hint">Stored in the Windows Credential Manager. Never written to the database or logs.</label>
            </div>

            <div className="settings-section column gap-10">
                <label className="settings-section-label">Google Gemini API key</label>
                <div className="align-center gap-10">
                    <input
                        type="password"
                        className="settings-input width-fill-available"
                        placeholder="Paste your Google Gemini API key"
                        value={geminiApiKeyInput}
                        onChange={(e) => setGeminiApiKeyInput(e.target.value)}
                    />
                    <button className="settings-button" onClick={handleSaveGeminiApiKey} disabled={!geminiApiKeyInput.trim()}>
                        <label>Save key</label>
                    </button>
                    <span className={`key-status-pill ${geminiKeyIsSet ? "set" : "missing"}`}>{geminiKeyIsSet ? "Key set" : "No key"}</span>
                </div>
                <label className="settings-hint">Used automatically when the model name starts with "gemini".</label>
            </div>

            <div className="settings-section column gap-10">
                <div className="align-center justify-space-between">
                    <label className="settings-section-label">Models</label>
                    <button className={`settings-button ${loadingModels ? "is-loading" : ""}`} onClick={handleLoadModels} disabled={loadingModels}>
                        <label>{loadingModels ? "Loading..." : "Load available models"}</label>
                    </button>
                </div>
                <datalist id="routellm-models">
                    {availableModels.map((model) => <option key={model} value={model} />)}
                    <option value="gemini-1.5-pro" />
                    <option value="gemini-1.5-flash" />
                    <option value="gemini-2.0-flash-exp" />
                </datalist>
                <div className="settings-model-row align-center gap-10">
                    <label>Master</label>
                    <input className="settings-input width-fill-available" list="routellm-models" value={settings.master_model} onChange={(e) => updateSetting("master_model", e.target.value)} />
                </div>
                <div className="settings-model-row align-center gap-10">
                    <label>Worker</label>
                    <input className="settings-input width-fill-available" list="routellm-models" value={settings.worker_model} onChange={(e) => updateSetting("worker_model", e.target.value)} />
                </div>
                <div className="settings-model-row align-center gap-10">
                    <label>Verifier</label>
                    <input className="settings-input width-fill-available" list="routellm-models" value={settings.verifier_model} onChange={(e) => updateSetting("verifier_model", e.target.value)} />
                </div>
                <label className="settings-hint">IDs must match RouteLLM's GET /v1/models exactly. Use "Load available models" to see the real list.</label>
            </div>

            <div className="settings-section column gap-10">
                <label className="settings-section-label">Budgets</label>
                <div className="settings-model-row align-center gap-10">
                    <label>Default task budget (units)</label>
                    <input
                        type="number"
                        className="settings-input"
                        style={{ width: "120px" }}
                        value={settings.default_budget_credits}
                        onChange={(e) => updateSetting("default_budget_credits", parseInt(e.target.value) || 0)}
                    />
                </div>
                <label className="settings-hint">Hard cap enforced by the Rust core per task. 1 unit = 1 token or 1 tool call — the master sees its spend and can plan around it.</label>
            </div>

            <div className="settings-section column gap-10">
                <label className="settings-section-label">Global File Permissions</label>
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
                <label className="settings-hint">Longest prefix matches win. More specific paths override general ones.</label>
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
                <label className="settings-section-label">Global Network/Browser Policies (Watcher AI)</label>
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

            <button className={`settings-button align-center justify-center ${saving ? "is-loading" : ""}`} onClick={handleSaveSettings} disabled={saving}>
                <label>{saving ? "Saving..." : "Save settings"}</label>
            </button>
        </div>
    );
}

export default SettingsModal;