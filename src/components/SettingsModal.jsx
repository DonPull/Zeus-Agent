import { useEffect, useState } from "react";
import * as bridge from "../bridge";

export const CompanyIcon = ({ company }) => {
    switch (company) {
        case "OpenAI": return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.073zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.0993 3.8558L12.5973 8.3829v-2.3324a.0804.0804 0 0 1 .0332-.0615l3.973-2.2902a4.4992 4.4992 0 0 1 6.1408 1.6464 4.4708 4.4708 0 0 1 .5346 3.0137l-.1419-.0852-4.783-2.7582a.7712.7712 0 0 0-.7806 0l-5.8428 3.3685zm4.01-6.2425a4.4755 4.4755 0 0 1-2.3655 1.9728V5.6844a.7664.7664 0 0 0-.3879-.6765L14.341 1.6536l2.0201-1.1685a.0757.0757 0 0 1 .071 0l4.8303 2.7865a4.504 4.504 0 0 1 .681 4.5089v-.0304zM7.3497 1.9863a4.4755 4.4755 0 0 1 2.8764 1.0408l-.1419.0804-4.7783 2.7582a.7948.7948 0 0 0-.3927.6813v6.7369l-2.02-1.1686a.071.071 0 0 1-.038-.052V6.4807a4.504 4.504 0 0 1 4.4945-4.4944zm6.0592 5.0935l-2.02 1.1685-2.02-1.1685V4.7471l2.02-1.1685 2.02 1.1685v2.3327z" /></svg>;
        case "Google": return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>;
        case "Anthropic": return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.541z" /></svg>;
        case "Meta": return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.962-2.58-1.536-4.08-1.65a10.82 10.82 0 0 0-1.745.021l-.01.002c-1.391.31-2.709.855-3.896 1.616-.494.316-.967.665-1.411 1.045-.05.042-.1.085-.15.127a9.385 9.385 0 0 0 8.902-4.192zM12 24C5.373 24 0 18.627 0 12S5.373 0 12 0s12 5.373 12 12-5.373 12-12 12z" fill="#0668E1" /></svg>;
        case "Qwen": return <svg width="16" height="16" viewBox="0 0 24 24" fill="#a855f7"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l-8-4v6l8 4 8-4v-6l-8 4zm0 6l-8-4v6l8 4 8-4v-6l-8 4z"/></svg>;
        case "Local": return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>;
        case "Xiaomi": return (
            <svg width="16" height="16" viewBox="0 0 24 24">
                <rect width="24" height="24" rx="4" fill="#ff6900" />
                <path d="M6 7h3v5.5h3V7h3v10h-3v-4.5H9V17H6V7z" fill="#ffffff" />
                <circle cx="18" cy="14.5" r="1.5" fill="#ffffff" />
            </svg>
        );
        default: return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><path d="M8 16h.01" /><path d="M16 16h.01" /></svg>;
    }
};

export const getCompany = (model) => {
    if (!model) return "Other";
    const lower = model.toLowerCase();
    if (lower.includes("mimo") || lower.includes("xiaomi")) return "Xiaomi";
    if (lower.includes("qwen")) return "Qwen";
    if (lower.includes("gpt") || lower.includes("o1") || lower.includes("openai")) return "OpenAI";
    if (lower.includes("claude") || lower.includes("anthropic")) return "Anthropic";
    if (lower.includes("gemini") || lower.includes("google")) return "Google";
    if (lower.includes("llama") || lower.includes("meta")) return "Meta";
    if (lower.includes("local") || lower.includes("ik_llama")) return "Local";
    return "Other";
};

export const isLocalModel = (model, localModelIds = []) => {
    if (!model || model === "(None)" || model === "None") return false;
    if (Array.isArray(localModelIds) && localModelIds.includes(model)) return true;
    const m = model.toLowerCase();
    if (m.startsWith("local/") || m.startsWith("local:")) return true;
    if (
        m.includes("localhost") ||
        m.includes("127.0.0.1") ||
        m.endsWith(".gguf") ||
        m.endsWith(".bin") ||
        m.includes("ik_llama") ||
        m.includes(":latest")
    ) {
        return true;
    }
    return false;
};

import { useRef } from "react";

export const ModelDropdown = ({ value, options, onChange, allowNone = false, getDisabledReason = null, localModelIds = [] }) => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const dropdownRef = useRef(null);

    // Ensure default models are present
    const fullOptions = [];
    if (allowNone) {
        fullOptions.push("(None)");
    }
    options.forEach(m => {
        if (m && !fullOptions.includes(m)) fullOptions.push(m);
    });
    ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash-exp", "gemini-3.8-flash", "deepseek/deepseek-chat", "mimo-v2.6-pro", "mimo-v2.6"].forEach(m => {
        if (!fullOptions.includes(m)) fullOptions.push(m);
    });

    const isNoneVal = !value || value === "None" || value === "(None)";
    const displayValue = isNoneVal && allowNone ? "(None)" : (value || "Select model...");

    const filteredOptions = fullOptions.filter(opt => opt.toLowerCase().includes(search.toLowerCase()));

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setOpen(false);
            }
        }
        if (open) {
            document.addEventListener("mousedown", handleClickOutside);
        } else {
            document.removeEventListener("mousedown", handleClickOutside);
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [open]);

    return (
        <div ref={dropdownRef} style={{ position: "relative", width: "100%" }}>
            <div
                className="settings-input width-fill-available align-center gap-10"
                style={{ cursor: "pointer", display: "flex", justifyContent: "space-between" }}
                onClick={() => { setOpen(!open); setSearch(""); }}
            >
                <div className="align-center gap-10">
                    {displayValue === "(None)" ? (
                        <span style={{ width: 16, height: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: 0.5, fontSize: "12px" }}>⊘</span>
                    ) : (
                        <CompanyIcon company={getCompany(displayValue)} />
                    )}
                    <span style={{ opacity: displayValue === "(None)" ? 0.6 : 1 }}>{displayValue}</span>
                    {isLocalModel(displayValue, localModelIds) && (
                        <span className="local-badge" style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "3px", background: "rgba(59, 130, 246, 0.2)", color: "#60a5fa", border: "1px solid rgba(59, 130, 246, 0.4)", marginLeft: "6px", fontWeight: 600 }}>Local</span>
                    )}
                </div>
                <span style={{ opacity: 0.5, fontSize: "0.8em" }}>▼</span>
            </div>

            {open && (
                <div
                    style={{
                        position: "absolute", top: "100%", left: 0, right: 0,
                        backgroundColor: "var(--bg-color, #1a1a1a)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "4px",
                        marginTop: "4px",
                        maxHeight: "250px", overflowY: "auto",
                        zIndex: 1000,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                        display: "flex", flexDirection: "column"
                    }}
                >
                    <input
                        type="text"
                        className="settings-input"
                        style={{ border: "none", borderBottom: "1px solid var(--border-color)", borderRadius: 0, backgroundColor: "transparent" }}
                        placeholder="Search model..."
                        autoFocus
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />

                    {filteredOptions.length > 0 ? filteredOptions.map(opt => {
                        const isNoneOpt = opt === "(None)";
                        const disabledReason = !isNoneOpt && getDisabledReason ? getDisabledReason(opt) : null;
                        const isDisabled = Boolean(disabledReason);
                        const isLocal = !isNoneOpt && isLocalModel(opt, localModelIds);

                        return (
                            <div
                                key={opt}
                                className="align-center gap-10"
                                title={disabledReason || ""}
                                style={{
                                    padding: "8px 12px",
                                    cursor: isDisabled ? "not-allowed" : "pointer",
                                    opacity: isDisabled ? 0.45 : 1,
                                    transition: "background 0.2s"
                                }}
                                onClick={() => {
                                    if (isDisabled) return;
                                    onChange(isNoneOpt ? "None" : opt);
                                    setOpen(false);
                                }}
                                onMouseOver={(e) => {
                                    if (!isDisabled) e.currentTarget.style.backgroundColor = "var(--border-color)";
                                }}
                                onMouseOut={(e) => {
                                    if (!isDisabled) e.currentTarget.style.backgroundColor = "transparent";
                                }}
                            >
                                {isNoneOpt ? (
                                    <span style={{ width: 16, height: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: 0.5, fontSize: "12px" }}>⊘</span>
                                ) : (
                                    <CompanyIcon company={getCompany(opt)} />
                                )}
                                <span style={{ flex: 1, display: "flex", alignItems: "center" }}>
                                    {opt}
                                    {isLocal && (
                                        <span className="local-badge" style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "3px", background: "rgba(59, 130, 246, 0.2)", color: "#60a5fa", border: "1px solid rgba(59, 130, 246, 0.4)", marginLeft: "6px", fontWeight: 600 }}>Local</span>
                                    )}
                                </span>
                                {isDisabled && (
                                    <span style={{ fontSize: "11px", color: "var(--zeus-text-dim, #94a3b8)", opacity: 0.8 }}>
                                        🔒 In use
                                    </span>
                                )}
                            </div>
                        );
                    }) : (
                        <div style={{ padding: "8px 12px", opacity: 0.5 }}>No models found...</div>
                    )}
                </div>
            )}
        </div>
    );
};

export const EFFORT_OPTIONS = [
    { value: "default", label: "Default Effort" },
    { value: "low", label: "Low Effort" },
    { value: "medium", label: "Medium Effort" },
    { value: "high", label: "High Effort" },
];

export const EffortDropdown = ({ value, onChange, id, disabled }) => {
    const currentVal = value || "default";
    return (
        <select
            id={id}
            className="settings-input"
            style={{
                minWidth: "130px",
                width: "135px",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.6 : 1,
            }}
            value={disabled ? "default" : currentVal}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            title={disabled ? "Reasoning effort is only supported on cloud reasoning models" : "Reasoning effort level (low, medium, high, or default)"}
        >
            <option value="default">{disabled ? "N/A (Local/None)" : "Default Effort"}</option>
            {!disabled && (
                <>
                    <option value="low">Low Effort</option>
                    <option value="medium">Medium Effort</option>
                    <option value="high">High Effort</option>
                </>
            )}
        </select>
    );
};

export const isNoneModel = (v) => !v || v === "None" || v === "(None)";

export const validateTeamConfig = (settings) => {
    if (!settings) return { isValid: true, missingRoles: [], countNone: 0, message: "" };
    const roles = [
        { label: "Worker", key: "worker_model" },
        { label: "Verifier", key: "verifier_model" },
        { label: "Watcher", key: "watcher_model" },
    ];
    const missingRoles = roles
        .filter(r => isNoneModel(settings[r.key]))
        .map(r => r.label);
    const countNone = missingRoles.length;
    // Valid if either ALL 3 are None (countNone === 3) OR NONE of them are None (countNone === 0)
    const isValid = countNone === 0 || countNone === 3;
    const message = !isValid
        ? `Incomplete setup: Zeus Agent requires either all 3 roles (Worker, Verifier, Watcher) for Multi-Agent mode, or all 3 set to (None) for Single-Agent Solo mode. Missing: ${missingRoles.join(", ")}.`
        : "";
    return { isValid, missingRoles, countNone, message };
};

function SettingsModal({ onToast, onClose }) {
    const [settings, setSettings] = useState(null);
    const [apiKeyInput, setApiKeyInput] = useState("");
    const [keyIsSet, setKeyIsSet] = useState(false);
    const [geminiApiKeyInput, setGeminiApiKeyInput] = useState("");
    const [geminiKeyIsSet, setGeminiKeyIsSet] = useState(false);
    const [xiaomiApiKeyInput, setXiaomiApiKeyInput] = useState("");
    const [xiaomiKeyIsSet, setXiaomiKeyIsSet] = useState(false);
    const [xiaomiStatus, setXiaomiStatus] = useState(null);
    const [testingXiaomi, setTestingXiaomi] = useState(false);
    const [availableModels, setAvailableModels] = useState([]);
    const [localModelIds, setLocalModelIds] = useState([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [saving, setSaving] = useState(false);
    const [permissions, setPermissions] = useState([]);
    const [newPermPath, setNewPermPath] = useState("");
    const [newPermAction, setNewPermAction] = useState("allow");
    const [newPermType, setNewPermType] = useState("read");

    const [localStatus, setLocalStatus] = useState(null);
    const [testingLocal, setTestingLocal] = useState(false);

    // Watcher Policies
    const [watcherPolicies, setWatcherPolicies] = useState([]);
    const [negotiatePrompt, setNegotiatePrompt] = useState("");
    const [negotiating, setNegotiating] = useState(false);
    const [generatedRules, setGeneratedRules] = useState("");

    useEffect(() => {
        (async () => {
            try {
                setSettings(await bridge.getSettings());
                setKeyIsSet(await bridge.hasApiKey());
                setGeminiKeyIsSet(await bridge.hasGeminiApiKey());
                setXiaomiKeyIsSet(await bridge.hasXiaomiApiKey());
                setPermissions(await bridge.getFilePermissions("global"));
                setWatcherPolicies(await bridge.getWatcherPolicies("global"));
                await handleLoadModels(true);
            } catch (err) {
                onToast(`Failed to load settings: ${err}`);
            }
        })();
    }, []);

    const handleTestLocalEndpoint = async () => {
        setTestingLocal(true);
        const endpoint = (settings?.local_base_url || "http://localhost:11434/v1").trim();
        try {
            const models = await bridge.testLocalEndpoint(endpoint);
            setLocalStatus({ ok: true, models });
            onToast(`Connected to local server! Found ${models.length} model(s): ${models.join(", ")}`, "success", 4000);
            await handleLoadModels(true);
        } catch (err) {
            setLocalStatus({ ok: false, error: String(err) });
            onToast(`Local connection failed: ${err}`, "error", 6000);
        } finally {
            setTestingLocal(false);
        }
    };

    const handleTestXiaomiEndpoint = async () => {
        setTestingXiaomi(true);
        const endpoint = (settings?.xiaomi_base_url || "https://token-plan-ams.xiaomimimo.com/v1").trim();
        try {
            const models = await bridge.testXiaomiEndpoint(endpoint);
            setXiaomiStatus({ ok: true, models });
            onToast(`Connected to Xiaomi server! Found ${models.length} model(s): ${models.join(", ")}`, "success", 4000);
            await handleLoadModels(true);
        } catch (err) {
            setXiaomiStatus({ ok: false, error: String(err) });
            onToast(`Xiaomi connection failed: ${err}`, "error", 6000);
        } finally {
            setTestingXiaomi(false);
        }
    };

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

    const handleSaveXiaomiApiKey = async () => {
        try {
            await bridge.setXiaomiApiKey(xiaomiApiKeyInput);
            setXiaomiApiKeyInput("");
            setXiaomiKeyIsSet(true);
            onToast("Xiaomi API key saved to the Windows Credential Manager.", "success", 3000);
            await handleLoadModels(true);
        } catch (err) {
            onToast(String(err));
        }
    };

    const handleSaveSettings = async () => {
        const validation = validateTeamConfig(settings);
        if (!validation.isValid) {
            onToast(validation.message, "error", 7000);
            return;
        }
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

    const handleLoadModels = async (silent = false) => {
        setLoadingModels(true);
        try {
            const models = await bridge.fetchAvailableModels();
            setAvailableModels(models);
            try {
                const localIds = await bridge.getLocalModelIds();
                if (Array.isArray(localIds)) setLocalModelIds(localIds);
            } catch (_) {}
            if (!silent) onToast(`Loaded ${models.length} available model(s).`, "success", 3000);
        } catch (err) {
            if (!silent) onToast(String(err), "error", 8000);
        } finally {
            setLoadingModels(false);
        }
    };

    const handleAddPermission = async () => {
        if (!newPermPath.trim()) return;
        try {
            const added = await bridge.addFilePermission("global", newPermPath.trim(), newPermAction, newPermType, "prefix");
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
        if (!generatedRules.trim()) return;
        try {
            const added = await bridge.addWatcherPolicy("global", generatedRules.trim());
            setWatcherPolicies([added]);
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

    const getModelLabel = (model) => {
        const lower = model.toLowerCase();
        if (lower.includes("gpt") || lower.includes("o1") || lower.includes("openai")) return `🟢 OpenAI (${model})`;
        if (lower.includes("claude") || lower.includes("anthropic")) return `🟤 Anthropic (${model})`;
        if (lower.includes("gemini") || lower.includes("google")) return `🔵 Google (${model})`;
        if (lower.includes("llama") || lower.includes("meta")) return `♾️ Meta (${model})`;
        if (lower.includes("mixtral") || lower.includes("mistral")) return `🌪️ Mistral (${model})`;
        if (lower.includes("cohere") || lower.includes("command")) return `🌲 Cohere (${model})`;
        if (lower.includes("deepseek")) return `🐋 DeepSeek (${model})`;
        if (lower.includes("qwen")) return `🟣 Qwen (${model})`;
        return `🤖 ${model}`;
    };

    if (!settings) {
        return (
            <div className="column align-center justify-center" style={{ height: "100%" }}>
                <div className="simple-spinner"><span></span></div>
            </div>
        );
    }

    const isNone = isNoneModel;

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
        if (!isLocalModel(opt, localModelIds)) return null;

        const otherRolesWithLocal = [];
        if (role !== "master" && !isNone(settings.master_model) && isLocalModel(settings.master_model, localModelIds)) {
            otherRolesWithLocal.push("Master");
        }
        if (role !== "worker" && !isNone(settings.worker_model) && isLocalModel(settings.worker_model, localModelIds)) {
            otherRolesWithLocal.push("Worker");
        }
        if (role !== "verifier" && !isNone(settings.verifier_model) && isLocalModel(settings.verifier_model, localModelIds)) {
            otherRolesWithLocal.push("Verifier");
        }
        if (role !== "watcher" && !isNone(settings.watcher_model) && isLocalModel(settings.watcher_model, localModelIds)) {
            otherRolesWithLocal.push("Watcher");
        }
        if (role !== "vision" && !isNone(settings.vision_model) && isLocalModel(settings.vision_model, localModelIds)) {
            otherRolesWithLocal.push("Vision");
        }

        if (otherRolesWithLocal.length > 0) {
            return `A single local model instance cannot be run concurrently across multiple roles (currently used in ${otherRolesWithLocal.join(", ")}). To use only the local model, set Master to local and set the remaining roles to (None).`;
        }
        return null;
    };

    return (
        <div className="modal column gap-20" style={{ padding: "24px", minWidth: "500px", maxHeight: "80vh", overflowY: "auto" }}>
            <div className="align-center justify-space-between">
                <h2 style={{ margin: 0 }}>Settings</h2>
                <button id="settings-close-button" className="icon-button" onClick={onClose}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>

            <div className="column gap-20" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "20px" }}>
                <h3 style={{ margin: 0, opacity: 0.9 }}>Global App Settings</h3>
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
                    <label className="settings-section-label">Local Model Server (llama.cpp / Ollama / LM Studio)</label>
                    <div className="align-center gap-10">
                        <input
                            type="text"
                            className="settings-input width-fill-available"
                            placeholder="e.g. http://localhost:11434/v1 or http://localhost:1234/v1"
                            value={settings.local_base_url || ""}
                            onChange={(e) => updateSetting("local_base_url", e.target.value)}
                        />
                        <button
                            className={`settings-button ${testingLocal ? "is-loading" : ""}`}
                            onClick={handleTestLocalEndpoint}
                            disabled={testingLocal}
                        >
                            <label>{testingLocal ? "Testing..." : "Test Local"}</label>
                        </button>
                        {localStatus && (
                            <span className={`key-status-pill ${localStatus.ok ? "set" : "missing"}`}>
                                {localStatus.ok ? `Connected (${localStatus.models.length} model)` : "Offline"}
                            </span>
                        )}
                    </div>
                    <label className="settings-hint">
                        OpenAI-compatible local endpoint (e.g. <code>ik_llama.cpp</code>, Ollama, LM Studio). Zero API keys required.
                    </label>
                </div>

                <div className="settings-section column gap-10">
                    <label className="settings-section-label">Xiaomi MiMo (Dedicated Base URL & API Key)</label>
                    <div className="column gap-10">
                        <div className="align-center gap-10">
                            <input
                                type="text"
                                className="settings-input width-fill-available"
                                placeholder="https://token-plan-ams.xiaomimimo.com/v1"
                                value={settings.xiaomi_base_url || ""}
                                onChange={(e) => updateSetting("xiaomi_base_url", e.target.value)}
                            />
                            <button
                                className={`settings-button ${testingXiaomi ? "is-loading" : ""}`}
                                onClick={handleTestXiaomiEndpoint}
                                disabled={testingXiaomi || !xiaomiKeyIsSet}
                                title={!xiaomiKeyIsSet ? "Save your Xiaomi API key first" : "Test endpoint connection and load models"}
                            >
                                <label>{testingXiaomi ? "Testing..." : "Test Connection"}</label>
                            </button>
                            {xiaomiStatus && (
                                <span className={`key-status-pill ${xiaomiStatus.ok ? "set" : "missing"}`}>
                                    {xiaomiStatus.ok ? `Connected (${xiaomiStatus.models.length} model)` : "Offline"}
                                </span>
                            )}
                        </div>
                        <div className="align-center gap-10">
                            <input
                                type="password"
                                className="settings-input width-fill-available"
                                placeholder="Paste your Xiaomi MiMo API key"
                                value={xiaomiApiKeyInput}
                                onChange={(e) => setXiaomiApiKeyInput(e.target.value)}
                            />
                            <button className="settings-button" onClick={handleSaveXiaomiApiKey} disabled={!xiaomiApiKeyInput.trim()}>
                                <label>Save key</label>
                            </button>
                            <span className={`key-status-pill ${xiaomiKeyIsSet ? "set" : "missing"}`}>{xiaomiKeyIsSet ? "Key set" : "No key"}</span>
                        </div>
                    </div>
                    <label className="settings-hint">
                        Dedicated OpenAI-compatible endpoint for models like <code>mimo-v2.6-pro</code>. API key is stored in the Windows Credential Manager.
                    </label>
                </div>
            </div>

            <div className="column gap-20" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "20px" }}>
                <h3 style={{ margin: 0, opacity: 0.9 }}>Default Chat Settings</h3>
                <label className="settings-hint">These settings apply by default when creating new chats.</label>

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
                                value={settings.master_model || "gemini-1.5-pro"}
                                options={availableModels}
                                onChange={(v) => updateSetting("master_model", v)}
                                getDisabledReason={getDisabledReasonForRole("master")}
                                localModelIds={localModelIds}
                            />
                        </div>
                        <EffortDropdown id="master-effort-select" value={settings.master_effort} onChange={(v) => updateSetting("master_effort", v)} disabled={isLocalModel(settings.master_model, localModelIds) || isNone(settings.master_model)} />
                    </div>
                    <div className="settings-model-row align-center gap-10">
                        <label style={{ minWidth: "65px" }}>Worker</label>
                        <div style={{ flex: 1 }}>
                            <ModelDropdown
                                value={settings.worker_model}
                                options={availableModels}
                                onChange={(v) => updateSetting("worker_model", v)}
                                allowNone={true}
                                getDisabledReason={getDisabledReasonForRole("worker")}
                                localModelIds={localModelIds}
                            />
                        </div>
                        <EffortDropdown id="worker-effort-select" value={settings.worker_effort} onChange={(v) => updateSetting("worker_effort", v)} disabled={isLocalModel(settings.worker_model, localModelIds) || isNone(settings.worker_model)} />
                    </div>
                    <div className="settings-model-row align-center gap-10">
                        <label style={{ minWidth: "65px" }}>Verifier</label>
                        <div style={{ flex: 1 }}>
                            <ModelDropdown
                                value={settings.verifier_model}
                                options={availableModels}
                                onChange={(v) => updateSetting("verifier_model", v)}
                                allowNone={true}
                                getDisabledReason={getDisabledReasonForRole("verifier")}
                                localModelIds={localModelIds}
                            />
                        </div>
                        <EffortDropdown id="verifier-effort-select" value={settings.verifier_effort} onChange={(v) => updateSetting("verifier_effort", v)} disabled={isLocalModel(settings.verifier_model, localModelIds) || isNone(settings.verifier_model)} />
                    </div>
                    <div className="settings-model-row align-center gap-10">
                        <label style={{ minWidth: "65px" }}>Watcher</label>
                        <div style={{ flex: 1 }}>
                            <ModelDropdown
                                value={settings.watcher_model}
                                options={availableModels}
                                onChange={(v) => updateSetting("watcher_model", v)}
                                allowNone={true}
                                getDisabledReason={getDisabledReasonForRole("watcher")}
                                localModelIds={localModelIds}
                            />
                        </div>
                        <EffortDropdown id="watcher-effort-select" value={settings.watcher_effort} onChange={(v) => updateSetting("watcher_effort", v)} disabled={isLocalModel(settings.watcher_model, localModelIds) || isNone(settings.watcher_model)} />
                    </div>
                    <div className="settings-model-row align-center gap-10">
                        <label style={{ minWidth: "65px" }}>Vision</label>
                        <div style={{ flex: 1 }}>
                            <ModelDropdown
                                value={settings.vision_model || "gemini-3.8-flash"}
                                options={availableModels}
                                onChange={(v) => updateSetting("vision_model", v)}
                                allowNone={true}
                                getDisabledReason={getDisabledReasonForRole("vision")}
                                localModelIds={localModelIds}
                            />
                        </div>
                        <EffortDropdown id="vision-effort-select" value={settings.vision_effort} onChange={(v) => updateSetting("vision_effort", v)} disabled={isLocalModel(settings.vision_model, localModelIds) || isNone(settings.vision_model)} />
                    </div>

                    {!teamValidation.isValid && (
                        <div
                            id="settings-delegation-warning"
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
                    <label className="settings-section-label">Browser</label>
                    <div className="settings-model-row align-center gap-10">
                        <label>Default Browser Mode</label>
                        <select 
                            className="settings-input" 
                            style={{ flex: 1 }}
                            value={settings.browser_mode || "sandboxed"} 
                            onChange={e => updateSetting("browser_mode", e.target.value)}
                        >
                            <option value="sandboxed">Workspace Sandboxed Browser (Isolated)</option>
                            <option value="main">User Main Browser Takeover</option>
                        </select>
                    </div>
                    {settings.browser_mode === "main" && (
                        <div className="settings-model-row align-center gap-10">
                            <label>Browser Executable (Optional)</label>
                            <input
                                type="text"
                                className="settings-input"
                                style={{ flex: 1 }}
                                placeholder="Auto-detect or enter path to browser .exe"
                                value={settings.browser_executable_path || ""}
                                onChange={(e) => updateSetting("browser_executable_path", e.target.value)}
                            />
                        </div>
                    )}
                    <label className="settings-hint">Sandboxed creates a new empty browser per chat. Main Takeover uses your daily browser (you must close it first).</label>
                </div>
            </div>

            <div className="column gap-20">
                <h3 style={{ margin: 0, opacity: 0.9 }}>Global Constraints</h3>
                <div className="settings-section column gap-10">
                    <label className="settings-section-label">Global File Permissions</label>
                    <div className="align-center gap-10">
                        <input className="settings-input" style={{ flex: 1 }} placeholder="C:/Projects or /home/user" value={newPermPath} onChange={e => setNewPermPath(e.target.value)} />
                        <select id="permission-action-select" className="settings-input permission-action-select" value={newPermAction} onChange={e => setNewPermAction(e.target.value)}>
                            <option value="allow">Allow</option>
                            <option value="deny">Deny</option>
                            <option value="ask">Ask</option>
                        </select>
                        <select id="permission-type-select" className="settings-input permission-type-select" value={newPermType} onChange={e => setNewPermType(e.target.value)}>
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

                    {watcherPolicies.length > 0 && watcherPolicies[0].rules_summary ? (
                        <div className="column gap-10" style={{ border: "1px solid var(--border-color)", borderRadius: "6px", padding: "10px" }}>
                            <div className="align-center justify-space-between">
                                <label style={{ fontSize: "0.9rem", fontWeight: 600 }}>Currently Enforced Rules:</label>
                                <button className="settings-button" style={{ padding: "4px 8px" }} onClick={() => handleDeletePolicy(watcherPolicies[0].id)}>
                                    <label>Clear Rules</label>
                                </button>
                            </div>
                            <pre style={{ margin: 0, fontSize: "0.85rem", whiteSpace: "pre-wrap", color: "var(--text-color)", opacity: 0.8 }}>
                                {watcherPolicies[0].rules_summary}
                            </pre>
                        </div>
                    ) : (
                        <div style={{ fontSize: "0.9rem", opacity: 0.7 }}>No global Watcher rules enforced. The agent has full access.</div>
                    )}

                    <div className="column gap-10 mt-10">
                        <textarea
                            className="settings-input width-fill-available"
                            rows={2}
                            placeholder={watcherPolicies.length > 0 ? "Chat with Watcher AI to modify these rules..." : "Chat with Watcher AI to generate rules... (e.g. 'Allow github.com')"}
                            value={negotiatePrompt}
                            onChange={(e) => setNegotiatePrompt(e.target.value)}
                        />
                        <button className={`settings-button ${negotiating ? "is-loading" : ""}`} onClick={handleNegotiatePolicy} disabled={negotiating || !negotiatePrompt.trim()}>
                            <label>{negotiating ? "Negotiating with Watcher..." : "Chat with Watcher"}</label>
                        </button>
                    </div>

                    {generatedRules && (
                        <div className="column gap-10 mt-10" style={{ border: "1px solid var(--zeus-accent)", padding: "10px", borderRadius: "6px", background: "var(--bg-secondary)" }}>
                            <label className="settings-section-label" style={{ fontSize: "0.9rem", color: "var(--zeus-accent)" }}>Proposed Rule Block (Editable):</label>
                            <textarea className="settings-input width-fill-available" rows={5} value={generatedRules} onChange={(e) => setGeneratedRules(e.target.value)} />

                            <div className="align-center justify-end gap-10 mt-5">
                                <button className="settings-button" onClick={() => setGeneratedRules("")}>
                                    <label>Cancel</label>
                                </button>
                                <button className="settings-button primary" onClick={handleSavePolicy}>
                                    <label>Save Policy</label>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <button id="global-save-settings-button" className={`settings-button align-center justify-center ${saving ? "is-loading" : ""}`} onClick={handleSaveSettings} disabled={saving}>
                <label>{saving ? "Saving..." : "Save settings"}</label>
            </button>
        </div>
    );
}

export default SettingsModal;