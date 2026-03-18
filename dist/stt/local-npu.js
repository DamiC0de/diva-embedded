/**
 * STT — Groq Whisper (primary, French) with SenseVoice NPU fallback (zh/en/ja/ko)
 * Circuit breaker: if Groq fails 3 times → auto-switch to NPU for 60s
 */
import { withCircuitBreaker } from "../tools/circuit-breaker.js";
const STT_LOCAL_URL = process.env.STT_LOCAL_URL ?? "http://localhost:8881/v1/audio/transcriptions";
const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
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
function cleanHallucinations(text) {
    if (!text)
        return "";
    const trimmed = text.trim();
    const lower = trimmed.toLowerCase().replace(/[.!?]+$/, "").trim();
    // Reject exact known hallucinations
    if (EXACT_HALLUCINATIONS.has(lower)) {
        console.log(`  [HALLUCINATION] Exact match rejeté: "${trimmed}"`);
        return "";
    }
    // Reject non-French text: CJK, Hangul, Cyrillic, Arabic, Devanagari
    const nonLatinRatio = (trimmed.match(/[\u3000-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\uFF00-\uFFEF]/g) || []).length / trimmed.length;
    if (nonLatinRatio > 0.3) {
        console.log(`  [HALLUCINATION] Non-French rejeté (${Math.round(nonLatinRatio * 100)}% non-latin): "${trimmed}"`);
        return "";
    }
    // Reject if mostly non-ASCII and not French accented chars
    const frenchChars = (trimmed.match(/[a-zA-ZàâäéèêëïîôùûüÿçœæÀÂÄÉÈÊËÏÎÔÙÛÜŸÇŒÆ0-9\s.,!?;:'"\-]/g) || []).length;
    if (trimmed.length > 3 && frenchChars / trimmed.length < 0.6) {
        console.log(`  [HALLUCINATION] Low French ratio rejeté (${Math.round(frenchChars / trimmed.length * 100)}%): "${trimmed}"`);
        return "";
    }
    const hallPrefixes = ["sous-titr", "copyright", "transcript", "thanks for", "subtitles by"];
    for (const prefix of hallPrefixes) {
        if (lower.startsWith(prefix))
            return "";
    }
    if (lower.length <= 4 && !VALID_SHORT_WORDS.has(lower))
        return "";
    const repetitionMatch = trimmed.match(/(.{5,}?)\1{2,}/);
    if (repetitionMatch)
        return repetitionMatch[1].trim();
    return trimmed;
}
function isRepeatOfPrevious(text) {
    if (!lastTranscription || !text)
        return false;
    const a = text.toLowerCase().trim();
    const b = lastTranscription.toLowerCase().trim();
    // Never filter commands (short intentional phrases)
    if (a.length < 25)
        return false;
    if (a === b)
        return true;
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
    const intersection = [...wordsA].filter(w => wordsB.has(w));
    return intersection.length / Math.max(wordsA.size, wordsB.size) > 0.85;
}
// --- Local NPU transcription ---
async function transcribeNPU(wavBuffer) {
    const arrayBuffer = wavBuffer.buffer.slice(wavBuffer.byteOffset, wavBuffer.byteOffset + wavBuffer.byteLength);
    const blob = new Blob([arrayBuffer], { type: "audio/wav" });
    const form = new FormData();
    form.append("file", blob, "audio.wav");
    const response = await fetch(STT_LOCAL_URL, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
        throw new Error(`Local STT error ${response.status}`);
    const data = (await response.json());
    return data.text?.trim() ?? "";
}
// --- Groq Cloud fallback ---
async function transcribeGroq(wavBuffer) {
    if (!GROQ_API_KEY)
        throw new Error("GROQ_API_KEY not set");
    const arrayBuffer = wavBuffer.buffer.slice(wavBuffer.byteOffset, wavBuffer.byteOffset + wavBuffer.byteLength);
    const blob = new Blob([arrayBuffer], { type: "audio/wav" });
    const form = new FormData();
    form.append("file", blob, "audio.wav");
    form.append("model", "whisper-large-v3");
    form.append("language", "fr");
    const response = await fetch(GROQ_STT_URL, {
        method: "POST",
        headers: { "Authorization": `Bearer ${GROQ_API_KEY}` },
        body: form,
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
        throw new Error(`Groq STT error ${response.status}`);
    const data = (await response.json());
    console.log("[STT] Groq fallback used");
    return data.text?.trim() ?? "";
}
// --- Main transcription function with circuit breaker ---
export async function transcribeLocal(wavBuffer) {
    try {
        // Groq Whisper = primary (supports French), NPU SenseVoice = fallback (zh/en/ja/ko only)
        const rawText = await withCircuitBreaker("stt", () => transcribeGroq(wavBuffer), () => transcribeNPU(wavBuffer), { failureThreshold: 3, resetTimeoutMs: 60000 });
        let result = cleanHallucinations(rawText);
        if (result && isRepeatOfPrevious(result)) {
            console.log(`  [REPEAT] Rejeté: "${result}"`);
            result = "";
        }
        if (result) {
            lastTranscription = result;
            console.log(`[STT] OK: "${result}"`);
        }
        else {
            console.warn(`[STT] Filtered: raw="${rawText?.slice(0, 60)}"`);
        }
        return result;
    }
    catch (err) {
        console.error(`[STT] All engines failed: ${err}`);
        return "";
    }
}
//# sourceMappingURL=local-npu.js.map