/**
 * Anaphora Resolver — Story 2.3
 * Resolves "le suivant", "la meme chose", "encore", "et demain ?"
 * using lastIntent/lastEntity from the Session Manager.
 */

import { getLastIntent } from "./session-manager.js";
import { log } from "../monitoring/logger.js";

interface AnaphoraResult {
  resolved: boolean;
  intent?: string;
  category?: string;
  entity?: string;
  modifiedText?: string;
}

const ANAPHORA_PATTERNS: { pattern: RegExp; resolve: (last: ReturnType<typeof getLastIntent>) => AnaphoraResult }[] = [
  {
    // "le suivant", "la suivante", "suivant", "next"
    pattern: /^(le |la )?(suivant|suivante|prochain|prochaine|next)e?$/i,
    resolve: (last) => {
      if (last.category === "music" || last.intent === "play_music") {
        return { resolved: true, intent: "local", category: "music", entity: "next", modifiedText: "musique suivante" };
      }
      return { resolved: false };
    },
  },
  {
    // "encore", "la meme chose", "remets", "rejoue"
    pattern: /^(encore|la m[eê]me chose|rem[eè]ts?|rejoue|replay)$/i,
    resolve: (last) => {
      if (last.entity) {
        return { resolved: true, intent: last.intent, category: last.category, entity: last.entity, modifiedText: `${last.category || ""} ${last.entity}` };
      }
      return { resolved: false };
    },
  },
  {
    // "et demain ?", "et demain", "demain ?"
    pattern: /^et demain\s*\??$/i,
    resolve: (last) => {
      if (last.category === "weather") {
        return { resolved: true, intent: last.intent, category: "weather", modifiedText: "meteo demain" };
      }
      if (last.category === "time") {
        return { resolved: true, intent: last.intent, category: "calendar", modifiedText: "planning demain" };
      }
      return { resolved: false };
    },
  },
  {
    // "et apres-demain", "apres-demain ?"
    pattern: /^(et )?apr[eè]s[- ]?demain\s*\??$/i,
    resolve: (last) => {
      if (last.category === "weather") {
        return { resolved: true, intent: last.intent, category: "weather", modifiedText: "meteo apres-demain" };
      }
      return { resolved: false };
    },
  },
  {
    // "arrete", "stop", "coupe"
    pattern: /^(arr[eê]te|stop|coupe|tais[- ]?toi|silence)$/i,
    resolve: (last) => {
      if (last.category === "music" || last.intent === "play_music") {
        return { resolved: true, intent: "local", category: "music", entity: "stop", modifiedText: "arrete la musique" };
      }
      if (last.category === "radio") {
        return { resolved: true, intent: "local", category: "radio", entity: "stop", modifiedText: "arrete la radio" };
      }
      return { resolved: false };
    },
  },
  {
    // "plus fort", "moins fort", "monte le son", "baisse"
    pattern: /^(plus fort|moins fort|monte le son|baisse|volume)$/i,
    resolve: (last) => {
      if (last.category === "music" || last.category === "radio") {
        return { resolved: true, intent: "local", category: last.category, modifiedText: `volume ${last.category}` };
      }
      return { resolved: false };
    },
  },
];

export function resolveAnaphora(text: string, speakerId: string): AnaphoraResult {
  const trimmed = text.trim();

  for (const { pattern, resolve } of ANAPHORA_PATTERNS) {
    if (pattern.test(trimmed)) {
      const last = getLastIntent(speakerId);
      if (!last.intent && !last.category) {
        log.debug("Anaphora detected but no previous context", { text: trimmed });
        return { resolved: false };
      }

      const result = resolve(last);
      if (result.resolved) {
        log.info("Anaphora resolved", {
          original: trimmed,
          resolved: result.modifiedText,
          fromIntent: last.intent,
          fromCategory: last.category,
        });
      }
      return result;
    }
  }

  return { resolved: false };
}
