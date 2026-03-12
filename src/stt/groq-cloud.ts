import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3";

/**
 * Transcribe audio using Groq Whisper API.
 * @param audioBuffer - Raw PCM audio (16kHz, 16-bit, mono)
 * @returns Transcription text
 */
export async function transcribeGroq(audioBuffer: Buffer): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY not set");
  }

  // Groq expects a file upload, so we need to create a WAV file
  const wavBuffer = pcmToWav(audioBuffer, 16000, 16, 1);
  const tmpPath = join(tmpdir(), `diva-stt-${randomUUID()}.wav`);

  try {
    await writeFile(tmpPath, wavBuffer);

    const fileData = await readFile(tmpPath);
    const blob = new Blob([fileData], { type: "audio/wav" });

    const form = new FormData();
    form.append("file", blob, "audio.wav");
    form.append("model", GROQ_MODEL);
    form.append("language", "fr");
    form.append("response_format", "json");

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: form,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error ${response.status}: ${errorText}`);
    }

    const result = (await response.json()) as { text: string };
    return result.text.trim();
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Convert raw PCM buffer to WAV format.
 */
function pcmToWav(
  pcm: Buffer,
  sampleRate: number,
  bitsPerSample: number,
  channels: number
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

/** Simple energy-based VAD. Returns true if audio chunk has speech. */
export function detectVoiceActivity(
  pcm: Buffer,
  threshold: number = 500
): boolean {
  let energy = 0;
  for (let i = 0; i < pcm.length - 1; i += 2) {
    const sample = pcm.readInt16LE(i);
    energy += sample * sample;
  }
  const rms = Math.sqrt(energy / (pcm.length / 2));
  return rms > threshold;
}

/**
 * Collect audio chunks until silence is detected.
 * @param audioStream - Readable stream of PCM audio
 * @param silenceMs - Silence duration to trigger end (default 2500ms)
 * @param maxMs - Maximum recording duration (default 30000ms)
 * @returns Collected audio buffer
 */
export function collectUntilSilence(
  audioStream: NodeJS.ReadableStream,
  silenceMs: number = 2500,
  maxMs: number = 30000
): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let lastVoice = Date.now();
    const startTime = Date.now();

    const onData = (chunk: Buffer) => {
      chunks.push(chunk);

      if (detectVoiceActivity(chunk)) {
        lastVoice = Date.now();
      }

      const now = Date.now();
      if (now - lastVoice > silenceMs || now - startTime > maxMs) {
        audioStream.removeListener("data", onData);
        resolve(Buffer.concat(chunks));
      }
    };

    audioStream.on("data", onData);
  });
}
