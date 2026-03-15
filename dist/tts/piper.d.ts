/**
 * Synthesize text to WAV via Piper TTS HTTP server.
 * Returns the raw WAV buffer.
 */
export declare function synthesize(text: string): Promise<Buffer>;
/**
 * Synthesize text and save as WAV file.
 * @param text - Text to speak
 * @param outputPath - Path to save WAV file
 */
export declare function synthesizeToFile(text: string, outputPath: string): Promise<void>;
//# sourceMappingURL=piper.d.ts.map