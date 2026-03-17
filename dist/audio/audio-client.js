/**
 * audio-client.ts — Client HTTP pour le serveur audio Diva (FastAPI)
 *
 * Remplace la communication TCP par des appels HTTP stateless.
 * Node.js orchestre, Python exécute.
 */
const AUDIO_SERVER = process.env.AUDIO_SERVER_URL || "http://localhost:9010";
/**
 * Bloque jusqu'à ce que le wake word soit détecté.
 * Node appelle ça en boucle dans son état "idle".
 */
export async function waitForWakeword(timeoutS = 0) {
    const controller = new AbortController();
    const timeoutId = timeoutS > 0
        ? setTimeout(() => controller.abort(), (timeoutS + 10) * 1000)
        : null;
    try {
        const response = await fetch(`${AUDIO_SERVER}/wakeword/wait`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ timeout_s: timeoutS }),
            signal: controller.signal,
        });
        if (!response.ok) {
            if (response.status === 408) {
                return { detected: false, score: 0, timestamp: Date.now() };
            }
            throw new Error(`Wakeword error: ${response.status}`);
        }
        return await response.json();
    }
    finally {
        if (timeoutId)
            clearTimeout(timeoutId);
    }
}
/**
 * Enregistre l'audio du micro avec détection VAD.
 * Retourne le WAV en base64 quand l'utilisateur a fini de parler.
 */
export async function recordAudio(opts) {
    const response = await fetch(`${AUDIO_SERVER}/audio/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            max_duration_s: opts?.maxDurationS ?? 10,
            silence_timeout_s: opts?.silenceTimeoutS ?? 1.2,
            min_speech_ms: opts?.minSpeechMs ?? 300,
        }),
        signal: AbortSignal.timeout(20000),
    });
    if (response.status === 204) {
        return { has_speech: false, reason: "no_speech_detected" };
    }
    if (!response.ok) {
        throw new Error(`Record error: ${response.status}`);
    }
    return await response.json();
}
/**
 * Joue un fichier WAV local via aplay.
 * Mute le micro automatiquement pendant la lecture.
 */
export async function playAudioFile(path) {
    const response = await fetch(`${AUDIO_SERVER}/audio/play`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
        signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
        throw new Error(`Play error: ${response.status} - ${path}`);
    }
}
/**
 * Joue des bytes WAV (base64) via aplay.
 * Utilisé pour le TTS généré dynamiquement.
 */
export async function playAudioBytes(wavBase64) {
    const response = await fetch(`${AUDIO_SERVER}/audio/play-bytes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wav_base64: wavBase64 }),
        signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
        throw new Error(`Play bytes error: ${response.status}`);
    }
}
/**
 * Couper le micro (pour le TTS streaming).
 */
export async function muteMic() {
    await fetch(`${AUDIO_SERVER}/mic/mute`, { method: "POST" });
}
/**
 * Rouvrir le micro.
 */
export async function unmuteMic() {
    await fetch(`${AUDIO_SERVER}/mic/unmute`, { method: "POST" });
}
/**
 * Vérifier que le serveur audio est prêt.
 */
export async function checkHealth() {
    try {
        const r = await fetch(`${AUDIO_SERVER}/health`, {
            signal: AbortSignal.timeout(2000),
        });
        return r.ok;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=audio-client.js.map