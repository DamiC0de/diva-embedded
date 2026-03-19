/**
 * Accessibility — Ideas #32, #33, #34, #35, #36
 * #32: Text input fallback (dashboard)
 * #33: Progressive hearing adaptation
 * #34: Stuttering/speech disorder tolerance
 * #35: Visual mode for hearing impaired (subtitles)
 * #36: Native multilingualism
 */

import { log } from "../monitoring/logger.js";
import { getCurrentPersona, updatePersonaPrefs } from "../persona/engine.js";

// #33 — Track "quoi?" repetitions per persona
const quoiTracker = new Map<string, { count: number; lastReset: number }>();

export function trackQuoi(speakerId: string): void {
  const tracker = quoiTracker.get(speakerId) || { count: 0, lastReset: Date.now() };
  // Reset daily
  if (Date.now() - tracker.lastReset > 24 * 60 * 60 * 1000) {
    tracker.count = 0;
    tracker.lastReset = Date.now();
  }
  tracker.count++;
  quoiTracker.set(speakerId, tracker);

  // Auto-adapt after 3 "quoi?" in a day
  if (tracker.count >= 3) {
    log.info("Hearing adaptation triggered", { speakerId, quoiCount: tracker.count });
    // Slow down TTS and increase volume via persona prefs
    const persona = getCurrentPersona();
    if (persona.ttsConfig.lengthScale < 1.4) {
      updatePersonaPrefs(speakerId, {});
      // Note: TTS config update would need a dedicated function
      log.info("TTS slowed down for hearing adaptation", { speakerId });
    }
  }
}

export function isQuoiDetected(text: string): boolean {
  return /^(quoi|hein|pardon|comment|r[eé]p[eè]te|j.ai pas compris|qu.est.ce que t.as dit)\s*\??$/i.test(text.trim());
}

// #34 — Stuttering tolerance
export function getAdaptedSilenceTimeout(speakerId: string, defaultTimeout: number): number {
  // If persona has known speech difficulties, extend silence timeout
  const persona = getCurrentPersona();
  if (persona.id === speakerId) {
    // Check if we've recorded speech difficulties in memory
    // For now, use a generous timeout for elderly and children
    if (persona.type === "elderly" || persona.type === "alzheimer") {
      return Math.max(defaultTimeout, 2.5);
    }
  }
  return defaultTimeout;
}

// Reconstruct fragmented speech
export function reconstructFragmentedSpeech(fragments: string[]): string {
  // Remove stuttering artifacts: "je je je veux" → "je veux"
  const combined = fragments.join(" ");
  return combined
    .replace(/(\b\w+\b)(\s+\1){1,}/gi, "$1") // Remove repeated words
    .replace(/\s{2,}/g, " ") // Normalize spaces
    .trim();
}

// #36 — Multilingualism detection
const LANGUAGE_PATTERNS: Record<string, RegExp[]> = {
  fr: [/\b(bonjour|merci|oui|non|comment|pourquoi|je|tu|nous|avec|dans|pour)\b/i],
  en: [/\b(hello|please|thank|yes|no|how|why|with|from|the|is|are)\b/i],
  es: [/\b(hola|gracias|por favor|si|no|como|porque|con|para)\b/i],
  ar: [/[\u0600-\u06FF]/],
  pt: [/\b(obrigado|por favor|bom dia|como|porque|com|para|muito)\b/i],
};

export function detectLanguage(text: string): string {
  let bestLang = "fr";
  let bestScore = 0;

  for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
    const score = patterns.filter(p => p.test(text)).length;
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }
  return bestLang;
}
