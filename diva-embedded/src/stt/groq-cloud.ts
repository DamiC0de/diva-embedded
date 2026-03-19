const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3";

/**
 * Transcribe audio using Groq Whisper API.
 * Accepts a WAV buffer (already has WAV headers from Python).
 */
export async function transcribeGroq(wavBuffer: Buffer): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY not set");
  }

  const arrayBuffer = wavBuffer.buffer.slice(wavBuffer.byteOffset, wavBuffer.byteOffset + wavBuffer.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: "audio/wav" });
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
}
