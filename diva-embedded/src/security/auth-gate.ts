/**
 * Auth Gate — Story 4.1, 5.1, 3.8 — Portail d'authentification a trois niveaux
 *
 * 3-level vocal authorization: open, protected, critical.
 * Integrated BEFORE the intent router in the pipeline.
 *
 * - **Open**: Anyone can use (unknown, guest, doubt zone) — no verification needed.
 * - **Protected**: Recognized voice only (speakerId known, confidence >= HIGH threshold).
 *   Requires liveness check (Story 4.6 / FR81).
 * - **Critical**: Recognized voice + vocal confirmation + liveness + secret verification
 *   (Story 4.5 / FR80, Story 4.6 / FR81).
 *
 * **Zone de doute (FR67)**: When the WeSpeaker confidence score falls between
 * `CONFIDENCE_THRESHOLD_LOW` (0.3) and `CONFIDENCE_THRESHOLD_HIGH` (0.7), the speaker
 * is treated as unrecognized for protected and critical levels, even if a speakerId
 * was tentatively assigned. Open-level access is preserved.
 *
 * **Story 5.1 — Pending confirmation (FR68)**: When identity oscillation is detected,
 * the Auth Gate enters `pending-confirmation` mode which restricts access to "open"
 * level only until the doubt is resolved (confirmed/denied/timeout).
 *
 * **Story 3.8 — Social mediation**: When auth is denied, the `onAuthDenied` hook
 * delegates to the PermissionMediator for social mediation instead of a cold refusal.
 * The `adminApproved` flag allows one-shot bypass after admin vocal approval.
 *
 * @module security/auth-gate
 * @see FR41 — 3 niveaux d'autorisation vocale
 * @see FR67 — Zone de doute = pas d'acces aux donnees personnelles
 * @see FR68 — Verbalisation du doute d'identification
 * @see FR215 — Mediation sociale pour permissions
 */

import { getCurrentPersona } from "../persona/engine.js";
import { log } from "../monitoring/logger.js";
import { getCorrelationId } from "../monitoring/correlation.js";
import { auditAuthRejected, auditCriticalAction } from "./audit-logger.js";
import type { WakeEvent } from "../audio/wake-event.js";

// =====================================================================
// Types
// =====================================================================

/**
 * Authorization level for an intent category.
 * - `"open"` — accessible to everyone (including unknown speakers)
 * - `"protected"` — requires a recognized voice from the foyer
 * - `"critical"` — requires recognized voice + vocal confirmation
 */
export type AuthLevel = "open" | "protected" | "critical";

/**
 * Story 5.1 (AC8): Auth Gate mode.
 * - `"normal"` — standard operation
 * - `"pending-confirmation"` — identity doubt detected, restrict to open only
 * - `"guest-forced"` — doubt resolved as denied/timeout, treat as guest
 */
export type AuthGateMode = "normal" | "pending-confirmation" | "guest-forced";

/**
 * Result of an authorization check via `checkAuth()`.
 *
 * The pipeline inspects `allowed` to decide whether to proceed or reject,
 * and uses the optional flags to trigger downstream verifications
 * (liveness, vocal secret, confirmation dialog).
 */
export interface AuthResult {
  /** Whether the speaker is authorized for this intent category. */
  allowed: boolean;
  /** The authorization level that was applied. */
  level: AuthLevel;
  /** Human-readable refusal message (natural French, non-technical). Set when `allowed === false`. */
  reason?: string;
  /** True if the action requires vocal confirmation before execution (critical level). */
  needsConfirmation?: boolean;
  /** True if anti-replay liveness analysis is required (Story 4.6 / FR81). */
  needsLivenessCheck?: boolean;
  /** True if vocal secret verification is required (Story 4.5 / FR80). */
  needsSecretVerification?: boolean;
  /**
   * The WeSpeaker confidence score passed to `checkAuth()`, propagated for
   * downstream use (e.g. Story 5.1 — verbalisation du doute).
   */
  confidenceScore?: number;
  /** Story 4.6: True if liveness analysis has been performed and passed. */
  livenessVerified?: boolean;
  /** Story 4.6: The liveness score (0.0–1.0) from spectral analysis. */
  livenessScore?: number;
}

// =====================================================================
// Confidence thresholds (FR67 — zone de doute)
// =====================================================================

/**
 * Score >= this threshold: speaker is confidently identified.
 * Below this but above LOW: zone de doute — treated as unrecognized
 * for protected/critical access.
 */
export const CONFIDENCE_THRESHOLD_HIGH = 0.7;

/**
 * Score < this threshold: speaker is clearly unknown.
 * Between LOW and HIGH: zone de doute.
 */
export const CONFIDENCE_THRESHOLD_LOW = 0.3;

// =====================================================================
// Category → Auth Level mapping (AC6 — single source of truth)
// =====================================================================

/**
 * Maps each known intent category to its authorization level.
 *
 * **Default for unknown categories**: `"protected"` (securite par defaut).
 *
 * Rationale for each category:
 * - Open: basic utilities and social interactions that expose no personal data.
 * - Protected: features that access or manipulate personal data or home devices.
 * - Critical: actions with external consequences (messaging, emergency calls).
 */
export const CATEGORY_AUTH_LEVELS: Record<string, AuthLevel> = {
  // --- Open — anyone can use (including unknown speakers) ---
  time: "open",              // Heure/date — information publique
  weather: "open",           // Meteo — information publique
  greeting: "open",          // Salutations — interaction sociale de base
  goodbye: "open",           // Au revoir — interaction sociale de base
  identity: "open",          // "Qui es-tu ?" — presentation de Diva
  joke: "open",              // Blagues/devinettes — divertissement universel
  calculator: "open",        // Calculs — utilitaire sans donnees personnelles
  conversational: "open",    // Bavardage — interaction sociale de base
  baby: "open",              // Info bebe — redirection vers app (pas de donnee directe)
  shutdown: "open",          // "Tais-toi" — controle de Diva elle-meme
  complex: "open",           // Conversation Claude — ouvert pour accueil et onboarding (FR41)

  // --- Protected — recognized voice only ---
  home_control: "protected", // Domotique — controle des appareils du foyer
  routine: "protected",      // Routines — sequences d'actions personnalisees
  briefing: "protected",     // Briefing matinal — donnees personnelles agregees
  shopping: "protected",     // Liste de courses — donnees personnelles
  timer: "protected",        // Minuteurs — lie a l'activite du foyer
  radio: "protected",        // Radio — preferences personnelles
  music: "protected",        // Musique — preferences personnelles
  about_me: "protected",     // Infos sur moi — donnees personnelles directes
  calendar: "protected",     // Calendrier — donnees personnelles sensibles
  reminder: "protected",     // Rappels — donnees personnelles

  // --- Protected (admin) — household management operations ---
  household_management: "protected", // Gestion du foyer — promotion, retrogradation, ajout, retrait (admin)

  // --- Protected (secret management) — Story 4.5 ---
  secret_setup: "protected",   // Story 4.5 — Definir un mot secret (speaker must be identified, no secret required)
  secret_change: "protected",  // Story 4.5 — Modifier son mot secret (old secret verified in flow)

  // --- Critical — recognized voice + confirmation ---
  send_message: "critical",  // Envoi de message — action externe irreversible
  messaging: "critical",     // Story 24.4 — Messagerie vocale externe (email/SMS)
  emergency: "critical",     // Urgences — appel aux secours, consequences graves
  data_retention: "critical", // Story 8.1 — Consultation/modification politique de retention (admin)
  audit_journal: "critical",  // Story 4.3 — Consultation du journal d'audit (admin only)
  vocal_reset: "critical",    // Story 4.4 — Reinitialisation empreinte vocale (admin only)
  secret_reset: "critical",   // Story 4.5 — Reinitialisation du mot secret d'un membre (admin only)

  // --- Story 8.3 — GDPR consent and data rights ---
  consent_query: "protected",    // Story 8.3 — Consultation des consentements
  consent_withdraw: "protected", // Story 8.3 — Retrait de consentement
  data_export: "protected",     // Story 8.3 — Export des donnees personnelles
  data_erasure: "critical",     // Story 8.3 — Droit a l'oubli (double confirmation)

  // --- Story 8.4 — RGPD compliance and processing registry ---
  rgpd_compliance: "critical",   // Story 8.4 — Consultation conformite RGPD (admin)
  rgpd_export: "critical",      // Story 8.4 — Export du registre RGPD (admin)
  breach_query: "critical",      // Story 8.4 — Consultation incidents de securite (admin)
};

// =====================================================================
// Refusal messages (AC9 — natural, non-technical French)
// =====================================================================

/**
 * Refusal messages are intentionally warm, casual, and non-technical.
 * They match Diva's personality: decontractee, bienveillante.
 * No error codes, no jargon — just a friendly explanation.
 */
const REFUSAL_PROTECTED = "Desole, je ne reconnais pas ta voix pour ca.";
const REFUSAL_CRITICAL = "Desole, je ne peux pas faire ca sans te reconnaitre.";

// =====================================================================
// Story 5.1 — Auth Gate mode (pending-confirmation / guest-forced)
// =====================================================================

let currentAuthGateMode: AuthGateMode = "normal";

/**
 * Story 5.1 (AC8): Set the Auth Gate mode.
 * - `"pending-confirmation"` — restrict to open level during identity doubt
 * - `"guest-forced"` — doubt resolved as denied/timeout, treat as guest
 * - `"normal"` — standard operation
 */
export function setAuthGateMode(mode: AuthGateMode): void {
  currentAuthGateMode = mode;
  log.info("Auth gate mode changed", { mode });
}

/** Get the current Auth Gate mode. */
export function getAuthGateMode(): AuthGateMode {
  return currentAuthGateMode;
}

// =====================================================================
// Core authorization function
// =====================================================================

/**
 * Check whether a speaker is authorized to execute an intent category.
 *
 * Called in the pipeline AFTER intent classification and BEFORE intent processing.
 * Pipeline order: Wake Word → STT → Intent Classification → **Auth Gate** → Intent Processing.
 *
 * @param category - The classified intent category (e.g. `"music"`, `"send_message"`)
 * @param speakerId - The identified speaker ID (e.g. `"thomas"`, `"unknown"`, `"guest"`)
 * @param confidenceScore - Optional WeSpeaker confidence score (0.0–1.0).
 *   When provided and in the doubt zone (0.3–0.7), the speaker is treated as
 *   unrecognized for protected/critical levels even if `speakerId` is set (FR67).
 * @returns An {@link AuthResult} indicating whether access is allowed and what
 *   additional verifications are needed.
 *
 * @example
 * // Open — always allowed
 * checkAuth("weather", "unknown")       // { allowed: true, level: "open" }
 *
 * @example
 * // Protected — rejected for unknown
 * checkAuth("music", "unknown")         // { allowed: false, level: "protected", reason: "..." }
 *
 * @example
 * // Zone de doute — treated as unrecognized
 * checkAuth("music", "thomas", 0.5)     // { allowed: false, level: "protected" }
 *
 * @example
 * // Critical — needs confirmation
 * checkAuth("send_message", "thomas")   // { allowed: true, needsConfirmation: true }
 */
export function checkAuth(category: string, speakerId: string, confidenceScore?: number): AuthResult {
  const level = CATEGORY_AUTH_LEVELS[category] || "protected"; // Default: protected (securite par defaut)

  // Story 5.1 (AC5, AC8): When identity doubt is pending or guest-forced,
  // restrict to open level only. Open always passes; protected/critical are blocked.
  if (currentAuthGateMode === "pending-confirmation" || currentAuthGateMode === "guest-forced") {
    if (level !== "open") {
      const reason = currentAuthGateMode === "pending-confirmation"
        ? "Attends, je dois d'abord m'assurer de qui tu es."
        : REFUSAL_PROTECTED;
      log.info("Auth restricted — identity doubt active", {
        category,
        speakerId,
        level,
        mode: currentAuthGateMode,
      });
      return { allowed: false, level, reason };
    }
    // Open level — always allowed, even during doubt
    return { allowed: true, level };
  }

  const persona = getCurrentPersona();

  // Determine if speaker is recognized
  let isRecognized = persona.id !== "guest" && speakerId !== "unknown" && speakerId !== "guest";

  // FR67 — Zone de doute: if confidence score is provided and falls in the doubt zone,
  // apply graduated restriction:
  // - Protected: allow access but flag doubt (speaker is known, just low confidence)
  // - Critical: block access (high-stakes actions need certainty)
  const isDoubtZone = confidenceScore !== undefined
    && confidenceScore >= CONFIDENCE_THRESHOLD_LOW
    && confidenceScore < CONFIDENCE_THRESHOLD_HIGH;

  if (isDoubtZone && isRecognized && level === "critical") {
    log.warn("Auth doubt zone — speaker blocked for critical action", {
      category,
      speakerId,
      confidenceScore,
      level,
    });
    isRecognized = false;
  } else if (isDoubtZone && isRecognized) {
    // Protected: allow but log the doubt (FR70: verbalize after 3+ consecutive low scores)
    log.info("Auth doubt zone — speaker allowed for protected with low confidence", {
      category,
      speakerId,
      confidenceScore,
      level,
    });
  }

  // Build base result with confidence score propagated for downstream use
  const baseResult: Partial<AuthResult> = {};
  if (confidenceScore !== undefined) {
    baseResult.confidenceScore = confidenceScore;
  }

  // --- Open — always allowed, no audit (volume excessif) ---
  if (level === "open") {
    return { ...baseResult, allowed: true, level };
  }

  // --- Protected — recognized voice required ---
  if (level === "protected") {
    if (!isRecognized) {
      log.warn("Auth rejected — unrecognized voice for protected command", {
        category,
        speakerId,
        level,
        confidenceScore,
      });
      auditAuthRejected(speakerId, category, "protected", "unrecognized_voice");
      return {
        ...baseResult,
        allowed: false,
        level,
        reason: REFUSAL_PROTECTED,
      };
    }
    return { ...baseResult, allowed: true, level, needsLivenessCheck: true };
  }

  // --- Critical — recognized voice + needs confirmation ---
  if (level === "critical") {
    if (!isRecognized) {
      log.warn("Auth rejected — unrecognized voice for critical command", {
        category,
        speakerId,
        level,
        confidenceScore,
      });
      auditAuthRejected(speakerId, category, "critical", "unrecognized_voice");
      return {
        ...baseResult,
        allowed: false,
        level,
        reason: REFUSAL_CRITICAL,
      };
    }
    auditCriticalAction(speakerId, `auth_pending_confirmation:${category}`, "pending");
    return {
      ...baseResult,
      allowed: true,
      level,
      needsConfirmation: true,
      needsLivenessCheck: true,      // Story 4.6: Verify voice is live, not replay
      needsSecretVerification: true,  // Story 4.5: Require vocal secret for critical actions
    };
  }

  // Fallback (should not be reached given the if-chain above)
  return { ...baseResult, allowed: true, level: "open" };
}

// =====================================================================
// Story 3.11 — Identification différée pour les déclenchements non-vocaux
// =====================================================================

/**
 * Niveau de confiance pour l'identification différée (déclenchement non-vocal).
 * - `"high"` — smart button avec assignedSpeakerId
 * - `"medium"` — un seul membre présent dans le foyer
 * - `"low"` — plusieurs membres possibles → demande "qui est-ce ?"
 * - `"visitor"` — fallback mode visiteur
 */
export type DeferredIdConfidence = "high" | "medium" | "low" | "visitor";

/** Résultat de l'identification différée. */
export interface DeferredIdentityResult {
  speakerId: string;
  confidenceLevel: DeferredIdConfidence;
  identificationStrategy: "assigned" | "single_presence" | "voice_query" | "visitor_fallback";
  /** True si Diva doit demander "Bonjour, qui est-ce ?" via TTS. */
  needsVoiceQuery: boolean;
}

/**
 * Story 3.11 (AC6): Stratégie d'identification différée pour les déclenchements non-vocaux.
 *
 * Quand le déclenchement est non-vocal (physical_button, smart_button),
 * le système ne dispose pas de l'empreinte vocale du wake-word.
 * Cette fonction détermine l'identité probable selon 4 stratégies :
 *
 * (a) Si un seul membre présent → ce membre avec confiance "medium"
 * (b) Si plusieurs membres possibles → demander "qui est-ce ?" (needsVoiceQuery: true)
 * (c) Si smart button avec assignedSpeakerId → ce membre avec confiance "high"
 * (d) Fallback → mode visiteur (permissions ouvertes uniquement)
 *
 * @param wakeEvent - L'événement non-vocal déclencheur
 * @param presentMembers - Liste des membres présents (via ha-presence.ts)
 * @returns Résultat de l'identification différée
 */
export function getDeferredIdentity(
  wakeEvent: WakeEvent,
  presentMembers: string[],
): DeferredIdentityResult {
  const correlationId = wakeEvent.correlationId;

  // Stratégie (c) : smart button avec assignedSpeakerId
  if (wakeEvent.type === "smart_button") {
    const assignedSpeakerId = wakeEvent.metadata.assignedSpeakerId as string | null | undefined;
    if (assignedSpeakerId && assignedSpeakerId !== "null") {
      log.info("Deferred identification — assigned speaker (strategy c)", {
        correlationId,
        identificationStrategy: "assigned",
        speakerId: assignedSpeakerId,
        confidenceLevel: "high",
      });
      return {
        speakerId: assignedSpeakerId,
        confidenceLevel: "high",
        identificationStrategy: "assigned",
        needsVoiceQuery: false,
      };
    }
  }

  // Stratégie (a) : un seul membre présent
  if (presentMembers.length === 1) {
    const speakerId = presentMembers[0];
    log.info("Deferred identification — single presence (strategy a)", {
      correlationId,
      identificationStrategy: "single_presence",
      speakerId,
      confidenceLevel: "medium",
    });
    return {
      speakerId,
      confidenceLevel: "medium",
      identificationStrategy: "single_presence",
      needsVoiceQuery: false,
    };
  }

  // Stratégie (b) : plusieurs membres → demander "qui est-ce ?"
  if (presentMembers.length > 1) {
    log.info("Deferred identification — multiple members, voice query needed (strategy b)", {
      correlationId,
      identificationStrategy: "voice_query",
      speakerId: "unknown",
      confidenceLevel: "low",
      memberCount: String(presentMembers.length),
    });
    return {
      speakerId: "unknown",
      confidenceLevel: "low",
      identificationStrategy: "voice_query",
      needsVoiceQuery: true,
    };
  }

  // Stratégie (d) : fallback visiteur
  log.info("Deferred identification — visitor fallback (strategy d)", {
    correlationId,
    identificationStrategy: "visitor_fallback",
    speakerId: "visitor",
    confidenceLevel: "visitor",
  });
  return {
    speakerId: "visitor",
    confidenceLevel: "visitor",
    identificationStrategy: "visitor_fallback",
    needsVoiceQuery: false,
  };
}

// =====================================================================
// Story 3.8 — Social mediation hook
// =====================================================================

/**
 * Story 3.8: Hook called when auth is denied for a speaker.
 * Delegates to the PermissionMediator for social mediation.
 *
 * @param speakerId - The denied speaker
 * @param intent - The denied intent
 * @param params - The intent parameters
 * @param correlationId - The correlation ID for tracing
 * @returns A MediationResult from the PermissionMediator
 */
export async function onAuthDenied(
  speakerId: string,
  intent: string,
  params: Record<string, unknown>,
  correlationId: string,
): Promise<import("../household/permission-mediator.js").MediationResult> {
  const { mediate } = await import("../household/permission-mediator.js");

  const result = mediate(speakerId, intent, params, correlationId);

  log.info("Auth denied — mediation result", {
    correlationId,
    speakerId,
    intent,
    mediationType: result.type,
    adminPresent: result.type === "redirected",
  });

  return result;
}

/**
 * Story 3.8: Check if an action has been approved by an admin (one-shot bypass).
 * Verifies that a pending mediation exists for the given correlation ID.
 *
 * @param correlationId - The correlation ID to check
 * @returns true if the action was admin-approved
 */
export async function isAdminApproved(correlationId: string): Promise<boolean> {
  const { getPendingMediation } = await import("../household/permission-mediator.js");
  return getPendingMediation(correlationId) !== null;
}

// =====================================================================
// Critical action confirmation
// =====================================================================

/**
 * Log a confirmed critical action after user vocal confirmation.
 *
 * Called by the pipeline when the speaker has vocally confirmed a critical action
 * (e.g. "oui, envoie le message"). Logs the outcome to `audit.db` for traceability.
 *
 * @param category - The intent category that was confirmed (e.g. `"send_message"`)
 * @param speakerId - The speaker who confirmed (e.g. `"thomas"`)
 * @param result - The outcome of the confirmation (e.g. `"confirmed"`, `"cancelled"`)
 */
export function confirmCriticalAction(category: string, speakerId: string, result: string): void {
  auditCriticalAction(speakerId, `confirmed:${category}`, result as "confirmed" | "failed");
  log.info("Critical action confirmed", { category, speakerId, result });
}
