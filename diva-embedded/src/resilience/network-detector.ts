/**
 * Network Detector — Story 10.1
 * Detects network loss/recovery and announces degradation state.
 */

import { log } from "../monitoring/logger.js";

let isOnline = true;
let lastCheck = 0;
const CHECK_INTERVAL_MS = 30000;

export async function checkNetwork(): Promise<boolean> {
  if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return isOnline;
  lastCheck = Date.now();

  try {
    const res = await fetch("https://api.anthropic.com", {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    if (!isOnline) {
      log.info("Network restored");
    }
    isOnline = true;
  } catch {
    if (isOnline) {
      log.warn("Network lost");
    }
    isOnline = false;
  }

  return isOnline;
}

export function getNetworkStatus(): boolean {
  return isOnline;
}

export function getDegradationMessage(): string | null {
  if (!isOnline) {
    return "J'ai plus internet pour le moment, mais je suis toujours la !";
  }
  return null;
}

export function getRestorationMessage(): string | null {
  // Called when network transitions from offline to online
  return "Ah, je suis de retour a pleine puissance !";
}
