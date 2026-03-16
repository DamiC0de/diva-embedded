/**
 * STT — Groq Whisper with anti-hallucination filtering
 * Uses verbose_json format for segment-level metrics
 * Filters out hallucinated segments (high no_speech_prob, repetitions, etc.)
 */
export declare function transcribeLocal(wavBuffer: Buffer): Promise<string>;
//# sourceMappingURL=local-npu.d.ts.map