/**
 * Home Assistant Connector — bidirectional integration via REST API
 * 
 * YAML config maps French voice names to HA entity IDs:
 *   "lumière du salon": "light.salon"
 *   "chauffage": "climate.thermostat"
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";

const HA_URL = process.env.HA_URL ?? "http://homeassistant.local:8123";
const HA_TOKEN = process.env.HA_TOKEN ?? "";
const HA_CONFIG_PATH = "/opt/diva-embedded/data/ha-entities.json";

interface EntityMapping {
  voiceName: string;      // "lumière du salon"
  entityId: string;       // "light.salon"
  domain: string;         // "light", "switch", "climate", etc.
  area?: string;          // "salon", "chambre"
}

let entityMappings: EntityMapping[] = [];

function loadMappings(): void {
  try {
    if (existsSync(HA_CONFIG_PATH)) {
      entityMappings = JSON.parse(readFileSync(HA_CONFIG_PATH, "utf-8"));
      console.log(`[HA] Loaded ${entityMappings.length} entity mappings`);
    } else {
      // Create sample config
      const sample: EntityMapping[] = [
        { voiceName: "lumière du salon", entityId: "light.salon", domain: "light", area: "salon" },
        { voiceName: "lumière de la chambre", entityId: "light.chambre", domain: "light", area: "chambre" },
        { voiceName: "lumière de la cuisine", entityId: "light.cuisine", domain: "light", area: "cuisine" },
        { voiceName: "chauffage", entityId: "climate.thermostat", domain: "climate" },
        { voiceName: "télé", entityId: "media_player.tv", domain: "media_player", area: "salon" },
      ];
      writeFileSync(HA_CONFIG_PATH, JSON.stringify(sample, null, 2));
      entityMappings = sample;
      console.log("[HA] Created sample config at", HA_CONFIG_PATH);
    }
  } catch (err) {
    console.error("[HA] Config load error:", err);
  }
}

async function callHA(endpoint: string, method: string = "GET", body?: unknown): Promise<unknown> {
  if (!HA_TOKEN) {
    throw new Error("HA_TOKEN not configured");
  }

  const res = await fetch(`${HA_URL}/api/${endpoint}`, {
    method,
    headers: {
      "Authorization": `Bearer ${HA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`HA API error: ${res.status}`);
  }

  return res.json();
}

function findEntity(text: string): EntityMapping | null {
  const lower = text.toLowerCase();

  // Direct voice name match
  for (const mapping of entityMappings) {
    if (lower.includes(mapping.voiceName.toLowerCase())) {
      return mapping;
    }
  }

  // Fuzzy: match by area + domain keywords
  const areaMatch = lower.match(/(?:du|de la|de l'|des?)\s+(salon|chambre|cuisine|salle\s+de\s+bain|bureau|garage|jardin|entrée|couloir)/i);
  const area = areaMatch?.[1]?.toLowerCase();

  const isLight = /lumi[eè]re|lampe|plafonnier|allume|[eé]teins/i.test(lower);
  const isSwitch = /prise|interrupteur/i.test(lower);
  const isClimate = /chauffage|thermostat|clim|temp[eé]rature/i.test(lower);
  const isLock = /porte|verrouill|serrure/i.test(lower);
  const isCover = /volet|store|rideau/i.test(lower);

  let targetDomain: string | null = null;
  if (isLight) targetDomain = "light";
  else if (isSwitch) targetDomain = "switch";
  else if (isClimate) targetDomain = "climate";
  else if (isLock) targetDomain = "lock";
  else if (isCover) targetDomain = "cover";

  if (targetDomain) {
    for (const mapping of entityMappings) {
      if (mapping.domain === targetDomain && (!area || mapping.area === area)) {
        return mapping;
      }
    }
    // Fallback: first match by domain
    return entityMappings.find((m) => m.domain === targetDomain) ?? null;
  }

  return null;
}

function detectAction(text: string): { action: string; service: string } {
  const lower = text.toLowerCase();

  if (/allume|ouvre|active|d[eé]marre|lance/i.test(lower)) {
    return { action: "on", service: "turn_on" };
  }
  if (/[eé]teins?|ferme|d[eé]sactive|arr[eê]te|coupe/i.test(lower)) {
    return { action: "off", service: "turn_off" };
  }
  if (/bascule|toggle|switch/i.test(lower)) {
    return { action: "toggle", service: "toggle" };
  }
  if (/monte|hausse|augmente|plus/i.test(lower)) {
    return { action: "up", service: "turn_on" };
  }
  if (/baisse|diminue|r[eé]dui|moins/i.test(lower)) {
    return { action: "down", service: "turn_off" };
  }
  if (/verrouill|lock/i.test(lower)) {
    return { action: "lock", service: "lock" };
  }
  if (/d[eé]verrouill|unlock/i.test(lower)) {
    return { action: "unlock", service: "unlock" };
  }

  // Default: toggle
  return { action: "toggle", service: "toggle" };
}

export async function handleHomeCommand(text: string): Promise<{ handled: boolean; response?: string }> {
  if (!HA_TOKEN) {
    return { handled: true, response: "La domotique n'est pas encore configuree. Il faut ajouter le token Home Assistant." };
  }

  const entity = findEntity(text);
  if (!entity) {
    return { handled: true, response: "Je ne trouve pas cet appareil. Verifie la configuration domotique." };
  }

  const { action, service } = detectAction(text);
  const domain = entity.domain;

  try {
    await callHA(`services/${domain}/${service}`, "POST", {
      entity_id: entity.entityId,
    });

    const actionVerb = action === "on" ? "allumé" : action === "off" ? "éteint" : action === "toggle" ? "basculé" : action;
    return { handled: true, response: `${entity.voiceName} ${actionVerb}.` };
  } catch (err) {
    console.error(`[HA] Command error:`, err);
    return { handled: true, response: "Erreur de communication avec Home Assistant." };
  }
}

export async function getHAEntityState(entityId: string): Promise<unknown> {
  return callHA(`states/${entityId}`);
}

export function isHAConfigured(): boolean {
  return HA_TOKEN.length > 0;
}

export function getEntityMappings(): EntityMapping[] {
  return entityMappings;
}

// Initialize on import
loadMappings();
