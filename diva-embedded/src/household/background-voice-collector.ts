/**
 * Background Voice Collector — Story 3.5
 *
 * Collects voice samples transparently in the background for unknown speakers,
 * generates preliminary voiceprints, attempts automatic voice-to-profile linking,
 * and handles consent-based confirmation flow.
 *
 * This module bridges pre-inscribed profiles (Story 3.3) with voice identification
 * (Story 3.4) by collecting voiceprints naturally during conversation instead of
 * requiring a formal enrollment process.
 *
 * @module household/background-voice-collector
 */

import { log } from "../monitoring/logger.js";
import { getCorrelationId } from "../monitoring/correlation.js";
import {
  type FoyerMember,
  getFoyer,
  getPreInscritMembers,
  getAdmins,
  getMemberByName,
  getMembers,
} from "./foyer-manager.js";
import {
  attemptVoiceLink,
  confirmVoiceLink,
  type VoiceLinkResult,
} from "./voice-linker.js";
import { resolveAlias, resolveRelation } from "./alias-resolver.js";
import { extractName } from "./name-parser.js";

// =====================================================================
// Audio helpers — injectable for testing
// =====================================================================

/** Audio helper interface for dependency injection (testability). */
export interface AudioHelpers {
  speak: (text: string) => Promise<void>;
  askYesNo: (question: string) => Promise<boolean | null>;
}

/** Default audio helpers using oobe-flow. Lazy-loaded to avoid circular deps. */
let _audioHelpers: AudioHelpers | null = null;

async function getDefaultAudioHelpers(): Promise<AudioHelpers> {
  if (!_audioHelpers) {
    const oobe = await import("./oobe-flow.js");
    _audioHelpers = { speak: oobe.speak, askYesNo: oobe.askYesNo };
  }
  return _audioHelpers;
}

// =====================================================================
// Constants
// =====================================================================

/** Maximum voice samples collected per session. */
export const MAX_VOICE_SAMPLES = 10;

/** Minimum sample duration in milliseconds. */
export const MIN_SAMPLE_DURATION_MS = 1000;

/** Minimum samples before generating a preliminary voiceprint. */
export const MIN_SAMPLES_FOR_VOICEPRINT = 3;

/** Prefix for temporary speaker IDs in npu-embeddings. */
export const TEMP_SPEAKER_PREFIX = "temp_";

/** TTL for samples in RAM (10 minutes in ms). */
export const SAMPLE_TTL_MS = 10 * 60 * 1000;

/** Base URL for the memory/speaker service. */
const MEM0_URL = process.env.MEM0_URL ?? "http://localhost:9002";

/** Timeout for register-multi calls (ms). */
const REGISTER_MULTI_TIMEOUT_MS = 10_000;

/** Timeout for register calls (ms). */
const REGISTER_TIMEOUT_MS = 10_000;

/** Timeout for delete/list calls (ms). */
const SPEAKER_API_TIMEOUT_MS = 5_000;

// =====================================================================
// Types
// =====================================================================

/** A single voice sample stored in RAM. */
export interface VoiceSample {
  audioB64: string;
  durationMs: number;
  correlationId: string;
  timestamp: number;
}

/** Outcome of a voice link proposal. */
export interface VoiceLinkOutcome {
  linked: boolean;
  memberId: string | null;
  reason: "confirmed" | "declined" | "consent_refused" | "conflict" | "error";
}

/** Result of an auto-link attempt. */
export interface AutoLinkResult {
  matched: boolean;
  member: FoyerMember | null;
  strategy: "exact" | "alias" | "relation" | "none";
}

/** Internal session state for background collection. */
interface CollectorSession {
  samples: VoiceSample[];
  transcribedTexts: string[];
  voiceprintGenerated: boolean;
  tempSpeakerId: string | null;
  linkProposedThisSession: boolean;
  ttlTimer: ReturnType<typeof setTimeout> | null;
}

// =====================================================================
// BackgroundVoiceCollector
// =====================================================================

export class BackgroundVoiceCollector {
  private sessions = new Map<string, CollectorSession>();
  private audioHelpers: AudioHelpers | null;

  constructor(audioHelpers?: AudioHelpers) {
    this.audioHelpers = audioHelpers ?? null;
  }

  private async getAudioHelpers(): Promise<AudioHelpers> {
    if (this.audioHelpers) return this.audioHelpers;
    return getDefaultAudioHelpers();
  }

  // --- Session management ---

  private getOrCreateSession(sessionId: string): CollectorSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        samples: [],
        transcribedTexts: [],
        voiceprintGenerated: false,
        tempSpeakerId: null,
        linkProposedThisSession: false,
        ttlTimer: null,
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  // --- Task 1: Sample collection (AC1, AC7, AC9) ---

  /**
   * Collect a voice sample if it meets the minimum duration requirement.
   * Resets the TTL timer on each new sample.
   */
  collectSample(audioB64: string, durationMs: number, correlationId: string, sessionId: string): void {
    if (durationMs < MIN_SAMPLE_DURATION_MS) {
      log.debug("Background voice collector: sample rejected (too short)", {
        correlationId,
        durationMs,
        minRequired: MIN_SAMPLE_DURATION_MS,
      });
      return;
    }

    const session = this.getOrCreateSession(sessionId);

    if (session.samples.length >= MAX_VOICE_SAMPLES) {
      log.debug("Background voice collector: max samples reached", {
        correlationId,
        sessionId,
        sampleCount: session.samples.length,
      });
      return;
    }

    const sample: VoiceSample = {
      audioB64,
      durationMs,
      correlationId,
      timestamp: Date.now(),
    };

    session.samples.push(sample);

    log.debug("Background voice collector: sample collected", {
      correlationId,
      durationMs,
      sampleCount: session.samples.length,
    });

    // Reset TTL timer
    this.resetTTL(sessionId);
  }

  /** Check whether collection should continue for this session. */
  shouldCollect(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return true;
    return session.samples.length < MAX_VOICE_SAMPLES;
  }

  /** Get the number of collected samples for a session. */
  getSampleCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.samples.length ?? 0;
  }

  /** Get all collected samples for a session. */
  getSamples(sessionId: string): VoiceSample[] {
    return this.sessions.get(sessionId)?.samples ?? [];
  }

  /** Store transcribed text for later name-matching. */
  addTranscribedText(sessionId: string, text: string): void {
    const session = this.getOrCreateSession(sessionId);
    session.transcribedTexts.push(text);
  }

  /** Check if the voiceprint has already been generated for this session. */
  isVoiceprintGenerated(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.voiceprintGenerated ?? false;
  }

  /** Check if a link has already been proposed for this session. */
  isLinkProposedThisSession(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.linkProposedThisSession ?? false;
  }

  // --- Task 1.6/1.7: Cleanup (AC7) ---

  /** Clear all samples and state for a session. */
  clearSamples(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.ttlTimer) clearTimeout(session.ttlTimer);
      const count = session.samples.length;
      this.sessions.delete(sessionId);
      log.debug("Background voice collector: samples cleared", {
        sessionId,
        clearedCount: count,
      });
    }
  }

  /** Clear all sessions (used at service restart). */
  clearAllSamples(): void {
    let total = 0;
    for (const [sessionId, session] of this.sessions) {
      if (session.ttlTimer) clearTimeout(session.ttlTimer);
      total += session.samples.length;
    }
    this.sessions.clear();
    log.debug("Background voice collector: all samples cleared", { clearedCount: total });
  }

  /** Reset TTL timer for a session. */
  private resetTTL(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.ttlTimer) clearTimeout(session.ttlTimer);
    session.ttlTimer = setTimeout(() => {
      this.clearSamples(sessionId);
    }, SAMPLE_TTL_MS);
  }

  // --- Task 2: Preliminary voiceprint generation (AC2) ---

  /**
   * Generate a preliminary voiceprint from collected samples.
   * Requires at least MIN_SAMPLES_FOR_VOICEPRINT samples.
   * Returns the temporary speaker ID or null on failure.
   */
  async generatePreliminaryVoiceprint(sessionId: string): Promise<string | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (session.samples.length < MIN_SAMPLES_FOR_VOICEPRINT) {
      log.debug("Background voice collector: not enough samples for voiceprint", {
        sessionId,
        sampleCount: session.samples.length,
        required: MIN_SAMPLES_FOR_VOICEPRINT,
      });
      return null;
    }

    if (session.voiceprintGenerated) {
      log.debug("Background voice collector: voiceprint already generated", { sessionId });
      return session.tempSpeakerId;
    }

    const tempSpeakerId = `${TEMP_SPEAKER_PREFIX}${sessionId}`;
    const correlationId = getCorrelationId();
    const startMs = Date.now();

    try {
      // Try register-multi first
      const samples = session.samples.map((s) => s.audioB64);
      const res = await fetch(`${MEM0_URL}/speaker/register-multi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tempSpeakerId, samples }),
        signal: AbortSignal.timeout(REGISTER_MULTI_TIMEOUT_MS),
      });

      if (res.ok) {
        session.voiceprintGenerated = true;
        session.tempSpeakerId = tempSpeakerId;
        const latencyMs = Date.now() - startMs;

        log.info("Empreinte vocale preliminaire generee", {
          correlationId,
          sampleCount: samples.length,
          tempSpeakerId,
          latencyMs,
        });
        return tempSpeakerId;
      }

      // Fallback: register with best (longest) sample
      log.debug("Background voice collector: register-multi failed, fallback to register", {
        correlationId,
        status: res.status,
      });

      const bestSample = session.samples.reduce((a, b) =>
        a.durationMs > b.durationMs ? a : b
      );

      const res2 = await fetch(`${MEM0_URL}/speaker/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tempSpeakerId, audio: bestSample.audioB64 }),
        signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
      });

      if (res2.ok) {
        session.voiceprintGenerated = true;
        session.tempSpeakerId = tempSpeakerId;
        const latencyMs = Date.now() - startMs;

        log.info("Empreinte vocale preliminaire generee (fallback)", {
          correlationId,
          sampleCount: 1,
          tempSpeakerId,
          latencyMs,
        });
        return tempSpeakerId;
      }

      log.warn("Background voice collector: voiceprint generation failed", {
        correlationId,
        sessionId,
        status: res2.status,
      });
      return null;
    } catch (err) {
      log.warn("Background voice collector: voiceprint generation error", {
        correlationId,
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  // --- Task 3: Auto-link attempt (AC3, AC8) ---

  /**
   * Attempt to automatically link the unknown voice to a pre-inscribed profile
   * based on mentioned names in transcribed texts.
   */
  async attemptAutoLink(sessionId: string, transcribedTexts?: string[]): Promise<AutoLinkResult> {
    const session = this.sessions.get(sessionId);
    if (!session) return { matched: false, member: null, strategy: "none" };

    const correlationId = getCorrelationId();
    const texts = transcribedTexts ?? session.transcribedTexts;
    const tempSpeakerId = session.tempSpeakerId;
    if (!tempSpeakerId) return { matched: false, member: null, strategy: "none" };

    const foyer = getFoyer();
    if (!foyer) return { matched: false, member: null, strategy: "none" };

    const preInscrit = getPreInscritMembers(foyer.id);
    if (preInscrit.length === 0) return { matched: false, member: null, strategy: "none" };

    const allMembers = getMembers(foyer.id);

    // Strategy 1 & 2: Extract names from texts, try exact then alias match
    for (const text of texts) {
      const name = extractName(text);
      if (!name || name.length < 2) continue;

      // Try voice-linker (handles exact + alias + relation)
      const linkResult = attemptVoiceLink(name, tempSpeakerId);
      if (linkResult.matched && linkResult.member) {
        log.info("Background voice collector: auto-link match found", {
          correlationId,
          strategy: linkResult.strategy,
          memberName: linkResult.member.name,
          sessionId,
        });
        return {
          matched: true,
          member: linkResult.member,
          strategy: linkResult.strategy as "exact" | "alias" | "relation",
        };
      }
    }

    // Strategy 3: Relational context in full texts
    for (const text of texts) {
      const resolved = resolveRelation(text, allMembers);
      if (resolved && preInscrit.some((m) => m.id === resolved.id)) {
        // Use attemptVoiceLink with the resolved name to trigger state transitions
        const linkResult = attemptVoiceLink(resolved.name, tempSpeakerId);
        if (linkResult.matched && linkResult.member) {
          log.info("Background voice collector: auto-link match via relation", {
            correlationId,
            strategy: "relation",
            memberName: linkResult.member.name,
            sessionId,
          });
          return { matched: true, member: linkResult.member, strategy: "relation" };
        }
      }
    }

    log.debug("Background voice collector: no auto-link match", {
      correlationId,
      sessionId,
      textCount: texts.length,
    });
    return { matched: false, member: null, strategy: "none" };
  }

  // --- Task 4: Propose voice link with consent (AC4, AC5, AC6) ---

  /**
   * Propose a voice link to a matched member.
   * Handles confirmation, conflict detection, and consent.
   */
  async proposeVoiceLink(sessionId: string, member: FoyerMember): Promise<VoiceLinkOutcome> {
    const session = this.sessions.get(sessionId);
    const correlationId = getCorrelationId();

    // AC5: Check for conflict — member already ACTIF with existing speakerId
    if (member.state === "ACTIF" && member.speakerId) {
      const foyer = getFoyer();
      const admins = foyer ? getAdmins(foyer.id) : [];
      const adminName = admins.length > 0 ? admins[0].name : "un administrateur";

      log.warn("Background voice collector: voiceprint conflict", {
        correlationId,
        memberId: member.id,
        existingSpeakerId: member.speakerId,
        newSpeakerId: session?.tempSpeakerId ?? "unknown",
      });

      return { linked: false, memberId: member.id, reason: "conflict" };
    }

    // Only PRE_INSCRIT members are eligible
    if (member.state !== "PRE_INSCRIT" && member.state !== "LIAISON_EN_COURS") {
      return { linked: false, memberId: member.id, reason: "conflict" };
    }

    // AC4: Ask confirmation
    const helpers = await this.getAudioHelpers();
    const confirmed = await helpers.askYesNo(`Tu es bien ${member.name} ?`);

    if (confirmed !== true) {
      // Mark as proposed so we don't ask again this session
      if (session) session.linkProposedThisSession = true;
      log.info("Background voice collector: link declined", {
        correlationId,
        memberId: member.id,
        memberName: member.name,
      });
      return { linked: false, memberId: member.id, reason: "declined" };
    }

    // AC6: Ask consent for voiceprint storage
    const consent = await helpers.askYesNo(
      "Pour te reconnaitre a l'avenir, je dois garder ton empreinte vocale. C'est d'accord ?"
    );

    if (consent !== true) {
      // Delete temporary voiceprint and samples
      await this.deleteTemporaryVoiceprint(sessionId);
      if (session) session.linkProposedThisSession = true;

      log.info("Consentement refuse, empreinte supprimee", {
        correlationId,
        memberId: member.id,
      });

      return { linked: false, memberId: member.id, reason: "consent_refused" };
    }

    // Finalize: register final voiceprint and confirm link
    try {
      const finalSpeakerId = await this.registerFinalVoiceprint(member, sessionId);

      if (finalSpeakerId) {
        confirmVoiceLink(member.id, finalSpeakerId);
        if (session) session.linkProposedThisSession = true;

        log.info("Background voice collector: voice link confirmed", {
          correlationId,
          memberId: member.id,
          speakerId: finalSpeakerId,
        });

        return { linked: true, memberId: member.id, reason: "confirmed" };
      }

      return { linked: false, memberId: member.id, reason: "error" };
    } catch (err) {
      log.warn("Background voice collector: voice link finalization error", {
        correlationId,
        memberId: member.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return { linked: false, memberId: member.id, reason: "error" };
    }
  }

  // --- Task 4.9: Register final voiceprint (AC4) ---

  /**
   * Re-register samples under the member's definitive speakerId.
   */
  async registerFinalVoiceprint(member: FoyerMember, sessionId: string): Promise<string | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.samples.length === 0) return null;

    const speakerId = member.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z]/g, "");

    try {
      const samples = session.samples.map((s) => s.audioB64);
      const res = await fetch(`${MEM0_URL}/speaker/register-multi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: speakerId, samples }),
        signal: AbortSignal.timeout(REGISTER_MULTI_TIMEOUT_MS),
      });

      if (res.ok) {
        // Clean up temp voiceprint
        await this.deleteTemporaryVoiceprint(sessionId);
        return speakerId;
      }

      // Fallback to single best sample
      const bestSample = session.samples.reduce((a, b) =>
        a.durationMs > b.durationMs ? a : b
      );
      const res2 = await fetch(`${MEM0_URL}/speaker/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: speakerId, audio: bestSample.audioB64 }),
        signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
      });

      if (res2.ok) {
        await this.deleteTemporaryVoiceprint(sessionId);
        return speakerId;
      }

      return null;
    } catch (err) {
      log.warn("Background voice collector: final voiceprint registration failed", {
        error: err instanceof Error ? err.message : String(err),
        memberId: member.id,
      });
      return null;
    }
  }

  // --- Task 4.10: Delete temporary voiceprint (AC6, AC7) ---

  /**
   * Delete the temporary voiceprint from npu-embeddings and clear RAM samples.
   */
  async deleteTemporaryVoiceprint(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const tempSpeakerId = session?.tempSpeakerId;

    if (tempSpeakerId) {
      try {
        await fetch(`${MEM0_URL}/speaker/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: tempSpeakerId }),
          signal: AbortSignal.timeout(SPEAKER_API_TIMEOUT_MS),
        });
        log.debug("Background voice collector: temp voiceprint deleted", {
          tempSpeakerId,
        });
      } catch (err) {
        log.warn("Background voice collector: failed to delete temp voiceprint", {
          tempSpeakerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.clearSamples(sessionId);
  }
}

// =====================================================================
// Task 5: Cleanup temporary voiceprints at startup (AC7)
// =====================================================================

/**
 * Remove all temporary voiceprints (prefixed with `temp_`) from npu-embeddings.
 * Called at service startup.
 */
export async function cleanupTemporaryVoiceprints(): Promise<void> {
  try {
    const res = await fetch(`${MEM0_URL}/speaker/list`, {
      signal: AbortSignal.timeout(SPEAKER_API_TIMEOUT_MS),
    });

    if (!res.ok) {
      log.warn("Background voice collector: failed to list speakers for cleanup", {
        status: res.status,
      });
      return;
    }

    const data = (await res.json()) as { speakers?: string[] | Record<string, unknown> };
    // Handle both array format and object format from MEM0
    const rawSpeakers = data.speakers ?? [];
    const speakers: string[] = Array.isArray(rawSpeakers)
      ? rawSpeakers
      : Object.keys(rawSpeakers);
    const tempSpeakers = speakers.filter((s: string) => s.startsWith(TEMP_SPEAKER_PREFIX));

    if (tempSpeakers.length === 0) {
      log.debug("Background voice collector: no temporary voiceprints to clean up");
      return;
    }

    let deleted = 0;
    for (const name of tempSpeakers) {
      try {
        await fetch(`${MEM0_URL}/speaker/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
          signal: AbortSignal.timeout(SPEAKER_API_TIMEOUT_MS),
        });
        deleted++;
      } catch (err) {
        log.warn("Background voice collector: failed to delete temp speaker", {
          name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    log.info("Cleanup temporary voiceprints", {
      total: tempSpeakers.length,
      deleted,
    });
  } catch (err) {
    log.warn("Background voice collector: cleanup error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =====================================================================
// Singleton collector instance
// =====================================================================

/** Shared collector instance used by index.ts. */
export const backgroundCollector = new BackgroundVoiceCollector();
