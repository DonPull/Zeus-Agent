import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "../styles/ActionPlan.css";

export default function ActionPlanPanel({ actionPlanMarkdown }) {
    if (!actionPlanMarkdown) return null;

    return (
        <div id="action-plan-sidebar" className="column">
            <div id="action-plan-header" className="row">
                <label>Action Plan</label>
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
