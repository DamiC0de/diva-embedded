/**
 * index.ts — Diva Embedded Voice Assistant (HTTP Architecture)
 * v5: Minimal regex routing, contextual goodbye, Claude handles conversation
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { waitForWakeword, recordAudio, playAudioFile, playAudioBytes, checkHealth, } from "./audio/audio-client.js";
import { transcribeLocal } from "./stt/local-npu.js";
import { ClaudeStreamingClient } from "./llm/claude-streaming.js";
import { classifyIntent, handleLocalIntent } from "./routing/intent-router.js";
import { handleWebSearch } from "./tools/searxng-search.js";
import { handleMemoryRead, handleMemoryWrite, getMemorySummary, addMemory, identifySpeaker, } from "./tools/memory-tool.js";
import { chooseFiller } from "./audio/filler-manager.js";
import { isDNDActive } from "./tools/dnd-manager.js";
import { setAudioBusy } from "./audio/audio-lock.js";
import { synthesize } from "./tts/piper.js";
import { setCurrentPersona, loadPersonas } from "./persona/engine.js";
import { runVoiceRegistration } from "./persona/registration.js";
import { startDashboard, logInteraction } from "./dashboard/server.js";
import { startHAWebhookServer } from "./smarthome/ha-notifications.js";
import { startMedicationScheduler } from "./elderly/medication-manager.js";
import { startProactiveScheduler, trackInteraction, trackRepeatedQuestion } from "./elderly/proactive-scheduler.js";
import { isDistressPhrase, handleDistress } from "./elderly/distress-detector.js";
import { checkRepetition } from "./elderly/repetition-tracker.js";
// =====================================================================
// CONFIG
// =====================================================================
const FOLLOW_UP_ENABLED = true;
const ASSETS_DIR = "/opt/diva-embedded/assets";
// Goodbye detection — only used in follow-up turns (not first turn)
const GOODBYE_WORDS = [
    "ciao", "au revoir", "à plus", "à bientôt", "à demain",
    "bonne nuit", "bonne soirée", "bye",
    "c'est bon merci", "merci c'est tout", "j'ai fini",
    "c'est tout", "ça ira",
];
// =====================================================================
// GLOBALS
// =====================================================================
const claude = new ClaudeStreamingClient();
// =====================================================================
// INIT
// =====================================================================
async function init() {
    claude.registerTool("brave_search", handleWebSearch);
    claude.registerTool("memory_read", handleMemoryRead);
    claude.registerTool("memory_write", handleMemoryWrite);
    startDashboard();
    loadPersonas();
    startMedicationScheduler();
    startProactiveScheduler();
    startHAWebhookServer();
}
// =====================================================================
// UTILS
// =====================================================================
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function isGoodbye(text) {
    const lower = text.toLowerCase().trim();
    return GOODBYE_WORDS.some(phrase => lower.includes(phrase));
}
// =====================================================================
// TTS
// =====================================================================
async function speakTTS(text) {
    try {
        const wavBuffer = await synthesize(text);
        await playAudioBytes(wavBuffer.toString("base64"));
    }
    catch (err) {
        console.error("[TTS] Error:", err);
    }
}
async function speakTTSStreaming(sentenceQueue) {
    let pendingWav = null;
    for await (const sentence of sentenceQueue) {
        if (sentence.trim().length <= 3)
            continue;
        if (pendingWav) {
            const readyWav = await pendingWav;
            pendingWav = synthesize(sentence);
            try {
                await playAudioBytes(readyWav.toString("base64"));
            }
            catch (err) {
                console.error("[TTS-STREAM] Play error:", err);
            }
        }
        else {
            try {
                const wav = await synthesize(sentence);
                await playAudioBytes(wav.toString("base64"));
            }
            catch (err) {
                console.error("[TTS-STREAM] First sentence error:", err);
            }
            continue;
        }
    }
    if (pendingWav) {
        try {
            const wavBuffer = await pendingWav;
            await playAudioBytes(wavBuffer.toString("base64"));
        }
        catch (err) {
            console.error("[TTS-STREAM] Final play error:", err);
        }
    }
}
// =====================================================================
// MAIN LOOPS
// =====================================================================
async function idleLoop() {
    console.log("\n[IDLE] En attente du wake word...");
    if (isDNDActive()) {
        console.log("[IDLE] DND mode active, skipping...");
        setAudioBusy(false);
        await sleep(5000);
        return;
    }
    setAudioBusy(true);
    const wakeword = await waitForWakeword();
    if (!wakeword.detected) {
        setAudioBusy(false);
        return;
    }
    console.log(`[WAKEWORD] Détecté ! Score: ${wakeword.score.toFixed(3)}`);
    await playAudioFile(`${ASSETS_DIR}/oui.wav`);
    await conversationLoop();
    setAudioBusy(false);
}
async function conversationLoop() {
    let isFirstTurn = true;
    while (true) {
        // Beep then record
        await playAudioFile(`${ASSETS_DIR}/listen.wav`);
        console.log("[REC] Enregistrement en cours...");
        const recorded = await recordAudio({
            maxDurationS: 10,
            silenceTimeoutS: isFirstTurn ? 1.2 : 1.0,
        });
        if (!recorded.has_speech || !recorded.wav_base64) {
            if (!isFirstTurn) {
                console.log("[FOLLOW-UP] Silence, fin de conversation");
            }
            else {
                console.log("[REC] Pas de parole détectée, retour au wake word");
            }
            break;
        }
        console.log(`[REC] Audio capturé : ${recorded.duration_ms}ms`);
        // STT + Speaker ID in parallel
        const wavBuffer = Buffer.from(recorded.wav_base64, "base64");
        const [transcription, speaker] = await Promise.all([
            transcribeLocal(wavBuffer),
            identifySpeaker(recorded.wav_base64).catch(() => "unknown"),
        ]);
        if (speaker && speaker !== "unknown") {
            console.log(`[SPEAKER] Identifié: ${speaker}`);
            setCurrentPersona(speaker);
            claude.clearHistory();
        }
        if (!transcription || transcription.trim().length === 0) {
            console.log("[STT] Transcription vide");
            if (!isFirstTurn)
                continue;
            break;
        }
        console.log(`[STT] "${transcription}"`);
        // --- DISTRESS (always priority) ---
        if (isDistressPhrase(transcription)) {
            console.log("[DISTRESS] Detected!");
            const response = await handleDistress(transcription);
            await speakTTS(response);
            break;
        }
        // --- GOODBYE (only in follow-up turns) ---
        if (!isFirstTurn && isGoodbye(transcription)) {
            console.log("[END] Goodbye détecté");
            await playAudioFile(`${ASSETS_DIR}/goodbye.wav`);
            break;
        }
        // --- VOICE REGISTRATION ---
        if (/enregistre.*voix|apprends.*voix|m[eé]morise.*voix/i.test(transcription)) {
            await handleVoiceRegistrationFlow();
            break;
        }
        // --- PROCESS ---
        await handleTranscription(transcription, speaker);
        if (!FOLLOW_UP_ENABLED)
            break;
        isFirstTurn = false;
    }
    console.log("[CONV] Fin de conversation, retour au wake word\n");
}
async function handleTranscription(transcription, speaker = "unknown") {
    const t0 = Date.now();
    trackInteraction();
    addMemory(transcription).catch(() => { });
    const { isRepetition } = checkRepetition(transcription);
    if (isRepetition) {
        trackRepeatedQuestion();
        console.log("[REPETITION] Repeated question detected");
    }
    const intent = await classifyIntent(transcription);
    console.log(`[INTENT] ${intent.intent} (${intent.category}) [${intent.latency_ms}ms]`);
    // Local intent handling (minimal: time, timer, calculator, dnd, about_me, speaker_register)
    if (intent.intent === "local") {
        const local = await handleLocalIntent(intent.category, transcription);
        if (local.handled && local.response) {
            console.log(`[LOCAL] "${local.response}"`);
            await speakTTS(local.response);
            logInteraction({
                timestamp: new Date().toISOString(),
                speaker, transcription,
                intent: intent.intent, category: intent.category,
                response: local.response,
                latencyMs: Date.now() - t0,
            });
            return;
        }
        console.log("[LOCAL] Handler declined, falling back to Claude...");
    }
    // Filler
    const filler = chooseFiller(intent.category, transcription);
    if (filler.primary) {
        playAudioFile(filler.primary).catch(() => { });
    }
    // Reload memory for current speaker
    const freshMemory = await getMemorySummary();
    claude.setMemorySummary(freshMemory);
    // Claude streaming + TTS
    console.log("[CLAUDE] Asking (streaming)...");
    let resolveNext = null;
    let sentenceDone = false;
    const sentenceQueue = [];
    const asyncSentenceIterable = {
        [Symbol.asyncIterator]() {
            return {
                next() {
                    if (sentenceQueue.length > 0) {
                        return Promise.resolve({ value: sentenceQueue.shift(), done: false });
                    }
                    if (sentenceDone) {
                        return Promise.resolve({ value: undefined, done: true });
                    }
                    return new Promise((resolve) => { resolveNext = resolve; });
                }
            };
        }
    };
    function pushSentence(sentence) {
        if (resolveNext) {
            const r = resolveNext;
            resolveNext = null;
            r({ value: sentence, done: false });
        }
        else {
            sentenceQueue.push(sentence);
        }
    }
    function finishSentences() {
        sentenceDone = true;
        if (resolveNext) {
            const r = resolveNext;
            resolveNext = null;
            r({ value: undefined, done: true });
        }
    }
    const claudePromise = claude.chatStreaming(transcription, (sentence, isFirst) => {
        console.log(`[CLAUDE] ${isFirst ? "First" : "Next"}: "${sentence}"`);
        pushSentence(sentence);
    }).then((fullResponse) => {
        finishSentences();
        return fullResponse;
    });
    const ttsPromise = speakTTSStreaming(asyncSentenceIterable);
    const [fullResponse] = await Promise.all([claudePromise, ttsPromise]);
    if (!fullResponse || fullResponse.trim().length === 0) {
        await speakTTS("Désolé, je n'ai pas pu répondre.");
        return;
    }
    console.log(`[CLAUDE] Full: "${fullResponse}"`);
    logInteraction({
        timestamp: new Date().toISOString(),
        speaker, transcription,
        intent: intent.intent, category: intent.category,
        response: fullResponse,
        latencyMs: Date.now() - t0,
    });
}
// =====================================================================
// VOICE REGISTRATION
// =====================================================================
async function handleVoiceRegistrationFlow() {
    try {
        const result = await runVoiceRegistration();
        if (result?.success) {
            setCurrentPersona(result.name);
        }
    }
    catch (err) {
        console.error("[REGISTER] Error:", err);
        await speakTTS("Désolé, une erreur est survenue pendant l'enregistrement.");
    }
}
// =====================================================================
// MAIN
// =====================================================================
async function main() {
    console.log("[DIVA] Starting v5 — Minimal regex, Claude handles conversation...");
    await init();
    console.log("[INIT] Vérification du serveur audio (port 9010)...");
    let retries = 0;
    while (!(await checkHealth())) {
        retries++;
        if (retries > 30) {
            console.error("[INIT] Serveur audio non disponible après 30 tentatives");
            process.exit(1);
        }
        console.log(`[INIT] En attente du serveur audio... (${retries}/30)`);
        await sleep(2000);
    }
    console.log("[INIT] Serveur audio connecté");
    try {
        execSync("pkill -9 arecord || true", { timeout: 3000 });
    }
    catch { }
    console.log("[INIT] Cleaned up old processes");
    console.log("[DIVA] Ready!");
    while (true) {
        try {
            await idleLoop();
        }
        catch (error) {
            console.error("[MAIN] Error:", error);
            await sleep(2000);
        }
    }
}
const shutdown = () => {
    console.log("\n[DIVA] Shutting down...");
    process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
main().catch((err) => {
    console.error("[DIVA] Fatal error:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map