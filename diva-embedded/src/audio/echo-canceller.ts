/**
 * Echo Canceller — Story 3.2
 * Simple approach: duck/pause audio output during recording.
 * Prevents Diva from hearing herself during music playback.
 * Post-MVP: full Speex AEC with reference signal.
 */

import { log } from "../monitoring/logger.js";

let divaIsOutputting = false;
let outputStartedAt = 0;

export function markOutputStart(): void {
  divaIsOutputting = true;
  outputStartedAt = Date.now();
}

export function markOutputEnd(): void {
  divaIsOutputting = false;
}

export function isDivaOutputting(): boolean {
  return divaIsOutputting;
}

/**
 * Returns the recommended recording strategy based on current output state.
 * - "normal": no output, record normally
 * - "duck": output active, lower music volume before recording
 * - "wait": output just started, wait a moment
 */
export function getRecordingStrategy(): "normal" | "duck" | "wait" {
  if (!divaIsOutputting) return "normal";

  const elapsed = Date.now() - outputStartedAt;
  if (elapsed < 500) return "wait"; // TTS just started, wait

  return "duck"; // Music playing, duck the volume
}

log.debug("Echo canceller initialized (duck mode)");
