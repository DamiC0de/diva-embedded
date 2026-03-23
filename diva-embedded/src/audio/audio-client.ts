/**
 * audio-client.ts — Client HTTP pour le serveur audio Diva (FastAPI)
 * 
 * Remplace la communication TCP par des appels HTTP stateless.
 * Node.js orchestre, Python exécute.
 */

const AUDIO_SERVER = process.env.AUDIO_SERVER_URL || "http://127.0.0.1:9010";

export interface WakewordResult {
    detected: boolean;
    score: number;
    timestamp: number;
    pre_audio_base64?: string;
    post_audio_base64?: string;
    /** Story 27.2: Variant detected (e.g. "Hey Diva", "Oh Diva") or undefined if plain "Diva" */
    variant_detected?: string;
    /** Story 27.2: Score adjusted for prefix boost/penalty */
    score_adjusted?: number;
    /** Story 27.3: Confidence tier — "HIGH", "MEDIUM", or "LOW" */
    tier?: string;
    /** Story 27.3: Action taken — "process" or "ignore" */
    action?: string;
    /** Story 27.3: Raw openWakeWord score */
    score_raw?: number;
    /** Story 27.3: Whether speech was detected during medium tier supplementary listen */
    medium_tier_speech_detected?: boolean;
    /** Story 27.3: Duration of the supplementary listen in seconds (medium tier) */
    medium_tier_listen_duration_s?: number;
    /** Story 27.3: Whether a feedback sound (chime/attention) was already played by the Python server */
    feedback_played?: boolean;
    /** Story 27.4: Latency in ms between wake-word detection and start of chime playback */
    latency_feedback_ms?: number;
    /** Story 27.4: Whether this detection was classified as a false positive */
    false_positive?: boolean;
    /** Story 27.4: Reason for dismissal — "no_speech_detected" or "cooldown_active" */
    dismiss_reason?: string;
    /** Story 28.2: Wakeword prosody analysis for mode pre-configuration */
    wakeword_prosody?: {
        mode: "executant" | "compagnon" | "alerte" | "neutre";
        confidence: number;
        duration_ms: number;
        rms_db: number;
        pitch_mean_hz: number;
        pitch_slope: number;
        speech_rate: number;
        analysis_time_ms?: number;
    };
}

export interface RecordResult {
    has_speech: boolean;
    wav_base64?: string;
    duration_ms?: number;
    reason?: string;
    early_stt?: string;  // CP#1: Partial STT from early anticipation
    /** Story 28.1: Vocal register analysis from Python server */
    vocalRegister?: {
        register: "whisper" | "pressed" | "calm";
        rmsDb: number;
        estimatedSpeechRate: number;
        confidence: number;
    };
}

/**
 * Bloque jusqu'à ce que le wake word soit détecté.
 * Node appelle ça en boucle dans son état "idle".
 */
export async function waitForWakeword(timeoutS: number = 0): Promise<WakewordResult> {
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
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

/**
 * Enregistre l'audio du micro avec détection VAD.
 * Retourne le WAV en base64 quand l'utilisateur a fini de parler.
 */
export async function recordAudio(opts?: {
    maxDurationS?: number;
    silenceTimeoutS?: number;
    minSpeechMs?: number;
}): Promise<RecordResult> {
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

    const data = await response.json();

    // Story 28.1: Map snake_case vocal_register to camelCase
    if (data.vocal_register) {
        data.vocalRegister = {
            register: data.vocal_register.register,
            rmsDb: data.vocal_register.rms_db,
            estimatedSpeechRate: data.vocal_register.estimated_speech_rate,
            confidence: data.vocal_register.confidence,
        };
    }

    return data;
}

/**
 * Joue un fichier WAV local via aplay.
 * Mute le micro automatiquement pendant la lecture.
 */
export async function playAudioFile(path: string): Promise<void> {
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
 * Story 28.1: Optional volumePercent for register-based attenuation.
 */
export async function playAudioBytes(wavBase64: string, volumePercent?: number): Promise<void> {
    const body: Record<string, unknown> = { wav_base64: wavBase64 };
    if (volumePercent !== undefined && volumePercent < 100) {
        body.volume_percent = volumePercent;
    }

    const response = await fetch(`${AUDIO_SERVER}/audio/play-bytes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
        throw new Error(`Play bytes error: ${response.status}`);
    }
}

/**
 * Couper le micro (pour le TTS streaming).
 */
export async function muteMic(): Promise<void> {
    await fetch(`${AUDIO_SERVER}/mic/mute`, { method: "POST" });
}

/**
 * Rouvrir le micro.
 */
export async function unmuteMic(): Promise<void> {
    await fetch(`${AUDIO_SERVER}/mic/unmute`, { method: "POST" });
}

/**
 * Combine les buffers audio pre et post wake-word en un seul WAV base64.
 * Les deux buffers sont du PCM brut 16-bit mono 16kHz encapsule dans du WAV base64.
 * Si un buffer est absent ou vide, retourne l'autre tel quel.
 */
export function combineAudioBuffers(
    preAudio: string | undefined,
    postAudio: string | undefined,
): string | undefined {
    if (!preAudio && !postAudio) return undefined;
    if (!preAudio) return postAudio;
    if (!postAudio) return preAudio;

    // Les deux sont du PCM brut encode en base64 (pas du WAV)
    const preBuf = Buffer.from(preAudio, "base64");
    const postBuf = Buffer.from(postAudio, "base64");

    // Concatener le PCM brut
    const combined = Buffer.concat([preBuf, postBuf]);
    return combined.toString("base64");
}

/**
 * Encapsule du PCM brut 16-bit mono 16kHz en WAV base64.
 */
export function pcmToWavBase64(pcmBase64: string, sampleRate = 16000, channels = 1, bitsPerSample = 16): string {
    const pcmData = Buffer.from(pcmBase64, "base64");
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = pcmData.length;
    const headerSize = 44;

    const wav = Buffer.alloc(headerSize + dataSize);

    // RIFF header
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + dataSize, 4);
    wav.write("WAVE", 8);

    // fmt sub-chunk
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16);        // sub-chunk size
    wav.writeUInt16LE(1, 20);         // PCM format
    wav.writeUInt16LE(channels, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(byteRate, 28);
    wav.writeUInt16LE(blockAlign, 32);
    wav.writeUInt16LE(bitsPerSample, 34);

    // data sub-chunk
    wav.write("data", 36);
    wav.writeUInt32LE(dataSize, 40);
    pcmData.copy(wav, headerSize);

    return wav.toString("base64");
}

/**
 * Determine la position du wake-word dans la phrase.
 * Retourne "start", "middle" ou "end" selon la presence de pre/post audio.
 */
export function detectWakewordPosition(
    preAudio: string | undefined,
    postAudio: string | undefined,
    preAudioMinBytes: number = 6400,  // 200ms a 16kHz mono 16-bit
): "start" | "middle" | "end" {
    const hasSignificantPre = !!preAudio && Buffer.from(preAudio, "base64").length > preAudioMinBytes;
    const hasPost = !!postAudio && Buffer.from(postAudio, "base64").length > 0;

    if (hasSignificantPre && hasPost) return "middle";
    if (hasSignificantPre && !hasPost) return "end";
    return "start";
}

// ---------------------------------------------------------------------------
// Story 19.4 Task 5.1 — Audio output stream for beat detection
// ---------------------------------------------------------------------------

/**
 * Get an audio output stream (Readable) for the beat detector.
 * Returns a stream of the audio being played (output), NOT the mic input.
 * This ensures the beat detector does not interfere with STT/wake-word.
 *
 * The stream provides 16-bit PCM mono at 44.1kHz when audio is playing,
 * or null if no output stream is available.
 *
 * Note: actual audio stream piping depends on the Python audio server
 * exposing an output stream endpoint. For now, returns null as a safe
 * fallback — the sync system works with polling as an alternative.
 */
export function getOutputStream(): import("node:stream").Readable | null {
    // TODO: Implement real output stream capture from Python audio server
    // when /audio/output-stream SSE endpoint is available.
    // For now, return null — the light-music sync will use energy estimation.
    return null;
}

/**
 * Vérifier que le serveur audio est prêt.
 */
export async function checkHealth(): Promise<boolean> {
    try {
        const r = await fetch(`${AUDIO_SERVER}/health`, {
            signal: AbortSignal.timeout(2000),
        });
        return r.ok;
    } catch {
        return false;
    }
}

// =====================================================================
// Story 27.5: Processing feedback (progressive audio during processing)
// =====================================================================

export interface ProcessingFeedbackResult {
    started?: boolean;
    skipped?: boolean;
    cancelled?: boolean;
    stopped?: boolean;
    noop?: boolean;
    reason?: string;
    delay_ms?: number;
    duration_ms?: number;
    fadeout?: boolean;
}

/**
 * Start the processing feedback timer.
 * Fire-and-forget: does not block the main pipeline.
 * The actual audio starts after processing_feedback_delay_ms (default 2s).
 */
export async function startProcessingFeedback(correlationId: string): Promise<ProcessingFeedbackResult> {
    try {
        const response = await fetch(`${AUDIO_SERVER}/processing/start-feedback`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ correlation_id: correlationId }),
            signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) {
            console.warn(`[PROCESSING_FEEDBACK] start-feedback error: ${response.status}`);
            return { started: false };
        }
        return await response.json();
    } catch (err) {
        console.warn("[PROCESSING_FEEDBACK] start-feedback failed (server unavailable):", err instanceof Error ? err.message : String(err));
        return { started: false };
    }
}

/**
 * Stop the processing feedback with fade-out.
 * This MUST be awaited before TTS starts — the fade-out takes max 300ms.
 */
export async function stopProcessingFeedback(): Promise<ProcessingFeedbackResult> {
    try {
        const response = await fetch(`${AUDIO_SERVER}/processing/stop-feedback`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
            console.warn(`[PROCESSING_FEEDBACK] stop-feedback error: ${response.status}`);
            return { stopped: false };
        }
        return await response.json();
    } catch (err) {
        console.warn("[PROCESSING_FEEDBACK] stop-feedback failed (server unavailable):", err instanceof Error ? err.message : String(err));
        return { stopped: false };
    }
}

/**
 * Notify the Python server whether a filler audio is playing.
 * This prevents the processing feedback from overlapping with fillers.
 */
export async function setFillerPlaying(playing: boolean): Promise<void> {
    try {
        await fetch(`${AUDIO_SERVER}/processing/set-filler-playing`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playing }),
            signal: AbortSignal.timeout(1000),
        });
    } catch {
        // Non-critical — ignore
    }
}
