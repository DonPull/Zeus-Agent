import { useState, useEffect } from "react";
import * as bridge from "../bridge";
import { ModelDropdown } from "./SettingsModal";

const TaskSettingsModal = ({ task, onClose, onSave }) => {
    const [settings, setSettings] = useState({
        master_model: task.master_model || "gemini-1.5-pro",
        worker_model: task.worker_model || "gemini-1.5-pro",
        verifier_model: task.verifier_model || "gemini-1.5-pro",
        watcher_model: task.watcher_model || "grok-4.5",
        budget_credits: task.budget_credits || 1000
    });
    const [availableModels, setAvailableModels] = useState([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        handleLoadModels(true);
    }, []);

    const handleLoadModels = async (silent = false) => {
        if (!silent) setLoadingModels(true);
        try {
            const models = await bridge.fetchAvailableModels();
            if (models && models.length > 0) {
                setAvailableModels(models);
            } else if (!silent) {
                alert("No models found or no API key set.");
            }
        } catch (e) {
            console.error("Failed to fetch models", e);
            if (!silent) alert("Failed to fetch models: " + e);
        } finally {
            if (!silent) setLoadingModels(false);
        }
    };

    const handleSaveSettings = async () => {
        setSaving(true);
        try {
            await bridge.updateTaskSettings(task.id, settings);
            onSave({ ...task, ...settings });
        } catch (e) {
            console.error("Failed to save task settings", e);
            alert("Failed to save task settings: " + e);
        } finally {
            setSaving(false);
        }
    };

    const updateSetting = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));

    return (
        <div className="modal column gap-20" style={{ padding: "24px", minWidth: "500px", maxHeight: "80vh", overflowY: "auto" }}>
            <div className="align-center justify-space-between">
                <h2 style={{ margin: 0 }}>Task Settings</h2>
                <button className="icon-button" onClick={onClose}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>

            <div className="column gap-20" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "20px" }}>
                <h3 style={{ margin: 0, opacity: 0.9 }}>Chat Models</h3>

                <div className="settings-section column gap-10">
                    <div className="align-center justify-space-between">
                        <label className="settings-section-label">Models</label>
                        <button className={`settings-button ${loadingModels ? "is-loading" : ""}`} onClick={() => handleLoadModels(false)} disabled={loadingModels}>
                            <label>{loadingModels ? "Loading..." : "Load available models"}</label>
                        </button>
                    </div>

                    <div className="settings-model-row align-center gap-10">
                        <label>Master</label>
                        <ModelDropdown value={settings.master_model} options={availableModels} onChange={(v) => updateSetting("master_model", v)} />
                    </div>
                    <div className="settings-model-row align-center gap-10">
                        <label>Worker</label>
                        <ModelDropdown value={settings.worker_model} options={availableModels} onChange={(v) => updateSetting("worker_model", v)} />
                    </div>
                    <div className="settings-model-row align-center gap-10">
                        <label>Verifier</label>
                        <ModelDropdown value={settings.verifier_model} options={availableModels} onChange={(v) => updateSetting("verifier_model", v)} />
                    </div>
                    <div className="settings-model-row align-center gap-10">
                        <label>Watcher</label>
                        <ModelDropdown value={settings.watcher_model} options={availableModels} onChange={(v) => updateSetting("watcher_model", v)} />
                    </div>
                    <label className="settings-hint">IDs must match RouteLLM's GET /v1/models exactly. Use "Load available models" to see the real list.</label>
                </div>
            </div>

            <div className="column gap-20">
                <h3 style={{ margin: 0, opacity: 0.9 }}>Budgets</h3>
                <div className="settings-section column gap-10">
                    <div className="settings-model-row align-center gap-10">
                        <label>Task budget (units)</label>
                        <input
                            type="number"
                            className="settings-input"
                            style={{ width: "120px" }}
                            value={settings.budget_credits}
                            onChange={(e) => updateSetting("budget_credits", parseInt(e.target.value) || 0)}
                        />
                    </div>
                    <label className="settings-hint">Hard cap enforced by the Rust core for this specific task. 1 unit = 1 token or 1 tool call.</label>
                </div>
            </div>

            <button className={`settings-button align-center justify-center ${saving ? "is-loading" : ""}`} onClick={handleSaveSettings} disabled={saving}>
                <label>{saving ? "Saving..." : "Save settings"}</label>
            </button>
        </div>
    );
};

export default TaskSettingsModal;
