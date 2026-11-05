import React, { useState } from "react";
import ModalCloseButton from './ModalCloseButton';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "../styles/ActionPlan.css";
import {readActionPlan} from '../actionPlan';

export default function ActionPlanPanel({ actionPlanMarkdown, onClose }) {
    const [showMarkdown, setShowMarkdown] = useState(false);

    if (!actionPlanMarkdown) return null;

    const {steps,notes:markdownText,checkpoint}=readActionPlan(actionPlanMarkdown);
    const executionLabels={idle:'Ready',running:'Working',awaiting_user:'Waiting for you',stopping:'Stopping',cancelled:'Stopped',interrupted:'Interrupted',failed:'Run failed',paused:'Paused',completed:'Run finished'};

    const totalSteps = steps.length;
    const completedSteps = steps.filter(s => s.status === "completed").length;
    const percent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    return (
        <div id="action-plan-sidebar" className="column">
            <div id="action-plan-header" className="row justify-space-between align-center">
                <label>Action Plan</label>
                <ModalCloseButton label="Close Action Plan" onClick={onClose}/>
            </div>

            {checkpoint&&<div className="action-plan-execution" aria-label="Execution status">
                <div className="action-plan-execution-row">
                    <span>Execution</span>
                    <span className={'action-plan-execution-state execution-'+checkpoint.state}>
                        <span className="execution-dot" aria-hidden="true"/>
                        {executionLabels[checkpoint.state]||'Status unavailable'}
                    </span>
                </div>
                {checkpoint.actions?.attempted>0&&<div className="action-plan-execution-detail">
                    Action results: {checkpoint.actions.returned} / {checkpoint.actions.attempted}
                    {checkpoint.actions.uncertain>0&&<> · {checkpoint.actions.uncertain} outcome unknown</>}
                </div>}
                {checkpoint.plan_stale&&<p className="action-plan-context-note">This plan predates your latest message. Zeus can revise it as needed.</p>}
                {checkpoint.historical_plan&&<p className="action-plan-context-note">Earlier saved plan; its coverage of your latest request is unknown.</p>}
                {checkpoint.completion&&<p className="action-plan-context-note">Completion evidence: {checkpoint.completion.checks?.passed||0} checks passed, {checkpoint.completion.checks?.failed||0} failed. {checkpoint.completion.goal_status==='model_supported'?'Supported by configured model review.':'Whole-goal verification remains unknown.'}</p>}
            </div>}

            {totalSteps > 0 && (
                <div className="action-plan-progress-container">
                    <div className="action-plan-progress-info">
                        <span>{checkpoint?'Reported progress':'Progress'}: {completedSteps} / {totalSteps} steps</span>
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
                                <div key={step.id||idx} className={`action-plan-step-item status-${status}`}>
                                    <div className={`action-plan-step-node step-node-${status}`}>
                                        {status === "completed" && "✓"}
                                        {status === "in_progress" && "▶"}
                                        {status === "interrupted" && "!"}
                                        {status === "failed" && "✕"}
                                        {status === "paused" && "Ⅱ"}
                                        {status === "unconfirmed" && "?"}
                                        {status === "pending" && (idx + 1)}
                                    </div>
                                    <div className="action-plan-step-body">
                                        <div className="action-plan-step-title">
                                            <span>{step.title}</span>
                                            <span className={`action-plan-status-badge badge-${status}`}>
                                                {status==='unconfirmed'?'not confirmed':status.replaceAll("_", " ")}
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

                {markdownText&&<button
                    className="action-plan-toggle-markdown"
                    onClick={() => setShowMarkdown(!showMarkdown)}
                >
                    {showMarkdown ? "▲ Hide notes" : "▼ Show notes"}
                </button>}

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
