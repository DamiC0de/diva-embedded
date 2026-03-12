import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const TTS_BASE_URL = process.env.TTS_BASE_URL ?? "http://localhost:8880";
const EC_INPUT_FIFO = process.env.EC_INPUT_FIFO ?? "/tmp/ec.input";

/**
 * Strip WAV header and return raw PCM data.
 * Parses chunks to find the "data" chunk reliably.
 */
function wavToRawPcm(wav: Buffer): Buffer {
  if (wav.length < 44) {
    throw new Error("Invalid WAV: too short");
  }

  const riff = wav.toString("ascii", 0, 4);
  if (riff !== "RIFF") {
    throw new Error("Invalid WAV: missing RIFF header");
  }

  // Find the "data" chunk — it's not always at byte 36
  let offset = 12; // skip RIFF header (12 bytes)
  while (offset < wav.length - 8) {
    const chunkId = wav.toString("ascii", offset, offset + 4);
    const chunkSize = wav.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      return wav.subarray(offset + 8, offset + 8 + chunkSize);
    }
    offset += 8 + chunkSize;
  }

  throw new Error("Invalid WAV: no data chunk found");
}

/**
 * Synthesize text to raw PCM audio via Piper TTS HTTP server.
 * Returns a Buffer of raw PCM (16kHz, 16-bit, mono).
 * @param text - The text to synthesize
 * @returns Raw PCM audio buffer
 */
export async function synthesize(text: string): Promise<Buffer> {
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
    throw new Error(
      `Piper TTS error: ${response.status} ${response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return wavToRawPcm(Buffer.from(arrayBuffer));
}

/**
 * Write raw PCM buffer to the AEC input FIFO.
 * Writes via a stream pipeline to handle backpressure on the FIFO.
 */
async function writePcmToFifo(pcm: Buffer): Promise<void> {
  const fd = await open(EC_INPUT_FIFO, "w");
  try {
    const stream = fd.createWriteStream();
    const readable = Readable.from(pcm);
    await pipeline(readable, stream);
  } finally {
    await fd.close();
  }
}

/**
 * Synthesize text and stream raw PCM to the AEC input FIFO.
 * This feeds audio to the echo canceller's speaker reference channel.
 * @param text - The text to speak
 */
export async function playViaAec(text: string): Promise<void> {
  const pcm = await synthesize(text);
  await writePcmToFifo(pcm);
}

/**
 * Synthesize text and return a readable stream of raw PCM.
 * @param text - The text to synthesize
 * @returns Readable stream of raw PCM audio
 */
export async function synthesizeStream(text: string): Promise<Readable> {
  const arrayBuffer = await synthesize(text);
  return Readable.from(arrayBuffer);
}
