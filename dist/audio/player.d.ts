/**
 * Play raw PCM audio via ALSA aplay.
 * @param pcm - Raw PCM buffer (16kHz, 16-bit, mono)
 */
export declare function playPcm(pcm: Buffer): Promise<void>;
/**
 * Play a WAV file via ALSA aplay.
 * @param filePath - Path to WAV file
 */
export declare function playWav(filePath: string): Promise<void>;
//# sourceMappingURL=player.d.ts.map