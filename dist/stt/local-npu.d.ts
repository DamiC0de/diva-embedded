/**
 * STT — Local SenseVoice NPU on port 8881 with Groq Cloud fallback
 * Circuit breaker: if NPU fails 3 times → auto-switch to Groq for 30s
 */
export declare function transcribeLocal(wavBuffer: Buffer): Promise<string>;
//# sourceMappingURL=local-npu.d.ts.map