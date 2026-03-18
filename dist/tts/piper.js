import { writeFile } from "node:fs/promises";
import { getPersonaTTSConfig } from "../persona/engine.js";
const TTS_BASE_URL = process.env.TTS_BASE_URL ?? "http://localhost:8880";
/**
 * Synthesize text to WAV via Piper TTS HTTP server.
 * Adapts speed based on current persona's TTS config.
 */
export async function synthesize(text, lengthScaleOverride) {
    const ttsConfig = getPersonaTTSConfig();
    const lengthScale = lengthScaleOverride ?? ttsConfig.lengthScale;
    const response = await fetch(`${TTS_BASE_URL}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            input: text,
            voice: "fr_FR-siwis-medium",
            response_format: "wav",
            speed: 1 / lengthScale, // Piper: speed > 1 = faster, we use inverse of lengthScale
        }),
    });
    if (!response.ok) {
        throw new Error(`Piper TTS error: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
export async function synthesizeToFile(text, outputPath) {
    const wav = await synthesize(text);
    await writeFile(outputPath, wav);
}
//# sourceMappingURL=piper.js.map