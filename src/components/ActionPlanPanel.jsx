import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "../styles/ActionPlan.css";

export default function ActionPlanPanel({ actionPlanMarkdown, onClose }) {
    if (!actionPlanMarkdown) return null;

    return (
        <div id="action-plan-sidebar" className="column">
            <div id="action-plan-header" className="row justify-space-between align-center">
                <label>Action Plan</label>
                <button className="icon-button" onClick={onClose} title="Close Action Plan">✕</button>
            </div>
            <div id="action-plan-content" className="column">
                <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {actionPlanMarkdown}
                    </ReactMarkdown>
                </div>
            </div>
        </div>
    );
}
