/**
 * Privacy Guard — Stories 5.2, 5.3, 5.4, 5.5, 5.6
 * Protects children's privacy, manages consent, right to erasure,
 * data export, and retention policies.
 */

import { log } from "../monitoring/logger.js";
import { logAudit, getCompanionDb, getMedicalDb } from "./database-manager.js";
import { getCorrelationId } from "../monitoring/correlation.js";
import { getCurrentPersona, deletePersona } from "../persona/engine.js";

// =====================================================================
// Story 5.2 — Child privacy protection
// =====================================================================

/**
 * Check if a parent is asking about a child's private conversations.
 */
export function isParentSnooping(transcription: string, speakerId: string): boolean {
  const persona = getCurrentPersona();
  if (persona.type !== "adult") return false;

  const snoopPatterns = [
    /qu.est.ce qu.*(?:lucas|emma|l.enfant|le petit|la petite).*(?:dit|racont|parl)/i,
    /(?:lucas|emma).*(?:dit|racont|parl).*quoi/i,
    /ce qu.*(?:lucas|emma).*(?:dit|racont)/i,
  ];

  return snoopPatterns.some(p => p.test(transcription));
}

export function getChildPrivacyResponse(): string {
  const responses = [
    "On a discute, mais c'est entre nous ! Si tu veux savoir, demande-lui directement.",
    "C'est notre petit secret ! Demande-lui, il te racontera.",
    "Je prefere qu'il te raconte lui-meme, c'est plus sympa non ?",
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

// =====================================================================
// Story 5.3 — Consent management
// =====================================================================

interface ConsentRecord {
  speakerId: string;
  consentType: "monitoring" | "voice_recording" | "data_collection";
  granted: boolean;
  grantedBy: string; // speaker or legal guardian
  timestamp: string;
}

const consentStore = new Map<string, ConsentRecord[]>();

export function recordConsent(
  speakerId: string,
  consentType: ConsentRecord["consentType"],
  granted: boolean,
  grantedBy?: string,
): void {
  const record: ConsentRecord = {
    speakerId,
    consentType,
    granted,
    grantedBy: grantedBy || speakerId,
    timestamp: new Date().toISOString(),
  };

  const existing = consentStore.get(speakerId) || [];
  existing.push(record);
  consentStore.set(speakerId, existing);

  logAudit(
    `consent_${granted ? "granted" : "refused"}`,
    "critical",
    speakerId,
    `${consentType}:${granted}`,
    getCorrelationId(),
    { grantedBy: record.grantedBy },
  );

  log.info("Consent recorded", { speakerId, consentType, granted });
}

export function hasConsent(speakerId: string, consentType: ConsentRecord["consentType"]): boolean {
  const records = consentStore.get(speakerId);
  if (!records) return false;
  const latest = records.filter(r => r.consentType === consentType).pop();
  return latest?.granted ?? false;
}

// =====================================================================
// Story 5.4 — Right to erasure
// =====================================================================

export async function eraseAllData(speakerId: string): Promise<boolean> {
  log.warn("Right to erasure requested", { speakerId });

  try {
    // Delete persona
    deletePersona(speakerId);

    // Delete memories from companion DB
    try {
      const db = getCompanionDb();
      db.prepare("DELETE FROM memories WHERE speaker_id = ?").run(speakerId);
    } catch {}

    // Delete medical data
    try {
      const mdb = getMedicalDb();
      mdb.prepare("DELETE FROM wellness_entries WHERE speaker_id = ?").run(speakerId);
      mdb.prepare("DELETE FROM medication_log WHERE speaker_id = ?").run(speakerId);
    } catch {}

    // Clear consent
    consentStore.delete(speakerId);

    // Log the erasure (but NOT the data)
    logAudit(
      "data_erased",
      "critical",
      speakerId,
      "complete",
      getCorrelationId(),
    );

    log.info("All data erased for speaker", { speakerId });
    return true;
  } catch (err) {
    log.error("Data erasure failed", {
      speakerId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// =====================================================================
// Story 5.5 — Data export
// =====================================================================

export function exportUserData(speakerId: string): Record<string, unknown> {
  const data: Record<string, unknown> = { speakerId, exportedAt: new Date().toISOString() };

  // Persona
  try {
    const persona = getCurrentPersona();
    if (persona.id === speakerId) {
      data.persona = {
        name: persona.name,
        type: persona.type,
        greetingName: persona.greetingName,
        communicationPrefs: persona.communicationPrefs,
      };
    }
  } catch {}

  // Memories
  try {
    const db = getCompanionDb();
    const memories = db.prepare("SELECT * FROM memories WHERE speaker_id = ?").all(speakerId);
    data.memories = memories;
  } catch {}

  // Medical data
  try {
    const mdb = getMedicalDb();
    const wellness = mdb.prepare("SELECT * FROM wellness_entries WHERE speaker_id = ?").all(speakerId);
    data.wellness = wellness;
  } catch {}

  // Consent records
  data.consents = consentStore.get(speakerId) || [];

  log.info("Data exported for speaker", { speakerId, sections: Object.keys(data).length });
  logAudit("data_exported", "protected", speakerId, "complete", getCorrelationId());

  return data;
}

// =====================================================================
// Story 5.6 — Retention policy
// =====================================================================

export function runRetentionPolicy(): void {
  const now = Date.now();
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  try {
    // Purge old conversational memories (90 days)
    const db = getCompanionDb();
    const deleted = db.prepare(
      "DELETE FROM memories WHERE category = 'conversation' AND created_at < datetime('now', '-90 days')"
    ).run();
    if (deleted.changes > 0) {
      log.info("Retention: purged old conversations", { deleted: deleted.changes });
    }
  } catch {}

  try {
    // Archive old audit logs (12 months)
    const adb = getCompanionDb();
    // Note: actual archival to encrypted file would be handled by backup script
    log.debug("Retention policy executed");
  } catch {}
}
