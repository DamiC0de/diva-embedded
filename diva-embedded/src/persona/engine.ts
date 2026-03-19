/**
 * Persona Engine v2 — Rich personality adaptation per speaker
 *
 * After speaker ID (WeSpeaker), loads persona profile that configures:
 * - communicationPrefs: tutoiement, style, humor, verbosity
 * - prompt_prefix: auto-generated from prefs (or custom override)
 * - tts_config: Piper speed (length_scale) and pauses
 * - content_filter: none | mild | strict
 * - greeting_name: how Diva addresses this person
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { atomicWriteJsonSync } from "../security/atomic-write.js";
import { join } from "node:path";

const PERSONAS_DIR = "/opt/diva-embedded/data/personas";

// =====================================================================
// Types
// =====================================================================

export type PersonaType = "adult" | "child" | "elderly" | "alzheimer" | "guest";
export type ContentFilter = "none" | "mild" | "strict";
export type CommunicationStyle = "enjouée" | "posée" | "neutre" | "chaleureuse" | "espiègle";
export type Verbosity = "concise" | "normale" | "détaillée";
export type InitiativeLevel = "silent" | "low" | "medium" | "high" | "chatty";

export interface CommunicationPrefs {
  tutoiement: boolean;
  style: CommunicationStyle;
  humor: boolean;
  verbosity: Verbosity;
  initiativeLevel: InitiativeLevel;
}

export interface TTSConfig {
  lengthScale: number;
  pauseBetweenSentences: number;
}

export interface PersonaProfile {
  id: string;
  name: string;
  type: PersonaType;
  greetingName: string;
  communicationPrefs: CommunicationPrefs;
  allowedIntents: string[] | "all";
  blockedIntents: string[];
  promptPrefix: string;       // auto-generated or custom override
  ttsConfig: TTSConfig;
  contentFilter: ContentFilter;
  morningBriefing: boolean;
  medicationReminders: boolean;
  proactiveCheckins: boolean;
  aidantContacts: string[];
}

// =====================================================================
// Default Communication Prefs by Type
// =====================================================================

const DEFAULT_COMM_PREFS: Record<PersonaType, CommunicationPrefs> = {
  adult: { tutoiement: true, style: "neutre", humor: true, verbosity: "concise", initiativeLevel: "low" },
  child: { tutoiement: true, style: "enjouée", humor: true, verbosity: "concise", initiativeLevel: "medium" },
  elderly: { tutoiement: false, style: "chaleureuse", humor: false, verbosity: "normale", initiativeLevel: "high" },
  alzheimer: { tutoiement: false, style: "chaleureuse", humor: false, verbosity: "concise", initiativeLevel: "chatty" },
  guest: { tutoiement: false, style: "neutre", humor: false, verbosity: "concise", initiativeLevel: "silent" },
};

// =====================================================================
// Generate promptPrefix from CommunicationPrefs
// =====================================================================

function generatePromptPrefix(persona: PersonaProfile): string {
  const { communicationPrefs: prefs, type, greetingName } = persona;
  const parts: string[] = [];

  // Address
  if (prefs.tutoiement) {
    parts.push("Utilise le tutoiement.");
  } else {
    parts.push("Utilise le vouvoiement.");
  }

  // Style
  switch (prefs.style) {
    case "enjouée":
      parts.push("Ton enjoue et dynamique. Montre de l'enthousiasme.");
      break;
    case "posée":
      parts.push("Ton calme et reflechi. Prends le temps de bien formuler.");
      break;
    case "chaleureuse":
      parts.push("Ton chaleureux et bienveillant. Montre de l'empathie.");
      break;
    case "espiègle":
      parts.push("Ton espiegle et malicieux. N'hesite pas a taquiner gentiment.");
      break;
    case "neutre":
    default:
      parts.push("Ton naturel et efficace.");
      break;
  }

  // Humor
  if (prefs.humor) {
    parts.push("L'humour est bienvenu, glisse des touches d'esprit quand c'est naturel.");
  } else {
    parts.push("Reste serieux et factuel.");
  }

  // Verbosity
  switch (prefs.verbosity) {
    case "concise":
      parts.push("Reponses courtes et directes, 1-2 phrases max.");
      break;
    case "détaillée":
      parts.push("Tu peux developper tes reponses avec des details et exemples.");
      break;
    case "normale":
    default:
      parts.push("Reponses de longueur moderee, 2-3 phrases.");
      break;
  }

  // Type-specific extras
  if (type === "child") {
    parts.push("Tu parles a un enfant. Vocabulaire simple. Pas de contenu effrayant ou complexe.");
  } else if (type === "alzheimer") {
    parts.push("Tu parles a une personne avec des troubles cognitifs. Phrases tres courtes (max 10 mots). Ne corrige jamais. Encourage toujours. Si la personne repete une question, reponds avec la meme bienveillance en reformulant legerement.");
  } else if (type === "elderly") {
    parts.push("Tu parles a une personne agee. Articule bien les informations importantes.");
  }

  // Greeting name
  if (greetingName) {
    parts.push(`L'utilisateur s'appelle ${greetingName}.`);
  }

  return parts.join(" ");
}

// =====================================================================
// Default Profiles by Type
// =====================================================================

const DEFAULT_PROFILES: Record<PersonaType, Omit<PersonaProfile, "id" | "name" | "greetingName" | "promptPrefix">> = {
  adult: {
    type: "adult",
    communicationPrefs: DEFAULT_COMM_PREFS.adult,
    allowedIntents: "all",
    blockedIntents: [],
    ttsConfig: { lengthScale: 1.0, pauseBetweenSentences: 200 },
    contentFilter: "none",
    morningBriefing: true,
    medicationReminders: false,
    proactiveCheckins: false,
    aidantContacts: [],
  },
  child: {
    type: "child",
    communicationPrefs: DEFAULT_COMM_PREFS.child,
    allowedIntents: "all",
    blockedIntents: ["home_control", "instruction"],
    ttsConfig: { lengthScale: 0.95, pauseBetweenSentences: 300 },
    contentFilter: "strict",
    morningBriefing: false,
    medicationReminders: false,
    proactiveCheckins: false,
    aidantContacts: [],
  },
  elderly: {
    type: "elderly",
    communicationPrefs: DEFAULT_COMM_PREFS.elderly,
    allowedIntents: "all",
    blockedIntents: [],
    ttsConfig: { lengthScale: 1.2, pauseBetweenSentences: 500 },
    contentFilter: "mild",
    morningBriefing: true,
    medicationReminders: true,
    proactiveCheckins: true,
    aidantContacts: [],
  },
  alzheimer: {
    type: "alzheimer",
    communicationPrefs: DEFAULT_COMM_PREFS.alzheimer,
    allowedIntents: "all",
    blockedIntents: ["home_control"],
    ttsConfig: { lengthScale: 1.3, pauseBetweenSentences: 800 },
    contentFilter: "strict",
    morningBriefing: true,
    medicationReminders: true,
    proactiveCheckins: true,
    aidantContacts: [],
  },
  guest: {
    type: "guest",
    communicationPrefs: DEFAULT_COMM_PREFS.guest,
    allowedIntents: ["time", "weather", "greeting", "goodbye", "conversational", "joke", "calculator", "identity"],
    blockedIntents: ["instruction", "home_control", "music"],
    ttsConfig: { lengthScale: 1.0, pauseBetweenSentences: 200 },
    contentFilter: "mild",
    morningBriefing: false,
    medicationReminders: false,
    proactiveCheckins: false,
    aidantContacts: [],
  },
};

// =====================================================================
// Persona Store
// =====================================================================

const personas = new Map<string, PersonaProfile>();
let currentPersona: PersonaProfile | null = null;

export function loadPersonas(): void {
  personas.clear();
  if (!existsSync(PERSONAS_DIR)) {
    mkdirSync(PERSONAS_DIR, { recursive: true });
    return;
  }

  const files = readdirSync(PERSONAS_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const raw = readFileSync(join(PERSONAS_DIR, file), "utf-8");
      const profile: PersonaProfile = JSON.parse(raw);

      // Migrate old profiles without communicationPrefs
      if (!profile.communicationPrefs) {
        profile.communicationPrefs = DEFAULT_COMM_PREFS[profile.type] || DEFAULT_COMM_PREFS.adult;
        profile.promptPrefix = generatePromptPrefix(profile);
        savePersona(profile);
        console.log(`[PERSONA] Migrated: ${profile.id}`);
      }

      personas.set(profile.id, profile);
      console.log(`[PERSONA] Loaded: ${profile.id} (${profile.type})`);
    } catch (err) {
      console.error(`[PERSONA] Error loading ${file}:`, err);
    }
  }
  console.log(`[PERSONA] ${personas.size} personas loaded`);
}

export function savePersona(profile: PersonaProfile): void {
  const path = join(PERSONAS_DIR, `${profile.id}.json`);
  atomicWriteJsonSync(path, profile);
  personas.set(profile.id, profile);
  console.log(`[PERSONA] Saved: ${profile.id} (${profile.type})`);
}

export function getPersona(speakerId: string): PersonaProfile {
  const profile = personas.get(speakerId);
  if (profile) return profile;
  // Return guest profile for unknown speakers
  const guestDefaults = DEFAULT_PROFILES.guest;
  const guest: PersonaProfile = {
    id: "guest",
    name: "Invité",
    greetingName: "",
    promptPrefix: "",
    ...guestDefaults,
  };
  guest.promptPrefix = generatePromptPrefix(guest);
  return guest;
}

export function createPersona(
  speakerId: string,
  displayName: string,
  type: PersonaType,
  greetingName?: string,
  commPrefs?: Partial<CommunicationPrefs>
): PersonaProfile {
  const defaults = DEFAULT_PROFILES[type];
  const finalCommPrefs: CommunicationPrefs = {
    ...DEFAULT_COMM_PREFS[type],
    ...(commPrefs || {}),
  };
  const profile: PersonaProfile = {
    id: speakerId,
    name: displayName,
    greetingName: greetingName ?? displayName,
    promptPrefix: "", // will be generated
    ...defaults,
    communicationPrefs: finalCommPrefs,
  };
  profile.promptPrefix = generatePromptPrefix(profile);
  savePersona(profile);
  return profile;
}

export function updatePersonaPrefs(
  speakerId: string,
  commPrefs: Partial<CommunicationPrefs>
): PersonaProfile | null {
  const profile = personas.get(speakerId);
  if (!profile) return null;
  profile.communicationPrefs = { ...profile.communicationPrefs, ...commPrefs };
  profile.promptPrefix = generatePromptPrefix(profile);
  savePersona(profile);
  return profile;
}

export function listPersonas(): PersonaProfile[] {
  return [...personas.values()];
}

export function deletePersona(id: string): boolean {
  const path = join(PERSONAS_DIR, `${id}.json`);
  if (existsSync(path)) {
    const fs = require("node:fs");
    fs.unlinkSync(path);
    personas.delete(id);
    return true;
  }
  return false;
}

// =====================================================================
// Active Persona Management
// =====================================================================

export function setCurrentPersona(speakerId: string): PersonaProfile {
  currentPersona = getPersona(speakerId);
  console.log(`[PERSONA] Active: ${currentPersona.id} (${currentPersona.type}) — "${currentPersona.greetingName}"`);
  return currentPersona;
}

export function getCurrentPersona(): PersonaProfile {
  return currentPersona ?? getPersona("guest");
}

// =====================================================================
// Intent Filtering
// =====================================================================

export function isIntentAllowed(category: string): boolean {
  const persona = getCurrentPersona();
  if (persona.blockedIntents.includes(category)) return false;
  if (persona.allowedIntents === "all") return true;
  return persona.allowedIntents.includes(category);
}

// =====================================================================
// System Prompt Builder
// =====================================================================

export function getPersonaPromptPrefix(): string {
  return getCurrentPersona().promptPrefix;
}

export function getPersonaTTSConfig(): TTSConfig {
  return getCurrentPersona().ttsConfig;
}

// Initialize on import
loadPersonas();
