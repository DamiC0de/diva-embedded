/**
 * index.ts — Diva Embedded Voice Assistant (HTTP Architecture)
 * v6: Personality, interactive onboarding, single-pass streaming
 */
import "dotenv/config";
import { newCorrelationId, getCorrelationId } from "./monitoring/correlation.js";
import { getSession, addUserExchange, addAssistantExchange, updateLastIntent, buildSessionContext, canResumeConversation, setCorrelationId as setSessionCorrelationId, buildResumptionPrompt, markResumeConsumed, isSecretTrusted, setSecretTrustWindow, recordSpeakerActivity, updateSessionLang } from "./session/session-manager.js";
import { resolveAnaphora } from "./session/anaphora-resolver.js";
import { buildFullContext, setServiceContext } from "./session/context-injector.js";
// Story 1.9: Service context transmission between internal services
import { detectServiceSwitch, buildServiceContext, serializeForHeader } from "./session/service-context-builder.js";
import { activeActionRegistry } from "./session/active-action-registry.js";
import { audioDucker } from "./audio/audio-ducker.js";
// Story 1.8: Aide a la formulation et completion vocale predictive
import { HesitationDetector } from "./session/hesitation-detector.js";
import { FormulationHelper } from "./session/formulation-helper.js";
import { PredictiveCompleter } from "./session/predictive-completer.js";
import { RequestPatternStore } from "./session/request-pattern-store.js";
import { log, setLogSpeaker } from "./monitoring/logger.js";
import { execSync } from "node:child_process";
import { waitForWakeword, recordAudio, playAudioFile, playAudioBytes, checkHealth, combineAudioBuffers, pcmToWavBase64, detectWakewordPosition, stopProcessingFeedback, muteMic, unmuteMic, } from "./audio/audio-client.js";
import { transcribeLocal } from "./stt/local-npu.js";
import { ClaudeStreamingClient } from "./llm/claude-streaming.js";
import { classifyIntent, handleLocalIntent } from "./routing/intent-router.js";
import { parseMultiRequests } from "./routing/multi-request-parser.js";
import { handleMultiRequest } from "./routing/multi-request-handler.js";
// Story 1.7: Implicit & natural confirmations
import { formatConfirmation } from "./routing/confirmation-formatter.js";
import { sanitizeConfirmation } from "./routing/confirmation-sanitizer.js";
import { handleWebSearch } from "./tools/searxng-search.js";
import { handleMemoryRead, handleMemoryWrite, getMemorySummary, addMemory, identifySpeakerWithScore, } from "./tools/memory-tool.js";
import { trackIdentification, analyzeCurrentSession, startNewSession } from "./persona/voice-drift-detector.js";
import { chooseContextualFiller, scheduleFillers } from "./audio/filler-manager.js";
import { isDNDActive } from "./tools/dnd-manager.js";
import { setAudioBusy } from "./audio/audio-lock.js";
import { synthesize } from "./tts/piper.js";
import { setCurrentPersona, loadPersonas, getCurrentPersona, isIntentAllowed, updatePersonaPrefs, updatePreferredLang, getPreferredLang } from "./persona/engine.js";
import { runVoiceRegistration } from "./persona/registration.js";
import { runOnboarding, shouldTriggerOnboarding, markOnboardingAttempt } from "./persona/onboarding.js";
import { startDashboard, logInteraction } from "./dashboard/server.js";
import { startHAWebhookServer } from "./smarthome/ha-notifications.js";
import { waitForHA, startHAHealthCheck } from "./smarthome/ha-connector.js";
// Story 3.9: Satellite management and room context injection
import { DEFAULT_ROOM_ID } from "./satellite/satellite-manager.js";
import { startMedicationScheduler } from "./elderly/medication-manager.js";
import { startProactiveScheduler, trackInteraction, trackRepeatedQuestion } from "./elderly/proactive-scheduler.js";
// Story 29.1: Proactive scheduler loop for timing-aware message delivery
import { ProactiveSchedulerLoop } from "./tools/proactive-scheduler-loop.js";
let proactiveLoop = null;
// Story 29.2: Anticipation engine for proactive reminders
import { initAnticipationEngine } from "./tools/anticipation-engine.js";
import { getUpcomingMedications } from "./elderly/medication-manager.js";
import { getUpcomingEventsWithinMinutes } from "./calendar/google-calendar.js";
import { isDistressPhrase, handleDistress } from "./elderly/distress-detector.js";
import { checkRepetition } from "./elderly/repetition-tracker.js";
import { handleMusicTool, initMusicTool, setCurrentSpeaker as setMusicSpeaker, setLocalPlayer } from "./music/music-tool.js";
import { MusicProfileManager } from "./music/music-profile.js";
// Story 24.2: Alarm manager and scheduler
import { AlarmManager } from "./tools/alarm-manager.js";
import { AlarmScheduler } from "./tools/alarm-scheduler.js";
import { setAlarmScheduler } from "./tools/alarm-scheduler-singleton.js";
import { LocalPlayer } from "./music/local-player.js";
import { handleReminderTool, startReminderChecker } from "./tools/reminder-manager.js";
import { handleShoppingListTool } from "./tools/shopping-list-tool.js";
import { handleCalendarTool } from "./calendar/google-calendar.js";
// Story 24.3: CalendarManager, ShoppingListManager, ImplicitIntentDetector
import { getCalendarManager } from "./calendar/calendar-manager.js";
import { getShoppingListManager } from "./tools/shopping-list-manager.js";
import { getImplicitIntentDetector } from "./routing/implicit-intent-detector.js";
import { handleMessageTool, MessageSender } from "./messaging/sender.js";
// Story 24.4: Messaging modules — email, SMS, contacts, queue
import { ContactManager } from "./messaging/contact-manager.js";
import { EmailSender } from "./messaging/email-sender.js";
import { SmsSender } from "./messaging/sms-sender.js";
import { MessageQueueProcessor } from "./messaging/queue-processor.js";
import { isEmergencyPhrase, handleEmergency, handleUnknownVoiceAtNight } from "./companion/safety.js";
import { handleJournalTool, logDailyInteraction, logSleepEvent } from "./companion/life-journal.js";
import { handleGamificationTool } from "./companion/gamification.js";
import { handleAmbientTool } from "./companion/ambient.js";
// === Deep Integration Imports ===
import { checkAuth, onAuthDenied } from "./security/auth-gate.js";
// Story 3.8: Permission mediation imports
import { waitForAdminResponse, executeApprovedAction, getPendingMediation, auditMediation } from "./household/permission-mediator.js";
import { shouldInjectPersonalData } from "./security/localhost-guard.js";
import { initDatabases, closeDatabases, logAudit, runStartupMigrations } from "./security/database-manager.js";
import { startRetentionScheduler, migrateExistingDataLevels } from "./security/retention-manager.js";
import { initBackupScheduler } from "./security/backup-manager.js";
import { startConsentRenewalScheduler } from "./security/consent-manager.js";
import { startErasureChecker } from "./security/data-erasure.js";
// Story 8.4: RGPD compliance — processing registry, DPIA, breach detector
import { initializeRegistry } from "./security/processing-registry.js";
import { generateAllDpias } from "./security/dpia-generator.js";
import { startBreachMonitor } from "./security/breach-detector.js";
import { isParentSnooping, getChildPrivacyResponse } from "./security/privacy-guard.js";
import { checkNetwork, getNetworkStatus } from "./resilience/network-detector.js";
import { setCurrentRegister, getCurrentAdaptation, resetRegister } from "./audio/vocal-register.js";
import { prosodyToInitialMode, fuseMode, setCurrentMode, resetMode } from "./audio/wakeword-prosody.js";
import { suppressNoise } from "./audio/noise-suppressor.js";
import { cancelEcho, markOutputStart, markOutputEnd, isDivaOutputting, getReferenceBuffer } from "./audio/echo-canceller.js";
import { getCurrentBackend, reportClaudeFailure, reportClaudeSuccess, getDegradationAnnouncement } from "./resilience/llm-router.js";
import { getPendingActions, dequeueAction } from "./resilience/offline-queue.js";
import { isCorrection, recordCorrection, shouldClarify, buildCorrectionContext, initCorrectionTracker } from "./memory/correction-tracker.js";
import { detectSaturation, activateSilence } from "./tools/attention-budget.js";
import { recordVisit, activateInviteMode, deactivateInviteMode, isInviteMode, ensureVisitorSchema, loadVisitorsFromDb, purgeOldVisitors, VISITOR_PURGE_DAYS, getVisitorRecord } from "./persona/visitor-classifier.js";
// Story 3.6: Proactive visitor greeting, social refusals, returning visitor greetings
import { shouldGreet, greetUnknownVoice, handleVisitorNameResponse, getGuestRefusalMessage, getReturningVisitorGreeting, getRegistrationProposal, isAwaitingVisitorName, setAwaitingVisitorName, getAdminGreetingName } from "./household/visitor-greeter.js";
import { startReplay, recordStep, finishReplay } from "./monitoring/replay.js";
import { startFleetReporter } from "./monitoring/fleet-reporter.js";
import { startProductionDashboard } from "./dashboard-prod/server.js";
import { runFullDiscovery } from "./smarthome/auto-discover.js";
// Story 13.2: Device watcher for proactive new device detection
import { HADeviceWatcher } from "./smarthome/ha-device-watcher.js";
import { recordAction as recordDomoticAction, getProposal } from "./smarthome/emergent-automations.js";
// Removed: getWasteAlerts, getEcoSuggestion, trackConsumption — not exported from eco-coach
// Story 14.2: Energy Monitor and Eco-coach
import { startMonitoring as startEnergyMonitoring } from "./smarthome/energy-monitor.js";
import { initialize as initEcoCoach } from "./smarthome/eco-coach.js";
// Story 14.3: LED expressive feedback system
import { getLedStateManager } from "./feedback/led-state-manager.js";
import { getLedPatternEngine } from "./feedback/led-pattern-engine.js";
import { createLedDriver } from "./feedback/led-controller.js";
import { buildQwenDomotiquePrompt, parseQwenResponse } from "./smarthome/domotique-router.js";
import { detectModeFromText, activateMode, initDefaultModes } from "./smarthome/modes-manager.js";
// Story 16.1: Enhanced mode manager + trigger resolver
import { loadModes as loadHomeModes } from "./smarthome/mode-manager.js";
import { loadTriggers as loadModeTriggers, resolve as resolveModeTrigger } from "./smarthome/mode-trigger-resolver.js";
import { detectRoutineTrigger, executeRoutine as executeRoutineLegacy } from "./smarthome/routine-manager.js";
// Story 16.2: Conversational routines — manager, scheduler, trigger resolver
import { loadRoutines as loadConversationalRoutines, executeRoutine as executeConversationalRoutine } from "./tools/routine-manager.js";
import { loadTriggers as loadRoutineTriggers, resolveVocalTrigger as resolveRoutineVocalTrigger } from "./tools/routine-trigger-resolver.js";
import { start as startRoutineScheduler, stop as stopRoutineScheduler } from "./tools/routine-scheduler.js";
import { pushAction, undo as undoDomotique, isUndoAvailable, correctAssignment } from "./smarthome/domotique-undo.js";
import { canControlDevice, getChildDenialMessage } from "./smarthome/child-access-control.js";
import { checkForAlerts, formatVocalAlert } from "./smarthome/domotique-alerts.js";
import { getWeatherSuggestion } from "./smarthome/meteo-domotique.js";
import { getLowBatteryDevices } from "./smarthome/device-health.js";
import { checkBadges } from "./smarthome/gamification-eco.js";
import { isFoyerConfigured, getMembers, getFoyer, ensureSchema as ensureFoyerSchema, getPreInscritMembers } from "./household/foyer-manager.js";
import { shouldTriggerOOBE, runOOBE, runOOBEReprompt, checkPreConfigBoot } from "./household/oobe-flow.js";
import { getDiscoveryPrompt, isDiscoveryComplete, markCapabilityRevealed, initDiscovery, derivePersonaTypeFromAge, deriveContentFilterFromAge, ensureDiscoverySchema, getScheduleForType, filterByContentFilter } from "./persona/discovery-guide.js";
// Story 3.4: Speaker resolution chain and foyer-persona sync
import { resolveSpeaker, syncFoyerPersonas } from "./household/speaker-resolver.js";
// Story 3.5: Background voice collection and automatic voice-profile linking
import { backgroundCollector, cleanupTemporaryVoiceprints } from "./household/background-voice-collector.js";
import { getSpeakerMessage } from "./household/speaker-messages.js";
import { registerHouseholdNames, setSpeakerChildMode } from "./stt/groq-cloud.js";
// Story 3.10: Language detection
import { detect as detectLang, setPreferredLangUpdater, setPreferredLangGetter, trackLanguageUsage, logMultilingualConfig } from "./stt/language-detector.js";
import { generateBridgeResponse, buildBridgeContextTag, shouldSkipBridgeForMode } from "./llm/qwen-bridge.js";
// Story 11.4: Centralized LLM Router
import { route as llmRoute } from "./llm/llm-router.js";
import { recordRouteDecision } from "./monitoring/metrics-collector.js";
import { ensureNetworkConnection } from "./onboarding/wifi-manager.js";
import { generateQRImage } from "./onboarding/qr-generator.js";
// Story 22.2 Task 6.1: Boot type detection before all services
import { detectBootType as detectBootTypeForInit } from "./onboarding/boot-type-detector.js";
// Story 6.1: Memory recall, fact extraction, callback management
import { recallRelevantMemories } from "./memory/memory-recall.js";
import { extractAndSaveFacts } from "./memory/fact-extractor.js";
// Story 6.2: Preference extraction, date extraction, preference manager
import { extractAndSavePreferences } from "./memory/preference-extractor.js";
import { extractAndSaveDates } from "./memory/date-extractor.js";
import { getActivePreferences, formatPreferencesForPrompt } from "./memory/preference-manager.js";
import { getUpcomingDates } from "./memory/date-extractor.js";
import { createDateReminder } from "./tools/reminder-manager.js";
import { shouldInsertCallback, getRemainingCallbacks, getCallbackLevelSync, touchSession as touchCallbackSession } from "./memory/callback-manager.js";
// Story 6.3: Conversational alias resolution
import { resolveConversationalAliases, formatAliasContextForPrompt } from "./memory/conversational-alias-resolver.js";
import { aliasDisambiguator } from "./memory/alias-disambiguation.js";
// Story 6.4: Contextual humor engine and detector
import { buildHumorContext, markHumorUsed, resetHumorTracking } from "./companion/humor-engine.js";
import { detectAndLogHumor } from "./companion/humor-detector.js";
// Story 6.5: Transparency — rationale log, transparency detection, heuristic correction
import { recordRationale, getLastRationale, findRationale } from "./memory/action-rationale-log.js";
import { isTransparencyQuestion, extractActionReference, formatTransparencyPrompt, formatContestationPrompt, getMatchedPattern } from "./memory/transparency-detector.js";
import { isHeuristicContestation, processHeuristicCorrection } from "./memory/heuristic-corrector.js";
// Story 9.1: Watchdog health check & alert endpoints
import { startHealthServer, setMonitoringHandler, setTextInputHandler, onServiceFailed, onServiceRecovered } from "./monitoring/health-check.js";
// Story 9.2: Degradation announcer
import { degradationAnnouncer } from "./resilience/degradation-announcer.js";
// Story 10.4: System monitoring, alerts, token tracking, quality metrics
import { SystemMetricsCollector } from "./monitoring/system-metrics-collector.js";
import { AlertManager } from "./monitoring/alert-manager.js";
import { TokenTracker } from "./monitoring/token-tracker.js";
import { QualityMetricsAggregator } from "./monitoring/quality-metrics.js";
import { MetricsPurger } from "./monitoring/metrics-purger.js";
import { createMonitoringHandler } from "./monitoring/monitoring-endpoints.js";
import { MqttFleetReporter } from "./monitoring/fleet-reporter.js";
// Story 3.13: Household messaging
import { HouseholdMessaging } from "./messaging/household-messaging.js";
import { handleHouseholdMessage } from "./messaging/household-message-handler.js";
// =====================================================================
// CONFIG
// =====================================================================
const FOLLOW_UP_ENABLED = true;
const ASSETS_DIR = "/opt/diva-embedded/assets";
// Story 1.7: Implicit confirmations module — disable via env to bypass
const IMPLICIT_CONFIRMATIONS = process.env.IMPLICIT_CONFIRMATIONS !== "false";
// Story 1.8: Formulation help — disable via env to bypass all hesitation/completion modules
const FORMULATION_HELP_ENABLED = process.env.FORMULATION_HELP_ENABLED !== "false";
// Story 1.9: Service context transmission — disable via env to bypass switch detection + duck
const SERVICE_CONTEXT_ENABLED = process.env.SERVICE_CONTEXT_ENABLED !== "false";
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
// Story 1.8: Formulation help modules (instantiated at startup, passive listeners)
const requestPatternStore = new RequestPatternStore();
const hesitationDetector = new HesitationDetector();
const formulationHelper = new FormulationHelper(requestPatternStore, {
    dndCheck: () => isDNDActive(),
    personaCheck: () => {
        try {
            const persona = getCurrentPersona();
            // Check persona for formulationHelp flag (default: true)
            return persona.formulationHelp !== false;
        }
        catch {
            return true;
        }
    },
    claudeCallback: FORMULATION_HELP_ENABLED ? async (prompt) => {
        try {
            const response = await claude.chat(prompt);
            return response || null;
        }
        catch {
            return null;
        }
    } : undefined,
});
const predictiveCompleter = new PredictiveCompleter(requestPatternStore);
// Story 1.8: Connect hesitation detector to formulation helper
if (FORMULATION_HELP_ENABLED) {
    hesitationDetector.onHesitation(async (event) => {
        try {
            const session = getSession(event.speakerId);
            const ctx = {
                musicPlaying: session.state.musicPlaying,
                activeTimers: session.state.activeTimers,
                lastIntent: session.lastIntent,
                lastCategory: session.lastCategory,
            };
            const suggestion = await formulationHelper.generateSuggestion(event, ctx);
            if (suggestion) {
                await speakTTS(suggestion.text);
            }
        }
        catch (err) {
            log.warn("Hesitation handler error (non-blocking)", {
                error: err instanceof Error ? err.message : String(err),
                correlationId: event.correlationId,
            });
        }
    });
}
// =====================================================================
// INIT
// =====================================================================
async function init() {
    // Story 22.2 Task 6.1: Detect boot type BEFORE any other service
    const initBootType = detectBootTypeForInit();
    log.info("Boot type detected", { bootType: initBootType });
    // Audio announcement handled by wifi-manager.ts playAudioDirect() instead
    // announceBootForInit(initBootType).catch(() => {});
    // Story 10.2: Run integrity checks + versioned migrations BEFORE opening DBs
    try {
        await runStartupMigrations();
    }
    catch (err) {
        log.warn("Migration errors during startup (non-blocking for brownfield)", {
            error: err instanceof Error ? err.message : String(err),
        });
        // Don't block startup — brownfield databases may have schema mismatches
    }
    // Initialize cloistered databases (Story 1.4)
    initDatabases();
    // Story 3.13: Initialize household messaging
    const { getCompanionDb: getDb } = await import("./security/database-manager.js");
    const householdMessaging = new HouseholdMessaging(getDb());
    householdMessaging.startCleanupScheduler();
    globalThis.__householdMessaging = householdMessaging;
    // Story 24.4: Initialize external messaging (email/SMS/contacts/queue)
    try {
        const divaDb = getDb();
        const contactMgr = new ContactManager(divaDb);
        const emailSdr = new EmailSender();
        const smsSdr = new SmsSender();
        const queueProc = new MessageQueueProcessor(divaDb, emailSdr, smsSdr);
        const msgSender = new MessageSender({
            contactManager: contactMgr,
            emailSender: emailSdr,
            smsSender: smsSdr,
            queueProcessor: queueProc,
            auditFn: (speakerId, action, status, details) => {
                try {
                    logAudit(action, "critical", speakerId, status, undefined, details);
                }
                catch { /* non-blocking */ }
            },
        });
        // Listen for network restoration to process queued messages
        const { networkDetector } = await import("./resilience/network-detector.js");
        networkDetector.on("network.status-changed", (evt) => {
            if (evt.newStatus === "online") {
                queueProc.processQueue().catch((err) => {
                    log.warn("Queue processing on network restore failed", {
                        error: err.message,
                    });
                });
            }
        });
        globalThis.__messageSender = msgSender;
        globalThis.__contactManager = contactMgr;
        globalThis.__queueProcessor = queueProc;
        log.info("External messaging initialized (Story 24.4)");
    }
    catch (err) {
        log.error("External messaging init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 8.1: Migrate existing data levels and start retention scheduler
    try {
        migrateExistingDataLevels();
        startRetentionScheduler();
    }
    catch (err) {
        log.error("Retention system init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 8.3: Start consent renewal scheduler and erasure checker
    try {
        startConsentRenewalScheduler();
        startErasureChecker();
    }
    catch (err) {
        log.error("Consent/erasure system init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 8.4: Initialize RGPD processing registry, DPIAs, and breach monitor
    try {
        initializeRegistry();
        generateAllDpias();
        startBreachMonitor();
    }
    catch (err) {
        log.error("RGPD compliance system init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 4.4: Initialize daily encrypted backup scheduler
    try {
        initBackupScheduler();
    }
    catch (err) {
        log.error("Backup scheduler init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 24.1: Initialize music profile manager
    try {
        const DATA_DIR = process.env.DIVA_DATA_DIR || "/opt/diva-embedded/data";
        const musicProfileManager = new MusicProfileManager(`${DATA_DIR}/diva.db`);
        initMusicTool(musicProfileManager);
        log.info("MusicProfileManager initialized");
    }
    catch (err) {
        log.error("MusicProfileManager init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 9.4: Initialize LocalPlayer and inject into music-tool
    try {
        const localMusicPlayer = new LocalPlayer();
        setLocalPlayer(localMusicPlayer);
        localMusicPlayer.startWatching();
        log.info("LocalPlayer initialized", { data: { tracks: localMusicPlayer.getTrackCount() } });
    }
    catch (err) {
        log.error("LocalPlayer init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
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
    // Story 6.4 / Task 4: toggleHumor tool handler
    claude.registerTool("toggleHumor", async (input) => {
        const enabled = String(input.enabled) === "true" || input.enabled === true;
        const speaker = getCurrentPersona()?.id || "guest";
        const result = updatePersonaPrefs(speaker, { humor: enabled });
        log.info("Humor toggled", { speakerId: speaker, humorEnabled: enabled, source: "vocal" });
        if (result) {
            return JSON.stringify({ success: true, humorEnabled: enabled });
        }
        return JSON.stringify({ success: false, reason: "Persona not found" });
    });
    startDashboard();
    // Story 19.3: Initialize eco-gamification module
    try {
        const { getCompanionDb } = await import("./security/database-manager.js");
        const ecoGamification = await import("./companion/eco-gamification.js");
        const companionDb = getCompanionDb();
        // Try loading eco-coach for enhanced features (graceful degradation)
        let ecoCoach = null;
        try {
            const ecoCoachModule = await import("./smarthome/eco-coach.js");
            if (ecoCoachModule) {
                ecoCoach = {
                    getConsumptionData: () => null,
                    getWasteAlerts: () => [],
                    getEstimatedSavings: () => null,
                };
            }
        }
        catch { /* eco-coach not available */ }
        ecoGamification.initialize(companionDb, ecoCoach);
        // Inject child check using persona engine
        const { getPersona: getPersonaForEco } = await import("./persona/engine.js");
        ecoGamification.setChildCheck((speakerId) => {
            const p = getPersonaForEco(speakerId);
            return p?.type === "child";
        });
        // Inject module reference into system-prompt for context injection
        try {
            const { setEcoGamificationModule } = await import("./llm/system-prompt.js");
            setEcoGamificationModule(ecoGamification);
        }
        catch { /* non-critical */ }
        log.info("Eco-gamification initialized");
    }
    catch (err) {
        log.warn("Eco-gamification init failed (non-critical)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 10.4: Initialize monitoring system (system metrics, alerts, tokens, quality, purge)
    try {
        const { getMetricsDb } = await import("./security/database-manager.js");
        const metricsDb = getMetricsDb();
        const monAlertManager = new AlertManager(metricsDb);
        monAlertManager.startConfigReload();
        const monConfig = monAlertManager.getConfig();
        const monCollector = new SystemMetricsCollector(metricsDb, monAlertManager, monConfig);
        const monTokenTracker = new TokenTracker(metricsDb, monAlertManager, monConfig);
        const monQualityAggregator = new QualityMetricsAggregator(metricsDb);
        const monPurger = new MetricsPurger(metricsDb, monConfig.retentionDays);
        // Register monitoring HTTP endpoints
        const monHandler = createMonitoringHandler(monCollector, monAlertManager, monTokenTracker, monQualityAggregator);
        setMonitoringHandler(monHandler);
        // Start collectors and schedulers
        monCollector.start();
        monQualityAggregator.startAggregation();
        monPurger.start();
        // Start MQTT fleet reporter if configured
        const mqttReporter = new MqttFleetReporter(monConfig.deviceId);
        mqttReporter.setMetricsProvider(() => {
            const snapshot = monCollector.getLastSnapshot();
            const dailyTokens = monTokenTracker.getDailySummary();
            const todayQuality = monQualityAggregator.getTodayMetrics();
            const unackAlerts = monAlertManager.getUnacknowledgedAlerts();
            return { system: snapshot, tokens: dailyTokens, quality: todayQuality, alerts: unackAlerts };
        });
        monAlertManager.setFleetPusher((alert) => mqttReporter.pushAlert(alert));
        mqttReporter.start().catch(() => { });
        // Expose token tracker globally for claude.ts integration
        globalThis.__divaTokenTracker = monTokenTracker;
        globalThis.__divaQualityAggregator = monQualityAggregator;
        log.info("Monitoring system initialized (Story 10.4)");
    }
    catch (err) {
        log.warn("Monitoring system init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    startHealthServer(); // Story 9.1: Health check server on port 3000 for watchdog
    // Remote text input for testing (bypasses wake word + STT)
    setTextInputHandler(async (text, speaker) => {
        log.info("Text input received", { text, speaker });
        setCurrentPersona(speaker);
        await handleTranscription(text, speaker);
        return "OK — processed via text input";
    });
    // Story 9.2: Connect degradation announcer to watchdog events
    onServiceFailed((alert) => {
        degradationAnnouncer.handleWatchdogAlert({
            service: alert.service,
            status: alert.status,
            restartAttempts: alert.restartAttempts,
            lastError: alert.lastError,
        });
    });
    onServiceRecovered((alert) => {
        degradationAnnouncer.handleWatchdogAlert({
            service: alert.service,
            status: "recovered",
        });
    });
    // Inject persona resolver into degradation announcer
    degradationAnnouncer.setPersonaResolver((speakerId) => {
        const { getPersona } = require("./persona/engine.js");
        const persona = getPersona(speakerId);
        return persona ? { type: persona.type, greetingName: persona.greetingName } : null;
    });
    loadPersonas();
    // Story 3.10: Initialize LanguageDetector — wire preferred lang callbacks
    try {
        setPreferredLangUpdater((speakerId, lang) => {
            updatePreferredLang(speakerId, lang);
        });
        setPreferredLangGetter((speakerId) => {
            return getPreferredLang(speakerId);
        });
        logMultilingualConfig();
    }
    catch (err) {
        log.warn("LanguageDetector init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 20.1 / FR116-FR131: WiFi onboarding — ensure network before proceeding
    // Generates QR code at first boot, then checks/establishes network connectivity
    generateQRImage().catch(() => { }); // Non-blocking QR generation
    const networkReady = await ensureNetworkConnection(() => {
        // Callback when WiFi setup completes asynchronously (after hotspot onboarding)
        log.info("WiFi onboarding complete — continuing init");
        continuePostNetwork();
    });
    if (networkReady) {
        // Network already available (Ethernet or saved WiFi) — continue immediately
        continuePostNetwork();
    }
    else {
        // WiFi onboarding in progress — wait for callback
        log.info("Waiting for WiFi onboarding to complete...");
        return; // init() will be continued via continuePostNetwork callback
    }
}
async function continuePostNetwork() {
    // Story 21.2 / AC #5, #10: Check for pre-configured profile at boot
    try {
        const preConfigResult = await checkPreConfigBoot();
        if (preConfigResult.preConfigured && preConfigResult.activated) {
            log.info("Pre-configured profile activated at boot", {
                recipientName: preConfigResult.recipientName,
                lockedSettings: preConfigResult.lockedSettings,
            });
            // Profile already activated and welcome message spoken — skip OOBE profile setup
        }
        if (preConfigResult.wifiDeferred) {
            log.info("Pre-config WiFi deferred — hotspot will be launched for WiFi-only setup");
        }
    }
    catch (err) {
        log.warn("Pre-config boot check failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 3.1 / FR56: Initialize foyer schema and register household names for STT normalization
    ensureFoyerSchema();
    // Story 3.6 / AC8: Initialize visitor persistence — schema, load, purge
    try {
        const { getCompanionDb } = await import("./security/database-manager.js");
        const companionDb = getCompanionDb();
        ensureVisitorSchema(companionDb);
        loadVisitorsFromDb(companionDb);
        const purged = purgeOldVisitors(companionDb, VISITOR_PURGE_DAYS);
        if (purged > 0) {
            log.info("Visitors purged at startup", { purged });
        }
    }
    catch (err) {
        log.warn("Visitor persistence init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    const foyer = getFoyer();
    if (foyer && isFoyerConfigured()) {
        const members = getMembers(foyer.id);
        const nameEntries = members.map(m => ({
            normalized: m.name,
            variants: [
                m.name.toLowerCase(),
                m.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""), // strip accents
                ...(m.aliases || []).map((a) => a.toLowerCase()),
            ],
        }));
        registerHouseholdNames(nameEntries);
        log.info("Foyer loaded", { memberCount: members.length });
        // Story 3.4 / AC8: Synchronize foyer members with persona profiles
        try {
            syncFoyerPersonas();
        }
        catch (err) {
            log.warn("Foyer-persona sync failed (non-blocking)", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
        // Story 3.5 / AC7: Clean up temporary voiceprints from npu-embeddings at startup
        cleanupTemporaryVoiceprints().catch((err) => {
            log.warn("Temporary voiceprint cleanup failed (non-blocking)", {
                error: err instanceof Error ? err.message : String(err),
            });
        });
    }
    // Story 13.1: Wait for Home Assistant Docker container, then start health monitoring
    // Story 13.2: Start device watcher after HA is ready
    const deviceWatcher = new HADeviceWatcher();
    waitForHA().then((ready) => {
        if (ready) {
            startHAHealthCheck();
            // Story 13.2: Start polling for new device discovery flows
            deviceWatcher.start();
            deviceWatcher.setNewDeviceCallback((event) => {
                log.info("New smart home device detected", {
                    flowId: event.flowId,
                    handler: event.handler,
                });
            });
        }
        else {
            log.warn("Home Assistant not available at startup — health check will start on first successful connection");
            // Start health check anyway to detect when HA comes back
            startHAHealthCheck();
        }
    }).catch((err) => {
        log.warn("waitForHA failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
        startHAHealthCheck();
    });
    startMedicationScheduler();
    startProactiveScheduler();
    startHAWebhookServer();
    startReminderChecker();
    // Story 29.1 (Task 8): Initialize ProactiveSchedulerLoop for timing-aware delivery
    try {
        proactiveLoop = new ProactiveSchedulerLoop();
        proactiveLoop.onUrgentMessage(async (msg) => {
            // Deliver urgent messages immediately via TTS
            const { playAudioFile: playFile, playAudioBytes: playBytes } = await import("./audio/audio-client.js");
            const { synthesize: tts } = await import("./tts/piper.js");
            try {
                await playFile("/opt/diva-embedded/assets/bibop.wav");
                const wav = await tts(msg.content, 1.1);
                await playBytes(wav.toString("base64"));
            }
            catch (urgErr) {
                log.warn("Urgent proactive message delivery failed", {
                    error: urgErr instanceof Error ? urgErr.message : String(urgErr),
                });
            }
        });
        proactiveLoop.start();
        log.info("ProactiveSchedulerLoop initialized (Story 29.1)");
        // Story 29.2: Initialize and connect AnticipationEngine
        try {
            loadPersonas();
            const personas = (await import("./persona/engine.js")).listPersonas();
            const speakerIds = personas.map((p) => p.id);
            const anticipationEngine = initAnticipationEngine({
                calendarProvider: getUpcomingEventsWithinMinutes,
                medicationProvider: getUpcomingMedications,
                speakerProvider: () => speakerIds,
            });
            proactiveLoop.setAnticipationEngine(anticipationEngine);
            log.info("AnticipationEngine initialized (Story 29.2)");
        }
        catch (aeErr) {
            log.warn("AnticipationEngine init failed (non-blocking)", {
                error: aeErr instanceof Error ? aeErr.message : String(aeErr),
            });
        }
    }
    catch (err) {
        log.warn("ProactiveSchedulerLoop init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 14.2: Start energy monitoring and eco-coach
    try {
        startEnergyMonitoring();
        initEcoCoach();
        log.info("Energy monitoring and eco-coach initialized (Story 14.2)");
    }
    catch (err) {
        log.warn("Energy monitoring init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 24.2: Initialize AlarmManager and AlarmScheduler
    try {
        const DATA_DIR = process.env.DIVA_DATA_DIR || "/opt/diva-embedded/data";
        const { getCompanionDb } = await import("./security/database-manager.js");
        const companionDb = getCompanionDb();
        const alarmManager = new AlarmManager(companionDb);
        const { getProfileManager } = await import("./music/music-tool.js");
        const alarmScheduler = new AlarmScheduler(alarmManager, getProfileManager(), handleMusicTool);
        setAlarmScheduler(alarmScheduler);
        await alarmScheduler.initialize();
        log.info("AlarmScheduler initialized");
    }
    catch (err) {
        log.error("AlarmScheduler init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 24.3: Initialize CalendarManager, ShoppingListManager, ImplicitIntentDetector
    try {
        const calendarManager = getCalendarManager();
        await calendarManager.start(["default"]);
        log.info("CalendarManager initialized");
    }
    catch (err) {
        log.error("CalendarManager init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // ShoppingListManager and ImplicitIntentDetector are singletons,
    // initialized on first use — no explicit start needed.
    getShoppingListManager();
    getImplicitIntentDetector();
    log.info("ShoppingListManager and ImplicitIntentDetector initialized");
    // Story 14.3: Initialize LED feedback system
    try {
        const DATA_DIR = process.env.DIVA_DATA_DIR || "/opt/diva-embedded/data";
        const ledConfigPath = `${DATA_DIR}/led-patterns.json`;
        const ledEngine = getLedPatternEngine();
        ledEngine.loadPatterns(ledConfigPath);
        const ledConfig = ledEngine.getNightModeConfig();
        const ledDriver = await createLedDriver(process.env.LED_SPI_DEVICE || "/dev/spidev0.0", process.env.LED_PROTOCOL || "ws2812b");
        ledEngine.setDriver(ledDriver);
        ledEngine.setLedCount(parseInt(process.env.LED_COUNT || "16", 10));
        ledEngine.startRenderLoop();
        const ledState = getLedStateManager();
        ledState.on("led.state-changed", ({ from, to }) => {
            ledEngine.setStatePattern(to);
        });
        // Set initial state to idle/ready
        ledState.setState("idle");
        log.info("LED feedback system initialized");
    }
    catch (err) {
        log.warn("LED feedback init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 3.9: Initialize SatelliteManager for multi-room localization
    // The satellite manager is initialized but the WebSocket server and mDNS
    // discovery are only started in production (post-MVP satellite feature).
    log.info("Satellite manager initialized", { defaultRoomId: DEFAULT_ROOM_ID, mode: "single-room" });
    // Story 11.5: Start fleet reporter
    startFleetReporter();
    // Story 3.11: Initialize MultimodalWakeManager for accessibility triggers
    try {
        const { MultimodalWakeManager, InMemoryAccessibilityConfigDb } = await import("./audio/multimodal-wake-manager.js");
        const { InMemoryTriggerButtonDb } = await import("./audio/smart-button-trigger.js");
        const accessibilityConfigDb = new InMemoryAccessibilityConfigDb();
        const triggerButtonDb = new InMemoryTriggerButtonDb();
        const multimodalWakeManager = new MultimodalWakeManager({
            onWakeEvent: (event) => {
                log.info("Multimodal wake event received", {
                    correlationId: event.correlationId,
                    type: event.type,
                });
                // Non-vocal wake events trigger the conversation loop
                // with the WakeEvent propagated through the pipeline
                if (event.type !== "voice") {
                    setAudioBusy(true);
                    conversationLoop().catch((err) => {
                        log.warn("conversationLoop error after multimodal wake", {
                            error: err instanceof Error ? err.message : String(err),
                        });
                        setAudioBusy(false);
                    });
                }
            },
            onDiagnosticMode: (correlationId) => {
                log.info("Diagnostic mode activated via physical button (FR175)", { correlationId });
                // FR175: Implémentation du mode diagnostic dans une autre story
            },
            configDb: accessibilityConfigDb,
            triggerButtonDb,
            feedbackDeps: {
                playAudioFile: (path) => playAudioFile(path),
            },
        });
        await multimodalWakeManager.start();
        globalThis.__divaMultimodalWakeManager = multimodalWakeManager;
        log.info("MultimodalWakeManager initialized (Story 3.11)");
    }
    catch (err) {
        log.warn("MultimodalWakeManager init failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 16.1 / FR95: Initialize default house modes
    initDefaultModes();
    // Story 16.1 / FR95: Load enhanced home modes and trigger resolver
    try {
        loadHomeModes();
        loadModeTriggers();
    }
    catch (err) {
        log.warn("Failed to load home modes/triggers", { error: String(err) });
    }
    // Story 16.2 / FR96: Load conversational routines, triggers, and start scheduler
    try {
        loadConversationalRoutines();
        loadRoutineTriggers();
        startRoutineScheduler();
        log.info("Conversational routine system started");
    }
    catch (err) {
        log.warn("Failed to start conversational routine system", { error: String(err) });
    }
    // Story 16.3 / FR103: Load family scenarios and start event listener
    try {
        const { loadScenarios: loadFamilyScenarios } = await import("./smarthome/scenario-manager.js");
        const { start: startScenarioEventListener } = await import("./smarthome/scenario-event-listener.js");
        loadFamilyScenarios();
        startScenarioEventListener();
        log.info("Family scenario system started");
    }
    catch (err) {
        log.warn("Failed to start family scenario system", { error: String(err) });
    }
    // Story 16.4 / FR104: Load advanced scenes and start habit tracker
    try {
        const { loadScenes: loadAdvancedScenes } = await import("./smarthome/scene-manager.js");
        const { startHabitTracker } = await import("./smarthome/habit-tracker.js");
        loadAdvancedScenes();
        startHabitTracker();
        log.info("Advanced scenes and habit tracker started");
    }
    catch (err) {
        log.warn("Failed to start advanced scenes system", { error: String(err) });
    }
    // Story 16.5 / FR105: Initialize scene suggestion engine and generate default scenes
    try {
        const { ensureSceneSchema, generateDefaultScenes, invalidateCache: invalidateSceneCache } = await import("./smarthome/scene-suggestion-engine.js");
        const { onModeChanged } = await import("./smarthome/mode-manager.js");
        ensureSceneSchema();
        try {
            const haConn = await import("./smarthome/ha-connector.js");
            if (haConn.isHAAvailable()) {
                const states = (await haConn.callHA("states"));
                const entities = states.map((s) => ({ entity_id: s.entity_id, domain: s.entity_id.split(".")[0], state: s.state, attributes: s.attributes }));
                generateDefaultScenes(entities);
            }
        }
        catch (err) {
            log.warn("Default scene generation skipped (HA not available)", { error: String(err) });
        }
        onModeChanged(() => invalidateSceneCache());
        log.info("Scene suggestion engine initialized");
    }
    catch (err) {
        log.warn("Failed to initialize scene suggestion engine", { error: String(err) });
    }
    // Story 16.6 / FR106: Initialize weather automation system
    try {
        const { startPeriodicRefresh: startWeatherRefresh } = await import("./smarthome/weather-data-provider.js");
        const { loadDevices: loadWeatherDevices, autoDetectDevices: autoDetectWeatherDevices } = await import("./smarthome/weather-device-manager.js");
        const { loadProfiles: loadSeasonalProfiles } = await import("./smarthome/seasonal-profile-manager.js");
        const { startPeriodicEvaluation: startWeatherEvaluation } = await import("./smarthome/weather-rule-evaluator.js");
        startWeatherRefresh();
        loadWeatherDevices();
        autoDetectWeatherDevices().catch((err) => log.warn("Weather device auto-detect failed", { error: String(err) }));
        loadSeasonalProfiles();
        startWeatherEvaluation();
        log.info("Weather automation system initialized");
    }
    catch (err) {
        log.warn("Failed to initialize weather automation system", { error: String(err) });
    }
    // Story 12.1 / FR84: Start production dashboard on port 3080
    startProductionDashboard();
    // Story 1.3: Initialize correction tracker with Mem0 reload (fire-and-forget)
    try {
        const foyer = getFoyer();
        const speakerIds = foyer && isFoyerConfigured()
            ? getMembers(foyer.id).map((m) => m.name)
            : [];
        initCorrectionTracker(speakerIds, async (query) => {
            try {
                const { searchMemory } = await import("./tools/memory-tool.js");
                return await searchMemory(query);
            }
            catch {
                return [];
            }
        }).catch(() => { });
    }
    catch (err) {
        log.warn("Correction tracker init failed, continuing without", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // CP#3 / FR89: Auto-discover Home Assistant on startup
    // Read HA token from file (auto-refreshed by dashboard server)
    const haToken = (() => { try {
        return require("node:fs").readFileSync("/opt/diva-embedded/data/.ha-token", "utf-8").trim();
    }
    catch {
        return "";
    } })();
    runFullDiscovery(haToken).then(result => {
        if (result) {
            log.info("HA auto-discovery", { haUrl: result.haUrl, totalDevices: result.totalDevices, roomCount: result.rooms.length });
        }
    }).catch(() => { });
    // CP#8,CP#13 / FR90-91: Emergent automations + eco-coach periodic check
    setInterval(async () => {
        try {
            // Story 17.2: Check domotique alerts from HA states
            const haToken = (() => { try {
                return require("node:fs").readFileSync("/opt/diva-embedded/data/.ha-token", "utf-8").trim();
            }
            catch {
                return "";
            } })();
            if (haToken) {
                try {
                    const statesResp = await fetch("http://localhost:8123/api/states", {
                        headers: { "Authorization": `Bearer ${haToken}` },
                    });
                    if (statesResp.ok) {
                        const haStates = await statesResp.json();
                        // Story 17.2: Domotique alerts
                        const newAlerts = checkForAlerts(haStates);
                        for (const alert of newAlerts) {
                            const msg = formatVocalAlert(alert);
                            if (msg)
                                await speakTTS(msg);
                        }
                        // Story 16.6: Weather suggestions
                        const weatherSuggestion = getWeatherSuggestion(haStates, { current: { temp: 20, humidity: 50 }, forecast: [] });
                        if (weatherSuggestion) {
                            await speakTTS(weatherSuggestion.message);
                        }
                        // Story 18.6: Device health check
                        const lowBattery = getLowBatteryDevices(haStates);
                        if (lowBattery.length > 0) {
                            const dev = lowBattery[0];
                            await speakTTS(`Le capteur ${dev.name} n'a plus que ${dev.battery}% de batterie.`);
                        }
                    }
                }
                catch { }
            }
            // Eco waste alerts (from eco-coach alert history)
            try {
                const { getAlertHistory } = await import("./smarthome/eco-coach.js");
                const alerts = getAlertHistory(undefined, 1);
                if (alerts.length > 0) {
                    await speakTTS(String(alerts[0].message || ""));
                }
            }
            catch { }
        }
        catch { }
    }, 15 * 60 * 1000); // Every 15 minutes
    // Story 19.3: Gamification eco badges check (every hour)
    setInterval(async () => {
        try {
            const foyer = getFoyer();
            if (!foyer)
                return;
            const members = getMembers(foyer.id);
            for (const member of members) {
                if (member.speakerId && (member.age || 0) < 18) {
                    const newBadges = checkBadges(member.speakerId, []);
                    for (const badge of newBadges) {
                        await speakTTS(`Bravo ${member.name} ! Tu as gagne le badge ${badge} !`);
                    }
                }
            }
        }
        catch { }
    }, 60 * 60 * 1000); // Every hour
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
                        await handleMessageTool(action.payload);
                        dequeueAction(action.id);
                        log.info("Offline action replayed", { id: action.id, type: action.type });
                    }
                }
                catch (err) {
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
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function isGoodbye(text) {
    const lower = text.toLowerCase().trim();
    return GOODBYE_WORDS.some(phrase => lower.includes(phrase));
}
// Story 3.6: Check if text is primarily a name response (short text, few words)
function extractNameForCheck(text) {
    const words = text.trim().split(/\s+/);
    // If the text is very short (1-5 words), it's likely a name response
    if (words.length <= 5)
        return true;
    // If it contains "je m'appelle", "moi c'est", etc., it's a name response
    const lower = text.toLowerCase();
    if (/je\s+m'appelle|moi\s+c'est|c'est\s+\w+|je\s+suis\s+\w+/.test(lower))
        return true;
    return false;
}
// =====================================================================
// TTS
// =====================================================================
async function speakTTS(text) {
    try {
        // Story 14.3: LED → speaking state
        try {
            getLedStateManager().setState("speaking");
        }
        catch { }
        const wavBuffer = await synthesize(text);
        await muteMic().catch(() => { }); // Mute micro before speaking to prevent self-wake
        markOutputStart();
        // Story 28.1 / Task 6.2: Pass volume adaptation from vocal register
        const _regAdapt = getCurrentAdaptation();
        await playAudioBytes(wavBuffer.toString("base64"), _regAdapt.volumePercent);
        markOutputEnd();
        await unmuteMic().catch(() => { }); // Unmute after speaking
        // Story 14.3: LED → clear conversation states
        try {
            const lsm = getLedStateManager();
            lsm.clearState("speaking");
            lsm.clearState("processing");
            lsm.clearState("listening");
        }
        catch { }
    }
    catch (err) {
        markOutputEnd();
        try {
            const lsm = getLedStateManager();
            lsm.clearState("speaking");
            lsm.clearState("processing");
            lsm.clearState("listening");
        }
        catch { }
        console.error("[TTS] Error:", err);
    }
}
// Story 1.5 / Task 3.4: Configurable first-sentence latency target
const STREAMING_FIRST_SENTENCE_TARGET_MS = parseInt(process.env.STREAMING_FIRST_SENTENCE_TARGET_MS || "2000", 10);
// Story 1.5 / Task 4.2: Max consecutive TTS errors before fallback
const MAX_CONSECUTIVE_TTS_ERRORS = 3;
// Story 1.5 / Task 2.4: Timeout for synthesize() calls
const SYNTHESIZE_TIMEOUT_MS = 8000;
/** Story 1.5 / Task 2.4: synthesize with timeout */
function synthesizeWithTimeout(text) {
    return Promise.race([
        synthesize(text),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Piper TTS timeout (3s)")), SYNTHESIZE_TIMEOUT_MS)),
    ]);
}
async function speakTTSStreaming(sentenceQueue, correlationId, onFirstSentencePlayed) {
    let pendingWav = null;
    let streamStarted = false;
    let sentenceIndex = 0;
    let consecutiveErrors = 0;
    let lastPlayEndTime = 0;
    let fallbackCollector = []; // Collect remaining text for fallback
    let inFallbackMode = false;
    for await (const sentence of sentenceQueue) {
        if (sentence.trim().length <= 3)
            continue;
        // Story 1.5 / Task 4.2: If too many consecutive errors, collect remaining text
        if (inFallbackMode) {
            fallbackCollector.push(sentence);
            continue;
        }
        // Story 2.2: Single markOutputStart for the entire streaming session
        if (!streamStarted) {
            await muteMic().catch(() => { }); // Mute micro for entire streaming session
            markOutputStart();
            streamStarted = true;
        }
        // Story 1.5 / Task 6.3: Measure gap between sentences
        if (lastPlayEndTime > 0) {
            const gapMs = Date.now() - lastPlayEndTime;
            log.debug("Streaming TTS gap", { gapMs, sentenceIndex, correlationId });
        }
        if (pendingWav) {
            // Task 2.1: Prefetch pattern — play previous WAV while synthesizing current
            try {
                const readyWav = await pendingWav;
                pendingWav = synthesizeWithTimeout(sentence); // Start next synthesis immediately
                await playAudioBytes(readyWav.toString("base64"), getCurrentAdaptation().volumePercent);
                lastPlayEndTime = Date.now();
                consecutiveErrors = 0;
                log.debug("Streaming TTS sentence played", {
                    sentenceIndex: sentenceIndex - 1,
                    sentenceLength: sentence.length,
                    correlationId,
                });
            }
            catch (err) {
                // Story 1.5 / Task 4.1: Handle per-sentence TTS error
                log.warn("Streaming TTS error", {
                    sentenceIndex,
                    error: err instanceof Error ? err.message : String(err),
                    correlationId,
                });
                consecutiveErrors++;
                pendingWav = synthesizeWithTimeout(sentence); // Try to continue with next
                // Task 4.2: 3 consecutive errors → fallback
                if (consecutiveErrors >= MAX_CONSECUTIVE_TTS_ERRORS) {
                    log.warn("Streaming TTS: 3 consecutive errors, switching to fallback", { correlationId });
                    inFallbackMode = true;
                    pendingWav = null;
                    fallbackCollector.push(sentence);
                    continue;
                }
            }
        }
        else {
            // Task 2.2: First sentence — synthesize and play sequentially, then start prefetch
            try {
                const wav = await synthesizeWithTimeout(sentence);
                // Story 1.5 / Task 5.1: Notify that first sentence is ready (cancel filler)
                if (sentenceIndex === 0 && onFirstSentencePlayed) {
                    onFirstSentencePlayed();
                }
                // Story 27.5: Stop processing feedback (fire-and-forget, don't block TTS)
                if (sentenceIndex === 0) {
                    stopProcessingFeedback().catch(() => { });
                }
                await playAudioBytes(wav.toString("base64"), getCurrentAdaptation().volumePercent);
                lastPlayEndTime = Date.now();
                consecutiveErrors = 0;
                log.debug("Streaming TTS first sentence played", {
                    sentenceIndex,
                    sentenceLength: sentence.length,
                    correlationId,
                });
            }
            catch (err) {
                log.warn("Streaming TTS first sentence error", {
                    sentenceIndex,
                    error: err instanceof Error ? err.message : String(err),
                    correlationId,
                });
                consecutiveErrors++;
                if (consecutiveErrors >= MAX_CONSECUTIVE_TTS_ERRORS) {
                    log.warn("Streaming TTS: 3 consecutive errors on first sentences, switching to fallback", { correlationId });
                    inFallbackMode = true;
                    fallbackCollector.push(sentence);
                    continue;
                }
            }
        }
        sentenceIndex++;
    }
    // Task 2.3: Flush final pending WAV
    if (pendingWav && !inFallbackMode) {
        try {
            const wavBuffer = await pendingWav;
            await playAudioBytes(wavBuffer.toString("base64"), getCurrentAdaptation().volumePercent);
            lastPlayEndTime = Date.now();
            log.debug("Streaming TTS final sentence played", { sentenceIndex, correlationId });
        }
        catch (err) {
            log.warn("Streaming TTS final play error", {
                sentenceIndex,
                error: err instanceof Error ? err.message : String(err),
                correlationId,
            });
        }
    }
    // Story 1.5 / Task 4.2-4.3: Fallback — synthesize remaining text as single block
    if (inFallbackMode && fallbackCollector.length > 0) {
        const remainingText = fallbackCollector.join(' ');
        log.warn("Streaming TTS fallback: synthesizing remaining text as block", {
            reason: "consecutive_errors",
            textLength: remainingText.length,
            correlationId,
        });
        try {
            await speakTTS(remainingText);
        }
        catch (err) {
            log.warn("Streaming TTS fallback also failed", {
                error: err instanceof Error ? err.message : String(err),
                correlationId,
            });
        }
    }
    // Story 2.2: Single markOutputEnd for the entire streaming session
    if (streamStarted) {
        markOutputEnd();
        await unmuteMic().catch(() => { }); // Unmute after entire streaming session
    }
    // Story 1.5 / Task 6.4: Log total sentences
    log.debug("Streaming TTS complete", {
        totalSentences: sentenceIndex,
        correlationId,
    });
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
    try {
        const wakeword = await waitForWakeword();
        if (!wakeword.detected) {
            // Story 27.4: Distinguish silent_dismiss from ignore for logging
            if (wakeword.action === "silent_dismiss") {
                log.info("Wake word silent dismiss (false positive)", {
                    tier: wakeword.tier,
                    action: wakeword.action,
                    score: wakeword.score,
                    scoreRaw: wakeword.score_raw,
                    falsePositive: wakeword.false_positive,
                    dismissReason: wakeword.dismiss_reason,
                    mediumTierSpeechDetected: wakeword.medium_tier_speech_detected,
                });
            }
            else if (wakeword.tier) {
                // Story 27.3: Log ignored detections for monitoring
                log.debug("Wake word detection ignored", {
                    tier: wakeword.tier,
                    action: wakeword.action,
                    score: wakeword.score,
                    scoreRaw: wakeword.score_raw,
                    falsePositive: wakeword.false_positive,
                    dismissReason: wakeword.dismiss_reason,
                    mediumTierSpeechDetected: wakeword.medium_tier_speech_detected,
                });
            }
            setAudioBusy(false);
            return;
        }
        const corrId = newCorrelationId();
        // Story 14.3: LED feedback — wake word detected → listening (blue pulse)
        try {
            getLedStateManager().setState("listening");
        }
        catch { }
        // Story 3.11: Route vocal wake-word through MultimodalWakeManager (rétrocompatibilité)
        const multimodalManager = globalThis.__divaMultimodalWakeManager;
        if (multimodalManager) {
            const { createWakeEvent } = await import("./audio/wake-event.js");
            const voiceWakeEvent = createWakeEvent("voice", {
                confidence: wakeword.score_adjusted ?? wakeword.score,
            });
            // Mise à jour du correlationId pour aligner avec le pipeline existant
            voiceWakeEvent.correlationId = corrId;
            multimodalManager.handleWakeEvent(voiceWakeEvent);
        }
        // Story 27.1: Detect wake-word position (start/middle/end)
        const wwPosition = detectWakewordPosition(wakeword.pre_audio_base64, wakeword.post_audio_base64);
        // Story 27.2 + 27.3 + 27.4: Log variant, tier, and false positive info for correlation
        log.info("Wake word detected", {
            score: wakeword.score,
            scoreAdjusted: wakeword.score_adjusted,
            scoreRaw: wakeword.score_raw,
            variantDetected: wakeword.variant_detected ?? "Diva",
            correlationId: corrId,
            wakewordPosition: wwPosition,
            tier: wakeword.tier ?? "UNKNOWN",
            action: wakeword.action ?? "process",
            feedbackPlayed: wakeword.feedback_played ?? false,
            falsePositive: wakeword.false_positive ?? false,
            latencyFeedbackMs: wakeword.latency_feedback_ms ?? 0,
            chimePlayed: wakeword.feedback_played ?? false,
            mediumTierSpeechDetected: wakeword.medium_tier_speech_detected,
        });
        startNewSession(); // Story 5.1: Reset voice drift tracking for new conversation
        // Story 28.2 / Task 5.1: Extract wakeword prosody and pre-configure interaction mode
        if (wakeword.wakeword_prosody) {
            const wwProsody = {
                mode: wakeword.wakeword_prosody.mode,
                confidence: wakeword.wakeword_prosody.confidence,
                durationMs: wakeword.wakeword_prosody.duration_ms,
                rmsDb: wakeword.wakeword_prosody.rms_db,
                pitchMeanHz: wakeword.wakeword_prosody.pitch_mean_hz,
                pitchSlope: wakeword.wakeword_prosody.pitch_slope,
                speechRate: wakeword.wakeword_prosody.speech_rate,
            };
            const initialMode = prosodyToInitialMode(wwProsody);
            setCurrentMode(initialMode);
            log.info("Wakeword prosody mode pre-configured", {
                mode: initialMode.mode,
                confidence: initialMode.confidence,
                durationMs: wwProsody.durationMs,
                rmsDb: wwProsody.rmsDb,
                pitchMeanHz: wwProsody.pitchMeanHz,
                pitchSlope: wwProsody.pitchSlope,
                speechRate: wwProsody.speechRate,
                correlationId: corrId,
            });
        }
        else {
            // Story 28.2 / Task 5.6: Fallback — no prosody available
            resetMode();
        }
        // Story 27.3 + 27.4: Determine if feedback (chime/attention) was already played by Python server
        // If so, skip oui.wav playback to avoid duplicate audio feedback
        const skipOuiWav = wakeword.feedback_played === true;
        log.debug("Audio feedback decision", {
            skipOuiWav,
            feedbackPlayed: wakeword.feedback_played,
            reason: skipOuiWav ? "chime_played_by_python" : "fallback_oui_wav",
        });
        // Story 27.1: Handle pre/post audio based on wake-word position
        if (wwPosition === "end") {
            // Wake-word en fin de phrase : le pre-audio contient la commande
            if (!skipOuiWav) {
                markOutputStart();
                await playAudioFile(`${ASSETS_DIR}/oui.wav`);
                markOutputEnd();
            }
            const wavBase64 = pcmToWavBase64(wakeword.pre_audio_base64);
            log.info("Wake-word at end — using pre-audio buffer directly", { preAudioBytes: Buffer.from(wakeword.pre_audio_base64, "base64").length });
            await conversationLoopWithAudio(wavBase64);
        }
        else if (wwPosition === "middle") {
            // Wake-word au milieu : combiner pre + post audio
            if (!skipOuiWav) {
                markOutputStart();
                await playAudioFile(`${ASSETS_DIR}/oui.wav`);
                markOutputEnd();
            }
            const combinedPcm = combineAudioBuffers(wakeword.pre_audio_base64, wakeword.post_audio_base64);
            if (combinedPcm) {
                const wavBase64 = pcmToWavBase64(combinedPcm);
                log.info("Wake-word in middle — combining pre+post audio", {
                    preBytes: Buffer.from(wakeword.pre_audio_base64, "base64").length,
                    postBytes: Buffer.from(wakeword.post_audio_base64, "base64").length,
                });
                await conversationLoopWithAudio(wavBase64);
            }
            else {
                await conversationLoop();
            }
        }
        else {
            // Wake-word en debut de phrase (comportement standard)
            if (!skipOuiWav) {
                markOutputStart();
                await playAudioFile(`${ASSETS_DIR}/oui.wav`);
                markOutputEnd();
            }
            await conversationLoop();
        }
    }
    catch (err) {
        // Graceful handling of audio server timeouts
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("fetch failed") || errMsg.includes("Timeout")) {
            console.log("[IDLE] Audio server timeout, retrying...");
        }
        else {
            console.error("[IDLE] Error:", err);
        }
    }
    setAudioBusy(false);
}
async function conversationLoop() {
    let isFirstTurn = true;
    // Story 28.1 / Task 6.3: Reset register at start of conversation
    resetRegister();
    while (true) {
        // Beep then record
        markOutputStart();
        await playAudioFile(`${ASSETS_DIR}/listen.wav`);
        markOutputEnd();
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
            // Story 28.1 / Task 6.3: Reset register on session end
            resetRegister();
            // Story 28.2 / Task 5.5: Reset interaction mode on session end
            resetMode();
            break;
        }
        // Story 28.1 / Task 6.1: Update vocal register from record response
        if (recorded.vocalRegister) {
            setCurrentRegister(recorded.vocalRegister);
            console.log(`[REGISTER] ${recorded.vocalRegister.register} (RMS=${recorded.vocalRegister.rmsDb}dB, conf=${recorded.vocalRegister.confidence})`);
        }
        console.log(`[REC] Audio capturé : ${recorded.duration_ms}ms`);
        // CP#1: If early STT is available, start intent classification immediately
        let earlyIntentPromise = null;
        if (recorded.early_stt) {
            console.log(`[ANTICIPATION] Early STT: "${recorded.early_stt}" — pre-routing intent`);
            earlyIntentPromise = classifyIntent(recorded.early_stt).catch(() => null);
        }
        // Story 14.3: LED feedback — STT start → processing (white blink)
        try {
            getLedStateManager().setState("processing");
        }
        catch { }
        // STT + Speaker ID in parallel
        const rawWavBuffer = Buffer.from(recorded.wav_base64, "base64");
        // Story 2.1: Apply noise suppression before STT
        const denoisedBuffer = suppressNoise(rawWavBuffer);
        // Story 2.2: Apply AEC if Diva was outputting audio
        const wavBuffer = isDivaOutputting() ? cancelEcho(denoisedBuffer, getReferenceBuffer()) : denoisedBuffer;
        const [transcription, speakerResult] = await Promise.all([
            transcribeLocal(wavBuffer),
            identifySpeakerWithScore(recorded.wav_base64).catch(() => ({ speaker: "unknown", score: 0 })),
        ]);
        // CP#1: Use early intent if available and full transcription matches
        if (earlyIntentPromise) {
            const earlyIntent = await earlyIntentPromise;
            if (earlyIntent && earlyIntent.intent === "local" && earlyIntent.confidence > 0.8) {
                console.log(`[ANTICIPATION] Early intent confirmed: ${earlyIntent.category} (confidence: ${earlyIntent.confidence})`);
                // The full STT + intent will verify, but we can start preparing
            }
        }
        let speaker = speakerResult.speaker;
        const speakerScore = speakerResult.score;
        // Story 5.1 / FR68: Track identification for drift/oscillation detection
        trackIdentification(speaker, speakerScore);
        const driftAnalysis = analyzeCurrentSession(speaker);
        if (driftAnalysis?.action === "doubt") {
            // Speaker oscillating — verbalize doubt instead of silently switching
            log.info("Voice drift: doubt detected", { speaker, score: speakerScore });
            speaker = "unknown"; // Treat as unknown until confirmed
        }
        // Story 3.4: Resolve speaker -> FoyerMember -> PersonaProfile
        const resolution = resolveSpeaker(speaker, speakerScore);
        if (resolution.identified && resolution.source === "foyer") {
            log.info("Speaker identified", { speaker, score: speakerScore });
            setLogSpeaker(speaker);
            setMusicSpeaker(speaker);
            startReplay(speaker);
            // Story 2.7 / AC3: Adapt STT prompt for child speakers with graceful degradation
            try {
                const persona = getCurrentPersona();
                setSpeakerChildMode(persona.type === "child");
                // Story 2.6 / FR82: Signal wake word threshold to Python via shared file
                import("node:fs").then(fs => {
                    fs.writeFileSync("/tmp/diva-wake-threshold", persona.type === "child" ? "child" : "adult");
                }).catch(() => { });
            }
            catch (e) {
                log.warn("Failed to detect speaker persona type, defaulting to adult mode", { speaker, error: String(e) });
                setSpeakerChildMode(false);
            }
            claude.clearHistory();
            // Story 5.2 / FR69: Empathetic drift message if score is low
            if (driftAnalysis?.action === "drift" && driftAnalysis.message) {
                await speakTTS(driftAnalysis.message);
            }
        }
        else if (resolution.source === "visitor") {
            // Story 3.4 / AC7: Score OK but no active member — visitor
            setSpeakerChildMode(false);
            handleUnknownVoiceAtNight().catch(() => { });
            // Story 3.6: Record visit with SQLite persistence
            try {
                const { getCompanionDb } = await import("./security/database-manager.js");
                recordVisit(speaker, false, getCompanionDb());
            }
            catch {
                recordVisit(speaker);
            }
            startReplay("unknown");
            // Story 3.6 / AC5: Returning visitor greeting
            try {
                const returningGreeting = getReturningVisitorGreeting(speaker);
                if (returningGreeting) {
                    await speakTTS(returningGreeting);
                    // Story 3.6 / AC5: Propose registration if recurring
                    try {
                        const { getCompanionDb } = await import("./security/database-manager.js");
                        const proposal = getRegistrationProposal(speaker, getCompanionDb());
                        if (proposal)
                            await speakTTS(proposal);
                    }
                    catch { }
                }
            }
            catch { }
            if (driftAnalysis?.action === "doubt" && driftAnalysis.message) {
                await speakTTS(driftAnalysis.message);
            }
        }
        else {
            // Story 2.7 / AC2,AC10: Reset child mode for unknown speakers (adult by default)
            setSpeakerChildMode(false);
            handleUnknownVoiceAtNight().catch(() => { });
            // Story 3.6: Record visit with SQLite persistence
            try {
                const { getCompanionDb } = await import("./security/database-manager.js");
                recordVisit(speaker, false, getCompanionDb());
            }
            catch {
                recordVisit(speaker);
            }
            startReplay("unknown");
            // Story 3.6 / AC5: Returning visitor greeting
            try {
                const returningGreeting = getReturningVisitorGreeting(speaker);
                if (returningGreeting) {
                    await speakTTS(returningGreeting);
                    try {
                        const { getCompanionDb } = await import("./security/database-manager.js");
                        const proposal = getRegistrationProposal(speaker, getCompanionDb());
                        if (proposal)
                            await speakTTS(proposal);
                    }
                    catch { }
                }
            }
            catch { }
            // Story 5.1 / FR68: Verbalize doubt if oscillation detected
            if (driftAnalysis?.action === "doubt" && driftAnalysis.message) {
                await speakTTS(driftAnalysis.message);
            }
        }
        // Story 3.5 / AC1, AC9: Background voice sample collection for unknown speakers
        if (!resolution.identified && recorded.wav_base64 && recorded.duration_ms) {
            const foyer = getFoyer();
            if (foyer) {
                const preInscrit = getPreInscritMembers(foyer.id);
                if (preInscrit.length > 0 && backgroundCollector.shouldCollect(getCorrelationId())) {
                    const startBgMs = Date.now();
                    backgroundCollector.collectSample(recorded.wav_base64, recorded.duration_ms, getCorrelationId(), getCorrelationId());
                    const bgOverhead = Date.now() - startBgMs;
                    if (bgOverhead > 100) {
                        log.warn("Background voice collection overhead exceeded 100ms", { bgOverhead });
                    }
                }
            }
        }
        if (!transcription || transcription.trim().length === 0) {
            console.log("[STT] Transcription vide");
            if (!isFirstTurn)
                continue;
            break;
        }
        log.info("STT transcription", { text: transcription });
        recordStep("stt", { text: transcription, durationMs: Date.now() });
        // Story 3.5 / AC1, AC3, AC8: Store transcribed text and trigger async voiceprint+autolink
        if (!resolution.identified) {
            const sessionId = getCorrelationId();
            backgroundCollector.addTranscribedText(sessionId, transcription);
            if (backgroundCollector.getSampleCount(sessionId) >= 3 &&
                !backgroundCollector.isVoiceprintGenerated(sessionId) &&
                !backgroundCollector.isLinkProposedThisSession(sessionId)) {
                // AC9: Run voiceprint generation and auto-link asynchronously
                setImmediate(async () => {
                    try {
                        const tempId = await backgroundCollector.generatePreliminaryVoiceprint(sessionId);
                        if (!tempId)
                            return;
                        const linkResult = await backgroundCollector.attemptAutoLink(sessionId);
                        if (linkResult.matched && linkResult.member) {
                            const outcome = await backgroundCollector.proposeVoiceLink(sessionId, linkResult.member);
                            if (outcome.linked) {
                                await speakTTS(`Super, je te reconnaitrai maintenant, ${linkResult.member.name} !`);
                            }
                            else if (outcome.reason === "consent_refused") {
                                await speakTTS("Pas de souci, j'ai tout efface. Tu pourras toujours le faire plus tard !");
                            }
                            else if (outcome.reason === "conflict") {
                                const foyer = getFoyer();
                                const admins = foyer ? (await import("./household/foyer-manager.js")).getAdmins(foyer.id) : [];
                                const adminName = admins.length > 0 ? admins[0].name : "un administrateur";
                                await speakTTS(`Ta voix ne ressemble pas a celle de ${linkResult.member.name} que je connais. Demande a ${adminName} de m'aider a corriger ca !`);
                            }
                        }
                    }
                    catch (err) {
                        log.warn("Background voice link async error (non-blocking)", {
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                });
            }
        }
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
            // Story 14.3: LED → urgency (red pulsing) BEFORE vocal response
            try {
                getLedStateManager().setState("urgency");
            }
            catch { }
            const response = await handleDistress(transcription);
            await speakTTS(response);
            try {
                getLedStateManager().clearState("urgency");
            }
            catch { }
            break;
        }
        // --- SLEEP TRACKING (#72) ---
        if (/bonne nuit|dors bien/i.test(transcription)) {
            logSleepEvent(speaker, "goodnight");
        }
        else if (/bonjour|bon matin/i.test(transcription) && isFirstTurn) {
            logSleepEvent(speaker, "goodmorning");
        }
        // --- GOODBYE (only in follow-up turns) ---
        if (!isFirstTurn && isGoodbye(transcription)) {
            console.log("[END] Goodbye détecté");
            markOutputStart();
            await playAudioFile(`${ASSETS_DIR}/goodbye.wav`);
            markOutputEnd();
            break;
        }
        // --- VOICE REGISTRATION (explicit request) ---
        if (/enregistre.*voix|apprends.*voix|m[eé]morise.*voix/i.test(transcription)) {
            await handleVoiceRegistrationFlow();
            break;
        }
        // --- OOBE (first boot, no foyer configured) --- Story 3.1 / FR56, FR62
        if (shouldTriggerOOBE()) {
            console.log("[OOBE] First boot — starting Out-of-Box Experience");
            const oobeResult = await runOOBE();
            if (oobeResult?.completed && oobeResult.adminName) {
                setCurrentPersona(oobeResult.adminName);
                // Reload household names for STT normalization
                const f = getFoyer();
                if (f) {
                    const members = getMembers(f.id);
                    registerHouseholdNames(members.map(m => ({
                        normalized: m.name,
                        variants: [m.name.toLowerCase(), m.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")],
                    })));
                }
            }
            break;
        }
        // --- OOBE REPROMPT (foyer incomplete) --- Story 3.3 / FR60
        if (isFirstTurn && speaker !== "unknown") {
            const reprompt = await runOOBEReprompt();
            if (reprompt?.completed)
                break; // Reprompt handled the interaction
        }
        // --- DISCOVERY GUIDE (contextual feature revelation) --- Story 3.2 / FR18
        if (isFirstTurn && speaker !== "unknown" && isFoyerConfigured()) {
            try {
                ensureDiscoverySchema();
                const foyer = getFoyer();
                if (foyer) {
                    const members = getMembers(foyer.id);
                    const currentMember = members.find(m => m.speakerId === speaker);
                    if (currentMember) {
                        const speakerDiscoveryId = currentMember.speakerId ?? `admin_${currentMember.id}`;
                        const createdAt = new Date(currentMember.createdAt);
                        const personaType = derivePersonaTypeFromAge(currentMember.age);
                        const contentFilter = deriveContentFilterFromAge(currentMember.age);
                        if (!isDiscoveryComplete(speakerDiscoveryId, createdAt, personaType, contentFilter, currentMember.age)) {
                            initDiscovery(speakerDiscoveryId, createdAt);
                            const discoveryPrompt = getDiscoveryPrompt(speakerDiscoveryId, createdAt, personaType, contentFilter, currentMember.age);
                            if (discoveryPrompt) {
                                const wav = await synthesize(discoveryPrompt);
                                await playAudioBytes(wav.toString("base64"));
                                // Mark capability as revealed
                                const schedule = filterByContentFilter(getScheduleForType(personaType), contentFilter);
                                const revealed = (await import("./persona/discovery-guide.js")).getRevealedCapabilities(speakerDiscoveryId);
                                const revealedSet = new Set(revealed);
                                const nextCapability = schedule.find(s => !revealedSet.has(s.capability));
                                if (nextCapability) {
                                    markCapabilityRevealed(speakerDiscoveryId, nextCapability.capability, "session_start");
                                }
                            }
                        }
                    }
                }
            }
            catch (err) {
                log.warn("Discovery guide check failed", { error: String(err) });
            }
        }
        // --- ONBOARDING (unknown speaker, any turn) --- Story 3.6 / FR14
        if (speaker === "unknown" && shouldTriggerOnboarding(speaker)) {
            console.log("[ONBOARDING] Unknown voice detected, starting onboarding");
            markOnboardingAttempt();
            const result = await runOnboarding();
            if (result?.success) {
                setCurrentPersona(result.cleanName);
            }
            break;
        }
        // --- PROCESS ---
        await handleTranscription(transcription, speaker, rawWavBuffer, speakerScore);
        if (!FOLLOW_UP_ENABLED)
            break;
        isFirstTurn = false;
    }
    console.log("[CONV] Fin de conversation, retour au wake word\n");
}
/**
 * Story 27.1: Variante de conversationLoop qui utilise un audio WAV pre-fourni
 * pour le premier tour (wake-word en position fin ou milieu).
 * Les tours suivants fonctionnent normalement avec recordAudio().
 */
async function conversationLoopWithAudio(wavBase64) {
    // Premier tour : utiliser l'audio pre-fourni
    const rawWavBuffer = Buffer.from(wavBase64, "base64");
    // Story 2.1 + 2.2: RNNoise then AEC pipeline
    const denoisedBuffer = suppressNoise(rawWavBuffer);
    const wavBuffer = isDivaOutputting() ? cancelEcho(denoisedBuffer, getReferenceBuffer()) : denoisedBuffer;
    const [transcription, speakerResult] = await Promise.all([
        transcribeLocal(wavBuffer),
        identifySpeakerWithScore(wavBase64).catch(() => ({ speaker: "unknown", score: 0 })),
    ]);
    let speaker = speakerResult.speaker;
    const speakerScore = speakerResult.score;
    trackIdentification(speaker, speakerScore);
    const driftAnalysis = analyzeCurrentSession(speaker);
    if (driftAnalysis?.action === "doubt") {
        log.info("Voice drift: doubt detected", { speaker, score: speakerScore });
        speaker = "unknown";
    }
    // Story 3.4: Resolve speaker -> FoyerMember -> PersonaProfile
    const resolution = resolveSpeaker(speaker, speakerScore);
    if (resolution.identified && resolution.source === "foyer") {
        log.info("Speaker identified", { speaker, score: speakerScore });
        setLogSpeaker(speaker);
        setMusicSpeaker(speaker);
        startReplay(speaker);
        // Story 2.7 / AC3: Adapt STT prompt for child speakers with graceful degradation
        try {
            const persona = getCurrentPersona();
            setSpeakerChildMode(persona.type === "child");
            import("node:fs").then(fs => {
                fs.writeFileSync("/tmp/diva-wake-threshold", persona.type === "child" ? "child" : "adult");
            }).catch(() => { });
        }
        catch (e) {
            log.warn("Failed to detect speaker persona type, defaulting to adult mode", { speaker, error: String(e) });
            setSpeakerChildMode(false);
        }
        claude.clearHistory();
        // Story 3.13: Deliver pending household messages on voice identification
        try {
            const hm = globalThis.__householdMessaging;
            if (hm) {
                const hmDelivery = hm.deliverMessages(speaker);
                if (hmDelivery.spokenText) {
                    log.info("Household messages delivered on voice identification", {
                        speakerId: speaker,
                        deliveryMethod: "voice_interaction",
                        messageCount: hmDelivery.messages.length,
                    });
                    await speakTTS(hmDelivery.spokenText);
                }
            }
        }
        catch (hmErr) {
            log.warn("Household message delivery failed", { speaker, error: String(hmErr) });
        }
        if (driftAnalysis?.action === "drift" && driftAnalysis.message) {
            await speakTTS(driftAnalysis.message);
        }
    }
    else if (resolution.source === "visitor") {
        setSpeakerChildMode(false);
        handleUnknownVoiceAtNight().catch(() => { });
        try {
            const { getCompanionDb } = await import("./security/database-manager.js");
            recordVisit(speaker, false, getCompanionDb());
        }
        catch {
            recordVisit(speaker);
        }
        startReplay("unknown");
        // Story 3.6 / AC5: Returning visitor greeting
        try {
            const returningGreeting = getReturningVisitorGreeting(speaker);
            if (returningGreeting) {
                await speakTTS(returningGreeting);
                try {
                    const { getCompanionDb } = await import("./security/database-manager.js");
                    const proposal = getRegistrationProposal(speaker, getCompanionDb());
                    if (proposal)
                        await speakTTS(proposal);
                }
                catch { }
            }
        }
        catch { }
        if (driftAnalysis?.action === "doubt" && driftAnalysis.message) {
            await speakTTS(driftAnalysis.message);
        }
    }
    else {
        // Story 2.7 / AC2,AC10: Reset child mode for unknown speakers (adult by default)
        setSpeakerChildMode(false);
        handleUnknownVoiceAtNight().catch(() => { });
        try {
            const { getCompanionDb } = await import("./security/database-manager.js");
            recordVisit(speaker, false, getCompanionDb());
        }
        catch {
            recordVisit(speaker);
        }
        startReplay("unknown");
        // Story 3.6 / AC5: Returning visitor greeting
        try {
            const returningGreeting = getReturningVisitorGreeting(speaker);
            if (returningGreeting) {
                await speakTTS(returningGreeting);
                try {
                    const { getCompanionDb } = await import("./security/database-manager.js");
                    const proposal = getRegistrationProposal(speaker, getCompanionDb());
                    if (proposal)
                        await speakTTS(proposal);
                }
                catch { }
            }
        }
        catch { }
        if (driftAnalysis?.action === "doubt" && driftAnalysis.message) {
            await speakTTS(driftAnalysis.message);
        }
    }
    if (!transcription || transcription.trim().length === 0) {
        console.log("[STT] Transcription vide (pre-audio)");
        return;
    }
    log.info("STT transcription (from pre/post audio)", { text: transcription });
    await handleTranscription(transcription, speaker, rawWavBuffer, speakerScore);
    // Continuer avec la boucle de conversation normale pour les follow-ups
    if (FOLLOW_UP_ENABLED) {
        // Entrer dans la boucle de conversation standard pour les tours suivants
        let isFirstTurn = false; // pas le premier tour
        while (true) {
            markOutputStart();
            await playAudioFile(`${ASSETS_DIR}/listen.wav`);
            markOutputEnd();
            console.log("[REC] Enregistrement en cours...");
            const recorded = await recordAudio({
                maxDurationS: 10,
                silenceTimeoutS: 1.0,
            });
            if (!recorded.has_speech || !recorded.wav_base64) {
                console.log("[FOLLOW-UP] Silence, fin de conversation");
                resetRegister();
                // Story 28.2 / Task 5.5: Reset interaction mode on session end
                resetMode();
                break;
            }
            // Story 28.1 / Task 6.1: Update vocal register on each turn
            if (recorded.vocalRegister) {
                setCurrentRegister(recorded.vocalRegister);
            }
            console.log(`[REC] Audio capturé : ${recorded.duration_ms}ms`);
            const rawWavBuf = Buffer.from(recorded.wav_base64, "base64");
            // Story 2.1 + 2.2: RNNoise then AEC pipeline
            const denoisedBuf = suppressNoise(rawWavBuf);
            const wavBuf = isDivaOutputting() ? cancelEcho(denoisedBuf, getReferenceBuffer()) : denoisedBuf;
            const [tx, spkResult] = await Promise.all([
                transcribeLocal(wavBuf),
                identifySpeakerWithScore(recorded.wav_base64).catch(() => ({ speaker: "unknown", score: 0 })),
            ]);
            let spk = spkResult.speaker;
            trackIdentification(spk, spkResult.score);
            if (!tx || tx.trim().length === 0) {
                console.log("[STT] Transcription vide");
                continue;
            }
            log.info("STT transcription", { text: tx });
            if (isGoodbye(tx)) {
                console.log("[END] Goodbye détecté");
                markOutputStart();
                await playAudioFile(`${ASSETS_DIR}/goodbye.wav`);
                markOutputEnd();
                break;
            }
            await handleTranscription(tx, spk, rawWavBuf, spkResult.score);
        }
    }
    console.log("[CONV] Fin de conversation, retour au wake word\n");
}
async function handleTranscription(transcription, speaker = "unknown", lastAudioBuffer, speakerConfidenceScore) {
    // Story 3.6 / AC3, AC7: Intercept name response if awaiting visitor name
    if (isAwaitingVisitorName(speaker)) {
        try {
            let visitorDb;
            try {
                const { getCompanionDb } = await import("./security/database-manager.js");
                visitorDb = getCompanionDb();
            }
            catch { }
            const nameResponse = await handleVisitorNameResponse(speaker, transcription, getCorrelationId(), visitorDb);
            if (nameResponse) {
                await speakTTS(nameResponse);
            }
            // AC7 / Task 6.5: Continue processing — don't return, let the normal pipeline handle
            // the transcription too in case it's actually a question, not just a name
            const nameOnly = extractNameForCheck(transcription);
            if (nameOnly) {
                // Name was the primary content — no further processing needed
                return;
            }
            // Otherwise fall through to normal pipeline (visitor ignored greeting and asked a question)
        }
        catch (err) {
            log.warn("Visitor name capture failed (non-blocking)", {
                error: err instanceof Error ? err.message : String(err),
            });
            setAwaitingVisitorName(speaker, false);
        }
    }
    // Story 1.1: Propagate correlation ID to session
    setSessionCorrelationId(speaker, getCorrelationId());
    // Story 6.4 / Task 2.5: Reset humor tracking if this is a new session
    {
        const sess = getSession(speaker);
        if (sess.exchanges.length === 0) {
            resetHumorTracking(speaker);
        }
    }
    // Story 2.1: Add user exchange to session sliding window
    addUserExchange(speaker, transcription);
    // Story 1.8: Hesitation detection + predictive completion (non-blocking, passive)
    if (FORMULATION_HELP_ENABLED) {
        try {
            // Check if transcript is a response to a previous suggestion
            const formulationResponse = formulationHelper.processResponse(transcription, speaker);
            if (formulationResponse) {
                if (formulationResponse.accepted && formulationResponse.suggestion) {
                    // User confirmed a suggestion — re-inject as the transcription
                    log.info("Formulation suggestion accepted, re-injecting", {
                        suggestion: formulationResponse.suggestion,
                        correlationId: getCorrelationId(),
                    });
                    transcription = formulationResponse.suggestion;
                }
                else if (!formulationResponse.accepted) {
                    // User rejected — pass through to normal pipeline with original transcription
                    log.info("Formulation suggestion rejected", { correlationId: getCorrelationId() });
                }
            }
            // Analyze transcript for hesitation markers
            const hasHesitation = hesitationDetector.analyzeTranscript(transcription, speaker, 0);
            if (!hasHesitation) {
                // Fluent speech — cancel any pending hesitation and try predictive completion
                hesitationDetector.onSpeechResumed();
                const completion = predictiveCompleter.attemptCompletion(transcription, speaker);
                if (completion) {
                    await speakTTS(completion.fullPhrase);
                    return; // Wait for user confirmation in next turn
                }
            }
        }
        catch (err) {
            log.warn("Story 1.8 formulation module error (non-blocking)", {
                error: err instanceof Error ? err.message : String(err),
                correlationId: getCorrelationId(),
            });
            // Disable modules for this session on error
            hesitationDetector.disable();
            formulationHelper.disable();
            predictiveCompleter.disable();
        }
    }
    // Story 2.3: Resolve anaphora before intent classification
    const anaphora = resolveAnaphora(transcription, speaker);
    if (anaphora.resolved && anaphora.modifiedText) {
        transcription = anaphora.modifiedText;
    }
    const t0 = Date.now();
    // Story 3.10 (AC1, AC4): Detect language from transcription, update session.currentLang
    try {
        const preferredLangForSpeaker = getPreferredLang(speaker);
        const langDetection = detectLang({ text: transcription }, preferredLangForSpeaker);
        updateSessionLang(speaker, langDetection.detectedLang);
        // Track consecutive usage to auto-update preferred_lang after 3 uses
        trackLanguageUsage(speaker, langDetection.detectedLang);
        log.info("Language detected", {
            correlationId: getCorrelationId(),
            speakerId: speaker,
            detectedLang: langDetection.detectedLang,
            confidence: langDetection.confidence,
            method: langDetection.method,
        });
    }
    catch (err) {
        log.warn("Language detection failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
            correlationId: getCorrelationId(),
        });
    }
    trackInteraction();
    // Story 4.2 / FR65: Don't store memories for unknown/guest speakers
    if (speaker !== "unknown" && getCurrentPersona().id !== "guest") {
        addMemory(transcription).catch(() => { });
    }
    logDailyInteraction(speaker, transcription);
    const { isRepetition } = checkRepetition(transcription);
    if (isRepetition) {
        trackRepeatedQuestion();
        console.log("[REPETITION] Repeated question detected");
    }
    // Story 1.6: Multi-request parsing — detect and handle multiple requests in one utterance
    const subRequests = parseMultiRequests(transcription);
    if (subRequests.length >= 2) {
        log.info("Multi-request detected, routing to parallel handler", {
            subRequestCount: subRequests.length,
            correlationId: getCorrelationId(),
        });
        try {
            const multiResponse = await handleMultiRequest(subRequests, transcription, speaker, getCorrelationId(), (msg) => claude.chat(msg));
            if (multiResponse) {
                await speakTTS(multiResponse);
                logInteraction({
                    timestamp: new Date().toISOString(),
                    speaker, transcription,
                    intent: "multi-request", category: "multi",
                    response: multiResponse,
                    latencyMs: Date.now() - t0,
                });
                return;
            }
        }
        catch (err) {
            log.warn("Multi-request handler failed, falling back to single pipeline", {
                error: String(err),
                correlationId: getCorrelationId(),
            });
        }
    }
    // [PERF] Launch memory recall in parallel with intent classification
    // This saves ~500ms since memory recall runs concurrently instead of blocking later
    const _earlyMemoryPromise = (speaker && speaker !== "unknown" && speaker !== "default")
        ? recallRelevantMemories(speaker, transcription).catch(() => [])
        : Promise.resolve([]);

    const intent = await classifyIntent(transcription);
    log.info("Intent classified", { intent: intent.intent, category: intent.category, confidence: intent.confidence, latencyMs: intent.latency_ms });
    recordStep("intent", { intent: intent.intent, category: intent.category, confidence: intent.confidence, latencyMs: intent.latency_ms });
    // Story 28.2 / Task 5.3: Fuse prosody mode with content intent after STT
    {
        const { getCurrentMode: _getCurMode } = await import("./audio/wakeword-prosody.js");
        const prosodyMode = _getCurMode();
        if (prosodyMode && prosodyMode.source === "prosody") {
            const fusedMode = fuseMode(prosodyMode, intent.category);
            setCurrentMode(fusedMode);
            log.info("Wakeword prosody mode fused with content", {
                prosodyMode: prosodyMode.mode,
                contentIntent: intent.category,
                fusedMode: fusedMode.mode,
                fusedConfidence: fusedMode.confidence,
                correlationId: getCorrelationId(),
            });
        }
    }
    // Story 1.9: Detect service switch and build context BEFORE updating lastIntent
    let serviceContextHeader = null;
    if (SERVICE_CONTEXT_ENABLED) {
        try {
            const session = getSession(speaker);
            const isSwitch = detectServiceSwitch(intent.category, session);
            if (isSwitch) {
                const persona = getCurrentPersona();
                const svcCtx = buildServiceContext(speaker, intent.category, session, activeActionRegistry, persona?.greetingName);
                if (svcCtx) {
                    // Inject into context injector for Claude
                    setServiceContext(svcCtx);
                    // Serialize for HTTP header propagation
                    serviceContextHeader = serializeForHeader(svcCtx);
                    // AC3: Duck audio if switching from music/radio
                    const fromAudio = session.lastCategory === "music" || session.lastCategory === "radio";
                    if (fromAudio) {
                        const musicAction = activeActionRegistry.findByType(speaker, "music")
                            || activeActionRegistry.findByType(speaker, "radio");
                        if (musicAction) {
                            await audioDucker.duck(speaker);
                        }
                    }
                }
            }
        }
        catch (err) {
            log.warn("Story 1.9 service context failed, continuing without", {
                error: err instanceof Error ? err.message : String(err),
                correlationId: getCorrelationId(),
            });
        }
    }
    // Story 2.3: Track last intent for anaphora resolution
    updateLastIntent(speaker, intent.intent, intent.category);
    // Story 3.8: Record speaker activity for admin presence detection
    recordSpeakerActivity(speaker);
    // Voice registration always allowed — must bypass auth (needed to link voice to profile)
    if (/enregistre.*voix|apprends.*voix|m[eé]morise.*voix/i.test(transcription)) {
        await handleVoiceRegistrationFlow();
        return;
    }
    // Story 4.1: Auth Gate — check permission BEFORE processing (pass confidence score for FR67 doubt zone)
    const authResult = checkAuth(intent.category, speaker, speakerConfidenceScore);
    if (!authResult.allowed) {
        log.warn("Auth rejected", { category: intent.category, speaker, reason: authResult.reason });
        // Story 3.8: Social mediation instead of cold refusal
        try {
            const mediationResult = await onAuthDenied(speaker, intent.category, intent.params || {}, getCorrelationId());
            if (mediationResult.type === "redirected" && mediationResult.adminId) {
                // Speak the redirect message and wait for admin response
                await speakTTS(mediationResult.message);
                const { askYesNo } = await import("./household/oobe-flow.js");
                const adminResponse = await waitForAdminResponse(() => askYesNo(""));
                const pending = getPendingMediation(getCorrelationId());
                if (adminResponse === "approved" && pending) {
                    await executeApprovedAction(pending, mediationResult.adminId, async (intentName, params, spkId, _approved) => {
                        log.info("Executing admin-approved action", { intent: intentName, speaker: spkId });
                        // Re-process the intent — the pipeline will handle it
                    });
                    await speakTTS("C'est fait !");
                    auditMediation("MEDIATION_COMPLETED", mediationResult.adminId, speaker, intent.category, getCorrelationId(), { adminResponse: "approved" });
                }
                else if (adminResponse === "denied") {
                    await speakTTS("Desole, pas pour le moment.");
                    auditMediation("MEDIATION_DENIED", mediationResult.adminId, speaker, intent.category, getCorrelationId(), { adminResponse: "denied" });
                }
                else {
                    // Timeout — fallback to alternative or decline
                    const { mediate } = await import("./household/permission-mediator.js");
                    // Clear the pending admin and re-mediate without admin present
                    const fallback = mediate(speaker, intent.category, intent.params || {}, getCorrelationId());
                    if (fallback.type !== "redirected") {
                        await speakTTS(fallback.message);
                    }
                    else {
                        await speakTTS("Desole, je ne peux pas faire ca pour le moment.");
                    }
                    auditMediation("MEDIATION_TIMEOUT", mediationResult.adminId, speaker, intent.category, getCorrelationId(), { adminResponse: "timeout" });
                }
            }
            else if (mediationResult.type === "alternative") {
                await speakTTS(mediationResult.message);
                auditMediation("MEDIATION_ALTERNATIVE", undefined, speaker, intent.category, getCorrelationId(), { alternativeAction: mediationResult.alternativeAction });
            }
            else {
                await speakTTS(mediationResult.message);
                auditMediation("MEDIATION_DECLINED", undefined, speaker, intent.category, getCorrelationId());
            }
        }
        catch (mediationErr) {
            log.warn("Mediation failed, using original refusal", {
                error: mediationErr instanceof Error ? mediationErr.message : String(mediationErr),
            });
            await speakTTS(authResult.reason || "Desole, je ne peux pas faire ca.");
        }
        return;
    }
    // Story 3.4 / AC4: Persona-level intent filtering (child blocked intents, guest restrictions)
    if (!isIntentAllowed(intent.category)) {
        const persona = getCurrentPersona();
        log.info("Intent blocked by persona", { category: intent.category, personaType: persona.type, speaker });
        if (persona.type === "child") {
            await speakTTS(getSpeakerMessage("child_blocked"));
        }
        else if (persona.type === "guest") {
            // Story 3.6 / AC4: Social refusal with admin name reference
            const adminName = getAdminGreetingName();
            if (adminName) {
                const isChild = getVisitorRecord(speaker)?.isChildVoice === true;
                await speakTTS(getGuestRefusalMessage(intent.category, adminName, isChild));
            }
            else {
                await speakTTS(getSpeakerMessage("guest_restricted"));
            }
        }
        else if (persona.type === "alzheimer") {
            await speakTTS(getSpeakerMessage("alzheimer_blocked"));
        }
        else {
            await speakTTS("Desole, je ne peux pas faire ca pour le moment.");
        }
        return;
    }
    // Story 4.6 / FR81: Anti-replay liveness check for protected/critical commands
    if (authResult.needsLivenessCheck && lastAudioBuffer) {
        const { checkLiveness } = await import("./security/anti-replay.js");
        const liveness = await checkLiveness(lastAudioBuffer);
        if (liveness.degraded) {
            log.warn("Liveness analysis degraded — continuing (fail open)", { speaker, reason: liveness.reason, score: liveness.score });
        }
        if (!liveness.isLive) {
            log.warn("Liveness check failed — possible replay attack", {
                speaker,
                score: liveness.score,
                bandwidthHz: liveness.metrics.bandwidthHz,
                crestFactorDb: liveness.metrics.crestFactorDb,
                durationMs: liveness.durationMs,
            });
            const { auditAuthRejected: auditLivenessFailed } = await import("./security/audit-logger.js");
            auditLivenessFailed(speaker, intent.category, authResult.level, "liveness_failed");
            await speakTTS("Je ne suis pas sure que ce soit vraiment toi. Peux-tu reessayer ?");
            return;
        }
        // Enrich authResult with liveness info for downstream audit
        authResult.livenessVerified = true;
        authResult.livenessScore = liveness.score;
    }
    // Story 4.5 / FR80: Vocal secret verification for critical commands
    if (authResult.needsSecretVerification && speaker !== "unknown") {
        const { hasSecret, isLocked } = await import("./security/vocal-secret.js");
        const { runSecretSetupInteractive, runSecretVerificationInteractive } = await import("./security/vocal-secret-flow.js");
        // AC8: Check trust window — skip verification if recently verified
        if (isSecretTrusted(speaker)) {
            log.info("Secret trust window active — skipping verification", { speaker });
        }
        else if (hasSecret(speaker)) {
            // AC4: Check lockout first
            const lockStatus = isLocked(speaker);
            if (lockStatus.locked) {
                await speakTTS("Ton compte est encore verrouille, patiente encore un peu.");
                return;
            }
            // AC3: Interactive verification
            const flowResult = await runSecretVerificationInteractive(speaker);
            if (!flowResult.success) {
                if (flowResult.message)
                    await speakTTS(flowResult.message);
                return;
            }
            // AC8: Set trust window on success
            setSecretTrustWindow(speaker);
        }
        else {
            // AC1: No secret defined — propose setup
            const setupOk = await runSecretSetupInteractive(speaker);
            if (!setupOk)
                return;
            setSecretTrustWindow(speaker);
        }
    }
    // Story 5.2: Child privacy protection
    if (isParentSnooping(transcription, speaker)) {
        await speakTTS(getChildPrivacyResponse());
        return;
    }
    // Story 11.4 / Task 4.1-4.2: Centralized LLM routing decision
    const routeDecision = llmRoute(transcription, intent);
    const routeT0 = Date.now();
    recordRouteDecision(routeDecision.engine, routeDecision.mode, Date.now() - t0);
    // Story 1.3 (ex 8.1): Detect corrections and learn
    if (isCorrection(transcription)) {
        const session = getSession(speaker);
        if (session.lastAction) {
            const memContent = recordCorrection(speaker, session.lastAction, transcription, intent.category, getCorrelationId());
            if (memContent) {
                addMemory(memContent).catch(() => { });
            }
        }
    }
    // Story 1.3 (ex 8.2): Check if clarification is needed
    const clarification = shouldClarify(speaker, transcription, intent.category, getCorrelationId());
    if (clarification) {
        await speakTTS(clarification + ", ou tu veux autre chose ?");
        return;
    }
    // ================================================================
    // Story 3.13: Household messaging intents
    // ================================================================
    if (intent.category === "household_message_send" || intent.category === "household_message_repeat") {
        const hm = globalThis.__householdMessaging;
        if (hm) {
            const session = getSession(speaker);
            const hmResponse = await handleHouseholdMessage(session, transcription, intent.category, hm);
            await speakTTS(hmResponse);
            return;
        }
    }
    // Story 3.13: Regex-based fallback for household messaging patterns
    if (/(?:dis|dit)\s+[aà]\s+\w+\s+(?:que|qu'|de\s|d'|:)/i.test(transcription) ||
        /laisse\s+(?:un\s+)?message\s+[aà]/i.test(transcription) ||
        /rappelle\s+[aà]\s+\w+\s+(?:que|de|d')/i.test(transcription) ||
        /pr[eé]viens\s+\w+\s+que/i.test(transcription)) {
        const hm = globalThis.__householdMessaging;
        if (hm) {
            const session = getSession(speaker);
            const hmResponse = await handleHouseholdMessage(session, transcription, "household_message_send", hm);
            await speakTTS(hmResponse);
            return;
        }
    }
    if (/r[eé]p[eè]te\s+le\s+message|redis[\s-]moi\s+le\s+message|quel\s+[eé]tait\s+le\s+message|c'[eé]tait\s+quoi\s+le\s+message/i.test(transcription)) {
        const hm = globalThis.__householdMessaging;
        if (hm) {
            const session = getSession(speaker);
            const hmResponse = await handleHouseholdMessage(session, transcription, "household_message_repeat", hm);
            await speakTTS(hmResponse);
            return;
        }
    }
    // ================================================================
    // DOMOTIQUE PIPELINE (Stories 15-17)
    // ================================================================
    // Story 15.5 / FR101: Undo domotique
    if (/annule|remets comme avant|undo/i.test(transcription) && isUndoAvailable()) {
        const result = await undoDomotique();
        if (result) {
            await speakTTS("C'est annule, j'ai remis comme avant.");
            return;
        }
    }
    // Story 15.5: Correction d'assignation
    if (/tu t'es tromp|mauvaise piece|pas dans/i.test(transcription)) {
        const corrected = await correctAssignment(transcription);
        if (corrected) {
            await speakTTS("C'est corrige !");
            return;
        }
    }
    // Story 13.2 Task 6.1: Device discovery via voice
    // "Diva, cherche les appareils" / "scanne le reseau" → smarthome_scan
    if (/cherche.*appareils?|scanne.*reseau|detecte.*appareils?|lance.*scan|new devices?|discovery/i.test(transcription)) {
        const local = await handleLocalIntent("smarthome_scan", transcription, speaker);
        if (local.handled && local.response) {
            await speakTTS(local.response);
            return;
        }
    }
    // Story 13.2 Task 6.1: "Quels appareils ne sont pas configurés ?"
    if (/quels?.*appareils?.*(?:pas|non).*configur|appareils?.*(?:pas|non).*configur|liste.*appareils?.*configur/i.test(transcription)) {
        const local = await handleLocalIntent("smarthome_unconfigured", transcription, speaker);
        if (local.handled && local.response) {
            await speakTTS(local.response);
            return;
        }
    }
    // Story FR93: Room management via voice (admin only)
    if (/cree une piece|ajoute une piece|nouvelle piece|ajouter.*piece/i.test(transcription)) {
        const roomMatch = transcription.match(/piece\s+(.+)/i);
        const roomName = roomMatch?.[1]?.trim() || "";
        if (roomName) {
            const haToken = (() => { try {
                return require("node:fs").readFileSync("/opt/diva-embedded/data/.ha-token", "utf-8").trim();
            }
            catch {
                return "";
            } })();
            try {
                await fetch("http://localhost:8123/api/services/homeassistant/reload_all", {
                    method: "POST", headers: { "Authorization": `Bearer ${haToken}`, "Content-Type": "application/json" },
                    body: "{}",
                });
            }
            catch { }
            await speakTTS(`Piece ${roomName} creee ! Tu peux y assigner des appareils maintenant.`);
        }
        else {
            await speakTTS("Comment tu veux appeler cette piece ?");
        }
        return;
    }
    if (/supprime.*piece|retire.*piece|enleve.*piece/i.test(transcription)) {
        const roomMatch = transcription.match(/piece\s+(.+)/i);
        const roomName = roomMatch?.[1]?.trim() || "";
        if (roomName) {
            await speakTTS(`Piece ${roomName} supprimee.`);
        }
        else {
            await speakTTS("Quelle piece tu veux supprimer ?");
        }
        return;
    }
    // Story 15.2 / FR93: Device assignment by sequential lighting
    if (/identifie|assigne|branche|nouvelle? ampoule|nouvel appareil/i.test(transcription) && intent.category === "home_control") {
        // Trigger device discovery and sequential identification
        const { runFullDiscovery } = await import("./smarthome/auto-discover.js");
        const haToken = (() => { try {
            return require("node:fs").readFileSync("/opt/diva-embedded/data/.ha-token", "utf-8").trim();
        }
        catch {
            return "";
        } })();
        await speakTTS("Je scanne le reseau pour trouver les nouveaux appareils...");
        const result = await runFullDiscovery(haToken);
        if (result && result.totalDevices > 0) {
            await speakTTS(`J'ai trouve ${result.totalDevices} appareils dans ${result.rooms.length} pieces. Tu peux les organiser dans le dashboard ou me dire ou chaque appareil se trouve.`);
        }
        else {
            await speakTTS("Je n'ai pas trouve de nouveaux appareils. Verifie qu'ils sont branches et connectes au reseau.");
        }
        return;
    }
    // Story 16.2 / FR96: Routine CREATION via conversation
    if (/chaque (matin|soir|jour|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)|tous les (matins|soirs|jours)|a \d+h/i.test(transcription) && /allume|eteins|ouvre|ferme|lance|demarre|mets|active/i.test(transcription)) {
        const { createRoutine } = await import("./smarthome/routine-manager.js");
        // Claude will parse the routine details
        await speakTTS("Je comprends que tu veux automatiser ca. Laisse-moi configurer la routine...");
        // For now, create a basic routine — Claude integration will handle the full parsing
        const routineName = `routine_${Date.now()}`;
        createRoutine(routineName, { type: "vocal" }, [{ type: "raw", config: { text: transcription } }], speaker);
        await speakTTS("C'est en place ! Tu pourras l'ajuster dans le dashboard.");
        return;
    }
    // Story 16.3 / FR103: Family scenarios
    if (/les enfants sont rentr|on y va|on part|soiree invit|on a des invit/i.test(transcription)) {
        const { activateMode: activateScenarioMode } = await import("./smarthome/modes-manager.js");
        if (/on y va|on part/i.test(transcription)) {
            // Departure scenario — already handled by mode detection below
        }
        else if (/enfants.*rentr/i.test(transcription)) {
            await speakTTS("Les enfants sont rentres ! J'allume l'entree et le salon.");
            // TODO: actual HA actions
        }
        else if (/invit/i.test(transcription)) {
            await speakTTS("Mode invites active ! Ambiance chaleureuse, je reste discrete.");
            // TODO: actual HA actions + invite mode
        }
        return;
    }
    // Story 16.1 / FR95: Enhanced trigger resolution via mode-trigger-resolver
    const resolvedModeId = resolveModeTrigger(transcription);
    if (resolvedModeId) {
        try {
            const { activateMode: activateModeV2 } = await import("./smarthome/mode-manager.js");
            const result = await activateModeV2(resolvedModeId, speaker, newCorrelationId());
            const failures = result.failures;
            if (failures.length > 0) {
                await speakTTS(`Mode ${result.mode.displayName} active, mais il y a eu ${failures.length} erreur${failures.length > 1 ? "s" : ""}.`);
            }
            else {
                const greetings = {
                    MAISON: "Mode maison active, bonjour !",
                    NUIT: "Bonne nuit !",
                    ABSENT: "Mode absent active, a plus tard !",
                };
                await speakTTS(greetings[result.mode.name] || `Mode ${result.mode.displayName} active !`);
            }
            return;
        }
        catch (err) {
            log.warn("Enhanced mode trigger failed, falling back", { error: String(err) });
        }
    }
    // Story 16.1 / FR95: Mode detection ("on part", "bonne nuit", "on est rentré") — legacy fallback
    const detectedMode = detectModeFromText(transcription);
    if (detectedMode) {
        await activateMode(detectedMode);
        const modeNames = { MAISON: "maison", NUIT: "nuit", ABSENT: "absent" };
        await speakTTS(`Mode ${modeNames[detectedMode] || detectedMode} active !`);
        return;
    }
    // Story 16.3 / FR103: Family scenario vocal trigger (after mode triggers, before routines)
    try {
        const { resolveVocalTrigger: resolveScenarioVocalTrigger, executeScenario: execScenario } = await import("./smarthome/scenario-manager.js");
        const scenarioId = resolveScenarioVocalTrigger(transcription);
        if (scenarioId !== null) {
            const corrId = newCorrelationId();
            const result = await execScenario(scenarioId, `vocal:${transcription}`, speaker, corrId);
            if (result.failures.length > 0) {
                await speakTTS(`Scenario lance avec ${result.failures.length} erreur${result.failures.length > 1 ? "s" : ""}.`);
            }
            else {
                await speakTTS("C'est parti !");
            }
            return;
        }
    }
    catch (err) {
        log.warn("Family scenario vocal trigger failed", { error: String(err) });
    }
    // Story 16.4 / FR104: Advanced scene vocal trigger (after family scenarios, before routines)
    try {
        const { resolveSceneTrigger, getSceneById: getAdvScene } = await import("./smarthome/scene-manager.js");
        const { executeScene: execAdvScene } = await import("./smarthome/scene-executor.js");
        const advSceneId = resolveSceneTrigger(transcription);
        if (advSceneId !== null) {
            const advScene = getAdvScene(advSceneId);
            if (advScene) {
                const corrId = newCorrelationId();
                const result = await execAdvScene(advScene, speaker, corrId);
                if (result.cancelled) {
                    await speakTTS("Scene annulee.");
                }
                else if (result.anomalies.length > 0) {
                    await speakTTS(`Scene ${advScene.displayName} terminee. Attention, ${result.anomalies.length} anomalie${result.anomalies.length > 1 ? "s" : ""} detectee${result.anomalies.length > 1 ? "s" : ""}.`);
                }
                else {
                    await speakTTS(`Scene ${advScene.displayName} lancee !`);
                }
                return;
            }
        }
    }
    catch (err) {
        log.warn("Advanced scene vocal trigger failed", { error: String(err) });
    }
    // Story 16.5 / FR105: Scene contextual execution via voice
    // Detects "scene X", "lance la scene X", "active la scene X"
    const sceneVocalMatch = transcription.match(/(?:sc[eè]ne|lance(?:\s+la)?\s+sc[eè]ne|active(?:\s+la)?\s+sc[eè]ne)\s+(.+)/i);
    if (sceneVocalMatch) {
        const sceneName = sceneVocalMatch[1].trim();
        try {
            const { getSceneByName, executeScene } = await import("./smarthome/scene-suggestion-engine.js");
            const scene = getSceneByName(sceneName);
            if (scene) {
                const corrId = newCorrelationId();
                const result = await executeScene(scene.id, speaker, "vocal", corrId);
                if (result.failed === 0) {
                    await speakTTS(`Scene ${scene.name} activee.`);
                }
                else if (result.executed > 0) {
                    await speakTTS(`Scene ${scene.name} activee partiellement, certains appareils ne repondent pas.`);
                }
                else {
                    await speakTTS(`Impossible d'activer la scene ${scene.name}.`);
                }
                return;
            }
        }
        catch (err) {
            log.warn("Scene vocal execution failed", { sceneName, error: String(err) });
        }
    }
    // Story 16.2 / FR96: Conversational routine vocal trigger (after mode triggers, before intent router)
    const routineVocalId = resolveRoutineVocalTrigger(transcription);
    if (routineVocalId) {
        try {
            const corrId = newCorrelationId();
            const execResult = await executeConversationalRoutine(routineVocalId, speaker, corrId);
            if (execResult.failures.length > 0) {
                await speakTTS(`C'est parti ! Mais il y a eu ${execResult.failures.length} erreur${execResult.failures.length > 1 ? "s" : ""}.`);
            }
            else {
                await speakTTS("C'est parti !");
            }
            return;
        }
        catch (err) {
            log.warn("Conversational routine vocal trigger failed", { routineVocalId, error: String(err) });
        }
    }
    // Story 16.2 / FR96: Routine trigger ("soirée ciné", "grasse mat") — legacy fallback
    const routineMatch = detectRoutineTrigger(transcription);
    if (routineMatch) {
        await executeRoutineLegacy(routineMatch);
        await speakTTS(`${routineMatch}, c'est lance !`);
        return;
    }
    // Story 16.4 / FR104: "Comme d'habitude" — habitual action replay (after routines, before intent router)
    if (/comme d.habitude|routine habituelle|comme d'habitude/i.test(transcription)) {
        try {
            const { handleCommeHabitude } = await import("./smarthome/habit-tracker.js");
            const corrId = newCorrelationId();
            const habitResult = await handleCommeHabitude(speaker, corrId);
            await speakTTS(habitResult.message);
            return;
        }
        catch (err) {
            log.warn("Comme d'habitude handler failed", { error: String(err) });
        }
    }
    // Story 16.4 / FR104: "Annule la scene" — cancel running scene
    if (/annule(?:\s+la)?\s+sc[eè]ne|stop(?:\s+la)?\s+sc[eè]ne/i.test(transcription)) {
        try {
            const { cancelScene } = await import("./smarthome/scene-executor.js");
            const result = cancelScene();
            if (result.cancelled) {
                await speakTTS("Scene annulee, les actions restantes ne seront pas executees.");
            }
            else if (result.runningScenes && result.runningScenes.length > 1) {
                const names = result.runningScenes.map((rs) => rs.sceneName).join(", ");
                await speakTTS(`Plusieurs scenes en cours : ${names}. Laquelle veux-tu annuler ?`);
            }
            else {
                await speakTTS("Aucune scene en cours.");
            }
            return;
        }
        catch (err) {
            log.warn("Scene cancel handler failed", { error: String(err) });
        }
    }
    // Story 17.1 / FR97: Child access control for domotique
    if (intent.category === "home_control" && getCurrentPersona().type === "child") {
        const roomMatch = transcription.match(/(?:du |de la |dans le |dans la )(\w+)/i);
        const room = roomMatch?.[1] || "";
        const accessCheck = canControlDevice(speaker, "", room);
        if (!accessCheck.allowed && accessCheck.reason) {
            const msg = getChildDenialMessage(accessCheck.reason);
            await speakTTS(msg);
            return;
        }
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
    // Story 15.1 / FR92 + Story 11.4: Domotique routing via LLM Router decision
    if (intent.category === "home_control" && routeDecision.engine === "qwen-domotique") {
        // Simple command → Qwen local (Story 11.4 / Task 4.3)
        console.log("[DOMOTIQUE] Simple command → Qwen local");
        try {
            const { generateBridgeResponse: genBridgeResp } = await import("./llm/qwen-bridge.js");
            const devices = []; // TODO: fetch from HA cache
            const prompt = buildQwenDomotiquePrompt(transcription, devices);
            const qwenResp = await genBridgeResp(prompt, speaker);
            if (qwenResp) {
                const action = parseQwenResponse(qwenResp.text);
                if (action) {
                    // Execute HA action
                    const haToken = (() => { try {
                        return require("node:fs").readFileSync("/opt/diva-embedded/data/.ha-token", "utf-8").trim();
                    }
                    catch {
                        return "";
                    } })();
                    const domain = action.domain || action.entityId.split(".")[0];
                    await fetch(`http://localhost:8123/api/services/${domain}/${action.action}`, {
                        method: "POST",
                        headers: { "Authorization": `Bearer ${haToken}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ entity_id: action.entityId }),
                    });
                    pushAction({ entityId: action.entityId, previousState: { state: "unknown" }, newState: { state: action.action }, timestamp: Date.now(), speakerId: speaker });
                    // Story 11.4 / Task 4.4: Respect shouldSpeak flag
                    if (routeDecision.shouldSpeak) {
                        // AC3: Mode executant → minimal confirmation
                        const confirmMsg = routeDecision.mode === "executant" ? "C'est fait." : "C'est fait !";
                        await speakTTS(confirmMsg);
                    }
                    else {
                        // AC6: Mode silencieux → play confirm beep if available
                        try {
                            await playAudioFile(`${ASSETS_DIR}/confirm-beep.wav`);
                        }
                        catch { }
                    }
                    recordDomoticAction(speaker, transcription, new Date());
                    return;
                }
            }
        }
        catch (e) {
            console.log("[DOMOTIQUE] Qwen failed, falling back to Claude");
        }
        // Qwen failed → will fall through to Claude below
        console.log("[DOMOTIQUE] Qwen failed, routing to Claude");
    }
    else if (intent.category === "home_control") {
        // Complex command → Claude-HA (Story 11.4 / Task 4.3)
        console.log("[DOMOTIQUE] Complex command → Claude");
    }
    // Story 9.2: Check for degradation announcement or status query before normal handling
    if (degradationAnnouncer.isDegraded()) {
        // AC8: If user is asking about system status, always respond with summary
        if (degradationAnnouncer.isStatusQuery(transcription)) {
            const statusMsg = degradationAnnouncer.generateStatusSummary(speaker);
            await speakTTS(statusMsg);
            logInteraction({
                timestamp: new Date().toISOString(),
                speaker, transcription,
                intent: "status_query", category: "system",
                response: statusMsg,
                latencyMs: Date.now() - t0,
            });
            return;
        }
        // AC1: Announce degradation to member if not yet notified
        const degradationMsg = degradationAnnouncer.generateDegradationMessage(speaker);
        if (degradationMsg) {
            await speakTTS(degradationMsg);
        }
    }
    else {
        // Check for recovery announcements even when not degraded
        const recoveryMsg = degradationAnnouncer.generateDegradationMessage(speaker);
        if (recoveryMsg) {
            await speakTTS(recoveryMsg);
        }
    }
    // Local intent handling (minimal: time, timer, calculator, dnd, about_me, speaker_register)
    if (intent.intent === "local" || intent.intent === "local_simple") {
        const local = await handleLocalIntent(intent.category, transcription, speaker);
        if (local.handled && local.response) {
            // Story 1.7: Apply implicit confirmation formatting
            let finalResponse = local.response;
            if (IMPLICIT_CONFIRMATIONS) {
                try {
                    const confirmCtx = {
                        actionType: intent.category,
                        actionSubType: undefined,
                        params: {},
                        rawResponse: local.response,
                        speakerName: getCurrentPersona()?.greetingName || undefined,
                        isComplex: false,
                    };
                    finalResponse = formatConfirmation(confirmCtx);
                    if (finalResponse !== null) {
                        // Also sanitize the formatted response
                        const sanitized = sanitizeConfirmation(finalResponse, "local");
                        finalResponse = sanitized.text;
                    }
                }
                catch (err) {
                    log.warn("Confirmation formatter error, using raw response", {
                        error: err instanceof Error ? err.message : String(err),
                    });
                    finalResponse = local.response;
                }
            }
            // Story 28.3: Silent action handling — skip TTS for simple domotique commands
            if (local.silentAction) {
                log.info("Silent action — skipping TTS", {
                    event: "silent-action",
                    category: intent.category,
                    correlationId: getCorrelationId(),
                });
                // Play click sound if persona has feedback sound enabled
                const persona = getCurrentPersona();
                const feedbackEnabled = persona?.silentActionFeedbackSound !== false;
                if (feedbackEnabled) {
                    try {
                        await playAudioFile(`${ASSETS_DIR}/click.wav`);
                    }
                    catch { }
                }
                // In companion mode, optionally add contextual phrase
                try {
                    const { getCurrentMode } = await import("./audio/wakeword-prosody.js");
                    const mode = getCurrentMode();
                    if (mode?.mode === "compagnon") {
                        const { getCompanionPhrase, getTimeOfDay } = await import("./smarthome/silent-executor.js");
                        const phrase = getCompanionPhrase(getTimeOfDay() ?? undefined);
                        if (phrase) {
                            await speakTTS(phrase);
                        }
                    }
                }
                catch { /* companion phrase is non-critical */ }
                // Story 11.4 / Task 4.4: Respect shouldSpeak from route decision
            }
            else if (finalResponse !== null && routeDecision.shouldSpeak) {
                console.log(`[LOCAL] "${finalResponse}"`);
                await speakTTS(finalResponse);
            }
            else if (!routeDecision.shouldSpeak) {
                // AC6: Mode silencieux — play confirm beep instead of TTS
                log.debug("Silent mode — skipping TTS", {
                    event: "silent-mode",
                    mode: routeDecision.mode,
                    category: intent.category,
                    correlationId: getCorrelationId(),
                });
                try {
                    await playAudioFile(`${ASSETS_DIR}/confirm-beep.wav`);
                }
                catch { }
            }
            else {
                // Story 1.7 / AC3: Silent action — no TTS
                log.debug("Silent confirmation", {
                    event: "confirmation-silent",
                    category: intent.category,
                    correlationId: getCorrelationId(),
                });
            }
            // CP#8 / FR90: Record domotique actions for emergent automations
            if (intent.category === "home_control" && speaker !== "unknown") {
                recordDomoticAction(speaker, transcription, new Date());
                const proposal = getProposal(speaker);
                if (proposal) {
                    setTimeout(async () => {
                        await speakTTS(proposal.message);
                    }, 2000);
                }
            }
            // CP#13 / FR91: Track device consumption
            if (intent.category === "home_control") {
                try {
                    const { recordAlertSent } = await import("./smarthome/eco-coach.js");
                    recordAlertSent(speaker);
                }
                catch { }
            }
            // Story 1.9: Resume ducked audio after local intent TTS
            if (SERVICE_CONTEXT_ENABLED && audioDucker.isDucked()) {
                try {
                    await audioDucker.resume();
                }
                catch { }
            }
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
    // Story 24.3 (AC6, AC7, Task 5.5): Implicit intent detection
    // When no explicit intent is matched, check for implicit intentions
    // (reminders, calendar planning) before falling through to Claude.
    if (intent.intent !== "local" || !intent.category) {
        try {
            const { detectImplicitIntentFromText } = await import("./routing/intent-router.js");
            const implicitIntent = await detectImplicitIntentFromText(transcription, speaker);
            if (implicitIntent) {
                log.info("Implicit intent detected", {
                    type: implicitIntent.type,
                    extracted: implicitIntent.extracted,
                    confidence: implicitIntent.confidence,
                    speaker,
                });
                // Emit internal event
                process.emit("intent.implicit-detected", {
                    type: implicitIntent.type,
                    extracted: implicitIntent.extracted,
                    speakerId: speaker,
                    when: implicitIntent.when,
                });
                // Ask for vocal confirmation before acting
                if (implicitIntent.confirmationMessage) {
                    await speakTTS(implicitIntent.confirmationMessage);
                    logInteraction({
                        timestamp: new Date().toISOString(),
                        speaker, transcription,
                        intent: "implicit-" + implicitIntent.type,
                        category: implicitIntent.type,
                        response: implicitIntent.confirmationMessage,
                        latencyMs: Date.now() - t0,
                    });
                    return;
                }
            }
        }
        catch (err) {
            log.warn("Implicit intent detection failed (non-blocking)", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    // Story 11.1 + 11.4: Qwen bridge for simple conversational intents
    // Task 2.3/2.4: Bridge is only called if handleLocalIntent() did NOT handle the intent
    // Story 11.4 / Task 3.7: Skip bridge in silencieux mode
    const tSttDone = Date.now();
    let bridgeText = null;
    if (routeDecision.engine === "qwen-bridge" && !shouldSkipBridgeForMode(routeDecision.mode)) {
        const personaName = getCurrentPersona().greetingName || speaker;
        const bridge = await generateBridgeResponse(transcription, personaName, intent.category);
        if (bridge) {
            bridgeText = bridge.text;
            if (routeDecision.shouldSpeak) {
                await speakTTS(bridge.text);
            }
            // Task 6.3: Measure end-to-end latency (STT done → first audio byte)
            const tFirstAudio = Date.now();
            log.info("Qwen bridge spoken", {
                text: bridge.text,
                durationMs: bridge.durationMs,
                category: intent.category,
                mode: routeDecision.mode,
                latencyE2eMs: tFirstAudio - tSttDone,
            });
        }
    }
    // Story 1.4 + 11.4: Contextual fillers — use route decision fillerNeeded flag (Task 4.5)
    let fillerHandle = null;
    if (!bridgeText && routeDecision.fillerNeeded && routeDecision.shouldSpeak) {
        const filler = chooseContextualFiller(intent.category, transcription, speaker);
        if (filler.primary) {
            fillerHandle = scheduleFillers(filler, getCorrelationId(), speaker, getCurrentPersona()?.type);
        }
    }
    // Story 27.5: Processing feedback DISABLED — causes audio lock conflicts
    // with TTS playback. Fillers (Story 1.4) handle the waiting UX instead.
    // startProcessingFeedback(getCorrelationId()).catch(() => {});
    // TODO Story 1.4 / Task 4.5: Call clearFillerHistory(speaker) from session expiration
    // callback when Session Manager supports onExpire hooks. For now, history is bounded
    // by FILLER_HISTORY_SIZE (5 entries per speaker) so memory is negligible.
    // Story 6.1 / Task 5: Enriched memory recall with semantic search + callback management
    // Story 4.2 / FR65, FR67: Isolate foyer data for unknown/guest/doubt-zone speakers
    if (shouldInjectPersonalData(speaker, speakerConfidenceScore)) {
        try {
            // Story 6.1 / Task 5.1: Semantic memory recall — already started in parallel above
            const recalledMemories = await _earlyMemoryPromise;
            let memorySummaryText;
            if (recalledMemories.length > 0) {
                memorySummaryText = recalledMemories
                    .map((m) => m.memory)
                    .join("\n");
            }
            else {
                // Fallback to basic memory summary if no semantic results
                memorySummaryText = await getMemorySummary();
            }
            // Story 6.1 / Task 5.4: Callback management
            const session = getSession(speaker);
            const exchangeCount = session.exchanges.filter((e) => e.role === "user").length;
            const canCallback = shouldInsertCallback(speaker, exchangeCount) && recalledMemories.length > 0;
            touchCallbackSession(speaker);
            const callbackLevel = getCallbackLevelSync(speaker);
            const remaining = getRemainingCallbacks(speaker);
            // Story 6.1 / Task 5.2: Pass enriched memory to system prompt
            claude.setMemorySummary(memorySummaryText);
            // Store callback metadata for post-response processing
            claude._story61_callbackLevel = callbackLevel;
            claude._story61_remaining = canCallback ? remaining : 0;
            claude._story61_memorySummary = memorySummaryText;
            // Story 6.2 / Task 6.2: Retrieve preferences and upcoming dates for system prompt
            try {
                const prefs = await getActivePreferences(speaker, 10);
                if (prefs.length > 0) {
                    claude._story62_preferencesSummary = formatPreferencesForPrompt(prefs);
                }
                const upcoming = await getUpcomingDates(speaker, 7);
                if (upcoming.length > 0) {
                    claude._story62_upcomingDatesSummary = upcoming
                        .map((d) => `- ${d.label} (${d.date})`)
                        .join("\n");
                }
            }
            catch (err) {
                log.warn("Story 6.2 preference/date retrieval failed", {
                    speakerId: speaker,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            // Story 6.3 / Task 5: Resolve conversational aliases before Claude call
            try {
                const aliasResult = await resolveConversationalAliases(transcription, speaker, getCorrelationId());
                const aliasContext = formatAliasContextForPrompt(aliasResult, getCurrentPersona()?.greetingName);
                if (aliasContext) {
                    claude._story63_aliasContext = aliasContext;
                }
                // Store ambiguities for follow-up disambiguation
                if (aliasResult.ambiguous.length > 0) {
                    for (const amb of aliasResult.ambiguous) {
                        aliasDisambiguator.addPending(speaker, amb);
                    }
                }
            }
            catch (err) {
                // AC8: Graceful degradation — continue without alias context
                log.warn("Story 6.3 alias resolution failed, continuing without", {
                    speakerId: speaker,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        catch (err) {
            // AC8: Graceful degradation — fall back to basic summary
            log.warn("Story 6.1 memory recall failed, falling back to basic", {
                speakerId: speaker,
                error: err instanceof Error ? err.message : String(err),
            });
            const freshMemory = await getMemorySummary();
            claude.setMemorySummary(freshMemory);
        }
    }
    else {
        claude.setMemorySummary("");
    }
    // Story 1.1: Inject full context (session + Mem0 + system state) via context injector
    let sessionContext = "";
    try {
        sessionContext = await buildFullContext(speaker);
    }
    catch {
        // Graceful degradation: fall back to basic session context
        sessionContext = buildSessionContext(speaker);
    }
    // Story 1.2: Conversation resumption after interruption
    try {
        if (canResumeConversation(speaker)) {
            const resumptionPrompt = buildResumptionPrompt(speaker);
            if (resumptionPrompt) {
                sessionContext = sessionContext
                    ? sessionContext + "\n\n" + resumptionPrompt
                    : resumptionPrompt;
                markResumeConsumed(speaker);
                log.info("Conversation resumption injected", {
                    speakerId: speaker,
                    resumeDelayMinutes: Math.floor((Date.now() - (Date.now() - 60000)) / 60000),
                });
            }
        }
    }
    catch (err) {
        log.warn("Conversation resumption failed, continuing without", {
            speakerId: speaker,
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 1.3: Inject correction context into Claude system prompt
    try {
        const correctionCtx = buildCorrectionContext(speaker, intent.category);
        if (correctionCtx) {
            sessionContext = sessionContext
                ? sessionContext + "\n\n" + correctionCtx
                : correctionCtx;
        }
    }
    catch (err) {
        log.warn("Correction context injection failed, continuing without", {
            speakerId: speaker,
            error: err instanceof Error ? err.message : String(err),
        });
    }
    claude.setSessionContext(sessionContext);
    // Story 6.4 / Task 6.1-6.2: Build humor context and inject into system prompt
    try {
        const persona = getCurrentPersona();
        const session = getSession(speaker);
        const memorySummaryText = claude._story61_memorySummary;
        const humorCtx = buildHumorContext(speaker, persona, session, memorySummaryText, getCorrelationId());
        if (humorCtx) {
            claude._story64_humorContext = humorCtx;
        }
    }
    catch (err) {
        // AC8: Graceful degradation — continue without humor context
        log.warn("Story 6.4 humor context build failed, continuing without", {
            speakerId: speaker,
            error: err instanceof Error ? err.message : String(err),
        });
    }
    // Story 6.5 / Task 6.1-6.4: Transparency detection and context injection
    try {
        if (isTransparencyQuestion(transcription)) {
            const matchedPattern = getMatchedPattern(transcription);
            const actionKeywords = extractActionReference(transcription);
            const rationale = findRationale(speaker, actionKeywords);
            const transparencyCtx = formatTransparencyPrompt(rationale);
            claude._story65_transparencyContext = transparencyCtx;
            log.info("Transparency question detected", {
                speakerId: speaker,
                detectedPattern: matchedPattern,
                matchedAction: rationale?.action || "none",
                hasRationale: !!rationale,
                correlationId: getCorrelationId(),
            });
            if (!rationale) {
                log.info("No rationale fallback", {
                    speakerId: speaker,
                    action: "no-rationale-fallback",
                    correlationId: getCorrelationId(),
                });
            }
        }
        else if (isHeuristicContestation(transcription)) {
            // Story 6.5 / Task 5.3: Handle heuristic contestation after transparency
            const lastRat = getLastRationale(speaker);
            if (lastRat) {
                const mem0Text = processHeuristicCorrection(speaker, lastRat, transcription, getCorrelationId() || "");
                if (mem0Text) {
                    addMemory(mem0Text).catch(() => { });
                }
                claude._story65_transparencyContext = formatContestationPrompt();
            }
        }
    }
    catch (err) {
        // AC8: Graceful degradation — continue without transparency
        log.warn("Story 6.5 transparency processing failed, continuing without", {
            speakerId: speaker,
            error: err instanceof Error ? err.message : String(err),
            correlationId: getCorrelationId(),
        });
    }
    // Story 11.4 / Task 3.6 + AC8: Inject behavioral mode modifier into Claude prompt
    claude._story114_modeModifier = routeDecision.promptModifier;
    // Story 11.1 / Task 4 + Story 11.4 / Task 4.7: Tell Claude what Qwen already said
    if (bridgeText) {
        claude.setSessionContext(sessionContext + "\n" + routeDecision.promptModifier + "\n" + buildBridgeContextTag(bridgeText));
    }
    else {
        // Inject mode modifier even without bridge text
        claude.setSessionContext(sessionContext + "\n" + routeDecision.promptModifier);
    }
    // Claude streaming + TTS (single-pass)
    log.info("Claude streaming start", { correlationId: getCorrelationId() });
    // Story 1.5 / Task 3.1: Capture stream start time for latency measurement
    const streamStartTime = Date.now();
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
    // Story 10.4: LLM Router — fallback multi-niveaux
    const backend = getCurrentBackend();
    let fullResponse = "";
    const correlationId = getCorrelationId();
    if (backend === "claude") {
        try {
            const claudePromise = claude.chatStreaming(transcription, (sentence, isFirst) => {
                // Story 1.5 / Task 3.2: Measure first sentence latency
                if (isFirst) {
                    const firstSentenceLatencyMs = Date.now() - streamStartTime;
                    log.info("Streaming TTS first sentence latency", {
                        firstSentenceLatencyMs,
                        correlationId,
                    });
                    // Task 3.4: Warn if latency exceeds target
                    if (firstSentenceLatencyMs > STREAMING_FIRST_SENTENCE_TARGET_MS) {
                        log.warn("Streaming TTS first sentence exceeded target", {
                            firstSentenceLatencyMs,
                            targetMs: STREAMING_FIRST_SENTENCE_TARGET_MS,
                            correlationId,
                        });
                    }
                    // Story 1.5 / Task 5.1: Cancel filler BEFORE pushing the first sentence
                    fillerHandle?.cancel();
                }
                // Story 1.7: Sanitize Claude streaming sentences
                let sanitizedSentence = sentence;
                if (IMPLICIT_CONFIRMATIONS) {
                    try {
                        const sr = sanitizeConfirmation(sentence, "claude");
                        sanitizedSentence = sr.text;
                    }
                    catch { /* fallback to original sentence */ }
                }
                log.debug("Claude stream sentence", { first: isFirst, sentence: sanitizedSentence.slice(0, 50), correlationId });
                pushSentence(sanitizedSentence);
            }).then((resp) => {
                finishSentences();
                reportClaudeSuccess();
                return resp;
            });
            // Story 1.5 / Task 6.5: Pass correlationId to speakTTSStreaming
            const ttsPromise = speakTTSStreaming(asyncSentenceIterable, correlationId);
            const [claudeResp] = await Promise.all([claudePromise, ttsPromise]);
            fullResponse = claudeResp || "";
        }
        catch (err) {
            // Story 1.5 / Task 4.5: Global streaming fallback
            log.warn("Claude streaming failed, falling back", {
                error: err instanceof Error ? err.message : String(err),
                correlationId,
            });
            reportClaudeFailure();
            finishSentences();
            // Story 27.5: Stop processing feedback before fallback TTS
            await stopProcessingFeedback();
            // Story 1.5 / AC12: If we have partial response, try to speak it
            if (fullResponse && fullResponse.trim().length > 0) {
                log.warn("Streaming TTS global fallback: speaking partial response", {
                    reason: "streaming_error",
                    correlationId,
                });
                // Story 1.7: Sanitize fallback response
                let fallbackText = fullResponse;
                if (IMPLICIT_CONFIRMATIONS) {
                    try {
                        fallbackText = sanitizeConfirmation(fullResponse, "claude").text;
                    }
                    catch { /* use original */ }
                }
                await speakTTS(fallbackText);
            }
            else {
                // Fallback to local response
                const degradeMsg = getDegradationAnnouncement();
                if (degradeMsg)
                    await speakTTS(degradeMsg);
                await speakTTS("Je n'ai pas pu repondre a ca pour le moment.");
            }
            return;
        }
    }
    else if (backend === "qwen-local") {
        // Qwen local fallback (basic response via rkllama)
        const degradeMsg = getDegradationAnnouncement();
        if (degradeMsg)
            await speakTTS(degradeMsg);
        finishSentences();
        await speakTTS("Je suis en mode economique. Pose-moi des questions simples.");
        return;
    }
    else {
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
    // Story 6.4 / Task 6.3: Post-response humor detection
    try {
        if (detectAndLogHumor(fullResponse, speaker, getCorrelationId())) {
            markHumorUsed(speaker);
        }
    }
    catch {
        // Non-blocking — best effort detection
    }
    // Story 6.5 / Task 6.3: Record rationale for Diva's response (if it contains a suggestion/action)
    try {
        const session = getSession(speaker);
        if (fullResponse && session.lastAction) {
            const memorySummaryText = claude._story61_memorySummary;
            const reasons = [];
            const sources = [];
            if (memorySummaryText) {
                reasons.push(memorySummaryText.slice(0, 200));
                sources.push("memory");
            }
            if (session.lastCategory) {
                sources.push("session");
            }
            if (reasons.length > 0 || sources.length > 0) {
                recordRationale(speaker, {
                    action: session.lastAction || fullResponse.slice(0, 100),
                    reasons,
                    sources: sources.length > 0 ? sources : ["session"],
                    timestamp: Date.now(),
                    correlationId: getCorrelationId() || "",
                });
            }
        }
    }
    catch {
        // Non-blocking — best effort rationale recording
    }
    // Story 1.9: Resume ducked audio after TTS is complete
    if (SERVICE_CONTEXT_ENABLED && audioDucker.isDucked()) {
        try {
            await audioDucker.resume();
        }
        catch (err) {
            log.warn("Audio resume after TTS failed", {
                error: err instanceof Error ? err.message : String(err),
                correlationId: getCorrelationId(),
            });
        }
    }
    // Story 6.1 / Task 5.3: Fire-and-forget fact extraction after response
    if (speaker !== "unknown" && speaker !== "default" && getCurrentPersona().id !== "guest") {
        extractAndSaveFacts(transcription, fullResponse, speaker, getCorrelationId()).catch((err) => {
            log.warn("Fact extraction fire-and-forget failed", {
                speakerId: speaker,
                error: err instanceof Error ? err.message : String(err),
            });
        });
        // Story 6.2 / Task 6.1: Fire-and-forget preference extraction after response
        extractAndSavePreferences(transcription, fullResponse, speaker, getCorrelationId()).catch((err) => {
            log.warn("Preference extraction fire-and-forget failed", {
                speakerId: speaker,
                error: err instanceof Error ? err.message : String(err),
            });
        });
        // Story 6.2 / Task 6.1: Fire-and-forget date extraction after response
        extractAndSaveDates(transcription, speaker, createDateReminder, getCorrelationId()).catch((err) => {
            log.warn("Date extraction fire-and-forget failed", {
                speakerId: speaker,
                error: err instanceof Error ? err.message : String(err),
            });
        });
    }
    logInteraction({
        timestamp: new Date().toISOString(),
        speaker, transcription,
        intent: intent.intent, category: intent.category,
        response: fullResponse,
        latencyMs: Date.now() - t0,
    });
    // Story 1.8: Record request pattern after successful interaction
    if (FORMULATION_HELP_ENABLED && speaker !== "unknown") {
        try {
            const keywords = transcription.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
            requestPatternStore.recordInteraction(speaker, intent.category, keywords, intent.confidence);
        }
        catch (err) {
            log.warn("Pattern recording failed (non-blocking)", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    // Story 3.6 / AC1, AC7: Proactive greeting for unknown voices — AFTER the response
    try {
        const persona = getCurrentPersona();
        if (persona.id === "guest" || persona.type === "guest") {
            const greetStartMs = Date.now();
            if (shouldGreet(speaker)) {
                const isChild = getVisitorRecord(speaker)?.isChildVoice === true;
                const greetingMsg = await greetUnknownVoice(speaker, isChild, getCorrelationId());
                if (greetingMsg) {
                    await speakTTS(greetingMsg);
                }
            }
            const greetOverhead = Date.now() - greetStartMs;
            log.debug("Visitor greeting overhead", { latencyMs: greetOverhead, speaker });
        }
    }
    catch (err) {
        log.warn("Proactive greeting failed (non-blocking)", {
            error: err instanceof Error ? err.message : String(err),
            correlationId: getCorrelationId(),
        });
    }
}
// =====================================================================
// VOICE REGISTRATION (explicit)
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
    try {
        execSync("pkill -9 arecord || true", { timeout: 3000 });
    }
    catch { }
    console.log("[INIT] Cleaned up old processes");
    console.log("[DIVA] Ready!");
    // FIRST_BOOT: Launch OOBE proactively without waiting for wake word
    if (shouldTriggerOOBE()) {
        console.log("[OOBE] First boot — launching proactive onboarding");
        try {
            await sleep(2000);
            const oobeResult = await runOOBE();
            if (oobeResult?.completed && oobeResult.adminName) {
                setCurrentPersona(oobeResult.adminName);
                const f = getFoyer();
                if (f) {
                    const members = getMembers(f.id);
                    registerHouseholdNames(members.map(m => ({
                        normalized: m.name,
                        variants: [m.name.toLowerCase(), m.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")],
                    })));
                }
                console.log("[OOBE] Onboarding completed — entering normal mode");
            }
        }
        catch (err) {
            console.error("[OOBE] Proactive onboarding error:", err);
        }
    }
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
    log.info("Shutting down...");
    // Story 29.1: Stop proactive scheduler loop cleanly
    try {
        if (proactiveLoop)
            proactiveLoop.stop();
    }
    catch { /* already stopped */ }
    // Story 16.2: Stop conversational routine scheduler cleanly
    try {
        stopRoutineScheduler();
    }
    catch { /* already stopped */ }
    // Story 16.3: Stop scenario event listener cleanly
    try {
        import("./smarthome/scenario-event-listener.js").then(m => m.stop()).catch(() => { });
    }
    catch { /* already stopped */ }
    closeDatabases();
    process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
main().catch((err) => {
    console.error("[DIVA] Fatal error:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map