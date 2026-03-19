/**
 * Anti-Substitution — Ideas #10, #11, #12, #13
 * Prevents Diva from replacing human relationships.
 * #10: Pushes toward human contact
 * #11: Anti-summary (preserves family curiosity)
 * #12: Self-imposed interaction limits
 * #13: Human ritual facilitator
 */

import { log } from "../monitoring/logger.js";

// Track interaction duration and last human contact per persona
const interactionTracker = new Map<string, {
  continuousMinutes: number;
  lastInteractionStart: number;
  lastHumanContactDays: Map<string, number>; // relative -> days since contact
}>();

// #10 — Push toward human when no contact detected
export function checkHumanContactNeeded(speakerId: string, daysThreshold = 5): string | null {
  const tracker = interactionTracker.get(speakerId);
  if (!tracker) return null;

  for (const [relative, days] of tracker.lastHumanContactDays) {
    if (days >= daysThreshold) {
      return `Ca fait un moment que t'as pas eu de nouvelles de ${relative}. Tu veux que je lui envoie un petit message ?`;
    }
  }
  return null;
}

export function recordHumanContact(speakerId: string, relative: string): void {
  const tracker = interactionTracker.get(speakerId) || {
    continuousMinutes: 0,
    lastInteractionStart: Date.now(),
    lastHumanContactDays: new Map(),
  };
  tracker.lastHumanContactDays.set(relative, 0);
  interactionTracker.set(speakerId, tracker);
}

export function incrementDaysSinceContact(): void {
  for (const [, tracker] of interactionTracker) {
    for (const [relative, days] of tracker.lastHumanContactDays) {
      tracker.lastHumanContactDays.set(relative, days + 1);
    }
  }
}

// #11 — Anti-summary: generate teaser instead of full summary
export function generateAntiSummary(childName: string, activities: string[]): string {
  if (activities.length === 0) return `${childName} a passe une bonne journee.`;

  // Don't reveal details — create conversation starters
  const teasers = [
    `${childName} a des choses a te raconter sur sa journee !`,
    `Demande a ${childName} ce qui s'est passe aujourd'hui, il a vecu des trucs interessants.`,
    `${childName} a eu une journee bien remplie. Il te racontera !`,
  ];
  return teasers[Math.floor(Math.random() * teasers.length)];
}

// #12 — Self-imposed interaction limits
export function checkInteractionLimit(speakerId: string, maxContinuousMinutes = 120): string | null {
  const tracker = interactionTracker.get(speakerId) || {
    continuousMinutes: 0,
    lastInteractionStart: Date.now(),
    lastHumanContactDays: new Map(),
  };

  const elapsed = (Date.now() - tracker.lastInteractionStart) / 60000;
  tracker.continuousMinutes = elapsed;
  interactionTracker.set(speakerId, tracker);

  if (elapsed >= maxContinuousMinutes) {
    const responses = [
      "Je suis un peu fatiguee ! Et si tu appelais quelqu'un ou sortais prendre l'air ?",
      "Ca fait un moment qu'on discute. Tu veux pas appeler un ami ?",
      "On a bien discute ! Prends une pause, je serai la quand tu reviens.",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
  return null;
}

export function resetInteractionTimer(speakerId: string): void {
  const tracker = interactionTracker.get(speakerId);
  if (tracker) {
    tracker.continuousMinutes = 0;
    tracker.lastInteractionStart = Date.now();
  }
}

// #13 — Human ritual facilitator
export function getRitualSuggestion(speakerId: string): string | null {
  const now = new Date();
  const day = now.getDay(); // 0=Sunday
  const hour = now.getHours();

  // Sunday morning — suggest calling family
  if (day === 0 && hour >= 9 && hour <= 11) {
    return "C'est dimanche ! Si t'appelais ta mere ? La derniere fois elle parlait de son jardin.";
  }

  return null;
}
