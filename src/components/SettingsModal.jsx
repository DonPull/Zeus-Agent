import { useEffect, useState } from "react";
import * as bridge from "../bridge";

function SettingsModal({ onToast, onClose }) {
    const [settings, setSettings] = useState(null);
    const [apiKeyInput, setApiKeyInput] = useState("");
    const [keyIsSet, setKeyIsSet] = useState(false);
    const [availableModels, setAvailableModels] = useState([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                setSettings(await bridge.getSettings());
                setKeyIsSet(await bridge.hasApiKey());
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
                <div className="align-center justify-space-between">
                    <label className="settings-section-label">Models</label>
                    <button className={`settings-button ${loadingModels ? "is-loading" : ""}`} onClick={handleLoadModels} disabled={loadingModels}>
                        <label>{loadingModels ? "Loading..." : "Load available models"}</label>
                    </button>
                </div>
                <datalist id="routellm-models">
                    {availableModels.map((model) => <option key={model} value={model} />)}
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

            <button className={`settings-button align-center justify-center ${saving ? "is-loading" : ""}`} onClick={handleSaveSettings} disabled={saving}>
                <label>{saving ? "Saving..." : "Save settings"}</label>
            </button>
        </div>
    );
}

export default SettingsModal;