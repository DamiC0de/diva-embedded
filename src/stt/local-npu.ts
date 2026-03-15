/**
 * Local STT via NPU SenseVoice server on Rock 5B+
 * OpenAI-compatible API on port 8881
 * Falls back to Groq Whisper if local fails
 */

const LOCAL_STT_URL = process.env.LOCAL_STT_URL ?? "http://localhost:8881";
const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export async function transcribeLocal(wavBuffer: Buffer): Promise<string> {
  try {
    return await transcribeNPU(wavBuffer);
  } catch (err) {
    console.warn(`[STT] NPU failed, falling back to Groq: ${err}`);
    return await transcribeGroqFallback(wavBuffer);
  }
}

async function transcribeNPU(wavBuffer: Buffer): Promise<string> {
  const arrayBuffer = wavBuffer.buffer.slice(
    wavBuffer.byteOffset,
    wavBuffer.byteOffset + wavBuffer.byteLength
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: "audio/wav" });
  const form = new FormData();
  form.append("file", blob, "audio.wav");
  form.append("language", "fr");

  const response = await fetch(`${LOCAL_STT_URL}/v1/audio/transcriptions`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    throw new Error(`NPU STT error ${response.status}: ${await response.text()}`);
  }

  const result = (await response.json()) as { text: string };
  return result.text.trim();
}

async function transcribeGroqFallback(wavBuffer: Buffer): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY not set and NPU STT failed");
  }

  const arrayBuffer = wavBuffer.buffer.slice(
    wavBuffer.byteOffset,
    wavBuffer.byteOffset + wavBuffer.byteLength
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: "audio/wav" });
  const form = new FormData();
  form.append("file", blob, "audio.wav");
  form.append("model", "whisper-large-v3");
  form.append("language", "fr");
  form.append("response_format", "json");

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Groq API error ${response.status}: ${await response.text()}`);
  }

  const result = (await response.json()) as { text: string };
  return result.text.trim();
}
