import { writeFile } from "node:fs/promises";
const TTS_BASE_URL = process.env.TTS_BASE_URL ?? "http://localhost:8880";
/**
 * Synthesize text to WAV via Piper TTS HTTP server.
 * Returns the raw WAV buffer.
 */
export async function synthesize(text) {
    const response = await fetch(`${TTS_BASE_URL}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            input: text,
            voice: "fr_FR-siwis-medium",
            response_format: "wav",
        }),
    });
    if (!response.ok) {
        throw new Error(`Piper TTS error: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
/**
 * Synthesize text and save as WAV file.
 * @param text - Text to speak
 * @param outputPath - Path to save WAV file
 */
export async function synthesizeToFile(text, outputPath) {
    const wav = await synthesize(text);
    await writeFile(outputPath, wav);
}
//# sourceMappingURL=piper.js.map