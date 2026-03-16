import { spawn } from "node:child_process";
const AUDIO_INPUT_DEVICE = process.env.AUDIO_INPUT_DEVICE ?? "plughw:1";
/**
 * Record raw PCM audio from ALSA.
 * Returns a readable stream of 16kHz 16-bit mono PCM.
 */
export function recordStream() {
    const proc = spawn("arecord", [
        "-D", AUDIO_INPUT_DEVICE,
        "-f", "S16_LE",
        "-r", "16000",
        "-c", "1",
        "-t", "raw",
    ]);
    proc.on("error", (err) => {
        console.error("[Recorder] Error:", err.message);
    });
    return { stream: proc.stdout, process: proc };
}
/**
 * Record a fixed duration of audio and return as buffer.
 * @param durationMs - Duration in milliseconds
 * @returns Raw PCM buffer
 */
export async function recordBuffer(durationMs) {
    const durationSec = Math.ceil(durationMs / 1000);
    return new Promise((resolve, reject) => {
        const proc = spawn("arecord", [
            "-D", AUDIO_INPUT_DEVICE,
            "-f", "S16_LE",
            "-r", "16000",
            "-c", "1",
            "-t", "raw",
            "-d", String(durationSec),
        ]);
        const chunks = [];
        proc.stdout.on("data", (chunk) => chunks.push(chunk));
        proc.on("error", reject);
        proc.on("close", (code) => {
            if (code === 0)
                resolve(Buffer.concat(chunks));
            else
                reject(new Error(`arecord exited with code ${code}`));
        });
    });
}
//# sourceMappingURL=recorder.js.map