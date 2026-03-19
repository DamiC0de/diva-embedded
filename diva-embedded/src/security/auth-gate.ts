/**
 * Auth Gate — Story 4.1
 * 3-level vocal authorization: open, protected, critical.
 * Integrated BEFORE the intent router in the pipeline.
 */

import { getCurrentPersona } from "../persona/engine.js";
import { log } from "../monitoring/logger.js";
import { logAudit } from "./database-manager.js";
import { getCorrelationId } from "../monitoring/correlation.js";

type AuthLevel = "open" | "protected" | "critical";

const CATEGORY_AUTH_LEVELS: Record<string, AuthLevel> = {
  // Open — anyone can use
  time: "open",
  weather: "open",
  greeting: "open",
  goodbye: "open",
  identity: "open",
  joke: "open",
  calculator: "open",
  conversational: "open",
  baby: "open",
  shutdown: "open",

  // Protected — recognized voice only
  home_control: "protected",
  routine: "protected",
  briefing: "protected",
  shopping: "protected",
  timer: "protected",
  radio: "protected",
  music: "protected",
  about_me: "protected",
  calendar: "protected",
  reminder: "protected",

  // Critical — recognized voice + confirmation
  send_message: "critical",
  emergency: "critical",
};

export interface AuthResult {
  allowed: boolean;
  level: AuthLevel;
  reason?: string;
  needsConfirmation?: boolean;
}

export function checkAuth(category: string, speakerId: string): AuthResult {
  const level = CATEGORY_AUTH_LEVELS[category] || "protected"; // Default: protected
  const persona = getCurrentPersona();
  const isRecognized = persona.id !== "guest" && speakerId !== "unknown";

  // Open — always allowed
  if (level === "open") {
    return { allowed: true, level };
  }

  // Protected — recognized voice required
  if (level === "protected") {
    if (!isRecognized) {
      log.warn("Auth rejected — unrecognized voice for protected command", {
        category,
        speakerId,
        level,
      });
      logAudit(
        `auth_rejected:${category}`,
        "protected",
        speakerId,
        "rejected",
        getCorrelationId(),
        { reason: "unrecognized_voice" },
      );
      return {
        allowed: false,
        level,
        reason: "Desole, je ne reconnais pas ta voix pour ca.",
      };
    }
    return { allowed: true, level };
  }

  // Critical — recognized voice + needs confirmation
  if (level === "critical") {
    if (!isRecognized) {
      log.warn("Auth rejected — unrecognized voice for critical command", {
        category,
        speakerId,
        level,
      });
      logAudit(
        `auth_rejected:${category}`,
        "critical",
        speakerId,
        "rejected",
        getCorrelationId(),
        { reason: "unrecognized_voice" },
      );
      return {
        allowed: false,
        level,
        reason: "Desole, je ne peux pas faire ca sans te reconnaitre.",
      };
    }
    logAudit(
      `auth_pending_confirmation:${category}`,
      "critical",
      speakerId,
      "pending",
      getCorrelationId(),
    );
    return {
      allowed: true,
      level,
      needsConfirmation: true,
    };
  }

  return { allowed: true, level: "open" };
}

/**
 * Log a confirmed critical action after user vocal confirmation.
 */
export function confirmCriticalAction(category: string, speakerId: string, result: string): void {
  logAudit(
    `confirmed:${category}`,
    "critical",
    speakerId,
    result,
    getCorrelationId(),
  );
  log.info("Critical action confirmed", { category, speakerId, result });
}
