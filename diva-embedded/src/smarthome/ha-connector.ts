/**
 * Home Assistant Connector — bidirectional integration via REST API
 *
 * YAML config maps French voice names to HA entity IDs:
 *   "lumière du salon": "light.salon"
 *   "chauffage": "climate.thermostat"
 *
 * Story 13.1: Added waitForHA(), periodic health check, localhost default URL
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createLogger } from "../monitoring/logger.js";

const logger = createLogger("smarthome");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Read HA_URL dynamically so tests can override process.env */
function getHAUrl(): string {
  return process.env.HA_URL ?? "http://localhost:8123";
}

/** Read HA_TOKEN dynamically so tests can override process.env */
function getHAToken(): string {
  return process.env.HA_TOKEN ?? "";
}

const HA_CONFIG_PATH = "/opt/diva-embedded/data/ha-entities.json";
const HA_TIMEOUT_MS = 3000;
const HA_POLL_INTERVAL_MS = 5000;
const HA_WAIT_TIMEOUT_MS = 120_000;
const HA_HEALTH_CHECK_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface EntityMapping {
  voiceName: string;      // "lumière du salon"
  entityId: string;       // "light.salon"
  domain: string;         // "light", "switch", "climate", etc.
  area?: string;          // "salon", "chambre"
}

let entityMappings: EntityMapping[] = [];
let _haAvailable = false;
let _healthCheckTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Story 18.2 — State change callbacks (AC2, AC8)
// ---------------------------------------------------------------------------

/** State change event for WebSocket broadcast. */
export interface StateChangeEvent {
  entityId: string;
  areaId: string;
  areaName: string;
  state: string;
  attributes: Record<string, unknown>;
  changedBy: {
    source: "vocal" | "dashboard" | "automation";
    personaId: string | null;
    personaName: string | null;
  };
  timestamp: string;
}

type StateChangeCallback = (event: StateChangeEvent) => void;
const _stateChangeCallbacks: StateChangeCallback[] = [];

/**
 * Register a callback to be called on every HA state change.
 * Used by WebSocket server to broadcast state changes in real-time.
 */
export function onStateChange(callback: StateChangeCallback): void {
  _stateChangeCallbacks.push(callback);
}

/**
 * Notify all registered state change callbacks.
 * Called after a successful HA service call.
 */
export function notifyStateChange(event: StateChangeEvent): void {
  for (const cb of _stateChangeCallbacks) {
    try {
      cb(event);
    } catch {
      // Callback error should not disrupt HA operations
    }
  }
}

/**
 * Reset state change callbacks — for testing only.
 */
export function _resetStateChangeCallbacks(): void {
  _stateChangeCallbacks.length = 0;
}

// ---------------------------------------------------------------------------
// waitForHA — Story 13.1 AC5/AC7
// ---------------------------------------------------------------------------

/**
 * Poll HA API until it responds or timeout is reached.
 * Called at Diva startup to ensure HA is ready before processing commands.
 *
 * @param timeoutMs  Max wait time (default 120s)
 * @param intervalMs Poll interval (default 5s)
 * @returns true if HA is reachable, false on timeout
 */
export async function waitForHA(
  timeoutMs: number = HA_WAIT_TIMEOUT_MS,
  intervalMs: number = HA_POLL_INTERVAL_MS,
): Promise<boolean> {
  const haUrl = getHAUrl();
  logger.info("Waiting for Home Assistant...", { url: haUrl });

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const token = getHAToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${haUrl}/api/`, {
        headers,
        signal: AbortSignal.timeout(HA_TIMEOUT_MS),
      });
      if (res.ok) {
        _haAvailable = true;
        logger.info("Home Assistant ready", { url: haUrl });
        return true;
      }
    } catch {
      // HA not ready yet — will retry
    }

    // Sleep before next poll (but don't exceed deadline)
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }

  _haAvailable = false;
  logger.warn("Home Assistant not available after timeout", {
    timeoutMs: String(timeoutMs),
    url: haUrl,
  });
  return false;
}

// ---------------------------------------------------------------------------
// Health check — Story 13.1 AC7
// ---------------------------------------------------------------------------

/**
 * Start a periodic health check that verifies HA connectivity every 60s.
 * Logs state transitions (up->down, down->up) for monitoring.
 */
export function startHAHealthCheck(intervalMs: number = HA_HEALTH_CHECK_INTERVAL_MS): void {
  if (_healthCheckTimer) return; // already running

  _healthCheckTimer = setInterval(async () => {
    const haUrl = getHAUrl();
    const wasAvailable = _haAvailable;
    try {
      const token = getHAToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${haUrl}/api/`, {
        headers,
        signal: AbortSignal.timeout(HA_TIMEOUT_MS),
      });
      _haAvailable = res.ok;
    } catch {
      _haAvailable = false;
    }

    // Log state transitions
    if (wasAvailable && !_haAvailable) {
      logger.warn("Home Assistant is down", { url: haUrl });
    } else if (!wasAvailable && _haAvailable) {
      logger.info("Home Assistant reconnected", { url: haUrl });
    }
  }, intervalMs);

  // Don't prevent Node.js from exiting
  _healthCheckTimer.unref();
}

/**
 * Stop the periodic health check (useful for tests and shutdown).
 */
export function stopHAHealthCheck(): void {
  if (_healthCheckTimer) {
    clearInterval(_healthCheckTimer);
    _healthCheckTimer = null;
  }
}

/**
 * Returns current HA availability status.
 */
export function isHAAvailable(): boolean {
  return _haAvailable;
}

// ---------------------------------------------------------------------------
// Internal: for test reset
// ---------------------------------------------------------------------------

export function _resetHAState(): void {
  _haAvailable = false;
  stopHAHealthCheck();
}

// ---------------------------------------------------------------------------
// Entity mappings
// ---------------------------------------------------------------------------

function loadMappings(): void {
  try {
    if (existsSync(HA_CONFIG_PATH)) {
      entityMappings = JSON.parse(readFileSync(HA_CONFIG_PATH, "utf-8"));
      logger.info(`Loaded ${entityMappings.length} entity mappings`);
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
      logger.info("Created sample config", { path: HA_CONFIG_PATH });
    }
  } catch (err) {
    logger.error("Config load error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function callHA(endpoint: string, method: string = "GET", body?: unknown, correlationId?: string): Promise<unknown> {
  const token = getHAToken();
  if (!token) {
    throw new Error("HA_TOKEN not configured");
  }

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // Story 15.5 Task 5.3 — Propagate X-Correlation-Id
  if (correlationId) {
    headers["X-Correlation-Id"] = correlationId;
  }

  const res = await fetch(`${getHAUrl()}/api/${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(HA_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`HA API error: ${res.status}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Entity resolution
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Action detection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Story 19.1: Rental mode aware home command handler.
 * When isRentalGuest is true, only allowed entities/services are permitted.
 */
export async function handleHomeCommandWithRentalCheck(
  text: string,
  isRentalGuest: boolean = false,
): Promise<{ handled: boolean; response?: string }> {
  if (!isRentalGuest) {
    return handleHomeCommand(text);
  }

  // In rental mode, check entity permissions before executing
  try {
    const { isEntityAllowed } = await import("./rental-mode-manager.js");
    const entity = findEntity(text);
    if (!entity) {
      return { handled: true, response: "Desole, cette fonctionnalite n'est pas disponible pour le moment." };
    }

    const { service } = detectAction(text);
    if (!isEntityAllowed(entity.entityId, service)) {
      return { handled: true, response: "Desole, cette fonctionnalite n'est pas disponible pour le moment." };
    }

    // Allowed — proceed with normal handling
    return handleHomeCommand(text);
  } catch {
    return { handled: true, response: "Desole, cette fonctionnalite n'est pas disponible pour le moment." };
  }
}

export async function handleHomeCommand(text: string): Promise<{ handled: boolean; response?: string }> {
  if (!getHAToken()) {
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

    // Story 18.1 — Task 4.1: Record vocal activity
    try {
      const { recordActivity } = await import("../dashboard-prod/services/activity-recorder.js");
      recordActivity(null, entity.entityId, service, "vocal");
    } catch { /* activity recording is non-critical */ }

    // Story 18.2 — Task 3.3: Notify state change for WebSocket broadcast
    try {
      const newState = action === "on" ? "on" : action === "off" ? "off" : "unknown";
      notifyStateChange({
        entityId: entity.entityId,
        areaId: entity.area || "",
        areaName: entity.area || "",
        state: newState,
        attributes: {},
        changedBy: {
          source: "vocal",
          personaId: null,
          personaName: null,
        },
        timestamp: new Date().toISOString(),
      });
    } catch { /* state change notification is non-critical */ }

    // Story 19.3 — Task 4.3: Emit smarthome.action for eco-gamification detection
    try {
      const { onSmarthomeAction } = await import("../companion/eco-gamification.js");
      onSmarthomeAction({
        entityId: entity.entityId,
        domain: entity.domain,
        service,
        action,
        area: entity.area,
        speakerId: undefined, // Will be set by caller if speaker is identified
        source: "vocal",
        timestamp: new Date().toISOString(),
      });
    } catch { /* eco-gamification is non-critical */ }

    const actionVerb = action === "on" ? "allumé" : action === "off" ? "éteint" : action === "toggle" ? "basculé" : action;
    return { handled: true, response: `${entity.voiceName} ${actionVerb}.` };
  } catch (err) {
    logger.warn("Command error", {
      error: err instanceof Error ? err.message : String(err),
      entityId: entity.entityId,
      service: `${domain}/${service}`,
    });
    return { handled: true, response: "Erreur de communication avec Home Assistant." };
  }
}

export async function getHAEntityState(entityId: string): Promise<unknown> {
  return callHA(`states/${entityId}`);
}

/**
 * Story 15.5 Task 2.1 — Capture the full state (state + relevant attributes)
 * of an entity before executing an action, for undo purposes.
 * Returns a flat Record including state and key attributes.
 */
export async function captureEntityStateForUndo(entityId: string): Promise<Record<string, unknown>> {
  try {
    const raw = (await callHA(`states/${entityId}`)) as {
      state?: string;
      attributes?: Record<string, unknown>;
    } | null;

    if (!raw) return { state: "unknown" };

    const snapshot: Record<string, unknown> = {
      state: raw.state ?? "unknown",
    };

    // Stocker les attributes pertinents pour la restauration
    const attrs = raw.attributes ?? {};
    if (attrs.brightness !== undefined) snapshot.brightness = attrs.brightness;
    if (attrs.color_temp !== undefined) snapshot.color_temp = attrs.color_temp;
    if (attrs.rgb_color !== undefined) snapshot.rgb_color = attrs.rgb_color;
    if (attrs.hs_color !== undefined) snapshot.hs_color = attrs.hs_color;
    if (attrs.temperature !== undefined) snapshot.temperature = attrs.temperature;
    if (attrs.hvac_mode !== undefined) snapshot.hvac_mode = attrs.hvac_mode;
    if (attrs.volume_level !== undefined) snapshot.volume_level = attrs.volume_level;

    // Conserver aussi les attributes complets pour d'autres usages
    snapshot.attributes = attrs;

    return snapshot;
  } catch {
    // Si HA ne repond pas, on retourne un etat inconnu
    return { state: "unknown" };
  }
}

export function isHAConfigured(): boolean {
  return getHAToken().length > 0;
}

export function getEntityMappings(): EntityMapping[] {
  return entityMappings;
}

// ---------------------------------------------------------------------------
// Story 3.9: Area and entity-by-area support (AC8)
// ---------------------------------------------------------------------------

/** HA Area from the area registry. */
export interface HAArea {
  area_id: string;
  name: string;
}

/** HA Entity with area info. */
export interface HAEntity {
  entity_id: string;
  area_id?: string;
  domain: string;
  state: string;
  attributes: Record<string, unknown>;
}

/**
 * Fetch all Home Assistant areas.
 * Uses the HA REST API template endpoint as area_registry is not directly
 * exposed via REST. Falls back to entity mappings if API fails.
 */
export async function getAreas(): Promise<HAArea[]> {
  try {
    const result = await callHA("config/area_registry/list", "GET") as HAArea[];
    return result;
  } catch {
    // Fallback: derive areas from entity mappings
    const areaSet = new Map<string, string>();
    for (const mapping of entityMappings) {
      if (mapping.area) {
        areaSet.set(mapping.area, mapping.area);
      }
    }
    return Array.from(areaSet.entries()).map(([id, name]) => ({ area_id: id, name }));
  }
}

/**
 * Get HA entities filtered by area and optionally by domain.
 * Uses the states API and filters by area from entity mappings.
 */
export async function getEntitiesByArea(roomId: string, domain?: string): Promise<HAEntity[]> {
  try {
    const states = (await callHA("states")) as Array<{
      entity_id: string;
      state: string;
      attributes: Record<string, unknown>;
    }>;

    // Filter by area from entity mappings
    const areaEntities = entityMappings.filter(
      (m) => m.area === roomId && (!domain || m.domain === domain),
    );

    return areaEntities
      .map((mapping) => {
        const state = states.find((s) => s.entity_id === mapping.entityId);
        return {
          entity_id: mapping.entityId,
          area_id: mapping.area,
          domain: mapping.domain,
          state: state?.state ?? "unknown",
          attributes: state?.attributes ?? {},
        };
      });
  } catch (err) {
    logger.warn("getEntitiesByArea failed", {
      roomId,
      domain: domain ?? "all",
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Story 15.2 Task 4.4: Hot reload of ha-entities.json
// ---------------------------------------------------------------------------

/**
 * Force reload entity mappings from ha-entities.json.
 * Called after dashboard or voice-based assignment changes.
 */
export function reloadEntityMappings(): void {
  loadMappings();
  logger.info("Entity mappings reloaded (hot reload)");
}

/**
 * Get entities that have no room (area) assigned.
 * Optionally filter by domain.
 */
export function getUnassignedEntities(domain?: string): EntityMapping[] {
  return entityMappings.filter((m) => {
    const hasNoRoom = !m.area || m.area === "" || m.area === "non-assigne";
    const matchesDomain = !domain || m.domain === domain;
    return hasNoRoom && matchesDomain;
  });
}

// ---------------------------------------------------------------------------
// Story 19.4 — Light-music sync helpers (Task 6)
// ---------------------------------------------------------------------------

/** Represents an RGB-capable light entity from HA. */
export interface HaRgbLight {
  entityId: string;
  areaId: string;
  supportsRgb: boolean;
  state: string;
  brightness: number | null;
  rgbColor: [number, number, number] | null;
}

/** State snapshot used for save/restore. */
export interface HaLightState {
  entityId: string;
  state: string;
  rgbColor: [number, number, number] | null;
  brightness: number | null;
}

/**
 * Get RGB-capable lights in a specific room.
 * Filters entities by area and checks for rgb_color support in attributes.
 */
export async function getRoomRgbLights(roomId: string): Promise<HaRgbLight[]> {
  try {
    const entities = await getEntitiesByArea(roomId, "light");
    const rgbLights: HaRgbLight[] = [];

    for (const entity of entities) {
      const attrs = entity.attributes ?? {};
      // Check if the light supports RGB (has supported_color_modes including rgb or hs)
      const colorModes = attrs.supported_color_modes as string[] | undefined;
      const hasRgb = colorModes
        ? colorModes.some((m: string) => m === "rgb" || m === "hs" || m === "xy")
        : attrs.rgb_color !== undefined;

      if (hasRgb) {
        const rgb = Array.isArray(attrs.rgb_color) && attrs.rgb_color.length >= 3
          ? [attrs.rgb_color[0], attrs.rgb_color[1], attrs.rgb_color[2]] as [number, number, number]
          : null;

        rgbLights.push({
          entityId: entity.entity_id,
          areaId: roomId,
          supportsRgb: true,
          state: entity.state,
          brightness: typeof attrs.brightness === "number" ? attrs.brightness : null,
          rgbColor: rgb,
        });
      }
    }

    return rgbLights;
  } catch (err) {
    logger.warn("getRoomRgbLights failed", {
      roomId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Set color and brightness on a light entity via HA REST API.
 * Uses /api/services/light/turn_on with rgb_color and brightness attributes.
 */
export async function setLightColor(
  entityId: string,
  rgb: [number, number, number],
  brightness: number,
): Promise<void> {
  await callHA("services/light/turn_on", "POST", {
    entity_id: entityId,
    rgb_color: rgb,
    brightness: Math.round(Math.max(0, Math.min(255, brightness))),
    transition: 0.1,
  });
}

/**
 * Get the current state of a light entity (color, brightness, on/off).
 * Used for save/restore when starting/stopping sync.
 */
export async function getLightState(entityId: string): Promise<HaLightState> {
  try {
    const raw = await callHA(`states/${entityId}`) as {
      state?: string;
      attributes?: Record<string, unknown>;
    };

    const attrs = raw?.attributes ?? {};
    const rgb = Array.isArray(attrs.rgb_color) && (attrs.rgb_color as number[]).length >= 3
      ? [(attrs.rgb_color as number[])[0], (attrs.rgb_color as number[])[1], (attrs.rgb_color as number[])[2]] as [number, number, number]
      : null;

    return {
      entityId,
      state: raw?.state ?? "off",
      rgbColor: rgb,
      brightness: typeof attrs.brightness === "number" ? attrs.brightness as number : null,
    };
  } catch {
    return { entityId, state: "off", rgbColor: null, brightness: null };
  }
}

// Initialize on import
loadMappings();
