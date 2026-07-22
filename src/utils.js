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

// P0 "Bedrock": the ONE merge function for the messages array.
// Insert-or-replace by id, then sort by the DB-authoritative `seq` —
// arrival order of events never matters. Local optimistic entries
// (no seq) sort last until the reconcile fetch replaces them.
export const mergeMessages = (prev, incoming) => {
    const list = Array.isArray(incoming) ? incoming : [incoming];
    const byId = new Map(prev.map((m) => [m.id, m]));
    for (const m of list) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => {
        const sa = typeof a.seq === "number" && a.seq > 0 ? a.seq : Number.MAX_SAFE_INTEGER;
        const sb = typeof b.seq === "number" && b.seq > 0 ? b.seq : Number.MAX_SAFE_INTEGER;
        if (sa !== sb) return sa - sb;
        return (a.created_at || "").localeCompare(b.created_at || "");
    });
};