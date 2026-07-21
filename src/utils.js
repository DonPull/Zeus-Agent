export const getElementProperty = (element, property, returnAsNumber = false) => {
    var containerStyles = window.getComputedStyle(element);
    var styleValue = containerStyles.getPropertyValue(property);
    return returnAsNumber ? Math.round(parseInt(styleValue.replace("px", ""))) : styleValue;
}

export const formatCredits = (credits) => {
    if (credits === null || credits === undefined) return "—";
    if (credits >= 100) return Math.round(credits).toString();
    return credits.toFixed(1);
}

export const formatTime = (isoString) => {
    const date = new Date(isoString);
    if (isNaN(date)) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Single source of truth for which messages are internal pipeline messages
// (hidden from BOTH the chat UI and the chat log). Content sniffing is only a
// fallback for rows persisted before the kind-based classification existed.
export const isHiddenPipelineMessage = (m) => {
    if (!m) return true;
    if (m.kind === "directive" || m.kind === "directive_result") return true;
    if (m.role === "assistant" && typeof m.content === "string" && m.content.includes("```zeus-directive")) return true;
    if (m.role === "user" && typeof m.content === "string" && m.content.startsWith("[DIRECTIVE_")) return true;
    return false;
};