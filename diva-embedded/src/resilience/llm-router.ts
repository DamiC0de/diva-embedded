/**
 * LLM Router — Story 10.4
 * Routes LLM calls: Claude API → Qwen local → intent-only fallback.
 */

import { log } from "../monitoring/logger.js";
import { getNetworkStatus } from "./network-detector.js";

export type LLMBackend = "claude" | "qwen-local" | "intent-only";

let currentBackend: LLMBackend = "claude";
let claudeFailCount = 0;
const MAX_CLAUDE_FAILS = 2;

export function getCurrentBackend(): LLMBackend {
  // If offline, skip Claude
  if (!getNetworkStatus()) {
    if (currentBackend === "claude") {
      currentBackend = "qwen-local";
      log.info("LLM Router: switched to Qwen local (offline)");
    }
  }
  return currentBackend;
}

export function reportClaudeFailure(): void {
  claudeFailCount++;
  if (claudeFailCount >= MAX_CLAUDE_FAILS && currentBackend === "claude") {
    currentBackend = "qwen-local";
    log.warn("LLM Router: Claude failed, switching to Qwen local", { failCount: claudeFailCount });
  }
}

export function reportClaudeSuccess(): void {
  if (currentBackend !== "claude") {
    currentBackend = "claude";
    log.info("LLM Router: Claude restored");
  }
  claudeFailCount = 0;
}

export function reportQwenFailure(): void {
  if (currentBackend === "qwen-local") {
    currentBackend = "intent-only";
    log.warn("LLM Router: Qwen failed, falling back to intent-only");
  }
}

export function getDegradationAnnouncement(): string | null {
  switch (currentBackend) {
    case "qwen-local":
      return "Je suis en mode economique, je suis moins maligne mais je suis la !";
    case "intent-only":
      return "J'ai quelques soucis techniques, mais je peux encore te donner l'heure, la meteo, et mettre de la musique.";
    default:
      return null;
  }
}

export function resetRouter(): void {
  currentBackend = "claude";
  claudeFailCount = 0;
}
