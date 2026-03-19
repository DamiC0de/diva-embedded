/**
 * Teen Distress Detection — Idea #5
 * 3-level detection: blues, alert, critical.
 * Level 1: listen + reassure
 * Level 2: encourage talking to adult + wellness log
 * Level 3: alert parents IMMEDIATELY + 3114 number
 */

import { log } from "../monitoring/logger.js";
import { logAudit } from "../security/database-manager.js";
import { getCorrelationId } from "../monitoring/correlation.js";

export type DistressLevel = 0 | 1 | 2 | 3;

const LEVEL3_PATTERNS = [
  /\b(suicid|me tuer|envie de mourir|plus envie de vivre|en finir)\b/i,
  /\b(automutile|me couper|me faire du mal|scarif)\b/i,
  /\b(personne m.aime|tout le monde s.en fout|je sers a rien)\b/i,
];

const LEVEL2_PATTERNS = [
  /\b(d[eé]prim[eé]|d[eé]press|trist[eé]|mal [aà] l.int[eé]rieur)\b/i,
  /\b(isol[eé]|seul|abandonn[eé]|rejet[eé]|exclu)\b/i,
  /\b(angoiss|paniqu|peur|stress[eé]|anxieux|anxieuse)\b/i,
  /\b(dors? plus|insomnie|cauchemar|pleure)\b/i,
];

const LEVEL1_PATTERNS = [
  /\b(j.en ai marre|ras le bol|c.est nul|j.en peux plus)\b/i,
  /\b(personne comprend|comprennent rien|m.[eé]nerve)\b/i,
  /\b(d[eé]gout[eé]|fatigu[eé]|ennui|chiant)\b/i,
];

// Track repeated signals per speaker
const signalHistory = new Map<string, { level: DistressLevel; count: number; dates: string[] }>();

export function detectTeenDistress(text: string, speakerId: string): DistressLevel {
  // Level 3 — CRITICAL
  for (const p of LEVEL3_PATTERNS) {
    if (p.test(text)) {
      log.error("CRITICAL teen distress detected", { speakerId, level: 3 });
      logAudit("distress_critical", "critical", speakerId, "level3", getCorrelationId(), { text: text.slice(0, 100) });
      return 3;
    }
  }

  // Level 2 — ALERT
  for (const p of LEVEL2_PATTERNS) {
    if (p.test(text)) {
      const history = signalHistory.get(speakerId) || { level: 0, count: 0, dates: [] };
      history.count++;
      history.level = 2;
      history.dates.push(new Date().toISOString().slice(0, 10));
      // Unique days with signals
      const uniqueDays = new Set(history.dates).size;
      signalHistory.set(speakerId, history);

      if (uniqueDays >= 3) {
        // Repeated over multiple days → escalate to parent notification
        log.warn("Repeated teen distress signals", { speakerId, level: 2, days: uniqueDays });
        logAudit("distress_repeated", "critical", speakerId, "level2_repeated", getCorrelationId());
      }
      return 2;
    }
  }

  // Level 1 — BLUES
  for (const p of LEVEL1_PATTERNS) {
    if (p.test(text)) {
      return 1;
    }
  }

  return 0;
}

export function getDistressResponse(level: DistressLevel): string {
  switch (level) {
    case 1:
      return "C'est dur de se sentir comme ca. Tu veux m'en parler ?";
    case 2:
      return "Je suis la pour toi. Ca a l'air vraiment difficile. Est-ce que tu pourrais en parler a quelqu'un de confiance ? Un adulte, un prof, quelqu'un que tu aimes bien ?";
    case 3:
      return "Je m'inquiete pour toi. J'ai prevenu tes parents parce que ta securite passe avant tout. Si tu as besoin de parler a quelqu'un tout de suite, appelle le 3114, ils sont la pour toi, 24 heures sur 24.";
    default:
      return "";
  }
}

export function shouldAlertParents(level: DistressLevel): boolean {
  return level >= 3;
}
