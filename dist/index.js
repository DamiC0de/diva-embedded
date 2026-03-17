/**
 * index.ts — Diva Embedded Voice Assistant (HTTP Architecture)
 *
 * Node.js est l'orchestrateur principal.
 * Python (FastAPI sur port 9010) exécute les opérations audio.
 * Plus de protocole TCP bidirectionnel fragile.
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { waitForWakeword, recordAudio, playAudioFile, playAudioBytes, checkHealth, } from "./audio/audio-client.js";
import { transcribeLocal } from "./stt/local-npu.js";
import { ClaudeStreamingClient } from "./llm/claude-streaming.js";
import { classifyIntent, handleLocalIntent } from "./routing/intent-router.js";
import { handleWebSearch } from "./tools/searxng-search.js";
import { handleMemoryRead, handleMemoryWrite, getMemorySummary, addMemory, addConversation, identifySpeaker, getCurrentUser } from "./tools/memory-tool.js";
import { chooseFiller } from "./audio/filler-manager.js";
import { synthesize } from "./tts/piper.js";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// =====================================================================
// CONFIG
// =====================================================================
const FOLLOW_UP_ENABLED = true;
const FOLLOW_UP_TIMEOUT_S = 5;
const ASSETS_DIR = "/opt/diva-embedded/assets";
// Goodbye phrases pour détecter fin de conversation
const GOODBYE_PHRASES = [
    "bonne nuit", "au revoir", "à plus", "salut", "ciao",
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
}
// =====================================================================
// UTILS
// =====================================================================
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function containsGoodbye(text) {
    const lower = text.toLowerCase();
    return GOODBYE_PHRASES.some(phrase => lower.includes(phrase));
}
// =====================================================================
// TTS
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
// =====================================================================
// MAIN LOOPS
// =====================================================================
async function idleLoop() {
    console.log("\n[IDLE] En attente du wake word...");
    // Attendre "Diva"
    const wakeword = await waitForWakeword();
    if (!wakeword.detected)
        return;
    console.log(`[WAKEWORD] Détecté ! Score: ${wakeword.score.toFixed(3)}`);
    // Jouer le chime de confirmation
    await playAudioFile(`${ASSETS_DIR}/oui.wav`);
    // Entrer en mode conversation
    await conversationLoop();
}
async function conversationLoop() {
    let isFirstTurn = true;
    let turnCount = 0;
    while (true) {
        turnCount++;
        // --- ENREGISTRER ---
        console.log("[REC] Enregistrement en cours...");
        const recorded = await recordAudio({
            maxDurationS: 10,
            silenceTimeoutS: isFirstTurn ? 1.5 : 1.2,
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
        // Identify speaker from audio
        const speaker = await identifySpeaker(recorded.wav_base64);
        console.log(`[SPEAKER] ${speaker} (user=${getCurrentUser()})`);
        // --- TRANSCRIRE ---
        const wavBuffer = Buffer.from(recorded.wav_base64, "base64");
        const transcription = await transcribeLocal(wavBuffer);
        if (!transcription || transcription.trim().length === 0) {
            console.log("[STT] Transcription vide");
            if (!isFirstTurn)
                continue;
            break;
        }
        console.log(`[STT] "${transcription}"`);
        // --- DÉTECTER FIN DE CONVERSATION ---
        if (containsGoodbye(transcription)) {
            console.log("[END] Goodbye détecté");
            await playAudioFile(`${ASSETS_DIR}/goodbye.wav`);
            break;
        }
        // --- TRAITER ---
        await handleTranscription(transcription);
        // --- FOLLOW-UP ? ---
        if (!FOLLOW_UP_ENABLED)
            break;
        isFirstTurn = false;
        // Notification follow-up
        playAudioFile(`${ASSETS_DIR}/thinking.wav`).catch(() => {});
    }
    console.log("[CONV] Fin de conversation, retour au wake word\n");
}

const __cached_dir = join(dirname(fileURLToPath(import.meta.url)), "../assets/cached-responses");
function getCachedResponse(category) {
    try {
        const dir = join(__cached_dir, category);
        const files = readdirSync(dir).filter(f => f.endsWith(".wav"));
        if (files.length === 0) return null;
        return join(dir, files[Math.floor(Math.random() * files.length)]);
    } catch { return null; }
}

async function handleTranscription(transcription) {
    // transcription is now saved via addConversation
    // --- CLASSIFIER L'INTENT ---
    const intent = await classifyIntent(transcription);
    console.log(`[INTENT] ${intent.intent} (${intent.category}) [${intent.latency_ms}ms]`);
    // --- RÉPONSES LOCALES (instantanées) ---
    if (intent.intent === "local_simple") {
        const local = await handleLocalIntent(intent.category, transcription);
        if (local.handled && local.response) {
            // Check for cached audio response
            const cachedCategories = {"greeting": "greetings", "goodbye": "goodbye", "shutdown": "shutdown", "conversational": "conversational"};
            const cachedDir = cachedCategories[intent.category];
            if (cachedDir) {
                const cachedPath = getCachedResponse(cachedDir);
                if (cachedPath) {
                    console.log(`[CACHED] Playing ${cachedPath}`);
                    await playAudioFile(cachedPath);
                    return;
                }
            }
            console.log(`[LOCAL] "${local.response}"`);
            await addMemory(local.response);
            await speakTTS(local.response);
            return;
        }
        console.log("[LOCAL] Handler declined, falling back to Claude...");
    }
    // --- FILLER PENDANT GÉNÉRATION ---
    const filler = chooseFiller(intent.category, transcription);
    if (filler.primary) {
        // Jouer le filler en parallèle avec le lancement de Claude
        playAudioFile(filler.primary).catch(() => { });
    }
    // --- CLAUDE STREAMING ---
    console.log("[CLAUDE] Asking (streaming)...");
    let isFirstSentence = true;
    const sentences = [];
    const fullResponse = await claude.chatStreaming(transcription, async (sentence, isFirst) => {
        sentences.push(sentence);
        if (isFirst) {
            console.log(`[CLAUDE] First: "${sentence}"`);
        }
        else {
            console.log(`[CLAUDE] Queue: "${sentence}"`);
        }
    });
    // Jouer chaque phrase séquentiellement
    for (const sentence of sentences) {
        await speakTTS(sentence);
    }
    // Fallback si rien généré
    if (!fullResponse || fullResponse.trim().length === 0) {
        const fallback = "Désolé, je n'ai pas pu répondre.";
        console.warn("[CLAUDE] Empty response, using fallback");
        await speakTTS(fallback);
        await addMemory(fallback);
        return;
    }
    console.log(`[CLAUDE] Full: "${fullResponse}"`);
    await addConversation(transcription, fullResponse);
}
// =====================================================================
// MAIN
// =====================================================================
async function main() {
    console.log("[DIVA] Starting HTTP Architecture...");
    await init();
    // Vérifier que le serveur audio est prêt
    console.log("[INIT] Vérification du serveur audio (port 9010)...");
    let retries = 0;
    while (!(await checkHealth())) {
        retries++;
        if (retries > 30) {
            console.error("[INIT] ❌ Serveur audio non disponible après 30 tentatives");
            process.exit(1);
        }
        console.log(`[INIT] En attente du serveur audio... (${retries}/30)`);
        await sleep(2000);
    }
    console.log("[INIT] ✅ Serveur audio connecté");
    // Cleanup
    try {
        execSync("pkill -9 arecord || true", { timeout: 3000 });
    }
    catch { }
    console.log("[INIT] Cleaned up old processes");
    // Boucle principale
    console.log("[DIVA] ✅ Ready!");
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
// Graceful shutdown
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