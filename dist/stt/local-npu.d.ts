/**
 * STT — Groq Whisper (primary, French) with SenseVoice NPU fallback
 * Circuit breaker: if Groq fails 3 times → auto-switch to NPU for 60s
 *
 * Minimal filtering: only reject non-French text (from NPU fallback)
 */
export declare function transcribeLocal(wavBuffer: Buffer): Promise<string>;
//# sourceMappingURL=local-npu.d.ts.map