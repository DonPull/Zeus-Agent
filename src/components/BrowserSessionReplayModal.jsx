import React, { useState, useEffect, useRef, useCallback } from "react";
import Modal from "./Modal";
import * as bridge from "../bridge";

export default function BrowserSessionReplayModal({ isOpen, onClose, taskId, sessionId }) {
    const [sessionData, setSessionData] = useState(null);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [highlightEnabled, setHighlightEnabled] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [imgScale, setImgScale] = useState({ scaleX: 1, scaleY: 1 });

    const imgRef = useRef(null);
    const containerRef = useRef(null);
    const timelineRef = useRef(null);
    const activePillRef = useRef(null);

    // Auto-scroll timeline to keep active step pill visible
    useEffect(() => {
        if (activePillRef.current) {
            activePillRef.current.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
                inline: "center",
            });
        }
    }, [currentStepIndex]);

    // Load session data when modal opens
    useEffect(() => {
        if (!isOpen || !taskId || !sessionId) {
            setSessionData(null);
            setCurrentStepIndex(0);
            setError(null);
            return;
        }

        setLoading(true);
        setError(null);
        setCurrentStepIndex(0);

        bridge.getBrowserSession(taskId, sessionId)
            .then(data => {
                setSessionData(data);
                setLoading(false);
            })
            .catch(err => {
                console.error("Failed to load browser session:", err);
                setError(typeof err === "string" ? err : "Failed to load session details");
                setLoading(false);
            });
    }, [isOpen, taskId, sessionId]);

    // Recalculate image scale factor
    const updateScale = useCallback(() => {
        const img = imgRef.current;
        if (img && img.naturalWidth && img.naturalHeight && img.clientWidth && img.clientHeight) {
            setImgScale({
                scaleX: img.clientWidth / img.naturalWidth,
                scaleY: img.clientHeight / img.naturalHeight,
            });
        }
    }, []);

    // ResizeObserver on image container to keep bounding boxes responsive
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => {
            updateScale();
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [updateScale]);

    // Keyboard navigation (Left / Right arrow keys)
    useEffect(() => {
        if (!isOpen || !sessionData?.steps?.length) return;

        const handleKeyDown = (e) => {
            if (e.key === "ArrowLeft") {
                setCurrentStepIndex(i => Math.max(0, i - 1));
            } else if (e.key === "ArrowRight") {
                setCurrentStepIndex(i => Math.min(sessionData.steps.length - 1, i + 1));
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, sessionData]);

    if (!isOpen) return null;

    const steps = sessionData?.steps || [];
    const currentStep = steps[currentStepIndex] || null;
    const hasBox = !!(currentStep?.bounding_box && currentStep.bounding_box.width > 0);
    const box = currentStep?.bounding_box;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            className="replay-modal-window"
        >
            <div className="replay-modal-container column">
                {/* Modal Header */}
                <div className="modal-header align-center justify-space-between" style={{ marginBottom: "8px" }}>
                    <span className="modal-title" style={{ fontSize: "16px", fontWeight: "bold", color: "var(--zeus-text)" }}>
                        🎬 Browser Session Replay — {sessionId || "Session"}
                    </span>
                    <button id="replay-modal-close-button" className="modal-close-button" onClick={onClose} title="Close Replay">✕</button>
                </div>

                {/* Replay Controls & Address Bar */}
                <div className="replay-top-bar align-center justify-space-between">
                    <div className="align-center gap-10">
                        <button
                            id="replay-prev-button"
                            className="replay-nav-btn"
                            disabled={currentStepIndex <= 0}
                            onClick={() => setCurrentStepIndex(i => Math.max(0, i - 1))}
                            title="Previous Step (Left Arrow)"
                        >
                            ◀ Prev
                        </button>
                        <span className="replay-step-counter mono">
                            {steps.length > 0 ? `Step ${currentStepIndex + 1} of ${steps.length}` : "No steps"}
                        </span>
                        <button
                            id="replay-next-button"
                            className="replay-nav-btn"
                            disabled={currentStepIndex >= steps.length - 1}
                            onClick={() => setCurrentStepIndex(i => Math.min(steps.length - 1, i + 1))}
                            title="Next Step (Right Arrow)"
                        >
                            Next ▶
                        </button>
                    </div>

                    {/* Realistic URL / Action Bar */}
                    <div className="replay-address-bar align-center gap-8">
                        <span className="replay-lock-icon">🔒</span>
                        <span className="replay-url-text mono truncate-url" title={currentStep?.url || (currentStep?.action === "goto" ? currentStep?.target : "") || ""}>
                            {currentStep?.url || (currentStep?.action === "goto" ? currentStep?.target : "") || "about:blank"}
                        </span>
                        {currentStep && (
                            <div className="replay-action-pill align-center gap-6">
                                <span className={`action-badge ${currentStep.action}`}>
                                    {currentStep.action.toUpperCase()}
                                </span>
                                {currentStep.target && (
                                    <span className="action-target mono truncate-url" title={currentStep.target}>
                                        {currentStep.target}
                                    </span>
                                )}
                                {currentStep.value && (
                                    <span className="action-value mono" title={currentStep.value}>
                                        "{currentStep.value}"
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Highlight Toggle */}
                    <div className="align-center gap-10">
                        <button
                            id="replay-highlight-toggle"
                            className={`replay-toggle-btn align-center gap-6 ${highlightEnabled ? "active" : ""}`}
                            onClick={() => setHighlightEnabled(h => !h)}
                            title="Toggle action bounding box highlight"
                        >
                            <span>{highlightEnabled ? "🎯 Highlight: ON" : "⚪ Highlight: OFF"}</span>
                        </button>
                    </div>
                </div>

                {/* Viewport Content */}
                <div ref={containerRef} className="replay-viewport-wrapper">
                    {loading ? (
                        <div className="replay-loading-state align-center justify-center column gap-10">
                            <span className="spinner" />
                            <span>Loading session replay...</span>
                        </div>
                    ) : error ? (
                        <div className="replay-error-state align-center justify-center column gap-10">
                            <span className="error-icon">⚠️</span>
                            <span>{error}</span>
                        </div>
                    ) : steps.length === 0 ? (
                        <div className="replay-empty-state align-center justify-center column gap-10">
                            <span>No browser actions recorded in this session.</span>
                        </div>
                    ) : (
                        <div className="replay-image-stage">
                            {currentStep?.screenshot_path ? (
                                <div className="replay-image-box">
                                    <img
                                        ref={imgRef}
                                        id="replay-screenshot-img"
                                        src={currentStep.screenshot_path.startsWith("data:") ? currentStep.screenshot_path : bridge.convertFileSrc(currentStep.screenshot_path)}
                                        alt={`Step ${currentStep.step} - ${currentStep.action}`}
                                        className="replay-screenshot-img"
                                        onLoad={updateScale}
                                    />
                                    {/* Action highlight box overlay */}
                                    {highlightEnabled && hasBox && box && (
                                        <div
                                            id="replay-bounding-box-overlay"
                                            className="replay-bounding-box"
                                            style={{
                                                left: `${box.x * imgScale.scaleX}px`,
                                                top: `${box.y * imgScale.scaleY}px`,
                                                width: `${box.width * imgScale.scaleX}px`,
                                                height: `${box.height * imgScale.scaleY}px`,
                                            }}
                                        >
                                            <div className="replay-box-tag">
                                                <span className="box-tag-action">{currentStep.action.toUpperCase()}</span>
                                                {currentStep.target && (
                                                    <span className="box-tag-target mono">{currentStep.target}</span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="replay-no-image">
                                    <span>No screenshot captured for this step.</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Bottom Timeline Step Carousel */}
                {steps.length > 0 && (
                    <div ref={timelineRef} className="replay-timeline-bar align-center gap-8">
                        {steps.map((st, idx) => {
                            const isActive = idx === currentStepIndex;
                            return (
                                <button
                                    key={st.step || idx}
                                    ref={isActive ? activePillRef : null}
                                    id={`replay-step-pill-${idx}`}
                                    className={`replay-step-pill align-center gap-6 ${isActive ? "active" : ""}`}
                                    onClick={() => setCurrentStepIndex(idx)}
                                    title={`${idx + 1}. ${st.action} ${st.target || ""}`}
                                >
                                    <span className="step-number">{idx + 1}</span>
                                    <span className="step-action-name">{st.action}</span>
                                    {st.bounding_box && <span className="step-has-target">🎯</span>}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </Modal>
    );
}
