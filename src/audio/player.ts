import { spawn, ChildProcess } from "node:child_process";

const AUDIO_OUTPUT_DEVICE = process.env.AUDIO_OUTPUT_DEVICE ?? "plughw:1";

/**
 * Play raw PCM audio via ALSA aplay.
 * @param pcm - Raw PCM buffer (16kHz, 16-bit, mono)
 */
export async function playPcm(pcm: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("aplay", [
      "-D", AUDIO_OUTPUT_DEVICE,
      "-f", "S16_LE",
      "-r", "16000",
      "-c", "1",
      "-t", "raw",
    ]);

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`aplay exited with code ${code}`));
    });

    proc.stdin.write(pcm);
    proc.stdin.end();
  });
}

/**
 * Play a WAV file via ALSA aplay.
 * @param filePath - Path to WAV file
 */
export async function playWav(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("aplay", ["-D", AUDIO_OUTPUT_DEVICE, filePath]);
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`aplay exited with code ${code}`));
    });
  });
}
