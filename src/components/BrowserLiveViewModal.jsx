import React, { useState, useEffect, useRef, useCallback } from "react";
import Modal from "./Modal";
import * as bridge from "../bridge";

export default function BrowserLiveViewModal({ isOpen, onClose, taskId, sessionId, onOpenReplay }) {
    const [latestFrame, setLatestFrame] = useState(null);
    const [isCompleted, setIsCompleted] = useState(false);
    const [completionData, setCompletionData] = useState(null);
    const [imgScale, setImgScale] = useState({ scaleX: 1, scaleY: 1 });
    const [imgError, setImgError] = useState(false);

    const imgRef = useRef(null);
    const stageRef = useRef(null);

    // Recalculate image scale factor for bounding box overlay
    const updateScale = useCallback(() => {
        const img = imgRef.current;
        if (img && img.naturalWidth && img.naturalHeight && img.clientWidth && img.clientHeight) {
            setImgScale({
                scaleX: img.clientWidth / img.naturalWidth,
                scaleY: img.clientHeight / img.naturalHeight,
            });
        }
    }, []);

    // ResizeObserver on image stage
    useEffect(() => {
        const el = stageRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => {
            updateScale();
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [updateScale]);

    useEffect(() => {
        if (!isOpen) {
            setLatestFrame(null);
            setIsCompleted(false);
            setCompletionData(null);
            setImgError(false);
            return;
        }

        let isSubscribed = true;
        let unlistenLive = null;
        let unlistenCompleted = null;

        // 1. Initial hydration: if session already exists, fetch last step to avoid blank screen
        if (taskId && sessionId) {
            bridge.getBrowserSession(taskId, sessionId)
                .then((data) => {
                    if (!isSubscribed || !data) return;
                    if (data.steps && data.steps.length > 0) {
                        const last = data.steps[data.steps.length - 1];
                        setLatestFrame((prev) => prev || {
                            session_id: sessionId,
                            step: last.step,
                            action: last.action,
                            target: last.target,
                            value: last.value,
                            url: last.url,
                            timestamp: last.timestamp,
                            screenshot_path: last.screenshot_path,
                            screenshot_base64: last.screenshot_path?.startsWith("data:") ? last.screenshot_path : null,
                            bounding_box: last.bounding_box,
                        });
                    }
                    if (data.completed_at) {
                        setIsCompleted(true);
                        setCompletionData({
                            totalSteps: data.total_steps || data.steps?.length || 0,
                            durationSec: data.duration_ms ? (data.duration_ms / 1000).toFixed(1) : null,
                            finalUrl: data.final_url || "",
                        });
                    }
                })
                .catch(() => {
                    // Normal when session has just started
                });
        }

        // 2. Subscribe to real-time live frames
        bridge.onBrowserLiveFrame((payload) => {
            if (!isSubscribed) return;
            if (!sessionId || payload.session_id === sessionId) {
                setLatestFrame(payload);
                setImgError(false);
            }
        }).then((unlisten) => {
            if (!isSubscribed) {
                unlisten();
                return;
            }
            unlistenLive = unlisten;
        }).catch((err) => {
            console.error("Failed to subscribe to browser live frames:", err);
        });

        // 3. Subscribe to session completion event
        bridge.onBrowserSessionCompleted((payload) => {
            if (!isSubscribed) return;
            if (!sessionId || payload.session_id === sessionId) {
                setIsCompleted(true);
                setCompletionData({
                    totalSteps: payload.total_steps,
                    durationSec: payload.duration_ms ? (payload.duration_ms / 1000).toFixed(1) : null,
                    finalUrl: payload.final_url,
                });
            }
        }).then((unlisten) => {
            if (!isSubscribed) {
                unlisten();
                return;
            }
            unlistenCompleted = unlisten;
        }).catch((err) => {
            console.error("Failed to subscribe to browser completion events:", err);
        });

        return () => {
            isSubscribed = false;
            if (unlistenLive) unlistenLive();
            if (unlistenCompleted) unlistenCompleted();
        };
    }, [isOpen, taskId, sessionId]);

    if (!isOpen) return null;

    const getFrameSrc = (frame) => {
        if (!frame) return "";
        if (frame.screenshot_base64) return frame.screenshot_base64;
        if (frame.screenshot_path) {
            if (typeof frame.screenshot_path === "string" && frame.screenshot_path.startsWith("data:")) {
                return frame.screenshot_path;
            }
            return bridge.convertFileSrc(frame.screenshot_path);
        }
        return "";
    };

    const imgSrc = getFrameSrc(latestFrame);
    const hasBox = !!(latestFrame?.bounding_box && latestFrame.bounding_box.width > 0);
    const box = latestFrame?.bounding_box;

    const handleSwitchToReplay = () => {
        if (onClose) onClose();
        if (onOpenReplay) onOpenReplay(sessionId, taskId);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            className="live-modal-window"
        >
            <div className="live-modal-container column">
                {/* Modal Header */}
                <div className="modal-header align-center justify-space-between" style={{ marginBottom: "8px" }}>
                    <span className="modal-title" style={{ fontSize: "16px", fontWeight: "bold", color: "var(--zeus-text)" }}>
                        👁️ Live Browser View (Passive Observer) — {sessionId || "Active"}
                    </span>
                    <button id="live-modal-close-button" className="modal-close-button" onClick={onClose} title="Close Live View">✕</button>
                </div>

                {/* Observer / Completion Notice Banner */}
                {isCompleted ? (
                    <div className="live-notice-banner completed align-center justify-space-between no-user-select">
                        <div className="align-center gap-8">
                            <span className="browser-badge-completed">✓</span>
                            <span className="live-badge-text completed">SESSION COMPLETED</span>
                            <span className="live-description-text">
                                Autonomous execution completed ({completionData?.totalSteps || latestFrame?.step || 0} actions{completionData?.durationSec ? ` in ${completionData.durationSec}s` : ""}).
                            </span>
                        </div>
                        <button
                            id="live-switch-to-replay-btn"
                            className="live-switch-replay-btn align-center gap-6"
                            onClick={handleSwitchToReplay}
                            title="Open full interactive session replay"
                        >
                            <span>🎬</span>
                            <span>View Full Replay</span>
                        </button>
                    </div>
                ) : (
                    <div className="live-notice-banner align-center justify-space-between no-user-select">
                        <div className="align-center gap-8">
                            <span className="live-pulse-dot" />
                            <span className="live-badge-text">LIVE OBSERVER</span>
                            <span className="live-description-text">
                                Read-only mirror. The browser is being driven autonomously by the agent.
                            </span>
                        </div>
                        {latestFrame?.timestamp && (
                            <span className="live-timestamp mono">
                                Last frame: {new Date(latestFrame.timestamp).toLocaleTimeString()}
                            </span>
                        )}
                    </div>
                )}

                {/* Status & Address Bar */}
                <div className="live-status-bar align-center justify-space-between">
                    <div className="align-center gap-10">
                        <span className="live-step-badge mono">
                            {latestFrame?.step ? `Step ${latestFrame.step}` : "Ready"}
                        </span>
                        {latestFrame?.action && (
                            <span className={`action-badge ${latestFrame.action}`}>
                                {latestFrame.action.toUpperCase()}
                            </span>
                        )}
                        {latestFrame?.target && (
                            <span className="live-target-text mono truncate-url" title={latestFrame.target}>
                                {latestFrame.target}
                            </span>
                        )}
                        {latestFrame?.value && (
                            <span className="live-value-text mono" title={latestFrame.value}>
                                "{latestFrame.value}"
                            </span>
                        )}
                    </div>

                    <div className="live-address-box align-center gap-6">
                        <span className="replay-lock-icon">🔒</span>
                        <span className="live-url-text mono truncate-url" title={latestFrame?.url || (latestFrame?.action === "goto" ? latestFrame?.target : "") || ""}>
                            {latestFrame?.url || (latestFrame?.action === "goto" ? latestFrame?.target : "") || "Waiting for initial URL..."}
                        </span>
                    </div>
                </div>

                {/* Viewport Content */}
                <div ref={stageRef} className="live-viewport-wrapper">
                    {imgSrc && !imgError ? (
                        <div className="live-image-stage">
                            <div className="live-image-box">
                                <img
                                    ref={imgRef}
                                    id="live-viewport-img"
                                    src={imgSrc}
                                    alt={`Live Frame ${latestFrame?.step || ""}`}
                                    className="live-screenshot-img"
                                    onLoad={updateScale}
                                    onError={() => setImgError(true)}
                                />
                                {hasBox && box && (
                                    <div
                                        id="live-bounding-box-overlay"
                                        className="replay-bounding-box"
                                        style={{
                                            left: `${box.x * imgScale.scaleX}px`,
                                            top: `${box.y * imgScale.scaleY}px`,
                                            width: `${box.width * imgScale.scaleX}px`,
                                            height: `${box.height * imgScale.scaleY}px`,
                                        }}
                                    >
                                        <div className="replay-box-tag">
                                            <span className="box-tag-action">{(latestFrame.action || "ACTION").toUpperCase()}</span>
                                            {latestFrame.target && (
                                                <span className="box-tag-target mono truncate-url">{latestFrame.target}</span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="live-waiting-stage align-center justify-center column gap-15">
                            <span className="live-big-pulse-dot" />
                            <div className="column align-center gap-6">
                                <span className="live-waiting-title">Observing Browser Activity...</span>
                                <span className="live-waiting-sub">
                                    Screenshots will appear here in real-time as the agent navigates.
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
}
