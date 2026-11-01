// History describes recent displayed actions, never old geometry on new pixels.
export function actionFeed(previous, annotation, now, rate = 2, playing = false) {
    const fresh = previous.filter(entry => entry.expires > now);
    if (!annotation || !['Agent', 'Human'].includes(annotation.actor)) return fresh;
    const id = annotation.action_id;
    if (!id || fresh.some(entry => entry.id === id)) return fresh;
    const lifetime = playing ? Math.max(400, 4000 / rate) : 4000;
    return [...fresh, {id, annotation, expires: now + lifetime}].slice(-4);
}
