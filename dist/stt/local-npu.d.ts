/**
 * Local STT via NPU SenseVoice server on Rock 5B+
 * OpenAI-compatible API on port 8881
 * Falls back to Groq Whisper if local fails
 */
export declare function transcribeLocal(wavBuffer: Buffer): Promise<string>;
//# sourceMappingURL=local-npu.d.ts.map