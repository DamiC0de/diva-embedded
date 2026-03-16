/**
 * Keyword detection for barge-in during SPEAKING state.
 * Detects control keywords in transcription text.
 */
export type KeywordAction = "relisten" | "stop" | null;
/**
 * Check if text contains a barge-in keyword.
 * @param text - Transcription text to check
 * @returns The action to take, or null if no keyword found
 */
export declare function detectKeyword(text: string): KeywordAction;
/**
 * Check if the text is ONLY a keyword (not part of a longer sentence).
 * Used for more precise barge-in detection.
 */
export declare function isOnlyKeyword(text: string): boolean;
//# sourceMappingURL=keywords.d.ts.map