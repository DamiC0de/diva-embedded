/**
 * Correction Tracker — Story 8.1, 8.2
 * Captures user corrections and learns from errors.
 * Auto-saves corrections to Mem0 for future reference.
 */

import { log } from "../monitoring/logger.js";

interface CorrectionRecord {
  original: string;
  correction: string;
  context: string;
  count: number;
  lastOccurrence: number;
}

const corrections = new Map<string, CorrectionRecord[]>();
const CLARIFICATION_THRESHOLD = 2; // Ask for clarification after N corrections

const CORRECTION_PATTERNS = [
  /^non\b/i,
  /^pas [çc]a/i,
  /^pas celui/i,
  /^l.autre/i,
  /^je voulais/i,
  /^je t.ai (dit|d[eé]j[aà] dit)/i,
  /^c.est pas/i,
  /plutôt/i,
];

/**
 * Detect if user is correcting Diva's last action.
 */
export function isCorrection(transcription: string): boolean {
  return CORRECTION_PATTERNS.some(p => p.test(transcription.trim()));
}

/**
 * Record a correction for future learning.
 */
export function recordCorrection(
  speakerId: string,
  lastAction: string,
  correctionText: string,
  category: string,
): string | null {
  const key = `${speakerId}:${category}:${lastAction.toLowerCase().trim()}`;
  const records = corrections.get(speakerId) || [];

  const existing = records.find(r => r.original.toLowerCase() === lastAction.toLowerCase());
  if (existing) {
    existing.count++;
    existing.correction = correctionText;
    existing.lastOccurrence = Date.now();
  } else {
    records.push({
      original: lastAction,
      correction: correctionText,
      context: category,
      count: 1,
      lastOccurrence: Date.now(),
    });
  }

  corrections.set(speakerId, records);

  // Generate Mem0 memory content for auto-save
  const memoryContent = `Quand ${speakerId} dit "${lastAction}", il veut: ${correctionText}`;
  log.info("Correction recorded", {
    speakerId,
    original: lastAction,
    correction: correctionText,
    category,
  });

  return memoryContent;
}

/**
 * Check if we should ask for clarification based on correction history (Story 8.2).
 */
export function shouldClarify(speakerId: string, action: string, category: string): string | null {
  const records = corrections.get(speakerId) || [];
  const match = records.find(
    r => r.context === category && r.original.toLowerCase() === action.toLowerCase() && r.count >= CLARIFICATION_THRESHOLD
  );

  if (match) {
    log.debug("Clarification triggered", {
      speakerId,
      action,
      previousCorrection: match.correction,
      correctionCount: match.count,
    });
    return match.correction;
  }

  return null;
}
