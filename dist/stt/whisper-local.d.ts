/**
 * Transcribe audio locally using whisper.cpp.
 * Fallback when Groq API is unavailable.
 * @param audioBuffer - Raw PCM audio (16kHz, 16-bit, mono)
 * @returns Transcription text
 */
export declare function transcribeLocal(audioBuffer: Buffer): Promise<string>;
//# sourceMappingURL=whisper-local.d.ts.map