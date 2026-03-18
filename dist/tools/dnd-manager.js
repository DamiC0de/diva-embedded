/**
 * Do Not Disturb (DND) / Night Mode Manager
 * Disables wake word detection for a configurable duration
 */
let dndActive = false;
let dndTimeout = null;
let dndUntil = 0;
export function enableDND(durationMs = 8 * 60 * 60 * 1000) {
    dndActive = true;
    dndUntil = Date.now() + durationMs;
    if (dndTimeout)
        clearTimeout(dndTimeout);
    dndTimeout = setTimeout(() => {
        dndActive = false;
        dndTimeout = null;
        dndUntil = 0;
        console.log("[DND] Mode normal réactivé automatiquement");
    }, durationMs);
    dndTimeout.unref();
    console.log(`[DND] Activé pour ${Math.round(durationMs / 60000)} minutes`);
}
export function disableDND() {
    dndActive = false;
    if (dndTimeout) {
        clearTimeout(dndTimeout);
        dndTimeout = null;
    }
    dndUntil = 0;
    console.log("[DND] Désactivé manuellement");
}
export function isDNDActive() {
    return dndActive;
}
export function getDNDStatus() {
    return {
        active: dndActive,
        untilTs: dndUntil,
        remainingMin: dndActive ? Math.max(0, Math.round((dndUntil - Date.now()) / 60000)) : 0,
    };
}
//# sourceMappingURL=dnd-manager.js.map