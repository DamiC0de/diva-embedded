/**
 * audio-client.ts — Client HTTP pour le serveur audio Diva (FastAPI)
 *
 * Remplace la communication TCP par des appels HTTP stateless.
 * Node.js orchestre, Python exécute.
 */
export interface WakewordResult {
    detected: boolean;
    score: number;
    timestamp: number;
}
export interface RecordResult {
    has_speech: boolean;
    wav_base64?: string;
    duration_ms?: number;
    reason?: string;
}
/**
 * Bloque jusqu'à ce que le wake word soit détecté.
 * Node appelle ça en boucle dans son état "idle".
 */
export declare function waitForWakeword(timeoutS?: number): Promise<WakewordResult>;
/**
 * Enregistre l'audio du micro avec détection VAD.
 * Retourne le WAV en base64 quand l'utilisateur a fini de parler.
 */
export declare function recordAudio(opts?: {
    maxDurationS?: number;
    silenceTimeoutS?: number;
    minSpeechMs?: number;
}): Promise<RecordResult>;
/**
 * Joue un fichier WAV local via aplay.
 * Mute le micro automatiquement pendant la lecture.
 */
export declare function playAudioFile(path: string): Promise<void>;
/**
 * Joue des bytes WAV (base64) via aplay.
 * Utilisé pour le TTS généré dynamiquement.
 */
export declare function playAudioBytes(wavBase64: string): Promise<void>;
/**
 * Couper le micro (pour le TTS streaming).
 */
export declare function muteMic(): Promise<void>;
/**
 * Rouvrir le micro.
 */
export declare function unmuteMic(): Promise<void>;
/**
 * Vérifier que le serveur audio est prêt.
 */
export declare function checkHealth(): Promise<boolean>;
//# sourceMappingURL=audio-client.d.ts.map