/**
 * Data Classifier — Story 5.1
 * Classifies data into 3 confidentiality levels: RED, ORANGE, GREEN.
 * RED: always escalated (health, danger, distress)
 * ORANGE: aggregated anonymized in summaries
 * GREEN: never shared, never included in reports
 */

import { log } from "../monitoring/logger.js";

export type DataLevel = "red" | "orange" | "green";

const RED_PATTERNS = [
  /\b(mal|douleur|bless[eé]|tomb[eé]|chute|saign|urgence|secours|aide[- ]moi)\b/i,
  /\b(m[eé]dicament|comprim[eé]|prise|ordonnance|docteur|m[eé]decin|h[oô]pital)\b/i,
  /\b(suicid|mourir|mort|tuer|automutil|scarif)\b/i,
  /\b(agress|frapp[eé]|viol|abus|maltrait)\b/i,
  /\b(seul|isol[eé]|abandon|d[eé]prim[eé]|d[eé]press)\b/i,
];

const ORANGE_PATTERNS = [
  /\b(devoirs?|exercice|conjugaison|math|lecture|dict[eé]e|note|bulletin)\b/i,
  /\b(minuteur|rappel|courses?|liste|planning|calendrier)\b/i,
  /\b(interaction|session|connexion|activit[eé])\b/i,
];

export function classifyData(content: string, context?: string): DataLevel {
  // RED — health, safety, distress
  for (const pattern of RED_PATTERNS) {
    if (pattern.test(content)) {
      log.debug("Data classified RED", { snippet: content.slice(0, 50) });
      return "red";
    }
  }

  // ORANGE — activity, education, tasks
  for (const pattern of ORANGE_PATTERNS) {
    if (pattern.test(content)) {
      return "orange";
    }
  }

  // GREEN — personal, secrets, opinions, emotions
  return "green";
}

/**
 * Filter data for parental summary — only RED and ORANGE.
 */
export function filterForSummary(items: { content: string; level?: DataLevel }[]): { content: string; level: DataLevel }[] {
  return items
    .map(item => ({ ...item, level: item.level || classifyData(item.content) }))
    .filter(item => item.level === "red" || item.level === "orange");
}

/**
 * Check if data should be escalated to parents/caregivers.
 */
export function shouldEscalate(content: string): boolean {
  return classifyData(content) === "red";
}
