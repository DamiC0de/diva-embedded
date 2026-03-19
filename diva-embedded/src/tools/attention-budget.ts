/**
 * Attention Budget — Story 9.2, 9.3, 9.4
 * Controls proactive message frequency, detects saturation,
 * manages 3 silence levels.
 */

import { log } from "../monitoring/logger.js";

interface PersonaBudget {
  maxProactivePerSlot: number;
  usedThisSlot: number;
  slotStart: number;
  saturationSignals: number;
  saturationDays: number;
  lastSaturationDate: string;
  silenceLevel: 0 | 1 | 2 | 3;
  silenceExpiry: number;
}

const budgets = new Map<string, PersonaBudget>();
const SLOT_DURATION_MS = 4 * 60 * 60 * 1000; // 4-hour slots

const SATURATION_PHRASES = [
  /c.est bon/i, /oui oui/i, /ok ok/i, /arr[eê]te/i,
  /pas maintenant/i, /stop/i, /laisse/i, /chut/i,
  /tais[- ]?toi/i, /j.ai compris/i,
];

function getBudget(speakerId: string): PersonaBudget {
  let budget = budgets.get(speakerId);
  if (!budget) {
    budget = {
      maxProactivePerSlot: 3,
      usedThisSlot: 0,
      slotStart: Date.now(),
      saturationSignals: 0,
      saturationDays: 0,
      lastSaturationDate: "",
      silenceLevel: 0,
      silenceExpiry: 0,
    };
    budgets.set(speakerId, budget);
  }

  // Reset slot if expired
  if (Date.now() - budget.slotStart > SLOT_DURATION_MS) {
    budget.usedThisSlot = 0;
    budget.slotStart = Date.now();
  }

  // Reset daily saturation counter
  const today = new Date().toISOString().slice(0, 10);
  if (budget.lastSaturationDate !== today) {
    if (budget.saturationSignals >= 3) {
      budget.saturationDays++;
      if (budget.saturationDays >= 3 && budget.maxProactivePerSlot > 1) {
        budget.maxProactivePerSlot--;
        log.info("Initiative level reduced due to sustained saturation", {
          speakerId,
          newMax: budget.maxProactivePerSlot,
          saturationDays: budget.saturationDays,
        });
      }
    }
    budget.saturationSignals = 0;
    budget.lastSaturationDate = today;
  }

  // Check silence expiry
  if (budget.silenceLevel > 0 && Date.now() >= budget.silenceExpiry) {
    budget.silenceLevel = 0;
    log.info("Silence mode expired", { speakerId });
  }

  return budget;
}

/**
 * Check if Diva can send a proactive message to this persona.
 */
export function canSendProactive(speakerId: string): boolean {
  const budget = getBudget(speakerId);

  // Silence levels
  if (budget.silenceLevel >= 2) return false; // Soirée tranquille or total silence
  if (budget.silenceLevel === 1) return false; // "Pas maintenant"

  // Budget check
  return budget.usedThisSlot < budget.maxProactivePerSlot;
}

/**
 * Record that a proactive message was sent.
 */
export function recordProactiveSent(speakerId: string): void {
  const budget = getBudget(speakerId);
  budget.usedThisSlot++;
}

/**
 * Detect saturation signals in user response.
 */
export function detectSaturation(speakerId: string, transcription: string): boolean {
  const isSaturated = SATURATION_PHRASES.some(p => p.test(transcription));
  if (isSaturated) {
    const budget = getBudget(speakerId);
    budget.saturationSignals++;
    log.debug("Saturation signal detected", {
      speakerId,
      signals: budget.saturationSignals,
      text: transcription.slice(0, 30),
    });
  }
  return isSaturated;
}

/**
 * Activate a silence level — Story 9.4
 * Level 1: "pas maintenant" — 1 hour
 * Level 2: "soirée tranquille" — until next morning 7h
 * Level 3: "silence total" — until next morning 7h, wake word disabled except emergency
 */
export function activateSilence(speakerId: string, level: 1 | 2 | 3): void {
  const budget = getBudget(speakerId);
  budget.silenceLevel = level;

  if (level === 1) {
    budget.silenceExpiry = Date.now() + 60 * 60 * 1000; // 1 hour
  } else {
    // Until next morning 7h
    const tomorrow7h = new Date();
    tomorrow7h.setDate(tomorrow7h.getDate() + 1);
    tomorrow7h.setHours(7, 0, 0, 0);
    budget.silenceExpiry = tomorrow7h.getTime();
  }

  log.info("Silence activated", { speakerId, level, expiresAt: new Date(budget.silenceExpiry).toISOString() });
}

export function getSilenceLevel(speakerId: string): number {
  return getBudget(speakerId).silenceLevel;
}

export function isTotalSilence(speakerId: string): boolean {
  return getBudget(speakerId).silenceLevel === 3;
}
