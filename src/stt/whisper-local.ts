import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const WHISPER_CPP_PATH = process.env.WHISPER_CPP_PATH ?? "/usr/local/bin/whisper-cpp";
const WHISPER_MODEL_PATH = process.env.WHISPER_MODEL_PATH ?? "/opt/models/ggml-base.bin";

/**
 * Transcribe audio locally using whisper.cpp.
 * Fallback when Groq API is unavailable.
 * @param audioBuffer - Raw PCM audio (16kHz, 16-bit, mono)
 * @returns Transcription text
 */
export async function transcribeLocal(audioBuffer: Buffer): Promise<string> {
  const wavBuffer = pcmToWav(audioBuffer, 16000, 16, 1);
  const tmpPath = join(tmpdir(), `diva-whisper-${randomUUID()}.wav`);

  try {
    await writeFile(tmpPath, wavBuffer);

    const output = await runWhisperCpp(tmpPath);
    return parseWhisperOutput(output);
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Run whisper.cpp on a WAV file and return stdout.
 */
function runWhisperCpp(wavPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(WHISPER_CPP_PATH, [
      "-m", WHISPER_MODEL_PATH,
      "-f", wavPath,
      "-l", "fr",
      "--no-timestamps",
      "-t", "4", // threads
    ]);

    const chunks: string[] = [];
    proc.stdout.on("data", (data: Buffer) => {
      chunks.push(data.toString());
    });

    let stderr = "";
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`whisper.cpp failed to start: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(chunks.join(""));
      } else {
        reject(new Error(`whisper.cpp exited with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Parse whisper.cpp output to extract transcription text.
 * Removes timestamps and whitespace.
 */
function parseWhisperOutput(output: string): string {
  return output
    .split("\n")
    .map((line) => line.replace(/^\[.*?\]\s*/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .trim();
}

/**
 * Convert raw PCM to WAV format.
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
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}
