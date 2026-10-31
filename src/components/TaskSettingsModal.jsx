import { useState, useEffect } from "react";
import ModalCloseButton from './ModalCloseButton';
import * as bridge from "../bridge";
import { ModelDropdown, EffortDropdown, isLocalModel, validateTeamConfig, isNoneModel } from "./SettingsModal";

const TaskSettingsModal = ({ task, onClose, onSave, onToast }) => {
    const [settings, setSettings] = useState({
        model_bindings: task.model_bindings || {},
        image_delivery:task.image_delivery || "auto",
        master_model: task.master_model || "gemini-1.5-pro",
        worker_model: task.worker_model || "gemini-1.5-pro",
        verifier_model: task.verifier_model || "gemini-1.5-pro",
        watcher_model: task.watcher_model || "grok-4.5",
        vision_model: task.vision_model || "gemini-3.8-flash",
        vision_effort: task.vision_effort || "default",
        master_effort: task.master_effort || "default",
        worker_effort: task.worker_effort || "default",
        verifier_effort: task.verifier_effort || "default",
        watcher_effort: task.watcher_effort || "default",
        budget_credits: task.budget_credits || 1000,
        browser_mode: task.browser_mode || "sandboxed",
        browser_executable_path: task.browser_executable_path || ""
    });
    const [availableModels, setAvailableModels] = useState([]);
    const [modelCatalogue, setModelCatalogue] = useState([]);
    const [localModelIds, setLocalModelIds] = useState([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        handleLoadModels(true);
    }, []);

    const handleLoadModels = async (silent = false) => {
        if (!silent) setLoadingModels(true);
        try {
            const catalogue = await bridge.fetchModelCatalogue();
            setModelCatalogue(catalogue);
            const models = [...new Set(catalogue.flatMap(entry => entry.models))];
            if (models && models.length > 0) {
                setAvailableModels(models);
            } else if (!silent) {
                alert("No models found or no API key set.");
            }
            try {
                const localIds = await bridge.getLocalModelIds();
                if (Array.isArray(localIds)) setLocalModelIds(localIds);
            } catch (_) {}
        } catch (e) {
            console.error("Failed to fetch models", e);
            if (!silent) alert("Failed to fetch models: " + e);
        } finally {
            if (!silent) setLoadingModels(false);
        }
    };

    const handleSaveSettings = async () => {
        const validation = validateTeamConfig(settings);
        if (!validation.isValid) {
            if (onToast) {
                onToast(validation.message, "error", 7000);
            } else {
                alert(validation.message);
            }
            return;
        }
        setSaving(true);
        console.log("[TaskSettingsModal] Saving settings...", settings);
        try {
            await bridge.updateTaskSettings(task.id, settings);
            console.log("[TaskSettingsModal] updateTaskSettings resolved!");
            onSave({ ...task, ...settings });
            console.log("[TaskSettingsModal] onSave called!");
        } catch (e) {
            console.error("Failed to save task settings", e);
            if (onToast) {
                onToast("Failed to save task settings: " + e, "error", 6000);
            } else {
                alert("Failed to save task settings: " + e);
            }
        } finally {
            setSaving(false);
        }
    };

    const isNone = isNoneModel;

    const setModelBinding = (role, binding) => setSettings(prev => {
        const model_bindings = {...prev.model_bindings};
        if(binding) model_bindings[role] = binding; else delete model_bindings[role];
        return {...prev,model_bindings};
    });

    const updateSetting = (key, value) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
    };

    const setAllDelegationNone = () => {
        setSettings((prev) => ({
            ...prev,
            worker_model: "None",
            verifier_model: "None",
            watcher_model: "None",
        }));
    };

    const teamValidation = validateTeamConfig(settings);

    const getDisabledReasonForRole = (role) => (opt) => {
        if (!isLocalModel(opt, localModelIds, settings.model_bindings?.[role]?.connection)) return null;

        const otherRolesWithLocal = [];
        if (role !== "master" && !isNone(settings.master_model) && isLocalModel(settings.master_model, localModelIds, settings.model_bindings?.master?.connection)) {
            otherRolesWithLocal.push("Master");
        }
        if (role !== "worker" && !isNone(settings.worker_model) && isLocalModel(settings.worker_model, localModelIds, settings.model_bindings?.worker?.connection)) {
            otherRolesWithLocal.push("Worker");
        }
        if (role !== "verifier" && !isNone(settings.verifier_model) && isLocalModel(settings.verifier_model, localModelIds, settings.model_bindings?.verifier?.connection)) {
            otherRolesWithLocal.push("Verifier");
        }
        if (role !== "watcher" && !isNone(settings.watcher_model) && isLocalModel(settings.watcher_model, localModelIds, settings.model_bindings?.watcher?.connection)) {
            otherRolesWithLocal.push("Watcher");
        }
        if (role !== "vision" && !isNone(settings.vision_model) && isLocalModel(settings.vision_model, localModelIds, settings.model_bindings?.vision?.connection)) {
            otherRolesWithLocal.push("Vision");
        }

        if (otherRolesWithLocal.length > 0) {
            return `A single local model instance cannot be run concurrently across multiple roles (currently used in ${otherRolesWithLocal.join(", ")}). To use only the local model, set Master to local and set the remaining roles to (None).`;
        }
        return null;
    };

    return (
        <div className="settings-panel column">
            <div className="settings-panel-header align-center justify-space-between">
                <h2 style={{ margin: 0 }}>Task Settings</h2>
                <ModalCloseButton id="task-settings-close-button" label="Close task settings" onClick={onClose}/>
            </div>
            <div className="settings-panel-body column gap-20">

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
                        <label style={{ minWidth: "65px" }}>Master</label>
                        <div style={{ flex: 1 }}>
                            <ModelDropdown
                                value={settings.master_model}
                                options={availableModels}
                                onChange={(v) => updateSetting("master_model", v)}
                                catalogue={modelCatalogue} binding={settings.model_bindings?.master}
                                onBindingChange={binding=>setModelBinding("master",binding)} role="master"
                                getDisabledReason={getDisabledReasonForRole("master")}
                                localModelIds={localModelIds}
                            />
                        </div>
                        <EffortDropdown id="task-master-effort-select" value={settings.master_effort} onChange={(v) => updateSetting("master_effort", v)} disabled={isLocalModel(settings.master_model, localModelIds, settings.model_bindings?.master?.connection) || isNone(settings.master_model)} />
                    </div>
                    <div className="settings-model-row align-center gap-10">
                        <label style={{ minWidth: "65px" }}>Worker</label>
                        <div style={{ flex: 1 }}>
                            <ModelDropdown
                                value={settings.worker_model}
                                options={availableModels}
                                onChange={(v) => updateSetting("worker_model", v)}
                                allowNone={true}
                                catalogue={modelCatalogue} binding={settings.model_bindings?.worker}
                                onBindingChange={binding=>setModelBinding("worker",binding)} role="worker"
                                getDisabledReason={getDisabledReasonForRole("worker")}
                                localModelIds={localModelIds}
                            />
                        </div>
                        <EffortDropdown id="task-worker-effort-select" value={settings.worker_effort} onChange={(v) => updateSetting("worker_effort", v)} disabled={isLocalModel(settings.worker_model, localModelIds, settings.model_bindings?.worker?.connection) || isNone(settings.worker_model)} />
                    </div>
                    <div className="settings-model-row align-center gap-10">
                        <label style={{ minWidth: "65px" }}>Verifier</label>
                        <div style={{ flex: 1 }}>
                            <ModelDropdown
                                value={settings.verifier_model}
                                options={availableModels}
                                onChange={(v) => updateSetting("verifier_model", v)}
                                allowNone={true}
                                catalogue={modelCatalogue} binding={settings.model_bindings?.verifier}
                                onBindingChange={binding=>setModelBinding("verifier",binding)} role="verifier"
                                getDisabledReason={getDisabledReasonForRole("verifier")}
                                localModelIds={localModelIds}
                            />
                        </div>
                        <EffortDropdown id="task-verifier-effort-select" value={settings.verifier_effort} onChange={(v) => updateSetting("verifier_effort", v)} disabled={isLocalModel(settings.verifier_model, localModelIds, settings.model_bindings?.verifier?.connection) || isNone(settings.verifier_model)} />
                    </div>
                    <div className="settings-model-row align-center gap-10">
                        <label style={{ minWidth: "65px" }}>Watcher</label>
                        <div style={{ flex: 1 }}>
                            <ModelDropdown
                                value={settings.watcher_model}
                                options={availableModels}
                                onChange={(v) => updateSetting("watcher_model", v)}
                                allowNone={true}
                                catalogue={modelCatalogue} binding={settings.model_bindings?.watcher}
                                onBindingChange={binding=>setModelBinding("watcher",binding)} role="watcher"
                                getDisabledReason={getDisabledReasonForRole("watcher")}
                                localModelIds={localModelIds}
                            />
                        </div>
                        <EffortDropdown id="task-watcher-effort-select" value={settings.watcher_effort} onChange={(v) => updateSetting("watcher_effort", v)} disabled={isLocalModel(settings.watcher_model, localModelIds, settings.model_bindings?.watcher?.connection) || isNone(settings.watcher_model)} />
                    </div>
                    <div className="settings-model-row align-center gap-10">
                        <label style={{ minWidth: "65px" }}>Vision</label>
                        <div style={{ flex: 1 }}>
                            <ModelDropdown
                                value={settings.vision_model || "gemini-3.8-flash"}
                                options={availableModels}
                                onChange={(v) => updateSetting("vision_model", v)}
                                allowNone={true}
                                catalogue={modelCatalogue} binding={settings.model_bindings?.vision}
                                onBindingChange={binding=>setModelBinding("vision",binding)} role="vision"
                                getDisabledReason={getDisabledReasonForRole("vision")}
                                localModelIds={localModelIds}
                            />
                        </div>
                        <EffortDropdown id="task-vision-effort-select" value={settings.vision_effort} onChange={(v) => updateSetting("vision_effort", v)} disabled={isLocalModel(settings.vision_model, localModelIds, settings.model_bindings?.vision?.connection) || isNone(settings.vision_model)} />
                    </div>
                    <label className="column gap-4">Image delivery
                        <select className="settings-input" aria-label="Image delivery" value={settings.image_delivery || "auto"} onChange={event=>updateSetting("image_delivery",event.target.value)}>
                            <option value="auto">Auto: direct when supported, otherwise configured helper</option>
                            <option value="helper">Always use configured vision helper</option>
                        </select>
                    </label>
                    {!teamValidation.isValid && (
                        <div
                            id="task-settings-delegation-warning"
                            className="delegation-team-warning"
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px",
                                padding: "12px 14px",
                                background: "rgba(234, 179, 8, 0.1)",
                                border: "1px solid rgba(234, 179, 8, 0.35)",
                                borderRadius: "6px",
                                fontSize: "12px",
                                lineHeight: "1.45"
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", color: "#facc15" }}>
                                <span style={{ fontSize: "16px", lineHeight: "1" }}>⚠️</span>
                                <div style={{ flex: 1 }}>
                                    <strong style={{ fontSize: "13px" }}>Incomplete Model Setup: Multi-Agent vs. Solo Mode</strong>
                                    <div style={{ marginTop: "4px", color: "#e2e8f0" }}>
                                        Zeus Agent supports two execution modes:
                                        <ul style={{ margin: "6px 0 6px 18px", padding: 0 }}>
                                            <li><strong>Multi-Agent Team Mode:</strong> Uses specialized Worker, Verifier, and Watcher agents for higher overall performance, rigorous verification, and reliable task execution.</li>
                                            <li><strong>Single-Agent Solo Mode:</strong> A single Master model handles all execution directly, emulating multi-agent coordination in one context. This typically yields lower task completion performance even with frontier models.</li>
                                        </ul>
                                        To run in Multi-Agent mode, please assign a valid model to the remaining role(s): <strong>{teamValidation.missingRoles.join(", ")}</strong>. Or set all three to <em>(None)</em> for Single-Agent Solo mode.
                                    </div>
                                    <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--text-secondary, #9ca3af)", fontStyle: "italic" }}>
                                        *Note: Single-agent mode typically consumes fewer credits, but total credit spend depends on the specific models selected (e.g., 4 lightweight models may cost less than 1 expensive frontier model).
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "2px" }}>
                                <button
                                    type="button"
                                    className="settings-button"
                                    style={{ fontSize: "11px", padding: "4px 10px" }}
                                    onClick={setAllDelegationNone}
                                >
                                    Switch to Solo Mode (Set all 3 to None)
                                </button>
                            </div>
                        </div>
                    )}

                    <label className="settings-hint">Zeus Agent supports Multi-Agent Team mode (all roles active for peak performance & verification) or Single-Agent Solo mode (Worker, Verifier, Watcher set to (None)). Solo mode typically uses fewer credits but has lower performance; credit spend depends on your chosen model tiers.</label>
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
                    <label className="settings-hint">Token allowance checked between model requests. Usage from all roles counts toward this task. A request can exceed the remaining allowance. Units are not provider credits.</label>
                </div>
            </div>

            <div className="column gap-20">
                <h3 style={{ margin: 0, opacity: 0.9 }}>Browser</h3>
                <div className="settings-section column gap-10">
                    <span>This task uses one shared Zeus browser. Runtime setup is in global settings. Personal-browser takeover is not enabled.</span>
                    {(settings.browser_mode==='main'||settings.browser_executable_path)&&<><span>Your saved personal/custom-browser preference is inactive.</span><button className="settings-button" onClick={()=>{updateSetting('browser_mode','sandboxed');updateSetting('browser_executable_path',null);}}>Use Zeus’s dedicated browser</button></>}
                </div>
            </div>

            <button id="task-save-settings-button" className={`settings-button align-center justify-center ${saving ? "is-loading" : ""}`} onClick={handleSaveSettings} disabled={saving}>
                <label>{saving ? "Saving..." : "Save settings"}</label>
            </button>
            </div>
        </div>
    );
};

export default TaskSettingsModal;
