/**
 * STT — Groq Whisper with anti-hallucination filtering
 * Uses verbose_json format for segment-level metrics
 * Filters out hallucinated segments (high no_speech_prob, repetitions, etc.)
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

const WHISPER_PROMPT =
  "Conversation en français avec Diva, assistant vocal intelligent. " +
  "Bonjour Diva. Quelle heure est-il ? Quelle est la date ? " +
  "Qui est le président de la France ? " +
  "Allume la lumière du salon. Éteins la cuisine. " +
  "Quelle est la météo à Besançon aujourd'hui ? " +
  "Mets un minuteur de dix minutes. " +
  "Comment va Jean le bébé ? Raconte-moi les actualités. " +
  "C'est quoi le programme ce soir ? Merci Diva. Bonne nuit.";

// --- Hallucination detection ---

const EXACT_HALLUCINATIONS = new Set([
  "merci.", "merci", "merci d'avoir regardé.",
  "sous-titres réalisés par la communauté d'amara.org",
  "sous-titrage stéréo", "sous-titrage fr",
  "sous-titrage st' 501",
  "merci de votre attention.", "à bientôt.",
  "...", "…", "",
  "thanks for watching.", "thank you.", "thank you for watching.",
  "subtitles by the amara.org community",
  "you", "bye.", "bye-bye.", "subscribe",
]);

const VALID_SHORT_WORDS = new Set([
  "oui", "non", "ok", "stop", "diva", "bonjour", "salut",
  "bonsoir", "aide", "répète", "quoi", "encore", "merci",
]);

let lastTranscription = "";

function cleanHallucinations(text: string): string {
  if (!text) return "";
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase().replace(/[.!?]+$/, "").trim();

  if (EXACT_HALLUCINATIONS.has(lower)) {
    console.log(`  [HALLUCINATION] Rejeté: "${trimmed}"`);
    return "";
  }

  const hallPrefixes = ["sous-titr", "copyright", "transcript", "thanks for", "subtitles by"];
  for (const prefix of hallPrefixes) {
    if (lower.startsWith(prefix)) {
      console.log(`  [HALLUCINATION PREFIX] Rejeté: "${trimmed}"`);
      return "";
    }
  }

  if (lower.length <= 4 && !VALID_SHORT_WORDS.has(lower)) {
    console.log(`  [TROP COURT] Rejeté: "${trimmed}"`);
    return "";
  }

  const repetitionMatch = trimmed.match(/(.{5,}?)\1{2,}/);
  if (repetitionMatch) {
    console.log(`  [RÉPÉTITION] Nettoyé: "${trimmed}" -> "${repetitionMatch[1]}"`);
    return repetitionMatch[1].trim();
  }

  return trimmed;
}

function isRepeatOfPrevious(text: string): boolean {
  if (!lastTranscription || !text) return false;
  const a = text.toLowerCase().trim();
  const b = lastTranscription.toLowerCase().trim();
  if (a === b) return true;
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const similarity = intersection.length / Math.max(wordsA.size, wordsB.size);
  return similarity > 0.8;
}

interface WhisperSegment {
  text: string;
  no_speech_prob: number;
  compression_ratio: number;
  avg_logprob: number;
}

function filterSegments(segments: WhisperSegment[]): string {
  if (!segments || segments.length === 0) return "";
  const clean: string[] = [];
  for (const seg of segments) {
    if (seg.no_speech_prob > 0.6) continue;
    if (seg.compression_ratio > 2.4) continue;
    if (seg.avg_logprob < -1.0) continue;
    const text = seg.text?.trim();
    if (text) clean.push(text);
  }
  return clean.join(" ").trim();
}

// --- Main transcription function ---

export async function transcribeLocal(wavBuffer: Buffer): Promise<string> {
  if (!GROQ_API_KEY) {
    console.error("[STT] GROQ_API_KEY not set");
    return "";
  }

  const arrayBuffer = wavBuffer.buffer.slice(
    wavBuffer.byteOffset,
    wavBuffer.byteOffset + wavBuffer.byteLength
  ) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: "audio/wav" });
  const form = new FormData();
  form.append("file", blob, "audio.wav");
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "fr");
  form.append("temperature", "0");
  form.append("response_format", "verbose_json");
  form.append("prompt", WHISPER_PROMPT);

  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Groq error ${response.status}`);
    }

    const data = (await response.json()) as {
      text?: string;
      segments?: WhisperSegment[];
    };

    // Try segment-level filtering first
    let result = "";
    if (data.segments && data.segments.length > 0) {
      result = filterSegments(data.segments);
      if (!result && data.text) {
        result = data.text.trim();
      }
    } else {
      result = data.text?.trim() ?? "";
    }

    // Clean hallucinations
    result = cleanHallucinations(result);

    // Check for repeat of previous transcription
    if (result && isRepeatOfPrevious(result)) {
      console.log(`  [REPEAT] Rejeté: "${result}" (same as previous)`);
      result = "";
    }

    // Update history
    if (result) {
      lastTranscription = result;
    }

    if (result) {
      console.log(`[STT] Groq OK: "${result}"`);
    } else {
      console.warn(`[STT] Groq filtered out: raw="${data.text?.slice(0, 60)}"`);
    }

    return result;
  } catch (err) {
    console.error(`[STT] Groq failed: ${err}`);
    return "";
  }
}
