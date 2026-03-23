/**
 * Member Registration — Post-OOBE member pre-inscription
 *
 * Allows the admin to add new household members at any time after the
 * initial OOBE setup. Handles single and batch registration, duplicate
 * detection, persona type derivation, pending link reminders, and
 * consultation/suppression of pending profiles.
 *
 * @module household/member-registration
 */

import { randomUUID } from "node:crypto";
import { getCompanionDb } from "../security/database-manager.js";
import { log } from "../monitoring/logger.js";
import {
  addMember,
  removeMember,
  getMemberByName,
  getMembers,
  getPreInscritMembers,
  getFoyer,
  getMemberBySpeakerId,
  requireAdmin,
  MAX_FAMILY_MEMBERS,
  type FoyerMember,
  type AddMemberOptions,
} from "./foyer-manager.js";
import type { PersonaType, ContentFilter } from "../persona/engine.js";
import { extractName, extractAge, extractRelation, capitalizeFirst } from "./name-parser.js";

// Lazy imports to avoid side effects during testing (persona engine creates directories)
let _speak: typeof import("./oobe-flow.js").speak | null = null;
let _listenAndTranscribe: typeof import("./oobe-flow.js").listenAndTranscribe | null = null;
let _askYesNo: typeof import("./oobe-flow.js").askYesNo | null = null;
let _createPersona: typeof import("../persona/engine.js").createPersona | null = null;

async function loadAudioHelpers(): Promise<void> {
  if (!_speak) {
    const mod = await import("./oobe-flow.js");
    _speak = mod.speak;
    _listenAndTranscribe = mod.listenAndTranscribe;
    _askYesNo = mod.askYesNo;
  }
}

async function loadPersonaEngine(): Promise<typeof import("../persona/engine.js").createPersona> {
  if (!_createPersona) {
    const mod = await import("../persona/engine.js");
    _createPersona = mod.createPersona;
  }
  return _createPersona;
}

// Re-export shims for direct use (when not in test mode)
async function speak(text: string): Promise<void> {
  await loadAudioHelpers();
  return _speak!(text);
}

async function listenAndTranscribe(maxDurationS?: number, silenceTimeoutS?: number): Promise<string | null> {
  await loadAudioHelpers();
  return _listenAndTranscribe!(maxDurationS, silenceTimeoutS);
}

async function askYesNo(question: string): Promise<boolean | null> {
  await loadAudioHelpers();
  return _askYesNo!(question);
}

// =====================================================================
// Types
// =====================================================================

export interface RegistrationResult {
  success: boolean;
  member: FoyerMember | null;
  message: string;
  cancelled?: boolean;
  duplicate?: boolean;
}

export interface BatchRegistrationResult {
  members: FoyerMember[];
  count: number;
  message: string;
}

// =====================================================================
// Constants
// =====================================================================

/** Number of milliseconds in 48 hours. */
export const PENDING_LINK_THRESHOLD_MS = 48 * 60 * 60 * 1000;

/** Maximum number of pending link reminders before giving up. */
export const MAX_PENDING_REMINDERS = 3;

// =====================================================================
// Session-level state for pending link reminders
// =====================================================================

let pendingLinkRemindedThisSession = false;

/**
 * Reset the pending link reminder session flag.
 * Call this at the start of each new session.
 */
export function resetPendingLinkSession(): void {
  pendingLinkRemindedThisSession = true; // will be reset below
  pendingLinkRemindedThisSession = false;
}

// =====================================================================
// PersonaType / ContentFilter derivation
// =====================================================================

/**
 * Derive the PersonaType from an optional age.
 * - < 13: child
 * - 13-17: adult (teen, with mild content filter)
 * - >= 18 or null: adult
 */
export function derivePersonaTypeFromAge(age: number | null): PersonaType {
  if (age === null || age === undefined) return "adult";
  if (age < 13) return "child";
  return "adult";
}

/**
 * Derive the ContentFilter from an optional age.
 * - < 13: strict
 * - 13-17: mild
 * - >= 18 or null: none
 */
export function deriveContentFilterFromAge(age: number | null): ContentFilter {
  if (age === null || age === undefined) return "none";
  if (age < 13) return "strict";
  if (age <= 17) return "mild";
  return "none";
}

// =====================================================================
// Pending Link Reminders — Schema
// =====================================================================

let reminderSchemaReady = false;

/**
 * Create the `pending_link_reminders` table if not exists.
 */
export function ensureReminderSchema(): void {
  if (reminderSchemaReady) return;

  const db = getCompanionDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_link_reminders (
      id TEXT PRIMARY KEY,
      foyer_id TEXT NOT NULL,
      reminder_count INTEGER NOT NULL DEFAULT 0,
      last_reminder_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pending_link_reminders_foyer_id
    ON pending_link_reminders(foyer_id)
  `);

  reminderSchemaReady = true;
}

/**
 * Reset the reminder schema flag. **Only used in tests.**
 * @internal
 */
export function resetReminderSchemaForTest(): void {
  reminderSchemaReady = false;
}

// =====================================================================
// Core Registration
// =====================================================================

/**
 * Register a new member from raw transcribed text.
 * Handles name extraction, duplicate check, persona creation.
 *
 * @param adminSpeakerId - The speaker ID of the admin performing the action
 * @param rawText - The transcribed speech (e.g. "ajoute Lucas, mon fils de 8 ans")
 * @param skipVocalInteraction - If true, skip vocal confirmation (for testing)
 * @returns RegistrationResult
 */
export async function registerNewMember(
  adminSpeakerId: string,
  rawText: string,
  skipVocalInteraction = false,
): Promise<RegistrationResult> {
  try {
    // Verify admin
    const adminCheck = requireAdmin(adminSpeakerId);
    if (!adminCheck.authorized) {
      return {
        success: false,
        member: null,
        message: adminCheck.errorMessage || "Seul un administrateur peut ajouter des membres.",
      };
    }

    const foyer = getFoyer();
    if (!foyer) {
      return { success: false, member: null, message: "Le foyer n'est pas encore configure." };
    }

    // Check member limit
    const currentMembers = getMembers(foyer.id);
    if (currentMembers.length >= MAX_FAMILY_MEMBERS) {
      return {
        success: false,
        member: null,
        message: `Le foyer a atteint la limite de ${MAX_FAMILY_MEMBERS} membres.`,
      };
    }

    // Extract info
    const name = capitalizeFirst(extractName(rawText));
    const age = extractAge(rawText);
    const relation = extractRelation(rawText);

    if (!name || name.length < 2) {
      return { success: false, member: null, message: "Je n'ai pas compris le prenom." };
    }

    // Duplicate check
    const existing = getMemberByName(foyer.id, name);
    if (existing) {
      if (!skipVocalInteraction) {
        const confirm = await askYesNo(
          `Il y a deja un ${existing.name} dans le foyer. Tu veux ajouter un deuxieme ${name} ?`,
        );
        if (confirm !== true) {
          return {
            success: false,
            member: null,
            message: "Ajout annule.",
            cancelled: true,
            duplicate: true,
          };
        }
        // Suggest a suffix
        const suffixedName = `${name} 2`;
        return createMemberWithPersona(foyer.id, suffixedName, age, relation);
      }
      return {
        success: false,
        member: null,
        message: `Il y a deja un ${existing.name} dans le foyer.`,
        duplicate: true,
      };
    }

    // Vocal confirmation (if not skipped)
    if (!skipVocalInteraction) {
      const ageInfo = age ? `, ${age} ans` : "";
      const relationInfo = relation ? ` (${relation})` : "";
      const confirmed = await askYesNo(`J'ai compris ${name}${ageInfo}${relationInfo}. C'est bien ça ?`);
      if (confirmed === false) {
        // FR57/FR101: First, ask for the correct name naturally (not spelling)
        await speak("D'accord, comment s'appelle cette personne ?");
        const correction = await listenAndTranscribe(10, 2.0);
        if (correction) {
          // Try to extract a name from the natural response
          const correctedName = extractName(correction);
          if (correctedName && correctedName.length >= 2 && correctedName.toLowerCase() !== name.toLowerCase()) {
            // Got a different name — confirm it
            const reconfirmed = await askYesNo(`${correctedName}, c'est bien ça ?`);
            if (reconfirmed === true) {
              return createMemberWithPersona(foyer.id, correctedName, age, relation);
            }
            // If still not right, fall through to spelling
          }
        }
        // Fallback: offer to spell
        await speak("Tu peux me l'épeler ?");
        const spelled = await listenAndTranscribe(15, 2.0);
        if (spelled) {
          const corrected = capitalizeFirst(
            spelled.replace(/\s+/g, "").replace(/[^a-zA-ZàâéèêëïîôùûüÿçÀÂÉÈÊËÏÎÔÙÛÜŸÇ-]/g, ""),
          );
          if (corrected.length >= 2) {
            return createMemberWithPersona(foyer.id, corrected, age, relation);
          }
        }
        return { success: false, member: null, message: "Je n'ai pas compris le prénom.", cancelled: true };
      }
      // Handle ambiguous response (null) — treat as confirmation to avoid frustrating loops
    }

    return createMemberWithPersona(foyer.id, name, age, relation);
  } catch (err) {
    log.warn("registerNewMember: error", { error: String(err) });
    return { success: false, member: null, message: "Erreur lors de l'inscription." };
  }
}

/**
 * Create a member with PRE_INSCRIT state and a matching PersonaProfile.
 * @internal
 */
async function createMemberWithPersona(
  foyerId: string,
  name: string,
  age: number | null,
  relation: string | null,
): Promise<RegistrationResult> {
  const personaType = derivePersonaTypeFromAge(age);
  const contentFilter = deriveContentFilterFromAge(age);

  const options: AddMemberOptions = {
    name,
    age: age ?? undefined,
    relation: relation ?? undefined,
    state: "PRE_INSCRIT",
  };

  const member = addMember(foyerId, options);

  // Create persona with preinscrit_ prefix (lazy load to avoid side effects in tests)
  const personaId = `preinscrit_${member.id}`;
  try {
    const createPersonaFn = await loadPersonaEngine();
    createPersonaFn(personaId, name, personaType, name);
    log.info("Persona created for pre-inscribed member", {
      personaId,
      personaType,
      contentFilter,
      memberName: name,
    });
  } catch (err) {
    log.warn("Failed to create persona for pre-inscribed member", { error: String(err) });
  }

  // Reset reminder counter when a new member is pre-inscribed
  resetReminderCounterForFoyer(foyerId);

  const ageInfo = age ? ` (${age} ans` : "";
  const relationInfo = relation ? (age ? `, ${relation})` : ` (${relation})`) : (age ? ")" : "");
  const message = `C'est note, ${name}${ageInfo}${relationInfo} est ajoute au foyer.`;

  log.info("Member pre-inscribed", { memberId: member.id, name, age, relation, personaType });

  return { success: true, member, message };
}

// =====================================================================
// Batch Registration
// =====================================================================

/**
 * Register multiple members in a guided loop.
 * The admin adds members one by one until they say "non" / "c'est tout" / silence.
 *
 * @param adminSpeakerId - The speaker ID of the admin
 * @param skipVocalInteraction - If true, skip vocal interaction (for testing)
 * @param testInputs - Optional array of test inputs to simulate speech
 * @returns BatchRegistrationResult
 */
export async function registerBatchMembers(
  adminSpeakerId: string,
  skipVocalInteraction = false,
  testInputs?: string[],
): Promise<BatchRegistrationResult> {
  const adminCheck = requireAdmin(adminSpeakerId);
  if (!adminCheck.authorized) {
    return {
      members: [],
      count: 0,
      message: adminCheck.errorMessage || "Seul un administrateur peut ajouter des membres.",
    };
  }

  const foyer = getFoyer();
  if (!foyer) {
    return { members: [], count: 0, message: "Le foyer n'est pas encore configure." };
  }

  const addedMembers: FoyerMember[] = [];
  let inputIndex = 0;

  if (!skipVocalInteraction) {
    await speak("D'accord, dis-moi le prenom et si possible l'age de la personne.");
  }

  let continueLoop = true;

  while (continueLoop) {
    const currentMembers = getMembers(foyer.id);
    if (currentMembers.length >= MAX_FAMILY_MEMBERS) {
      const msg = `Le foyer a atteint la limite de ${MAX_FAMILY_MEMBERS} membres.`;
      if (!skipVocalInteraction) await speak(msg);
      break;
    }

    let response: string | null;
    if (testInputs && inputIndex < testInputs.length) {
      response = testInputs[inputIndex++];
    } else if (!skipVocalInteraction) {
      response = await listenAndTranscribe(12, 2.0);
    } else {
      break;
    }

    if (!response) break;

    const lower = response.toLowerCase();
    if (/\b(personne|c'est\s+tout|rien|non|nan|pas\s+d'autre|fini|termine)\b/.test(lower)) {
      break;
    }

    const result = await registerNewMember(adminSpeakerId, response, true);

    if (result.success && result.member) {
      addedMembers.push(result.member);
      if (!skipVocalInteraction) {
        await speak(result.message);
        const more = await askYesNo("Quelqu'un d'autre ?");
        if (more !== true) {
          continueLoop = false;
        }
      }
    } else if (!skipVocalInteraction) {
      await speak(result.message);
    }
  }

  // Recap
  let message: string;
  if (addedMembers.length === 0) {
    message = "Aucun nouveau membre ajoute.";
  } else {
    const names = addedMembers.map((m) => m.name);
    const nameList = names.length === 1
      ? names[0]
      : names.slice(0, -1).join(", ") + " et " + names[names.length - 1];
    message = `J'ai ajoute ${addedMembers.length} nouveau${addedMembers.length > 1 ? "x" : ""} membre${addedMembers.length > 1 ? "s" : ""} : ${nameList}.`;
  }

  if (!skipVocalInteraction && addedMembers.length > 0) {
    await speak(message);
  }

  return { members: addedMembers, count: addedMembers.length, message };
}

// =====================================================================
// Consultation: List Pending Members
// =====================================================================

/**
 * Generate a spoken text listing all PRE_INSCRIT members with their
 * wait duration since creation.
 *
 * @param foyerId - The foyer UUID
 * @returns Human-readable text for TTS
 */
export function listPendingMembers(foyerId: string): string {
  const pending = getPreInscritMembers(foyerId);

  if (pending.length === 0) {
    return "Tout le monde dans le foyer a enregistre sa voix !";
  }

  const descriptions = pending.map((m) => {
    const duration = formatDurationSinceCreation(m.createdAt);
    return `${m.name} (${duration})`;
  });

  const list = descriptions.length === 1
    ? descriptions[0]
    : descriptions.slice(0, -1).join(", ") + " et " + descriptions[descriptions.length - 1];

  return `${pending.length === 1 ? "Un membre n'a" : `${pending.length} membres n'ont`} pas encore enregistre ${pending.length === 1 ? "sa" : "leur"} voix : ${list}.`;
}

/**
 * Format the duration since a creation date as a natural French string.
 * @internal
 */
export function formatDurationSinceCreation(createdAt: string): string {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays === 0) {
    if (diffHours <= 1) return "depuis moins d'une heure";
    return `depuis ${diffHours} heures`;
  }
  if (diffDays === 1) return "depuis hier";
  return `depuis ${diffDays} jours`;
}

// =====================================================================
// Suppression of pending profile
// =====================================================================

/**
 * Remove a member by name. Handles vocal confirmation via askYesNo.
 *
 * @param adminSpeakerId - The admin speaker ID
 * @param memberName - The member name to remove
 * @param skipVocalInteraction - Skip vocal confirmation (for testing)
 * @returns A spoken response message
 */
export async function removeMemberByName(
  adminSpeakerId: string,
  memberName: string,
  skipVocalInteraction = false,
): Promise<string> {
  const adminCheck = requireAdmin(adminSpeakerId);
  if (!adminCheck.authorized) {
    return adminCheck.errorMessage || "Seul un administrateur peut retirer des membres.";
  }

  const foyer = getFoyer();
  if (!foyer) return "Le foyer n'est pas encore configure.";

  const name = capitalizeFirst(memberName.trim());
  const member = getMemberByName(foyer.id, name);

  if (!member) {
    return `Je ne trouve pas de membre qui s'appelle ${name} dans le foyer.`;
  }

  if (!skipVocalInteraction) {
    // Active member warning
    if (member.state === "ACTIF") {
      const confirm = await askYesNo(
        `Attention, ${member.name} a deja enregistre sa voix. Tu es sur de vouloir le retirer ?`,
      );
      if (confirm !== true) return "D'accord, je garde le profil.";
    } else {
      const confirm = await askYesNo(`Tu veux retirer ${member.name} du foyer ?`);
      if (confirm !== true) return "D'accord, je garde le profil.";
    }
  }

  const success = removeMember(member.id);
  if (success) {
    log.info("Member removed by admin", { memberId: member.id, name: member.name, adminSpeakerId });
    return `${member.name} a ete retire du foyer.`;
  }

  return "Erreur lors de la suppression.";
}

// =====================================================================
// Pending Link Reminder System
// =====================================================================

/**
 * Check if a pending link reminder should be shown to the admin.
 * Returns the reminder message if conditions are met, null otherwise.
 *
 * Conditions:
 * - Speaker is admin
 * - There are PRE_INSCRIT members older than 48h
 * - reminder_count < MAX_PENDING_REMINDERS
 * - Not already reminded this session
 *
 * @param adminSpeakerId - The speaker ID to check
 * @returns The reminder message, or null
 */
export function checkPendingLinkReminder(adminSpeakerId: string): string | null {
  // Already reminded this session
  if (pendingLinkRemindedThisSession) return null;

  // Check admin
  const adminCheck = requireAdmin(adminSpeakerId);
  if (!adminCheck.authorized) return null;

  const foyer = getFoyer();
  if (!foyer) return null;

  ensureReminderSchema();

  // Get PRE_INSCRIT members older than 48h
  const pending = getPreInscritMembers(foyer.id);
  const now = new Date();
  const oldPending = pending.filter((m) => {
    const created = new Date(m.createdAt);
    return (now.getTime() - created.getTime()) >= PENDING_LINK_THRESHOLD_MS;
  });

  if (oldPending.length === 0) return null;

  // Check reminder count
  const db = getCompanionDb();
  let row = db.prepare(
    "SELECT * FROM pending_link_reminders WHERE foyer_id = ? LIMIT 1",
  ).get(foyer.id) as { id: string; reminder_count: number; last_reminder_at: string | null } | undefined;

  if (!row) {
    // Create initial row
    const id = randomUUID();
    db.prepare(
      "INSERT INTO pending_link_reminders (id, foyer_id, reminder_count, created_at) VALUES (?, ?, 0, datetime('now'))",
    ).run(id, foyer.id);
    row = { id, reminder_count: 0, last_reminder_at: null };
  }

  if (row.reminder_count >= MAX_PENDING_REMINDERS) {
    log.debug("Pending link reminder: max reminders reached", { foyerId: foyer.id, count: row.reminder_count });
    return null;
  }

  // Build reminder message
  const names = oldPending.map((m) => m.name);
  const nameList = names.length === 1
    ? names[0]
    : names.slice(0, -1).join(", ") + " et " + names[names.length - 1];

  const message = `Au fait, ${nameList} ${names.length === 1 ? "n'a" : "n'ont"} pas encore parle avec moi. Dis-${names.length === 1 ? "lui" : "leur"} de me dire bonjour quand ${names.length === 1 ? "il sera" : "ils seront"} la !`;

  // Increment counter
  db.prepare(
    "UPDATE pending_link_reminders SET reminder_count = reminder_count + 1, last_reminder_at = datetime('now') WHERE foyer_id = ?",
  ).run(foyer.id);

  pendingLinkRemindedThisSession = true;

  log.info("Pending link reminder sent", { foyerId: foyer.id, names, reminderCount: row.reminder_count + 1 });

  return message;
}

/**
 * Reset the reminder counter for a foyer (called when a new member is pre-inscribed).
 * @internal
 */
function resetReminderCounterForFoyer(foyerId: string): void {
  try {
    ensureReminderSchema();
    const db = getCompanionDb();
    db.prepare(
      "UPDATE pending_link_reminders SET reminder_count = 0 WHERE foyer_id = ?",
    ).run(foyerId);
    log.debug("Pending link reminder counter reset", { foyerId });
  } catch (err) {
    log.warn("Failed to reset reminder counter", { error: String(err) });
  }
}

/**
 * Get the current reminder count for a foyer. Used in tests.
 * @internal
 */
export function getReminderCount(foyerId: string): number {
  ensureReminderSchema();
  const db = getCompanionDb();
  const row = db.prepare(
    "SELECT reminder_count FROM pending_link_reminders WHERE foyer_id = ? LIMIT 1",
  ).get(foyerId) as { reminder_count: number } | undefined;
  return row?.reminder_count ?? 0;
}

/**
 * Check if reminder was already sent this session.
 * @internal
 */
export function wasPendingLinkRemindedThisSession(): boolean {
  return pendingLinkRemindedThisSession;
}
