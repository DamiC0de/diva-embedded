/**
 * Synthesize text to WAV via Piper TTS HTTP server.
 * Adapts speed based on current persona's TTS config.
 */
export declare function synthesize(text: string, lengthScaleOverride?: number): Promise<Buffer>;
export declare function synthesizeToFile(text: string, outputPath: string): Promise<void>;
//# sourceMappingURL=piper.d.ts.map