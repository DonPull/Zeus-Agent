import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "../styles/ActionPlan.css";

function parseMarkdownSteps(markdown) {
    if (!markdown) return [];
    const steps = [];
    const lines = markdown.split("\n");
    let hasInProgress = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        // Check for checkbox syntax: - [x] or * [x] or - [ ] or * [ ]
        const checkMatch = line.match(/^[-*]\s*\[([ xX])\]\s*(.+)$/);
        if (checkMatch) {
            const isDone = checkMatch[1].toLowerCase() === "x";
            const text = checkMatch[2].trim();
            const lower = text.toLowerCase();
            let status = "pending";
            if (isDone) {
                status = "completed";
            } else if (lower.includes("(in progress)") || lower.includes("[in progress]") || lower.includes("(current)")) {
                status = "in_progress";
                hasInProgress = true;
            }
            steps.push({
                title: text.replace(/\s*[([](in progress|current)[)\]]/i, "").trim(),
                status,
                description: null,
            });
            continue;
        }

        // Check for numbered list: 1. Step title
        const numMatch = line.match(/^(\d+)\.\s+(.+)$/);
        if (numMatch) {
            const text = numMatch[2].trim();
            const lower = text.toLowerCase();
            let status = "pending";
            if (lower.includes("(done)") || lower.includes("[done]") || lower.includes("✓")) {
                status = "completed";
            } else if (lower.includes("(in progress)") || lower.includes("[in progress]")) {
                status = "in_progress";
                hasInProgress = true;
            }
            steps.push({
                title: text.replace(/\s*[([](done|in progress)[)\]]/i, "").replace(/✓/g, "").trim(),
                status,
                description: null,
            });
        }
    }

    // If no step is explicitly marked in_progress, mark the first pending step after completed ones
    if (!hasInProgress) {
        for (const s of steps) {
            if (s.status === "pending") {
                s.status = "in_progress";
                break;
            }
        }
    }

    return steps;
}

export default function ActionPlanPanel({ actionPlanMarkdown, onClose }) {
    const [showMarkdown, setShowMarkdown] = useState(false);

    if (!actionPlanMarkdown) return null;

    let markdownText = actionPlanMarkdown;
    let steps = null;

    if (typeof actionPlanMarkdown === "string" && actionPlanMarkdown.trim().startsWith("{")) {
        try {
            const parsed = JSON.parse(actionPlanMarkdown);
            if (parsed.markdown) markdownText = parsed.markdown;
            if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
                steps = parsed.steps;
            }
        } catch (_) {
            // fallback to raw markdown
        }
    }

    if (!steps || steps.length === 0) {
        steps = parseMarkdownSteps(markdownText);
    }

    const totalSteps = steps.length;
    const completedSteps = steps.filter(s => s.status === "completed").length;
    const percent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    return (
        <div id="action-plan-sidebar" className="column">
            <div id="action-plan-header" className="row justify-space-between align-center">
                <label>Action Plan</label>
                <button className="icon-button" onClick={onClose} title="Close Action Plan">✕</button>
            </div>

            {totalSteps > 0 && (
                <div className="action-plan-progress-container">
                    <div className="action-plan-progress-info">
                        <span>Progress: {completedSteps} / {totalSteps} steps</span>
                        <span>{percent}%</span>
                    </div>
                    <div className="action-plan-progress-bar">
                        <div className="action-plan-progress-fill" style={{ width: `${percent}%` }} />
                    </div>
                </div>
            )}

            <div id="action-plan-content" className="column">
                {totalSteps > 0 && (
                    <div className="action-plan-stepper">
                        {steps.map((step, idx) => {
                            const status = step.status || "pending";
                            return (
                                <div key={idx} className={`action-plan-step-item status-${status}`}>
                                    <div className={`action-plan-step-node step-node-${status}`}>
                                        {status === "completed" && "✓"}
                                        {status === "in_progress" && "▶"}
                                        {status === "interrupted" && "!"}
                                        {status === "failed" && "✕"}
                                        {status === "pending" && (idx + 1)}
                                    </div>
                                    <div className="action-plan-step-body">
                                        <div className="action-plan-step-title">
                                            <span>{step.title}</span>
                                            <span className={`action-plan-status-badge badge-${status}`}>
                                                {status.replace("_", " ")}
                                            </span>
                                        </div>
                                        {step.description && (
                                            <div className="action-plan-step-desc">{step.description}</div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                <button
                    className="action-plan-toggle-markdown"
                    onClick={() => setShowMarkdown(!showMarkdown)}
                >
                    {showMarkdown ? "▲ Hide Full Plan Notes" : "▼ Show Full Plan Notes"}
                </button>

                {showMarkdown && (
                    <div className="action-plan-markdown-section">
                        <div className="markdown-body">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {markdownText}
                            </ReactMarkdown>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
