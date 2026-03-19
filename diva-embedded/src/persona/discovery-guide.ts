/**
 * Discovery Guide — Story 6.5
 * Reveals Diva's capabilities one by one over the first week.
 */

import { log } from "../monitoring/logger.js";

interface DiscoveryState {
  daysSinceCreation: number;
  revealedCapabilities: Set<string>;
  discoveryComplete: boolean;
}

const discoveryStates = new Map<string, DiscoveryState>();

const DISCOVERY_SCHEDULE: { day: number; hour: number; capability: string; prompt: string }[] = [
  { day: 1, hour: 8, capability: "weather", prompt: "Il fait beau aujourd'hui !" },
  { day: 2, hour: 12, capability: "music", prompt: "Tu veux un peu de musique pour le dejeuner ?" },
  { day: 3, hour: 10, capability: "reminder", prompt: "" }, // Revealed contextually via implicit intent
  { day: 4, hour: 16, capability: "timer", prompt: "Tu savais que tu pouvais me demander un minuteur ?" },
  { day: 5, hour: 18, capability: "shopping", prompt: "Si tu as besoin de quelque chose, dis-le moi et je le note dans la liste de courses !" },
  { day: 6, hour: 9, capability: "calendar", prompt: "" }, // Revealed via morning briefing
  { day: 7, hour: 20, capability: "messaging", prompt: "Tu sais que tu peux m'envoyer des messages a tes proches ?" },
];

export function initDiscovery(speakerId: string, createdAt: Date): void {
  discoveryStates.set(speakerId, {
    daysSinceCreation: 0,
    revealedCapabilities: new Set(),
    discoveryComplete: false,
  });
  log.info("Discovery guide initialized", { speakerId });
}

export function getDiscoveryPrompt(speakerId: string, createdAt: Date): string | null {
  const state = discoveryStates.get(speakerId);
  if (!state || state.discoveryComplete) return null;

  const daysSince = Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000));
  const currentHour = new Date().getHours();

  for (const item of DISCOVERY_SCHEDULE) {
    if (daysSince >= item.day && !state.revealedCapabilities.has(item.capability) && currentHour >= item.hour && item.prompt) {
      state.revealedCapabilities.add(item.capability);
      state.daysSinceCreation = daysSince;

      if (state.revealedCapabilities.size >= DISCOVERY_SCHEDULE.length) {
        state.discoveryComplete = true;
        log.info("Discovery guide completed", { speakerId });
      }

      return item.prompt;
    }
  }

  return null;
}

export function isDiscoveryComplete(speakerId: string): boolean {
  return discoveryStates.get(speakerId)?.discoveryComplete ?? true;
}
