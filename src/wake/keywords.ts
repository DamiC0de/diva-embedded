/**
 * Keyword detection for barge-in during SPEAKING state.
 * Detects control keywords in transcription text.
 */

const RELISTEN_KEYWORDS = ["diva"];
const STOP_KEYWORDS = ["attend", "arrête", "arrete", "stop"];

export type KeywordAction = "relisten" | "stop" | null;

/**
 * Check if text contains a barge-in keyword.
 * @param text - Transcription text to check
 * @returns The action to take, or null if no keyword found
 */
export function detectKeyword(text: string): KeywordAction {
  const lower = text.toLowerCase().trim();

  for (const kw of RELISTEN_KEYWORDS) {
    if (lower.includes(kw)) return "relisten";
  }

  for (const kw of STOP_KEYWORDS) {
    if (lower.includes(kw)) return "stop";
  }

  return null;
}

/**
 * Check if the text is ONLY a keyword (not part of a longer sentence).
 * Used for more precise barge-in detection.
 */
export function isOnlyKeyword(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const allKeywords = [...RELISTEN_KEYWORDS, ...STOP_KEYWORDS];
  return allKeywords.some((kw) => lower === kw);
}
