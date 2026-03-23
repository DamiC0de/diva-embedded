/**
 * OOBE Flow — Out-of-Box Experience for Diva voice assistant
 *
 * First-boot experience that discovers and registers the household:
 * 1. Present Diva to the user
 * 2. Register the first user as admin (name + voice enrollment)
 * 3. Discover family members ("Tu vis seul ou il y a d'autres personnes ici?") — FR62
 * 4. Loop with "quelqu'un d'autre?" until done
 * 5. Handle unusual name spelling
 * 6. Recap and confirm (with ages + relations)
 * 7. Warm start vocal for each pre-inscribed member
 * 8. Launch first discovery suggestion
 *
 * Pre-inscribed members get state PRE_INSCRIT (name + optional age, no voice).
 * Their voice is linked later when they naturally interact with Diva.
 *
 * **Relationship foyer <-> persona engine:**
 * - `household/foyer-manager.ts` manages WHO is in the house (structure familiale)
 * - `persona/engine.ts` manages HOW Diva interacts with each person (behaviour/preferences)
 * - The `speakerId` (WeSpeaker embedding ID) is the shared key between both systems:
 *   - `foyer_members.speaker_id` links a member to their voice
 *   - `PersonaProfile.id` uses the same speakerId as its identifier
 * - When a member's voice is linked (via `voice-linker.ts`), a corresponding
 *   `PersonaProfile` is created in the persona engine with appropriate defaults
 *   (adult type for the first user, etc.)
 *
 * @module household/oobe-flow
 */

import { recordAudio, playAudioBytes, playAudioFile } from "../audio/audio-client.js";
import { synthesize } from "../tts/piper.js";
import { transcribeLocal } from "../stt/local-npu.js";
import { log } from "../monitoring/logger.js";
import {
  initFoyer,
  addMember,
  setFoyerStatus,
  recordOobeAttempt,
  getOobeAttempts,
  getFoyer,
  isFoyerConfigured,
  getMembers,
  getPreInscritMembers,
  type AddMemberOptions,
  type FoyerStatus,
} from "./foyer-manager.js";
import {
  isPreConfigured,
  getPendingProfile,
  activatePreConfigProfile,
  isWifiDeferred,
  getWelcomeMessage,
} from "../onboarding/pre-config-manager.js";
import {
  hasLockedSettings,
  isSettingLocked,
  getLockedSettingRefusalMessage,
  getLockedEstablishment,
  getLockedSettingKeys,
} from "../onboarding/pro-setup-manager.js";
import {
  initDiscovery,
  getDiscoveryPrompt,
  markCapabilityRevealed,
  derivePersonaTypeFromAge,
  deriveContentFilterFromAge,
  isTeen,
} from "../persona/discovery-guide.js";
import {
  prepareWarmStart,
  parseWarmStartFromSpeech,
  type WarmStartProfile,
} from "../persona/warm-start.js";
import {
  extractName,
  extractMultipleNames,
  extractAge,
  extractRelation,
  capitalizeFirst,
} from "./name-parser.js";

// =====================================================================
// Constants
// =====================================================================

const ASSETS_DIR = "/opt/diva-embedded/assets";
const MAX_FAMILY_MEMBERS = 15;
const MAX_OOBE_ATTEMPTS = 3;
const OOBE_SESSION_KEY = "oobe_prompted_this_session";

let oobePromptedThisSession = false;

// =====================================================================
// Audio Helpers (exported for reuse by member-registration)
// =====================================================================

export async function speak(text: string): Promise<void> {
  const wav = await synthesize(text);
  await playAudioBytes(wav.toString("base64"));
}

async function listenWithBeep(
  maxDurationS: number = 10,
  silenceTimeoutS: number = 1.5,
): Promise<{ has_speech: boolean; wav_base64?: string; duration_ms?: number }> {
  await playAudioFile(`${ASSETS_DIR}/listen.wav`);
  return recordAudio({ maxDurationS, silenceTimeoutS });
}

export async function listenAndTranscribe(
  maxDurationS: number = 10,
  silenceTimeoutS: number = 1.5,
): Promise<string | null> {
  const rec = await listenWithBeep(maxDurationS, silenceTimeoutS);
  if (!rec.has_speech || !rec.wav_base64) return null;

  const wav = Buffer.from(rec.wav_base64, "base64");
  // Force French transcription via Groq for reliability (SenseVoice misdetects short phrases)
  try {
    const { transcribeGroq } = await import("../stt/groq-cloud.js");
    const text = await transcribeGroq(wav, "fr");
    if (text && text.trim().length > 0) return text;
  } catch {
    // Fallback to local
  }
  return transcribeLocal(wav);
}

/**
 * Ask a yes/no question. Returns true for yes, false for no, null for ambiguous.
 */
export async function askYesNo(question: string): Promise<boolean | null> {
  await speak(question);
  const text = await listenAndTranscribe(6, 1.2);
  if (!text) return null;

  const lower = text.toLowerCase();
  if (/\b(oui|ouais|ok|d'accord|bien\s*sur|yes|yep|absolument|carrément|volontiers|evidemment)\b/.test(lower)) return true;
  if (/\b(non|nan|pas|nope|jamais|aucun|personne)\b/.test(lower)) return false;
  return null;
}

// =====================================================================
// Helpers: "lives alone" detection
// =====================================================================

/**
 * Detect if the user says they live alone.
 */
function isLivesAloneResponse(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(je\s+vis\s+seul|je\s+suis\s+seul|tout\s+seul|seule?|personne\s+d['']autre|personne|non|nan)\b/.test(lower);
}

/**
 * Detect if the user says there are other people.
 */
function hasOtherPeopleResponse(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(oui|ouais|il\s+y\s+a|on\s+est|nous\s+sommes|avec|ma\s+femme|mon\s+mari|mes\s+enfants|mon\s+fils|ma\s+fille|famille)\b/.test(lower);
}

// =====================================================================
// OOBE Main Flow
// =====================================================================

export interface OOBEResult {
  completed: boolean;
  foyerStatus: FoyerStatus;
  adminName: string | null;
  memberCount: number;
  discoveryStarted: boolean;
}

/**
 * Run the Out-of-Box Experience. Should be called on first boot
 * or when foyer is not yet configured.
 */
export async function runOOBE(): Promise<OOBEResult> {
  log.info("OOBE: starting out-of-box experience");

  const MEM0_URL = "http://localhost:9002";
  const ENROLLMENT_PHRASES = [
    "Repete apres moi : Diva, quelle heure est-il ?",
    "Repete : Le soleil brille aujourd'hui, il fait vraiment tres beau dehors.",
    "Repete : Est-ce que tu peux me raconter une blague s'il te plait ?",
    "Et la derniere : Je voudrais ecouter de la musique classique ce soir.",
  ];

  try {
    // Initialize foyer
    const foyer = initFoyer();
    recordOobeAttempt();

    // ── Step 1: Present Diva ──
    await speak(
      "Bonjour ! Je suis Diva, ton assistant vocal intelligent. " +
      "Je vais apprendre a te connaitre. Ca prend deux minutes.",
    );

    // ── Step 2: Get admin name ──
    await speak("Pour commencer, comment tu t'appelles ?");
    const adminNameText = await listenAndTranscribe(15, 2.5);

    if (!adminNameText) {
      log.warn("OOBE: no response for admin name, marking incomplete");
      setFoyerStatus("INCOMPLETE");
      await speak("Pas de souci, on reprendra plus tard. Dis juste Diva quand tu es pret.");
      return { completed: false, foyerStatus: "INCOMPLETE", adminName: null, memberCount: 0, discoveryStarted: false };
    }

    let confirmedAdminName = capitalizeFirst(extractName(adminNameText));
    if (!confirmedAdminName || confirmedAdminName.length < 2) {
      // Use the full text as fallback
      confirmedAdminName = capitalizeFirst(adminNameText.trim().split(/[\s,!.?]+/)[0] || "");
    }
    if (!confirmedAdminName || confirmedAdminName.length < 2) {
      log.warn("OOBE: could not extract admin name", { raw: adminNameText });
      setFoyerStatus("INCOMPLETE");
      await speak("Je n'ai pas bien entendu. On reprendra plus tard.");
      return { completed: false, foyerStatus: "INCOMPLETE", adminName: null, memberCount: 0, discoveryStarted: false };
    }

    log.info("OOBE: admin name detected", { name: confirmedAdminName });

    // Confirm name with natural correction flow (FR57)
    const nameOk = await askYesNo(`${confirmedAdminName}, c'est ça ?`);
    if (nameOk === false) {
      await speak("D'accord, comment tu t'appelles ?");
      const retry = await listenAndTranscribe(12, 2.5);
      if (retry) {
        const retryName = capitalizeFirst(extractName(retry));
        if (retryName && retryName.length >= 2) {
          confirmedAdminName = retryName;
        } else {
          // Fallback: ask to spell
          await speak("Tu peux me l'épeler ?");
          const spelled = await listenAndTranscribe(15, 2.0);
          if (spelled) {
            const spelledName = capitalizeFirst(
              spelled.replace(/\s+/g, "").replace(/[^a-zA-ZàâéèêëïîôùûüÿçÀÂÉÈÊËÏÎÔÙÛÜŸÇ-]/g, ""),
            );
            if (spelledName.length >= 2) confirmedAdminName = spelledName;
          }
        }
      }
      // Re-confirm after correction
      const reconfirm = await askYesNo(`${confirmedAdminName}, c'est bien ça ?`);
      if (reconfirm === false) {
        await speak("On reprendra plus tard. Dis juste Diva quand tu es prêt.");
        setFoyerStatus("INCOMPLETE");
        return { completed: false, foyerStatus: "INCOMPLETE", adminName: null, memberCount: 0, discoveryStarted: false };
      }
    }

    // Create admin member
    const adminMember = addMember(foyer.id, {
      name: confirmedAdminName,
      isAdmin: true,
      state: "ACTIF",
    });
    log.info("OOBE: admin member created", { id: adminMember.id, name: confirmedAdminName });

    // ── Step 3: Voice enrollment for admin ──
    await speak(
      `Tres bien ${confirmedAdminName}. Maintenant je vais apprendre ta voix ` +
      `pour te reconnaitre. Repete les phrases apres le bip.`
    );

    const audioSamples: string[] = [];
    // Use the name recording as first sample
    const nameRec = await listenWithBeep(8, 1.5);
    if (nameRec.has_speech && nameRec.wav_base64) {
      audioSamples.push(nameRec.wav_base64);
    }

    for (const phrase of ENROLLMENT_PHRASES) {
      await speak(phrase);
      const rec = await listenWithBeep(12, 2.0);
      if (rec.has_speech && rec.wav_base64) {
        audioSamples.push(rec.wav_base64);
      } else {
        // One retry
        await speak("Je n'ai pas entendu, repete.");
        const retry = await listenWithBeep(12, 2.0);
        if (retry.has_speech && retry.wav_base64) {
          audioSamples.push(retry.wav_base64);
        }
      }
    }

    // Register voice with MEM0
    const speakerKey = confirmedAdminName.toLowerCase().replace(/[^a-zàâéèêëïîôùûüÿç]/g, "");
    let voiceRegistered = false;
    if (audioSamples.length >= 3) {
      try {
        const res = await fetch(`${MEM0_URL}/speaker/register-multi`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: speakerKey, samples: audioSamples }),
          signal: AbortSignal.timeout(30000),
        });
        voiceRegistered = res.ok;
        if (!voiceRegistered) {
          // Fallback: single best sample
          const best = audioSamples.reduce((a, b) => a.length > b.length ? a : b);
          const res2 = await fetch(`${MEM0_URL}/speaker/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: speakerKey, audio: best }),
            signal: AbortSignal.timeout(10000),
          });
          voiceRegistered = res2.ok;
        }
      } catch (err) {
        log.warn("OOBE: voice registration failed", { error: String(err) });
      }
    }

    if (voiceRegistered) {
      // Create persona and link speaker
      try {
        const { createPersona } = await import("../persona/engine.js");
        createPersona(speakerKey, confirmedAdminName, "adult", confirmedAdminName);
      } catch { /* persona may already exist */ }
      // Update member with speaker_id
      try {
        const { getCompanionDb } = await import("../security/database-manager.js");
        const db = getCompanionDb();
        db.prepare("UPDATE foyer_members SET speaker_id = ? WHERE id = ?").run(speakerKey, adminMember.id);
      } catch { /* best effort */ }
      log.info("OOBE: admin voice registered", { name: confirmedAdminName, samples: audioSamples.length });
      await speak(`Parfait ${confirmedAdminName}, je te reconnaitrai maintenant.`);
    } else {
      log.warn("OOBE: voice registration failed or not enough samples", { samples: audioSamples.length });
      await speak(`OK ${confirmedAdminName}. L'enregistrement vocal n'a pas marche, tu pourras le refaire plus tard en disant : enregistre ma voix.`);
    }

    // ── Step 4: Discover other members ──
    await speak("Qui d'autre habite ici avec toi ? Dis-moi les prenoms, ou non si tu es seul.");

    const discoveredMembers: { name: string; age: number | null; relation: string | null }[] = [];
    let memberIndex = 0;

    // First response
    const firstResponse = await listenAndTranscribe(15, 2.5);
    if (firstResponse && !isLivesAloneResponse(firstResponse)
        && !/\b(non|nan|personne|rien|seul)\b/.test(firstResponse.toLowerCase())) {
      // Extract names
      const names = extractMultipleNames(firstResponse)
        .filter(m => m.name.toLowerCase() !== confirmedAdminName.toLowerCase());
      for (const n of names) {
        discoveredMembers.push(n);
        memberIndex++;
        log.info("OOBE: member discovered", { name: n.name });
      }
      // If no names extracted but positive response, ask for a name
      if (names.length === 0) {
        const singleName = capitalizeFirst(extractName(firstResponse));
        if (singleName && singleName.length >= 2 && singleName.toLowerCase() !== confirmedAdminName.toLowerCase()) {
          discoveredMembers.push({ name: singleName, age: extractAge(firstResponse), relation: extractRelation(firstResponse) });
          memberIndex++;
        }
      }

      // Loop for more
      while (memberIndex < MAX_FAMILY_MEMBERS) {
        if (discoveredMembers.length > 0) {
          const allNames = discoveredMembers.map(m => m.name).join(", ");
          await speak(`${allNames}. Quelqu'un d'autre ? Dis un prenom ou non.`);
        } else {
          await speak("Dis-moi un prenom.");
        }

        const response = await listenAndTranscribe(12, 2.5);
        if (!response) break;

        const lower = response.toLowerCase();
        if (/\b(non|nan|personne|c'est\s+tout|pas\s+d'autre|fini|termin|rien|stop|voila|c'est\s+bon)\b/.test(lower)) break;

        const newNames = extractMultipleNames(response)
          .filter(m => m.name.toLowerCase() !== confirmedAdminName.toLowerCase()
            && !discoveredMembers.some(d => d.name.toLowerCase() === m.name.toLowerCase()));

        if (newNames.length > 0) {
          for (const n of newNames) {
            discoveredMembers.push(n);
            memberIndex++;
            log.info("OOBE: member discovered", { name: n.name });
          }
        } else {
          const singleName = capitalizeFirst(extractName(response));
          if (singleName && singleName.length >= 2) {
            discoveredMembers.push({ name: singleName, age: null, relation: null });
            memberIndex++;
          }
        }
      }
    }

    // ── Step 5: Confirm and create member profiles (FR57 — repeat for confirmation) ──
    const confirmedMembers: typeof discoveredMembers = [];
    for (const member of discoveredMembers) {
      const ageInfo = member.age ? `, ${member.age} ans` : "";
      const confirm = await askYesNo(`${member.name}${ageInfo}, c'est bien ça ?`);
      if (confirm === false) {
        // Natural correction: ask for the right name
        await speak("Comment s'appelle cette personne ?");
        const correction = await listenAndTranscribe(10, 2.0);
        if (correction) {
          const correctedName = capitalizeFirst(extractName(correction));
          if (correctedName && correctedName.length >= 2) {
            member.name = correctedName;
            member.age = extractAge(correction) ?? member.age;
          }
        }
      }
      // confirm === null (ambiguous) treated as OK to avoid frustrating loops
      confirmedMembers.push(member);
      addMember(foyer.id, {
        name: member.name,
        age: member.age ?? undefined,
        relation: member.relation ?? undefined,
        state: "ACTIF",
      });
      log.info("OOBE: member created", { name: member.name });
    }

    // ── Step 6: Final recap ──
    const totalMembers = confirmedMembers.length + 1;

    if (confirmedMembers.length > 0) {
      const nameList = confirmedMembers.map(m => m.name).join(", ");
      await speak(
        `C'est noté. Le foyer, c'est ${confirmedAdminName} et ${nameList}. ` +
        `Les autres pourront enregistrer leur voix en disant : Diva, enregistre ma voix.`,
      );
    } else {
      await speak(
        `C'est noté ${confirmedAdminName}. Tu pourras ajouter des personnes plus tard.`,
      );
    }

    // Mark foyer as configured
    setFoyerStatus("CONFIGURED");

    // --- Step 6: Warm start for pre-inscribed members ---
    if (discoveredMembers.length > 0) {
      await runWarmStartPhase(confirmedAdminName, discoveredMembers, foyer.id);
    }

    // --- Step 7: Launch first discovery ---
    let discoveryStarted = false;
    try {
      const adminCreatedAt = new Date();
      const adminTempSpeakerId = `admin_${adminMember.id}`;

      initDiscovery(adminTempSpeakerId, adminCreatedAt);

      const personaType = derivePersonaTypeFromAge(null); // admin is adult
      const contentFilter = deriveContentFilterFromAge(null);
      const prompt = getDiscoveryPrompt(adminTempSpeakerId, adminCreatedAt, personaType, contentFilter, null);

      if (prompt) {
        await speak(prompt);
        // Mark the first capability as revealed
        const { getScheduleForType, getTeenSchedule, filterByContentFilter } = await import("../persona/discovery-guide.js");
        const schedule = filterByContentFilter(getScheduleForType(personaType), contentFilter);
        if (schedule.length > 0) {
          markCapabilityRevealed(adminTempSpeakerId, schedule[0].capability, "oobe_first_discovery");
        }
        discoveryStarted = true;
      } else {
        await speak("Excellent ! La maison est configuree. Je suis prete a vous aider !");
      }
    } catch (err) {
      log.warn("OOBE: error launching first discovery, continuing", { error: String(err) });
      await speak("Excellent ! La maison est configuree. Je suis prete a vous aider !");
    }

    log.info("OOBE: completed successfully", {
      adminName: confirmedAdminName,
      memberCount: totalMembers,
      discoveryStarted,
    });

    return {
      completed: true,
      foyerStatus: "CONFIGURED",
      adminName: confirmedAdminName,
      memberCount: totalMembers,
      discoveryStarted,
    };
  } catch (err) {
    log.error("OOBE: unexpected error", { error: String(err) });
    setFoyerStatus("INCOMPLETE");
    try {
      await speak("Desole, j'ai rencontre un probleme. On reprendra plus tard.");
    } catch {
      // Audio might be unavailable
    }
    return { completed: false, foyerStatus: "INCOMPLETE", adminName: null, memberCount: 0, discoveryStarted: false };
  }
}

// =====================================================================
// Warm Start Phase (Task 4)
// =====================================================================

/**
 * Run the warm start phase: for each pre-inscribed member, ask the admin
 * if they want to share information about that member.
 */
async function runWarmStartPhase(
  adminName: string,
  members: { name: string; age: number | null; relation: string | null }[],
  foyerId: string,
): Promise<void> {
  // For families with 4+ members, offer batch mode
  if (members.length >= 4) {
    const batchMode = await askYesNo(
      "Tu preferes me donner des infos sur tout le monde d'un coup ?",
    );
    if (batchMode === true) {
      await speak(
        "D'accord, dis-moi tout ce que tu veux que je sache sur les membres de ta famille.",
      );
      const batchResponse = await listenAndTranscribe(30, 3.0);
      if (batchResponse) {
        // Process batch — try to extract info for each member
        for (const member of members) {
          const memberType = derivePersonaTypeFromAge(member.age);
          const parsed = parseWarmStartFromSpeech(batchResponse, member.name, memberType);
          if (parsed.interests?.length || parsed.pet || parsed.nickname) {
            const profile: WarmStartProfile = {
              displayName: member.name,
              greetingName: parsed.nickname ?? member.name,
              type: memberType,
              interests: parsed.interests,
              pet: parsed.pet,
              nickname: parsed.nickname,
              notes: parsed.notes,
            };
            prepareWarmStart(member.name.toLowerCase(), profile);
            log.info("OOBE: batch warm start processed", { member: member.name });
          }
        }
      }
      return;
    }
  }

  // Individual warm start for each member
  for (const member of members) {
    const wantWarmStart = await askYesNo(
      `Tu veux me dire quelques petites choses sur ${member.name} ? ` +
      `Ses centres d'interet, un surnom, des habitudes ?`,
    );

    if (wantWarmStart === true) {
      const response = await listenAndTranscribe(20, 2.5);
      if (response) {
        const memberType = derivePersonaTypeFromAge(member.age);
        const parsed = parseWarmStartFromSpeech(response, member.name, memberType);

        const profile: WarmStartProfile = {
          displayName: member.name,
          greetingName: parsed.nickname ?? member.name,
          type: memberType,
          interests: parsed.interests,
          pet: parsed.pet,
          nickname: parsed.nickname,
          notes: parsed.notes,
        };

        prepareWarmStart(member.name.toLowerCase(), profile);
        await speak(`C'est note pour ${member.name} !`);
        log.info("OOBE: warm start completed for member", { member: member.name });
      }
    } else {
      log.debug("OOBE: warm start skipped for member", { member: member.name });
    }
  }
}

// =====================================================================
// OOBE Re-prompt Logic
// =====================================================================

/**
 * Check if OOBE should be triggered (first boot or incomplete foyer).
 * Subtle re-prompt: max 1 per session, max 3 total attempts.
 */
export function shouldTriggerOOBE(): boolean {
  // Already fully configured
  if (isFoyerConfigured()) return false;

  // Already prompted this session
  if (oobePromptedThisSession) return false;

  // Max total attempts reached
  const attempts = getOobeAttempts();
  if (attempts >= MAX_OOBE_ATTEMPTS) {
    log.debug("OOBE: max attempts reached, not re-prompting", { attempts });
    return false;
  }

  // No foyer at all — definitely trigger
  const foyer = getFoyer();
  if (!foyer) return true;

  // Incomplete foyer — re-prompt
  if (foyer.status === "INCOMPLETE" || foyer.status === "NOT_CONFIGURED") {
    return true;
  }

  return false;
}

/**
 * Mark that OOBE was prompted this session (prevents repeated prompts).
 */
export function markOOBEPrompted(): void {
  oobePromptedThisSession = true;
}

/**
 * Reset session state (call on new session start).
 */
export function resetOOBESession(): void {
  oobePromptedThisSession = false;
}

/**
 * Check if foyer is CONFIGURED but discovery hasn't been started.
 * Used for resuming after interruption.
 */
export function shouldResumeDiscovery(): boolean {
  if (!isFoyerConfigured()) return false;

  const foyer = getFoyer();
  if (!foyer) return false;

  // Check if admin member has discovery tracking entries
  const members = getMembers(foyer.id);
  const admin = members.find((m) => m.isAdmin);
  if (!admin) return false;

  // If admin has no discovery entries, we should resume
  try {
    const { getRevealedCapabilities } = require("../persona/discovery-guide.js");
    const adminSpeakerId = admin.speakerId ?? `admin_${admin.id}`;
    const revealed = getRevealedCapabilities(adminSpeakerId);
    return revealed.length === 0;
  } catch {
    return false;
  }
}

/**
 * Run the OOBE re-prompt flow for incomplete foyers.
 * More subtle than the initial OOBE — just asks if they want to continue setup.
 */
export async function runOOBEReprompt(): Promise<OOBEResult | null> {
  markOOBEPrompted();

  const foyer = getFoyer();
  if (!foyer) {
    return runOOBE();
  }

  const members = getMembers(foyer.id);
  const hasAdmin = members.some((m) => m.isAdmin);

  if (!hasAdmin) {
    // No admin yet — run full OOBE
    return runOOBE();
  }

  // Foyer exists but incomplete — gentle re-prompt
  log.info("OOBE: re-prompting for incomplete foyer");
  recordOobeAttempt();

  const wantToContinue = await askYesNo(
    "Au fait, on n'avait pas termine la configuration de la maison. Tu veux qu'on continue maintenant ?",
  );

  if (wantToContinue !== true) {
    log.info("OOBE: user declined re-prompt");
    await speak("D'accord, pas de probleme.");
    return null;
  }

  // Continue discovery from where we left off
  try {
    await speak("Super ! Tu vis seul ou il y a d'autres personnes ici ?");

    const householdResponse = await listenAndTranscribe(12, 2.0);
    const discoveredMembers: { name: string; age: number | null; relation: string | null }[] = [];
    let continueDiscovery = true;
    let memberIndex = 0;

    if (householdResponse && !isLivesAloneResponse(householdResponse)) {
      while (continueDiscovery && memberIndex < MAX_FAMILY_MEMBERS) {
        let response = memberIndex === 0 ? householdResponse : await listenAndTranscribe(12, 2.0);

        if (!response) break;

        const lower = response.toLowerCase();
        if (/\b(personne|c'est\s+tout|rien|non|nan|pas\s+d'autre|fini|termine)\b/.test(lower)) break;

        const memberName = capitalizeFirst(extractName(response));
        const memberAge = extractAge(response);
        const memberRelation = extractRelation(response);

        if (memberName && memberName.length >= 2) {
          discoveredMembers.push({ name: memberName, age: memberAge, relation: memberRelation });
          memberIndex++;

          addMember(foyer.id, {
            name: memberName,
            age: memberAge ?? undefined,
            relation: memberRelation ?? undefined,
            state: "PRE_INSCRIT",
          });

          log.info("OOBE reprompt: member added", { name: memberName });

          const moreMembers = await askYesNo("Quelqu'un d'autre ?");
          if (moreMembers === false || moreMembers === null) {
            continueDiscovery = false;
          }
        } else {
          await speak("Je n'ai pas bien compris. Peux-tu repeter le prenom ?");
        }
      }
    }

    const updatedMembers = getMembers(foyer.id);
    if (discoveredMembers.length > 0 || updatedMembers.length > 1) {
      setFoyerStatus("CONFIGURED");

      // Run warm start for newly discovered members
      if (discoveredMembers.length > 0) {
        await runWarmStartPhase(
          updatedMembers.find((m) => m.isAdmin)?.name ?? "",
          discoveredMembers,
          foyer.id,
        );
      }

      await speak("C'est note ! La maison est maintenant configuree.");
      log.info("OOBE reprompt: completed", { newMembers: discoveredMembers.length });

      return {
        completed: true,
        foyerStatus: "CONFIGURED",
        adminName: updatedMembers.find((m) => m.isAdmin)?.name ?? null,
        memberCount: updatedMembers.length,
        discoveryStarted: false,
      };
    }

    // No new members added but user confirmed alone
    setFoyerStatus("CONFIGURED");
    await speak("D'accord, la configuration est terminee.");
    return {
      completed: true,
      foyerStatus: "CONFIGURED",
      adminName: updatedMembers.find((m) => m.isAdmin)?.name ?? null,
      memberCount: updatedMembers.length,
      discoveryStarted: false,
    };
  } catch (err) {
    log.error("OOBE reprompt: error", { error: String(err) });
    return null;
  }
}

// =====================================================================
// Story 21.2: Pre-configured profile boot integration (Task 7)
// =====================================================================

/**
 * Checks at boot if a pre-configured profile exists and activates it.
 * - If pre-configured: activates profile, generates welcome message, skips OOBE profile setup (AC #5)
 * - If WiFi deferred: returns indication to launch hotspot for WiFi-only setup (AC #3)
 * - If pro mode with locked settings: loads locked setting keys for middleware (AC #10)
 *
 * Returns an object describing the boot state.
 */
export interface PreConfigBootResult {
  preConfigured: boolean;
  activated: boolean;
  welcomeMessage: string | null;
  recipientName: string | null;
  wifiDeferred: boolean;
  lockedSettings: string[];
  lockedEstablishment: string | null;
}

export async function checkPreConfigBoot(): Promise<PreConfigBootResult> {
  const result: PreConfigBootResult = {
    preConfigured: false,
    activated: false,
    welcomeMessage: null,
    recipientName: null,
    wifiDeferred: false,
    lockedSettings: [],
    lockedEstablishment: null,
  };

  try {
    // Check for pending pre-configured profile (AC #5)
    if (isPreConfigured()) {
      result.preConfigured = true;
      const pending = getPendingProfile();

      if (pending && pending.id != null) {
        // Check if WiFi is deferred (AC #3)
        if (isWifiDeferred()) {
          result.wifiDeferred = true;
          result.recipientName = pending.recipient_name;
          log.info("Pre-config boot: WiFi deferred, will launch hotspot for WiFi-only setup", {
            recipientName: pending.recipient_name,
          });
          // Don't activate yet — wait for WiFi to be configured
          return result;
        }

        // Activate the profile
        const activated = activatePreConfigProfile(pending.id);
        if (activated) {
          result.activated = true;
          result.recipientName = activated.recipient_name;
          result.welcomeMessage = getWelcomeMessage(activated);

          log.info("Pre-config boot: profile activated", {
            recipientName: activated.recipient_name,
            installerName: activated.installer_name,
          });

          // Speak the welcome message (AC #5)
          try {
            await speak(result.welcomeMessage);
          } catch (err) {
            log.warn("Pre-config boot: failed to speak welcome", { error: String(err) });
          }
        }
      }
    }

    // Check for locked settings from pro mode (AC #10)
    if (hasLockedSettings()) {
      result.lockedSettings = getLockedSettingKeys();
      result.lockedEstablishment = getLockedEstablishment();
      log.info("Pre-config boot: locked settings detected", {
        keys: result.lockedSettings,
        establishment: result.lockedEstablishment,
      });
    }
  } catch (err) {
    log.error("Pre-config boot check failed", { error: String(err) });
  }

  return result;
}

/**
 * Middleware check for locked settings (AC #10).
 * Call this before executing any setting modification.
 * Returns a refusal message if the setting is locked, or null if allowed.
 */
export function checkLockedSetting(settingKey: string): string | null {
  if (isSettingLocked(settingKey)) {
    return getLockedSettingRefusalMessage(settingKey);
  }
  return null;
}
