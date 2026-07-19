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