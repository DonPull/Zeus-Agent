import React, { useState, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import Modal from "./Modal";
import * as bridge from "../bridge";

export default function BrowserHistoryModal({ isOpen, onClose, taskId }) {
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isOpen || !taskId) return;
        
        setLoading(true);
        bridge.getBrowserHistory(taskId)
            .then(files => {
                const imageUrls = files.map(f => convertFileSrc(f));
                setImages(imageUrls);
                setLoading(false);
            })
            .catch(err => {
                console.error("Failed to load browser history", err);
                setLoading(false);
            });
    }, [isOpen, taskId]);

    if (!isOpen) return null;

    return (
        <Modal title="Visual Browser History" onClose={onClose} width="80vw" height="80vh">
            <div className="browser-history-container column gap-20" style={{ height: "100%", overflowY: "auto", padding: "10px" }}>
                <p>These screenshots were captured automatically during the agent's browser session.</p>
                {loading ? (
                    <div>Loading history...</div>
                ) : images.length === 0 ? (
                    <div>No browser history found for this task.</div>
                ) : (
                    <div className="browser-history-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "15px" }}>
                        {images.map((src, i) => (
                            <div key={i} className="browser-history-item" style={{ border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
                                <img src={src} alt={`Screenshot ${i}`} style={{ width: "100%", display: "block" }} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
}
