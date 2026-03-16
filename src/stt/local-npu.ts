/**
 * STT with quality validation
 * Uses NPU SenseVoice first, validates the result,
 * falls back to Groq Whisper if transcript looks like garbage
 */

const LOCAL_STT_URL = process.env.LOCAL_STT_URL ?? "http://localhost:8881";
const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

// French text should mostly contain latin characters
const LATIN_REGEX = /[a-zA-ZÀ-ÿ]/;
const CJK_REGEX = /[\u3000-\u9FFF\uF900-\uFAFF]/;

function isValidFrenchTranscript(text: string): boolean {
  if (!text || text.length < 2) return false;
  // Reject if it contains CJK characters (SenseVoice defaulting to Chinese/Japanese)
  if (CJK_REGEX.test(text)) return false;
  // Reject if no latin characters at all
  if (!LATIN_REGEX.test(text)) return false;
  // Reject if too short and just punctuation
  const stripped = text.replace(/[^a-zA-ZÀ-ÿ]/g, "");
  if (stripped.length < 2) return false;
  return true;
}

export async function transcribeLocal(wavBuffer: Buffer): Promise<string> {
  // Try NPU first (fast, local)
  try {
    const npuResult = await transcribeNPU(wavBuffer);
    if (isValidFrenchTranscript(npuResult)) {
      console.log(`[STT] NPU OK: "${npuResult}"`);
      return npuResult;
    }
    console.warn(`[STT] NPU returned invalid French: "${npuResult}", falling back to Groq`);
  } catch (err) {
    console.warn(`[STT] NPU error: ${err}, falling back to Groq`);
  }

  // Fallback to Groq Whisper (cloud, accurate French)
  try {
    const groqResult = await transcribeGroqFallback(wavBuffer);
    console.log(`[STT] Groq OK: "${groqResult}"`);
    return groqResult;
  } catch (err) {
    console.error(`[STT] Both NPU and Groq failed: ${err}`);
    return "";
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
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`NPU STT error ${response.status}`);
  }

  const result = (await response.json()) as { text: string };
  return result.text.trim();
}

async function transcribeGroqFallback(wavBuffer: Buffer): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY not set");
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
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Groq error ${response.status}`);
  }

  const result = (await response.json()) as { text: string };
  return result.text.trim();
}
