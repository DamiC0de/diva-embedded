/**
 * STT — Groq Whisper (primary, French) with SenseVoice NPU fallback (zh/en/ja/ko)
 * Circuit breaker: if Groq fails 3 times → auto-switch to NPU for 60s
 */
export declare function transcribeLocal(wavBuffer: Buffer): Promise<string>;
//# sourceMappingURL=local-npu.d.ts.map