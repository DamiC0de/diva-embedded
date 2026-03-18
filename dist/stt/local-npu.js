/**
 * STT — Groq Whisper (primary, French) with SenseVoice NPU fallback
 * Circuit breaker: if Groq fails 3 times → auto-switch to NPU for 60s
 *
 * Minimal filtering: only reject non-French text (from NPU fallback)
 */
import { withCircuitBreaker } from "../tools/circuit-breaker.js";
const STT_LOCAL_URL = process.env.STT_LOCAL_URL ?? "http://localhost:8881/v1/audio/transcriptions";
const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
/**
 * Only reject text that is clearly not French (CJK, Hangul, etc.)
 * This only happens when NPU fallback is active.
 */
function isNotFrench(text) {
    if (!text || text.trim().length === 0)
        return true;
    const trimmed = text.trim();
    const nonLatinCount = (trimmed.match(/[\u3000-\u9FFF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\uFF00-\uFFEF]/g) || []).length;
    if (nonLatinCount / trimmed.length > 0.3) {
        console.log(`[STT] Non-French rejeté: "${trimmed}"`);
        return true;
    }
    return false;
}
// --- Groq Whisper (primary) ---
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
    return data.text?.trim() ?? "";
}
// --- SenseVoice NPU (fallback) ---
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
    console.log("[STT] NPU fallback used");
    return data.text?.trim() ?? "";
}
// --- Main ---
export async function transcribeLocal(wavBuffer) {
    try {
        const rawText = await withCircuitBreaker("stt", () => transcribeGroq(wavBuffer), () => transcribeNPU(wavBuffer), { failureThreshold: 3, resetTimeoutMs: 60000 });
        if (!rawText || isNotFrench(rawText)) {
            console.warn(`[STT] Empty or non-French: "${rawText?.slice(0, 60) ?? ""}"`);
            return "";
        }
        console.log(`[STT] OK: "${rawText}"`);
        return rawText;
    }
    catch (err) {
        console.error(`[STT] All engines failed: ${err}`);
        return "";
    }
}
//# sourceMappingURL=local-npu.js.map