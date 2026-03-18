/**
 * Persona Engine — adapts ALL behavior based on detected speaker
 * 
 * After speaker ID (WeSpeaker), loads persona profile that configures:
 * - allowed_intents: which intents are allowed (child filtering)
 * - prompt_prefix: Claude instructions (tone, vocabulary, length)
 * - tts_config: Piper speed (length_scale) and pauses
 * - content_filter: none | mild | strict
 * - greeting_name: how Diva addresses this person
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PERSONAS_DIR = "/opt/diva-embedded/data/personas";

// =====================================================================
// Types
// =====================================================================

export type PersonaType = "adult" | "child" | "elderly" | "alzheimer" | "guest";
export type ContentFilter = "none" | "mild" | "strict";

export interface TTSConfig {
  lengthScale: number;   // 1.0 = normal, >1 = slower, <1 = faster
  pauseBetweenSentences: number; // ms pause between sentences
}

export interface PersonaProfile {
  id: string;            // matches speaker ID name
  name: string;          // display name
  type: PersonaType;
  greetingName: string;  // "Marie", "mon grand", etc.
  allowedIntents: string[] | "all";
  blockedIntents: string[];
  promptPrefix: string;  // injected into Claude system prompt
  ttsConfig: TTSConfig;
  contentFilter: ContentFilter;
  morningBriefing: boolean;
  medicationReminders: boolean;
  proactiveCheckins: boolean;
  aidantContacts: string[]; // notification targets
}

// =====================================================================
// Default Profiles by Type
// =====================================================================

const DEFAULT_PROFILES: Record<PersonaType, Omit<PersonaProfile, "id" | "name" | "greetingName">> = {
  adult: {
    type: "adult",
    allowedIntents: "all",
    blockedIntents: [],
    promptPrefix: "Ton, vocabulaire neutre et efficace. Reponses concises.",
    ttsConfig: { lengthScale: 1.0, pauseBetweenSentences: 200 },
    contentFilter: "none",
    morningBriefing: true,
    medicationReminders: false,
    proactiveCheckins: false,
    aidantContacts: [],
  },
  child: {
    type: "child",
    allowedIntents: "all",
    blockedIntents: ["home_control", "instruction"],
    promptPrefix: "Tu parles a un enfant. Utilise le tutoiement. Vocabulaire simple et court. Reponses de 1 phrase max. Pas de contenu effrayant ou complexe.",
    ttsConfig: { lengthScale: 0.95, pauseBetweenSentences: 300 },
    contentFilter: "strict",
    morningBriefing: false,
    medicationReminders: false,
    proactiveCheckins: false,
    aidantContacts: [],
  },
  elderly: {
    type: "elderly",
    allowedIntents: "all",
    blockedIntents: [],
    promptPrefix: "Tu parles a une personne agee. Utilise le vouvoiement. Ton chaleureux et bienveillant. Reponses claires, pas trop longues. Articule bien les informations importantes.",
    ttsConfig: { lengthScale: 1.2, pauseBetweenSentences: 500 },
    contentFilter: "mild",
    morningBriefing: true,
    medicationReminders: true,
    proactiveCheckins: true,
    aidantContacts: [],
  },
  alzheimer: {
    type: "alzheimer",
    allowedIntents: "all",
    blockedIntents: ["home_control"],
    promptPrefix: "Tu parles a une personne atteinte de troubles cognitifs. Utilise le vouvoiement. Phrases tres courtes (max 10 mots). Ton tres chaleureux et rassurant. Ne corrige jamais. Encourage toujours. Si la personne repete une question, reponds avec la meme bienveillance, en reformulant legerement.",
    ttsConfig: { lengthScale: 1.3, pauseBetweenSentences: 800 },
    contentFilter: "strict",
    morningBriefing: true,
    medicationReminders: true,
    proactiveCheckins: true,
    aidantContacts: [],
  },
  guest: {
    type: "guest",
    allowedIntents: ["time", "weather", "greeting", "goodbye", "conversational", "joke", "calculator", "identity"],
    blockedIntents: ["instruction", "home_control", "music"],
    promptPrefix: "L'utilisateur est un invite. Sois poli et utile mais ne partage pas d'informations personnelles de la famille. Pas d'acces memoire.",
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
  if (!existsSync(PERSONAS_DIR)) return;

  const files = readdirSync(PERSONAS_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const raw = readFileSync(join(PERSONAS_DIR, file), "utf-8");
      const profile: PersonaProfile = JSON.parse(raw);
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
  writeFileSync(path, JSON.stringify(profile, null, 2));
  personas.set(profile.id, profile);
  console.log(`[PERSONA] Saved: ${profile.id} (${profile.type})`);
}

export function getPersona(speakerId: string): PersonaProfile {
  const profile = personas.get(speakerId);
  if (profile) return profile;
  // Return guest profile for unknown speakers
  return {
    id: "guest",
    name: "Invité",
    greetingName: "",
    ...DEFAULT_PROFILES.guest,
  };
}

export function createPersona(
  speakerId: string,
  displayName: string,
  type: PersonaType,
  greetingName?: string
): PersonaProfile {
  const defaults = DEFAULT_PROFILES[type];
  const profile: PersonaProfile = {
    id: speakerId,
    name: displayName,
    greetingName: greetingName ?? displayName,
    ...defaults,
  };
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

  // Check blocked list first
  if (persona.blockedIntents.includes(category)) return false;

  // Check allowed list
  if (persona.allowedIntents === "all") return true;
  return persona.allowedIntents.includes(category);
}

// =====================================================================
// System Prompt Builder
// =====================================================================

export function getPersonaPromptPrefix(): string {
  const persona = getCurrentPersona();
  let prefix = persona.promptPrefix;

  if (persona.greetingName) {
    prefix += `\nL'utilisateur s'appelle ${persona.greetingName}.`;
  }

  return prefix;
}

export function getPersonaTTSConfig(): TTSConfig {
  return getCurrentPersona().ttsConfig;
}

// Initialize on import
loadPersonas();
