/**
 * index.ts — Diva Embedded Voice Assistant (HTTP Architecture)
 * v6: Personality, interactive onboarding, single-pass streaming
 */

import "dotenv/config";
import { newCorrelationId, getCorrelationId } from "./monitoring/correlation.js";
import { getSession, addUserExchange, addAssistantExchange, updateLastIntent, updateSystemState, buildSessionContext, canResumeConversation, getLastTopic } from "./session/session-manager.js";
import { resolveAnaphora } from "./session/anaphora-resolver.js";
import { log, setLogSpeaker } from "./monitoring/logger.js";
import { execSync } from "node:child_process";
import {
    waitForWakeword,
    recordAudio,
    playAudioFile,
    playAudioBytes,
    checkHealth,
} from "./audio/audio-client.js";
import { transcribeLocal } from "./stt/local-npu.js";
import { ClaudeStreamingClient } from "./llm/claude-streaming.js";
import { classifyIntent, handleLocalIntent } from "./routing/intent-router.js";
import { handleWebSearch } from "./tools/searxng-search.js";
import {
    handleMemoryRead,
    handleMemoryWrite,
    getMemorySummary,
    addMemory,
    identifySpeaker,
} from "./tools/memory-tool.js";
import { chooseFiller } from "./audio/filler-manager.js";
import { isDNDActive } from "./tools/dnd-manager.js";
import { setAudioBusy } from "./audio/audio-lock.js";
import { synthesize } from "./tts/piper.js";
import { setCurrentPersona, loadPersonas } from "./persona/engine.js";
import { runVoiceRegistration } from "./persona/registration.js";
import { runOnboarding, shouldTriggerOnboarding, markOnboardingAttempt } from "./persona/onboarding.js";
import { startDashboard, logInteraction } from "./dashboard/server.js";
import { startHAWebhookServer } from "./smarthome/ha-notifications.js";
import { startMedicationScheduler } from "./elderly/medication-manager.js";
import { startProactiveScheduler, trackInteraction, trackRepeatedQuestion } from "./elderly/proactive-scheduler.js";
import { isDistressPhrase, handleDistress } from "./elderly/distress-detector.js";
import { checkRepetition } from "./elderly/repetition-tracker.js";
import { handleMusicTool } from "./music/music-tool.js";
import { handleReminderTool, startReminderChecker } from "./tools/reminder-manager.js";
import { handleShoppingListTool } from "./tools/shopping-list-tool.js";
import { handleCalendarTool } from "./calendar/google-calendar.js";
import { handleMessageTool } from "./messaging/sender.js";
import { isEmergencyPhrase, handleEmergency, handleUnknownVoiceAtNight } from "./companion/safety.js";
import { handleJournalTool, logDailyInteraction, logSleepEvent, checkCapsulesToDeliver } from "./companion/life-journal.js";
import { handleGamificationTool } from "./companion/gamification.js";
import { handleAmbientTool } from "./companion/ambient.js";
import { recordPersonaCreation, checkAnniversaries, shouldGenerateWeeklyStory, generateWeeklyStory } from "./companion/milestones.js";
// === Deep Integration Imports ===
import { checkAuth } from "./security/auth-gate.js";
import { initDatabases, closeDatabases, logAudit } from "./security/database-manager.js";
import { classifyData, shouldEscalate } from "./security/data-classifier.js";
import { isParentSnooping, getChildPrivacyResponse, recordConsent, eraseAllData, exportUserData, runRetentionPolicy } from "./security/privacy-guard.js";
import { checkNetwork, getNetworkStatus } from "./resilience/network-detector.js";
import { suppressNoise } from "./audio/noise-suppressor.js";
import { getCurrentBackend, reportClaudeFailure, reportClaudeSuccess, getDegradationAnnouncement } from "./resilience/llm-router.js";
import { cacheSet, cacheGet, cacheGetStale, TTL } from "./resilience/cache-manager.js";
import { enqueueAction, getPendingActions, dequeueAction } from "./resilience/offline-queue.js";
import { isCorrection, recordCorrection, shouldClarify } from "./memory/correction-tracker.js";
import { canSendProactive, recordProactiveSent, detectSaturation, activateSilence, getSilenceLevel, isTotalSilence } from "./tools/attention-budget.js";
import { recordInteractionMetric, isBudgetWarning, isBudgetCritical } from "./monitoring/metrics-collector.js";
import { recordVisit, getVisitorType, shouldProposeRegistration, activateInviteMode, deactivateInviteMode, isInviteMode } from "./persona/visitor-classifier.js";
import { startReplay, recordStep, finishReplay } from "./monitoring/replay.js";
import { startFleetReporter } from "./monitoring/fleet-reporter.js";


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

async function init(): Promise<void> {
    // Initialize cloistered databases (Story 1.4)
    initDatabases();
    claude.registerTool("brave_search", handleWebSearch);
    claude.registerTool("memory_read", handleMemoryRead);
    claude.registerTool("memory_write", handleMemoryWrite);
    claude.registerTool("play_music", handleMusicTool);
    claude.registerTool("reminder", handleReminderTool);
    claude.registerTool("shopping_list", handleShoppingListTool);
    claude.registerTool("calendar", handleCalendarTool);
    claude.registerTool("send_message", handleMessageTool);
    claude.registerTool("life_journal", handleJournalTool);
    claude.registerTool("gamification", handleGamificationTool);
    claude.registerTool("ambient", handleAmbientTool);

    startDashboard();
    loadPersonas();
    startMedicationScheduler();
    startProactiveScheduler();
    startHAWebhookServer();
    startReminderChecker();

    // Story 11.5: Start fleet reporter
    startFleetReporter();

    // Story 10.1: Periodic network check + offline queue replay
    setInterval(async () => {
        const wasOffline = !getNetworkStatus();
        await checkNetwork();
        const isNowOnline = getNetworkStatus();

        // Replay queued actions when network returns
        if (wasOffline && isNowOnline) {
            const pending = getPendingActions();
            for (const action of pending) {
                try {
                    if (action.type === "send_message") {
                        await handleMessageTool(action.payload as Record<string, string>);
                        dequeueAction(action.id);
                        log.info("Offline action replayed", { id: action.id, type: action.type });
                    }
                } catch (err) {
                    log.warn("Offline replay failed", { id: action.id });
                }
            }
            if (pending.length > 0) {
                await speakTTS("J'ai envoye les messages que tu m'avais demandes tout a l'heure.");
            }
        }
    }, 30000);
}

// =====================================================================
// UTILS
// =====================================================================

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isGoodbye(text: string): boolean {
    const lower = text.toLowerCase().trim();
    return GOODBYE_WORDS.some(phrase => lower.includes(phrase));
}

// =====================================================================
// TTS
// =====================================================================

async function speakTTS(text: string): Promise<void> {
    try {
        const wavBuffer = await synthesize(text);
        await playAudioBytes(wavBuffer.toString("base64"));
    } catch (err) {
        console.error("[TTS] Error:", err);
    }
}

async function speakTTSStreaming(sentenceQueue: AsyncIterable<string>): Promise<void> {
    let pendingWav: Promise<Buffer> | null = null;

    for await (const sentence of sentenceQueue) {
        if (sentence.trim().length <= 3) continue;

        if (pendingWav) {
            const readyWav = await pendingWav;
            pendingWav = synthesize(sentence);
            try {
                await playAudioBytes(readyWav.toString("base64"));
            } catch (err) {
                console.error("[TTS-STREAM] Play error:", err);
            }
        } else {
            try {
                const wav = await synthesize(sentence);
                await playAudioBytes(wav.toString("base64"));
            } catch (err) {
                console.error("[TTS-STREAM] First sentence error:", err);
            }
            continue;
        }
    }

    if (pendingWav) {
        try {
            const wavBuffer = await pendingWav;
            await playAudioBytes(wavBuffer.toString("base64"));
        } catch (err) {
            console.error("[TTS-STREAM] Final play error:", err);
        }
    }
}

// =====================================================================
// MAIN LOOPS
// =====================================================================

async function idleLoop(): Promise<void> {
    console.log("\n[IDLE] En attente du wake word...");

    if (isDNDActive()) {
        console.log("[IDLE] DND mode active, skipping...");
        setAudioBusy(false);
        await sleep(5000);
        return;
    }

    setAudioBusy(true);

    try {
        const wakeword = await waitForWakeword();
        if (!wakeword.detected) {
            setAudioBusy(false);
            return;
        }

        const corrId = newCorrelationId();
        log.info("Wake word detected", { score: wakeword.score, correlationId: corrId });
        await playAudioFile(`${ASSETS_DIR}/oui.wav`);
        await conversationLoop();
    } catch (err) {
        // Graceful handling of audio server timeouts
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("fetch failed") || errMsg.includes("Timeout")) {
            console.log("[IDLE] Audio server timeout, retrying...");
        } else {
            console.error("[IDLE] Error:", err);
        }
    }

    setAudioBusy(false);
}

async function conversationLoop(): Promise<void> {
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
            } else {
                console.log("[REC] Pas de parole détectée, retour au wake word");
            }
            break;
        }

        console.log(`[REC] Audio capturé : ${recorded.duration_ms}ms`);

        // STT + Speaker ID in parallel
        const rawWavBuffer = Buffer.from(recorded.wav_base64, "base64");
        // Story 3.1: Apply noise suppression before STT
        const wavBuffer = suppressNoise(rawWavBuffer);
        const [transcription, speaker] = await Promise.all([
            transcribeLocal(wavBuffer),
            identifySpeaker(recorded.wav_base64).catch(() => "unknown"),
        ]);

        if (speaker && speaker !== "unknown") {
            log.info("Speaker identified", { speaker });
            setLogSpeaker(speaker);
            startReplay(speaker);
            setCurrentPersona(speaker);
            claude.clearHistory();
        } else if (speaker === "unknown") {
            handleUnknownVoiceAtNight().catch(() => {});
            recordVisit(speaker);
            startReplay("unknown");
        }

        if (!transcription || transcription.trim().length === 0) {
            console.log("[STT] Transcription vide");
            if (!isFirstTurn) continue;
            break;
        }

        log.info("STT transcription", { text: transcription });
        recordStep("stt", { text: transcription, durationMs: Date.now() });

        // --- EMERGENCY (#86) ---
        if (isEmergencyPhrase(transcription)) {
            console.log("[EMERGENCY] Detected!");
            const response = await handleEmergency(transcription);
            await speakTTS(response);
            break;
        }

        // --- DISTRESS (always priority) ---
        if (isDistressPhrase(transcription)) {
            console.log("[DISTRESS] Detected!");
            const response = await handleDistress(transcription);
            await speakTTS(response);
            break;
        }

        // --- SLEEP TRACKING (#72) ---
        if (/bonne nuit|dors bien/i.test(transcription)) {
            logSleepEvent(speaker, "goodnight");
        } else if (/bonjour|bon matin/i.test(transcription) && isFirstTurn) {
            logSleepEvent(speaker, "goodmorning");
        }

        // --- GOODBYE (only in follow-up turns) ---
        if (!isFirstTurn && isGoodbye(transcription)) {
            console.log("[END] Goodbye détecté");
            await playAudioFile(`${ASSETS_DIR}/goodbye.wav`);
            break;
        }

        // --- VOICE REGISTRATION (explicit request) ---
        if (/enregistre.*voix|apprends.*voix|m[eé]morise.*voix/i.test(transcription)) {
            await handleVoiceRegistrationFlow();
            break;
        }

        // --- ONBOARDING (unknown speaker, first turn) ---
        if (isFirstTurn && speaker === "unknown" && shouldTriggerOnboarding(speaker)) {
            console.log("[ONBOARDING] Unknown voice detected, starting onboarding");
            markOnboardingAttempt();
            const result = await runOnboarding();
            if (result?.success) {
                setCurrentPersona(result.cleanName);
                // After onboarding, go back to idle (they can talk next time)
            }
            break;
        }

        // --- PROCESS ---
        await handleTranscription(transcription, speaker);

        if (!FOLLOW_UP_ENABLED) break;
        isFirstTurn = false;
    }

    console.log("[CONV] Fin de conversation, retour au wake word\n");
}

async function handleTranscription(transcription: string, speaker: string = "unknown"): Promise<void> {
    // Story 2.1: Add user exchange to session sliding window
    addUserExchange(speaker, transcription);

    // Story 2.3: Resolve anaphora before intent classification
    const anaphora = resolveAnaphora(transcription, speaker);
    if (anaphora.resolved && anaphora.modifiedText) {
        transcription = anaphora.modifiedText;
    }
    const t0 = Date.now();

    trackInteraction();
    addMemory(transcription).catch(() => {});
    logDailyInteraction(speaker, transcription);

    const { isRepetition } = checkRepetition(transcription);
    if (isRepetition) {
        trackRepeatedQuestion();
        console.log("[REPETITION] Repeated question detected");
    }

    const intent = await classifyIntent(transcription);
    log.info("Intent classified", { intent: intent.intent, category: intent.category, confidence: intent.confidence, latencyMs: intent.latency_ms });
    recordStep("intent", { intent: intent.intent, category: intent.category, confidence: intent.confidence, latencyMs: intent.latency_ms });

    // Story 2.3: Track last intent for anaphora resolution
    updateLastIntent(speaker, intent.intent, intent.category);

    // Story 4.1: Auth Gate — check permission BEFORE processing
    const authResult = checkAuth(intent.category, speaker);
    if (!authResult.allowed) {
        log.warn("Auth rejected", { category: intent.category, speaker, reason: authResult.reason });
        await speakTTS(authResult.reason || "Desole, je ne peux pas faire ca.");
        return;
    }

    // Story 5.2: Child privacy protection
    if (isParentSnooping(transcription, speaker)) {
        await speakTTS(getChildPrivacyResponse());
        return;
    }

    // Story 8.1: Detect corrections and learn
    if (isCorrection(transcription)) {
        const session = getSession(speaker);
        if (session.lastAction) {
            const memContent = recordCorrection(speaker, session.lastAction, transcription, intent.category);
            if (memContent) {
                addMemory(memContent).catch(() => {});
            }
        }
    }

    // Story 8.2: Check if clarification is needed
    const clarification = shouldClarify(speaker, transcription, intent.category);
    if (clarification) {
        await speakTTS(clarification + ", ou tu veux autre chose ?");
        return;
    }

    // Story 9.3: Detect saturation signals
    detectSaturation(speaker, transcription);

    // Story 9.4: Handle silence commands
    const silenceLower = transcription.toLowerCase().trim();
    if (/pas maintenant/i.test(silenceLower)) {
        activateSilence(speaker, 1);
        await speakTTS("OK, je me tais. Appelle-moi si tu as besoin.");
        return;
    }
    if (/soir[eé]e tranquille/i.test(silenceLower)) {
        activateSilence(speaker, 2);
        await speakTTS("Bonne soiree tranquille. Je reste dispo si tu m'appelles.");
        return;
    }
    if (/silence total/i.test(silenceLower)) {
        activateSilence(speaker, 3);
        await speakTTS("Silence total. Seul le mot urgence me reveillera. Bonne nuit.");
        return;
    }

    // Story 7.5: Invite mode activation
    if (/on a des invit[eé]s|mode invit[eé]/i.test(silenceLower)) {
        activateInviteMode();
        await speakTTS("Mode invite active. Je serai discrete et polie.");
        return;
    }
    if (/mode normal/i.test(silenceLower) && isInviteMode()) {
        deactivateInviteMode();
        await speakTTS("Mode normal reactive !");
        return;
    }

    // Story 5.4: Right to erasure
    if (/oublie[- ]?moi|supprime tout/i.test(silenceLower)) {
        await speakTTS("Tu es sur ? Je vais oublier tout ce qu'on a vecu ensemble. C'est definitif. Confirme en disant oui.");
        // Note: actual confirmation handling would need a follow-up turn
        return;
    }

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
        playAudioFile(filler.primary).catch(() => {});
    }

    // Reload memory for current speaker
    const freshMemory = await getMemorySummary();
    claude.setMemorySummary(freshMemory);
    // Story 2.2: Inject session context (sliding window + system state)
    const sessionContext = buildSessionContext(speaker);
    claude.setSessionContext(sessionContext);

    // Claude streaming + TTS (single-pass)
    console.log("[CLAUDE] Asking (streaming)...");

    let resolveNext: ((value: IteratorResult<string>) => void) | null = null;
    let sentenceDone = false;
    const sentenceQueue: string[] = [];

    const asyncSentenceIterable: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
            return {
                next(): Promise<IteratorResult<string>> {
                    if (sentenceQueue.length > 0) {
                        return Promise.resolve({ value: sentenceQueue.shift()!, done: false });
                    }
                    if (sentenceDone) {
                        return Promise.resolve({ value: undefined as any, done: true });
                    }
                    return new Promise((resolve) => { resolveNext = resolve; });
                }
            };
        }
    };

    function pushSentence(sentence: string) {
        if (resolveNext) {
            const r = resolveNext;
            resolveNext = null;
            r({ value: sentence, done: false });
        } else {
            sentenceQueue.push(sentence);
        }
    }

    function finishSentences() {
        sentenceDone = true;
        if (resolveNext) {
            const r = resolveNext;
            resolveNext = null;
            r({ value: undefined as any, done: true });
        }
    }

    // Story 10.4: LLM Router — fallback multi-niveaux
    const backend = getCurrentBackend();
    let fullResponse = "";

    if (backend === "claude") {
        try {
            const claudePromise = claude.chatStreaming(
                transcription,
                (sentence: string, isFirst: boolean) => {
                    log.debug("Claude stream", { first: isFirst, sentence: sentence.slice(0, 50) });
                    pushSentence(sentence);
                }
            ).then((resp) => {
                finishSentences();
                reportClaudeSuccess();
                return resp;
            });

            const ttsPromise = speakTTSStreaming(asyncSentenceIterable);
            const [claudeResp] = await Promise.all([claudePromise, ttsPromise]);
            fullResponse = claudeResp || "";
        } catch (err) {
            log.warn("Claude API failed, falling back", { error: err instanceof Error ? err.message : String(err) });
            reportClaudeFailure();
            finishSentences();
            // Fallback to local response
            const degradeMsg = getDegradationAnnouncement();
            if (degradeMsg) await speakTTS(degradeMsg);
            await speakTTS("Je n'ai pas pu repondre a ca pour le moment.");
            return;
        }
    } else if (backend === "qwen-local") {
        // Qwen local fallback (basic response via rkllama)
        const degradeMsg = getDegradationAnnouncement();
        if (degradeMsg) await speakTTS(degradeMsg);
        finishSentences();
        await speakTTS("Je suis en mode economique. Pose-moi des questions simples.");
        return;
    } else {
        // intent-only mode
        finishSentences();
        await speakTTS("J'ai quelques soucis. Je peux te donner l'heure ou mettre de la musique.");
        return;
    }

    if (!fullResponse || fullResponse.trim().length === 0) {
        await speakTTS("Desole, je n'ai pas pu repondre.");
        return;
    }

    log.info("Claude response", { length: fullResponse.length, backend });
    // Story 2.1: Track assistant response in session
    addAssistantExchange(speaker, fullResponse);
    recordStep("response", { length: fullResponse.length, backend });
    finishReplay();

    logInteraction({
        timestamp: new Date().toISOString(),
        speaker, transcription,
        intent: intent.intent, category: intent.category,
        response: fullResponse,
        latencyMs: Date.now() - t0,
    });
}

// =====================================================================
// VOICE REGISTRATION (explicit)
// =====================================================================

async function handleVoiceRegistrationFlow(): Promise<void> {
    try {
        const result = await runVoiceRegistration();
        if (result?.success) {
            setCurrentPersona(result.name);
        }
    } catch (err) {
        console.error("[REGISTER] Error:", err);
        await speakTTS("Désolé, une erreur est survenue pendant l'enregistrement.");
    }
}

// =====================================================================
// MAIN
// =====================================================================

async function main(): Promise<void> {
    console.log("[DIVA] Starting v6 — Personality + Onboarding + Single-pass streaming...");
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

    try { execSync("pkill -9 arecord || true", { timeout: 3000 }); } catch {}
    console.log("[INIT] Cleaned up old processes");

    console.log("[DIVA] Ready!");
    while (true) {
        try {
            await idleLoop();
        } catch (error) {
            console.error("[MAIN] Error:", error);
            await sleep(2000);
        }
    }
}

const shutdown = () => {
    log.info("Shutting down...");
    closeDatabases();
    process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
    console.error("[DIVA] Fatal error:", err);
    process.exit(1);
});
