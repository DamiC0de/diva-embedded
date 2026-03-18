/**
 * index.ts — Diva Embedded Voice Assistant (HTTP Architecture)
 *
 * Node.js est l'orchestrateur principal.
 * Python (FastAPI sur port 9010) exécute les opérations audio.
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
const GOODBYE_PHRASES = [
    "bonne nuit", "au revoir", "à plus", "ciao",
    "j'ai fini", "c'est bon", "merci c'est tout", "ça ira"
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
    const memorySummary = await getMemorySummary();
    if (memorySummary) {
        claude.setMemorySummary(memorySummary);
    }
    // Start dashboard server
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
function containsGoodbye(text) {
    const lower = text.toLowerCase().trim();
    // Short utterances: must be primarily a goodbye
    if (lower.length < 20) {
        return GOODBYE_PHRASES.some(phrase => lower.includes(phrase));
    }
    // Longer utterances: goodbye must be at the end
    return GOODBYE_PHRASES.some(phrase => lower.endsWith(phrase) || lower.endsWith(phrase + " !") || lower.endsWith(phrase + "."));
}
// =====================================================================
// TTS — Streaming pipeline
// =====================================================================
async function speakTTS(text) {
    try {
        const wavBuffer = await synthesize(text);
        const wavBase64 = wavBuffer.toString("base64");
        await playAudioBytes(wavBase64);
    }
    catch (err) {
        console.error("[TTS] Error:", err);
    }
}
async function speakTTSStreaming(sentenceQueue) {
    // Pipeline: synthesize sentence N+1 while playing sentence N
    let pendingWav = null;
    for await (const sentence of sentenceQueue) {
        if (sentence.trim().length <= 3)
            continue;
        if (pendingWav) {
            // We have a sentence being synthesized — wait for it, then
            // kick off synthesis of the NEW sentence, then play the ready one
            const readyWav = await pendingWav;
            pendingWav = synthesize(sentence); // start next in background
            try {
                await playAudioBytes(readyWav.toString("base64"));
            }
            catch (err) {
                console.error("[TTS-STREAM] Play error:", err);
            }
        }
        else {
            // First sentence — synthesize AND play immediately (no prefetch)
            try {
                const wav = await synthesize(sentence);
                await playAudioBytes(wav.toString("base64"));
            }
            catch (err) {
                console.error("[TTS-STREAM] First sentence error:", err);
            }
            // pendingWav stays null — next iteration will be "first" again
            // unless we get the next sentence fast enough
            continue;
        }
    }
    // Play last prefetched sentence
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
        // Beep to signal "your turn to speak"
        await playAudioFile(`${ASSETS_DIR}/listen.wav`);
        console.log("[REC] Enregistrement en cours...");
        const recorded = await recordAudio({
            maxDurationS: 10,
            silenceTimeoutS: isFirstTurn ? 1.2 : 0.8,
        });
        if (!recorded.has_speech || !recorded.wav_base64) {
            if (!isFirstTurn) {
                console.log("[FOLLOW-UP] Silence, fin de conversation");
                break;
            }
            console.log("[REC] Pas de parole détectée, retour au wake word");
            break;
        }
        console.log(`[REC] Audio capturé : ${recorded.duration_ms}ms`);
        const wavBuffer = Buffer.from(recorded.wav_base64, "base64");
        const [transcription, speaker] = await Promise.all([
            transcribeLocal(wavBuffer),
            identifySpeaker(recorded.wav_base64).catch(() => "unknown"),
        ]);
        if (speaker && speaker !== "unknown") {
            console.log(`[SPEAKER] Identifié: ${speaker}`);
            setCurrentPersona(speaker);
            claude.clearHistory(); // New speaker = fresh conversation context
        }
        if (!transcription || transcription.trim().length === 0) {
            console.log("[STT] Transcription vide");
            if (!isFirstTurn)
                continue;
            break;
        }
        console.log(`[STT] "${transcription}"`);
        // --- DISTRESS DETECTION (priority) ---
        if (isDistressPhrase(transcription)) {
            console.log("[DISTRESS] Detected!");
            const response = await handleDistress(transcription);
            await speakTTS(response);
            break;
        }
        if (containsGoodbye(transcription)) {
            console.log("[END] Goodbye détecté");
            await playAudioFile(`${ASSETS_DIR}/goodbye.wav`);
            break;
        }
        // Handle voice registration flow
        if (/enregistre.*voix|apprends.*voix|m.morise.*voix/i.test(transcription)) {
            await handleVoiceRegistrationFlow();
            break;
        }
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
    // Store every user message in memory (Mem0 extracts personal facts automatically)
    addMemory(transcription).catch(() => { });
    // Check for repeated questions (Alzheimer tracking)
    const { isRepetition } = checkRepetition(transcription);
    if (isRepetition) {
        trackRepeatedQuestion();
        console.log("[REPETITION] Repeated question detected");
    }
    const intent = await classifyIntent(transcription);
    console.log(`[INTENT] ${intent.intent} (${intent.category}) [${intent.latency_ms}ms]`);
    // Local intent handling
    if (intent.intent === "local_simple" || intent.intent === "local") {
        const local = await handleLocalIntent(intent.category, transcription);
        if (local.handled && local.response) {
            console.log(`[LOCAL] "${local.response}"`);
            await speakTTS(local.response);
            logInteraction({
                timestamp: new Date().toISOString(),
                speaker,
                transcription,
                intent: intent.intent,
                category: intent.category,
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
    // Reload memory for current speaker before asking Claude
    const freshMemory = await getMemorySummary();
    claude.setMemorySummary(freshMemory);
    // Claude streaming + TTS pipeline
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
        const fallback = "Désolé, je n'ai pas pu répondre.";
        console.warn("[CLAUDE] Empty response, using fallback");
        await speakTTS(fallback);
        return;
    }
    console.log(`[CLAUDE] Full: "${fullResponse}"`);
    logInteraction({
        timestamp: new Date().toISOString(),
        speaker,
        transcription,
        intent: intent.intent,
        category: intent.category,
        response: fullResponse,
        latencyMs: Date.now() - t0,
    });
}
// =====================================================================
// MAIN
// =====================================================================
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
async function main() {
    console.log("[DIVA] Starting HTTP Architecture...");
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