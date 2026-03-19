/**
 * Warm Start — Story 6.4
 * Pre-configure a user profile before they meet Diva.
 * Called from the dashboard by the installer/family member.
 */

import { createPersona, type PersonaType, type CommunicationPrefs } from "./engine.js";
import { log } from "../monitoring/logger.js";

export interface WarmStartProfile {
  displayName: string;
  greetingName: string;
  type: PersonaType;
  interests?: string[];
  pet?: string;
  medications?: string[];
  contacts?: { name: string; relation: string; phone?: string; email?: string }[];
  notes?: string;
}

/**
 * Pre-configure a persona with warm start data.
 * The speaker ID will be assigned later during voice registration.
 */
export function prepareWarmStart(tempId: string, profile: WarmStartProfile): void {
  const commPrefs: Partial<CommunicationPrefs> = {};
  
  if (profile.type === "elderly" || profile.type === "alzheimer") {
    commPrefs.tutoiement = false;
    commPrefs.style = "chaleureuse";
  }

  const persona = createPersona(
    `warmstart_${tempId}`,
    profile.displayName,
    profile.type,
    profile.greetingName,
    commPrefs,
  );

  log.info("Warm start profile prepared", {
    tempId,
    name: profile.displayName,
    type: profile.type,
    hasInterests: !!profile.interests?.length,
    hasPet: !!profile.pet,
    hasMedications: !!profile.medications?.length,
  });
}

/**
 * Build the warm start greeting for first encounter.
 */
export function buildWarmStartGreeting(profile: WarmStartProfile, installerName?: string): string {
  const parts: string[] = [];
  
  parts.push(`Bonjour ${profile.greetingName} !`);
  
  if (installerName) {
    parts.push(`${installerName} m'a installee pour te tenir compagnie.`);
  }
  
  parts.push("Je suis Diva, je suis la pour toi.");
  
  if (profile.pet) {
    parts.push(`Il parait que tu as ${profile.pet} !`);
  }
  
  return parts.join(" ");
}
