/**
 * Multi-Request Parser — Story 1.6 / FR206
 * Decomposes a single user utterance containing multiple requests
 * into distinct sub-requests for parallel processing.
 */

import { log } from "../monitoring/logger.js";

export interface SubRequest {
  text: string;
  originalIndex: number;
}

/** Maximum number of sub-requests allowed */
const MAX_SUB_REQUESTS = 5;

/** Minimum number of sub-requests to activate multi-request mode */
const MIN_SUB_REQUESTS = 2;

/** Minimum word count for a segment to be considered a valid sub-request */
const MIN_SEGMENT_WORDS = 2;

/**
 * Patterns indicating the segment is an interrogative / autonomous question.
 * These segments are valid even with fewer words.
 */
const QUESTION_PATTERNS = [
  /^(quelle?|quel|quels|quelles)\b/i,
  /^(combien|comment|pourquoi|ou|quand|qui|qu['e])\b/i,
  /\?$/,
  /^(est-ce que|y a-t-il|dis[- ]moi)\b/i,
  /^(il fait|il est|c'est|on est)\b/i,
];

/**
 * Patterns for compound subjects/objects — should NOT be split.
 * e.g., "allume la lumiere et le ventilateur" = 1 request
 * e.g., "il fait chaud et humide" = 1 request
 */
const COMPOUND_PATTERNS = [
  // adjective + et + adjective (il fait chaud et humide)
  /\b(chaud|froid|humide|sec|beau|bon|grand|petit|long|court|fort|doux|clair|sombre|lourd|leger)\s+et\s+(chaud|froid|humide|sec|beau|bon|grand|petit|long|court|fort|doux|clair|sombre|lourd|leger)\b/i,
  // verb + object + et + object (allume X et Y, ouvre A et B)
  /^(allume|eteins|ouvre|ferme|active|desactive|mets|lance|arrete|coupe|baisse|monte|demarre|joue)\b.*\bet\s+(le|la|les|l'|un|une|des|du|mon|ma|mes|ton|ta|tes|son|sa|ses)\b/i,
  // noun + et + noun as compound subject (papa et maman, toi et moi)
  /^(le|la|les|mon|ma|mes|ton|ta|tes|son|sa|ses|papa|maman|toi|moi)\b.*\bet\s+(le|la|les|mon|ma|mes|ton|ta|tes|son|sa|ses|papa|maman|toi|moi)\b/i,
];

/**
 * Connectors that can split multi-requests.
 * Order matters: longer patterns first.
 */
const SPLIT_CONNECTORS = [
  /\s*;\s*/,                                    // semicolons
  /\s*,\s+(?:et\s+)?/,                          // comma (optionally followed by "et")
  /\s+puis\s+/i,                                // puis
  /\s+ensuite\s+/i,                             // ensuite
  /\s+apres\s+(?:ca\s+)?/i,                     // apres / apres ca
  /\s+aussi\s+/i,                               // aussi
  /\s+et\s+(?=(?:dis|donne|mets|rappelle|fais|lance|allume|eteins|ouvre|ferme|quelle?|combien|comment|rappel|cherche|trouve|c.est\s+quoi|quel))/i,  // "et" followed by a verb/question
  /\s+et\s+(?=(?:aussi|ensuite|apres|sinon|au\s+fait))/i,  // "et" followed by transition words
];

/**
 * Known topic nouns that act as implicit requests when standalone
 * (e.g., "la meteo" after a separator implies "donne-moi la meteo")
 */
const IMPLICIT_REQUEST_NOUNS = /\b(meteo|m[eé]t[eé]o|heure|blague|minuteur|timer|radio|musique|temps|temp[eé]rature|nouvelles|actualit[eé]s|briefing|liste|courses|rappel|r[eé]veil|alarme)\b/i;

/**
 * Check if a segment looks like an autonomous sub-request.
 * A segment is autonomous if it contains a verb, is a recognizable question,
 * or contains an implicit request noun (like "la meteo").
 */
function isAutonomousSegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (!trimmed) return false;

  // Check question patterns
  for (const pat of QUESTION_PATTERNS) {
    if (pat.test(trimmed)) return true;
  }

  // Check for verb presence (common French imperative/indicative forms)
  const verbPatterns = /\b(dis|donne|mets|rappelle|fais|lance|allume|eteins|ouvre|ferme|joue|arrete|coupe|baisse|monte|active|desactive|cherche|trouve|raconte|explique|calcule|ajoute|supprime|envoie|appelle|verifie|regarde|ecoute|lis|ecris|programme|planifie|reserve|commande|achete|prepare|demarre|configure|change|modifie|il fait|il est|c'est|on est|j'ai|je veux|je voudrais|peux-tu|est-ce)\b/i;
  if (verbPatterns.test(trimmed)) return true;

  // Check for implicit request nouns (e.g., "la meteo" as a standalone request)
  if (IMPLICIT_REQUEST_NOUNS.test(trimmed)) return true;

  return false;
}

/**
 * Check if the full text contains a compound pattern that should NOT be split.
 */
function hasCompoundPattern(text: string): boolean {
  for (const pat of COMPOUND_PATTERNS) {
    if (pat.test(text)) return true;
  }
  return false;
}

/**
 * Count significant words in a segment (excluding articles, prepositions, etc.)
 */
function significantWordCount(segment: string): number {
  const stopWords = new Set(["le", "la", "les", "l", "un", "une", "des", "du", "de", "et", "ou", "a", "au", "aux", "en", "dans", "sur", "pour", "par", "avec", "ce", "cette", "ces", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "me", "te", "se", "ne", "pas", "que", "qui"]);
  const words = segment.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
  const significant = words.filter(w => !stopWords.has(w.replace(/['']/g, "")));
  return significant.length;
}

/**
 * Parse a transcription into multiple sub-requests.
 * Returns a single-element array (the full text) if no valid decomposition is found.
 */
export function parseMultiRequests(text: string): SubRequest[] {
  const trimmed = text.trim();
  if (!trimmed) return [{ text: trimmed, originalIndex: 0 }];

  // Check for compound patterns — don't split
  if (hasCompoundPattern(trimmed)) {
    return [{ text: trimmed, originalIndex: 0 }];
  }

  // Try splitting with each connector pattern
  let bestSegments: string[] = [trimmed];

  for (const connector of SPLIT_CONNECTORS) {
    const segments = trimmed.split(connector).map(s => s.trim()).filter(s => s.length > 0);
    if (segments.length > bestSegments.length) {
      bestSegments = segments;
    }
  }

  // Also try combined split: split on multiple connectors at once
  const combinedRegex = /\s*[;]\s*|\s*,\s+(?:et\s+)?|\s+puis\s+|\s+ensuite\s+|\s+et\s+(?=(?:dis|donne|mets|rappelle|fais|lance|allume|eteins|ouvre|ferme|quelle?|combien|comment|rappel|cherche|trouve|c.est\s+quoi|quel|aussi|ensuite|apres|sinon|au\s+fait))/gi;
  const combinedSegments = trimmed.split(combinedRegex).map(s => s.trim()).filter(s => s.length > 0);
  if (combinedSegments.length > bestSegments.length) {
    bestSegments = combinedSegments;
  }

  // If no split found, return the full text
  if (bestSegments.length < MIN_SUB_REQUESTS) {
    return [{ text: trimmed, originalIndex: 0 }];
  }

  // Validate each segment: must be autonomous or have enough significant words
  const validSegments: string[] = [];
  const invalidSegments: string[] = [];

  for (const seg of bestSegments) {
    const isQuestion = QUESTION_PATTERNS.some(p => p.test(seg));
    const isAutonomous = isAutonomousSegment(seg);
    const wordCount = significantWordCount(seg);

    if (isAutonomous || isQuestion || wordCount >= MIN_SEGMENT_WORDS) {
      validSegments.push(seg);
    } else {
      invalidSegments.push(seg);
    }
  }

  // If we have invalid segments, re-attach them to adjacent valid segments
  if (invalidSegments.length > 0 && validSegments.length > 0) {
    // Append invalid segments to the last valid segment
    for (const inv of invalidSegments) {
      validSegments[validSegments.length - 1] += " " + inv;
    }
  }

  // If not enough valid segments, return full text (fallback)
  if (validSegments.length < MIN_SUB_REQUESTS) {
    return [{ text: trimmed, originalIndex: 0 }];
  }

  // Apply max sub-requests limit: re-concatenate excess segments
  let finalSegments = validSegments;
  if (finalSegments.length > MAX_SUB_REQUESTS) {
    const kept = finalSegments.slice(0, MAX_SUB_REQUESTS - 1);
    const excess = finalSegments.slice(MAX_SUB_REQUESTS - 1);
    kept.push(excess.join(", "));
    finalSegments = kept;
  }

  // Final confidence check: if most segments are not autonomous, don't split
  const autonomousCount = finalSegments.filter(s => isAutonomousSegment(s)).length;
  const confidence = autonomousCount / finalSegments.length;
  if (confidence < 0.6) {
    log.warn("Multi-request parsing: low confidence, falling back to single request", {
      confidence,
      segmentCount: finalSegments.length,
      autonomousCount,
    });
    return [{ text: trimmed, originalIndex: 0 }];
  }

  return finalSegments.map((seg, idx) => ({
    text: seg.trim(),
    originalIndex: idx,
  }));
}
