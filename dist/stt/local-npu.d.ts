/**
 * STT with quality validation
 * Uses NPU SenseVoice first, validates the result,
 * falls back to Groq Whisper if transcript looks like garbage
 */
export declare function transcribeLocal(wavBuffer: Buffer): Promise<string>;
//# sourceMappingURL=local-npu.d.ts.map