/**
 * Dashboard HTTP Server — Admin panel for Diva on port 3002
 * v2 — Tabbed navigation, ONNX model switching, env config, proactive config
 *
 * Endpoints:
 * - GET  /                         → Dashboard HTML
 * - GET  /api/status               → Service health + system metrics
 * - GET  /api/metrics              → CPU/RAM/NPU/temp real-time
 * - GET  /api/logs                 → Recent interaction logs
 * - GET  /api/timers               → Active timers
 * - GET  /api/sounds               → List configurable sounds
 * - POST /api/sounds/upload        → Upload custom sound
 * - GET  /api/sounds/play/:file    → Stream a WAV file
 * - GET  /api/dnd                  → DND status
 * - POST /api/dnd                  → Toggle DND
 * - GET  /api/personas             → List personas
 * - POST /api/personas             → Create persona
 * - DELETE /api/personas/:id       → Delete persona
 * - GET  /api/health/medications   → Medication log + compliance
 * - GET  /api/health/repetitions   → Repetition stats
 * - GET  /api/routines             → Routines list
 * - GET  /api/shopping             → Shopping list
 * - GET  /api/radio                → Radio status
 * - POST /api/services/action      → Start/stop/restart a service
 * - GET  /api/services/list        → Detailed service list
 * - POST /api/services/kill-all    → Emergency stop all
 * - POST /api/services/start-all   → Start all services
 * - GET  /api/tuning/audio         → Audio tuning params
 * - POST /api/tuning/audio         → Update audio tuning
 * - GET  /api/tuning/speaker       → Speaker ID tuning
 * - POST /api/tuning/speaker       → Update speaker tuning
 * - GET  /api/speakers             → Registered speakers
 * - POST /api/speakers/delete      → Delete speaker
 * - GET  /api/logs/stream          → SSE live logs
 * - GET  /api/logs/journalctl      → Recent journalctl logs
 * - GET  /api/memory/users         → Memory users list
 * - GET  /api/memory/list          → Memories for user
 * - POST /api/memory/search        → Search memories
 * - POST /api/memory/delete        → Delete memory
 * - POST /api/memory/add           → Add memory manually
 * - GET  /api/music/spotify/*      → Spotify OAuth
 * - GET  /api/music/youtube/*      → YouTube cookies
 * - GET  /api/music/status         → All music sources status
 * - GET  /api/network/wifi/*       → WiFi management
 * - GET  /api/network/bluetooth/*  → Bluetooth management
 * --- NEW v2 ---
 * - GET  /api/models/wakeword      → List available ONNX models
 * - POST /api/models/wakeword      → Switch active model
 * - GET  /api/config/env           → Read non-secret env vars
 * - POST /api/config/env           → Update env vars
 * - GET  /api/config/proactive     → Read proactive config
 * - POST /api/config/proactive     → Update proactive config
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { listTimers } from "../tools/timer-manager.js";
import { getDNDStatus, enableDND, disableDND } from "../tools/dnd-manager.js";
import { listPersonas, createPersona, deletePersona, getCurrentPersona, type PersonaType } from "../persona/engine.js";
import { getMedicationLog, getComplianceRate } from "../elderly/medication-manager.js";
import { getWellnessSummary } from "../elderly/wellness-tracker.js";
import { getRepetitionStats } from "../elderly/repetition-tracker.js";
// Story 25.2: Emotional history endpoint
import { getEmotionalHistory } from "../elderly/emotional-checkin.js";
// Story 25.3: Gamification education dashboard
import { gamificationEngine } from "../companion/gamification-engine.js";
// Story 16.5: Scene suggestion engine — contextual scenes dashboard
import {
  getSuggestions as getSceneSuggestions,
  createScene,
  updateScene,
  deleteScene,
  getSceneById,
  toggleFavorite,
  reorderFavorites,
  executeScene,
  type SceneAction,
  type TimeSlot,
} from "../smarthome/scene-suggestion-engine.js";
import { getActiveMode as getActiveModeForScenes } from "../smarthome/mode-manager.js";
// Story 16.6: Weather automation dashboard endpoints
import { getWeather } from "../smarthome/weather-data-provider.js";
import { loadRuleConfigs, logWeatherAction } from "../smarthome/weather-rule-evaluator.js";
import { getReactiveDevices, getAllDevices, addDevice, updateDevice, removeDevice } from "../smarthome/weather-device-manager.js";
import { getActiveProfile as getActiveSeasonalProfile } from "../smarthome/seasonal-profile-manager.js";
import { getRoutinesForDashboard } from "../tools/routines.js";
import { getListItems } from "../tools/shopping-list.js";
import { isPlaying, getCurrentStation } from "../tools/radio.js";
// Story 25.6: Longitudinal wellness — timeline and patterns endpoints
import { WellnessSummarizer } from "../elderly/wellness-summarizer.js";
import { PatternAnalyzer } from "../elderly/pattern-analyzer.js";

const PORT = 3002;
const ASSETS_DIR = "/opt/diva-embedded/assets";
const DASHBOARD_HTML_PATH = "/opt/diva-embedded/src/dashboard/index.html";
const ENV_PATH = "/opt/diva-embedded/.env";
const PROACTIVE_CONFIG_PATH = "/opt/diva-embedded/data/proactive-config.json";

// Non-secret env keys that can be exposed/modified via dashboard
const SAFE_ENV_KEYS = [
  "LLM_MODEL", "TTS_BASE_URL", "PORT", "NODE_ENV",
  "AUDIO_INPUT_DEVICE", "AUDIO_OUTPUT_DEVICE",
];

// Interaction log ring buffer
interface LogEntry {
  timestamp: string;
  speaker: string;
  transcription: string;
  intent: string;
  category: string;
  response: string;
  latencyMs: number;
}

const interactionLogs: LogEntry[] = [];
const MAX_LOGS = 200;

export function logInteraction(entry: LogEntry): void {
  interactionLogs.push(entry);
  if (interactionLogs.length > MAX_LOGS) {
    interactionLogs.shift();
  }
}

// Configurable sounds mapping
const SOUND_SLOTS: Record<string, { description: string; defaultFile: string }> = {
  wakeword_ack: { description: "Wake word detected (confirmation)", defaultFile: "oui.wav" },
  idle_return: { description: "Return to idle / goodbye", defaultFile: "goodbye.wav" },
  timer_end: { description: "Timer expired", defaultFile: "bibop.wav" },
  thinking: { description: "Processing / thinking", defaultFile: "thinking.wav" },
  listen: { description: "Your turn to speak (beep)", defaultFile: "listen.wav" },
};

// =====================================================================
// HELPERS
// =====================================================================

function getSystemMetrics(): Record<string, unknown> {
  try {
    const cpuTemp = execSync("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0", { timeout: 1000 }).toString().trim();
    const tempC = parseInt(cpuTemp) / 1000;

    const memInfo = execSync("free -m | awk 'NR==2{printf \"%s %s %s\", $2,$3,$7}'", { timeout: 1000 }).toString().trim().split(" ");
    const totalMB = parseInt(memInfo[0]);
    const usedMB = parseInt(memInfo[1]);
    const availMB = parseInt(memInfo[2]);

    const loadAvg = execSync("cat /proc/loadavg", { timeout: 1000 }).toString().trim().split(" ");
    const uptime = execSync("uptime -p", { timeout: 1000 }).toString().trim();

    let npuActive = false;
    try {
      execSync("pgrep -f rkllama", { timeout: 1000 });
      npuActive = true;
    } catch {}

    const diskInfo = execSync("df -h / | awk 'NR==2{printf \"%s %s %s %s\", $2,$3,$4,$5}'", { timeout: 1000 }).toString().trim().split(" ");

    return {
      cpu: {
        tempC: Math.round(tempC * 10) / 10,
        load1m: parseFloat(loadAvg[0]),
        load5m: parseFloat(loadAvg[1]),
        load15m: parseFloat(loadAvg[2]),
      },
      memory: { totalMB, usedMB, availMB, usedPercent: Math.round((usedMB / totalMB) * 100) },
      npu: { active: npuActive },
      disk: { total: diskInfo[0], used: diskInfo[1], avail: diskInfo[2], usedPercent: diskInfo[3] },
      uptime,
    };
  } catch (err) {
    return { error: String(err) };
  }
}

async function checkServiceHealth(): Promise<Record<string, { status: string; latencyMs: number }>> {
  const services: Record<string, string> = {
    "diva-audio": "http://localhost:9010/health",
    "intent-router": "http://localhost:8882/health",
    "diva-memory": "http://localhost:9002/health",
    "stt-npu": "http://localhost:8881/health",
    "paroli-tts": "http://localhost:8880/health",
    "qwen-npu": "http://localhost:8080/v1/models",
    "searxng": "http://localhost:8888/healthz",
    "embedding": "http://localhost:8883/health",
  };

  const results: Record<string, { status: string; latencyMs: number }> = {};

  await Promise.all(
    Object.entries(services).map(async ([name, url]) => {
      const t0 = Date.now();
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        results[name] = { status: res.ok ? "ok" : `error:${res.status}`, latencyMs: Date.now() - t0 };
      } catch {
        results[name] = { status: "down", latencyMs: Date.now() - t0 };
      }
    })
  );

  return results;
}

async function listSounds(): Promise<Record<string, { slot: string; description: string; currentFile: string; files: string[] }>> {
  const result: Record<string, { slot: string; description: string; currentFile: string; files: string[] }> = {};

  let wavFiles: string[] = [];
  try {
    const files = await readdir(ASSETS_DIR);
    wavFiles = files.filter((f) => f.endsWith(".wav"));
  } catch {}

  for (const [slot, info] of Object.entries(SOUND_SLOTS)) {
    result[slot] = { slot, description: info.description, currentFile: info.defaultFile, files: wavFiles };
  }

  return result;
}

async function parseMultipart(req: IncomingMessage): Promise<{ fields: Record<string, string>; file?: { name: string; data: Buffer } }> {
  return new Promise((resolve, reject) => {
    const boundary = req.headers["content-type"]?.match(/boundary=(.+)/)?.[1];
    if (!boundary) return reject(new Error("No boundary"));

    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const parts = body.toString("binary").split(`--${boundary}`);
      const fields: Record<string, string> = {};
      let file: { name: string; data: Buffer } | undefined;

      for (const part of parts) {
        if (part.includes("filename=")) {
          const nameMatch = part.match(/filename="(.+?)"/);
          const headerEnd = part.indexOf("\r\n\r\n") + 4;
          const dataEnd = part.lastIndexOf("\r\n");
          if (nameMatch && headerEnd > 3 && dataEnd > headerEnd) {
            file = { name: nameMatch[1], data: Buffer.from(part.slice(headerEnd, dataEnd), "binary") };
          }
        } else if (part.includes("name=")) {
          const nameMatch = part.match(/name="(.+?)"/);
          const headerEnd = part.indexOf("\r\n\r\n") + 4;
          const dataEnd = part.lastIndexOf("\r\n");
          if (nameMatch && headerEnd > 3) {
            fields[nameMatch[1]] = part.slice(headerEnd, dataEnd).trim();
          }
        }
      }

      resolve({ fields, file });
    });
    req.on("error", reject);
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// =====================================================================
// NEW v2: ONNX model listing
// =====================================================================

async function listOnnxModels(): Promise<Array<{ path: string; name: string; size: string; active: boolean }>> {
  const searchDirs = [ASSETS_DIR, "/opt/diva-embedded/training/wakeword/models"];
  const models: Array<{ path: string; name: string; size: string; active: boolean }> = [];

  // Read current active model from audio server
  let activeModel = "";
  try {
    const r = await fetch("http://localhost:9010/tuning", { signal: AbortSignal.timeout(2000) });
    const data = (await r.json()) as Record<string, unknown>;
    activeModel = (data as any).wakeword_model_path || "";
  } catch {}

  for (const dir of searchDirs) {
    try {
      const findOutput = execSync(`find ${dir} -name "*.onnx" -not -name "melspectrogram*" 2>/dev/null`, { timeout: 3000 }).toString().trim();
      if (!findOutput) continue;
      for (const filePath of findOutput.split("\n")) {
        try {
          const s = await stat(filePath);
          const sizeMB = (s.size / 1048576).toFixed(1);
          const name = filePath.split("/").pop()?.replace(".onnx", "") || filePath;
          models.push({
            path: filePath,
            name,
            size: `${sizeMB} MB`,
            active: filePath === activeModel || activeModel.includes(name),
          });
        } catch {}
      }
    } catch {}
  }

  return models;
}

// =====================================================================
// NEW v2: Env config helpers
// =====================================================================

async function readEnvConfig(): Promise<Record<string, string>> {
  try {
    const content = await readFile(ENV_PATH, "utf-8");
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      if (SAFE_ENV_KEYS.includes(key)) {
        result[key] = val;
      }
    }
    return result;
  } catch {
    return {};
  }
}

async function updateEnvConfig(updates: Record<string, string>): Promise<string[]> {
  const content = await readFile(ENV_PATH, "utf-8");
  const lines = content.split("\n");
  const updated: string[] = [];

  for (const [key, val] of Object.entries(updates)) {
    if (!SAFE_ENV_KEYS.includes(key)) continue;
    // Sanitize value (no newlines, no shell injection)
    const safeVal = val.replace(/[\n\r]/g, "").trim();
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(`${key}=`)) {
        lines[i] = `${key}=${safeVal}`;
        found = true;
        break;
      }
    }
    if (!found) {
      lines.push(`${key}=${safeVal}`);
    }
    updated.push(key);
  }

  await writeFile(ENV_PATH, lines.join("\n"));
  return updated;
}


// =====================================================================
// REQUEST HANDLER
// =====================================================================

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // Dashboard HTML
    if (path === "/" && req.method === "GET") {
      const html = await readFile(DASHBOARD_HTML_PATH, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // =====================================================================
    // STATUS / METRICS
    // =====================================================================

    if (path === "/api/status" && req.method === "GET") {
      const services = await checkServiceHealth();
      const metrics = getSystemMetrics();
      respond(res, 200, { services, metrics });
      return;
    }

    if (path === "/api/metrics" && req.method === "GET") {
      respond(res, 200, getSystemMetrics());
      return;
    }

    // =====================================================================
    // INTERACTION LOGS / TIMERS
    // =====================================================================

    if (path === "/api/logs" && req.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") ?? "50");
      respond(res, 200, { logs: interactionLogs.slice(-limit) });
      return;
    }

    if (path === "/api/timers" && req.method === "GET") {
      respond(res, 200, { timers: listTimers() });
      return;
    }

    // =====================================================================
    // SOUNDS
    // =====================================================================

    if (path === "/api/sounds" && req.method === "GET") {
      respond(res, 200, { sounds: await listSounds() });
      return;
    }

    if (path === "/api/sounds/upload" && req.method === "POST") {
      const { fields, file } = await parseMultipart(req);
      if (!file || !file.name.endsWith(".wav")) {
        respond(res, 400, { error: "Only .wav files accepted" });
        return;
      }
      const dest = join(ASSETS_DIR, file.name);
      await writeFile(dest, file.data);
      respond(res, 200, { uploaded: file.name, path: dest, size: file.data.length });
      return;
    }

    if (path.startsWith("/api/sounds/play/") && req.method === "GET") {
      const filename = decodeURIComponent(path.replace("/api/sounds/play/", ""));
      if (filename.includes("..") || filename.includes("/") || !filename.endsWith(".wav")) {
        respond(res, 400, { error: "Invalid filename" });
        return;
      }
      const filePath = join(ASSETS_DIR, filename);
      if (!existsSync(filePath)) {
        respond(res, 404, { error: "File not found" });
        return;
      }
      try {
        const data = await readFile(filePath);
        res.writeHead(200, {
          "Content-Type": "audio/wav",
          "Content-Length": data.length.toString(),
          "Access-Control-Allow-Origin": "*",
        });
        res.end(data);
      } catch {
        respond(res, 500, { error: "Read error" });
      }
      return;
    }

    // =====================================================================
    // DND
    // =====================================================================

    if (path === "/api/dnd" && req.method === "GET") {
      respond(res, 200, getDNDStatus());
      return;
    }

    if (path === "/api/dnd" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      if (body.enable) {
        enableDND((body.durationMin ?? 480) * 60 * 1000);
      } else {
        disableDND();
      }
      respond(res, 200, getDNDStatus());
      return;
    }

    // =====================================================================
    // PERSONAS
    // =====================================================================

    if (path === "/api/personas" && req.method === "GET") {
      respond(res, 200, { personas: listPersonas() });
      return;
    }

    if (path === "/api/personas" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const profile = createPersona(body.id, body.name, body.type as PersonaType, body.greetingName);
      respond(res, 200, profile);
      return;
    }

    if (path.startsWith("/api/personas/") && req.method === "DELETE") {
      const id = path.split("/").pop() ?? "";
      respond(res, 200, { deleted: deletePersona(id) });
      return;
    }

    // =====================================================================
    // SPEAKER CURRENT — Story 2.6: Expose persona type for Python audio server
    // =====================================================================

    if (path === "/v1/speaker/current" && req.method === "GET") {
      const persona = getCurrentPersona();
      respond(res, 200, {
        speakerId: persona.id !== "guest" ? persona.id : null,
        personaType: persona.type ?? null,
        greetingName: persona.greetingName || null,
      });
      return;
    }

    // =====================================================================
    // HEALTH / ELDERLY
    // =====================================================================

    if (path === "/api/health/medications" && req.method === "GET") {
      const days = parseInt(url.searchParams.get("days") ?? "7");
      respond(res, 200, { log: getMedicationLog(days), compliance: getComplianceRate(days) });
      return;
    }

    if (path === "/api/health/repetitions" && req.method === "GET") {
      const days = parseInt(url.searchParams.get("days") ?? "7");
      respond(res, 200, getRepetitionStats(days));
      return;
    }

    // Story 25.1 (AC #9): Wellness summary for designated caregiver — read-only
    if (path.startsWith("/api/v1/wellness/") && path.endsWith("/summary") && req.method === "GET") {
      const personaId = path.split("/")[4];
      const days = parseInt(url.searchParams.get("days") ?? "7");
      if (!personaId) {
        respond(res, 400, { error: "Missing personaId" });
        return;
      }
      try {
        const summary = getWellnessSummary(personaId, days);
        respond(res, 200, summary);
      } catch (err) {
        respond(res, 500, { error: "Unable to fetch wellness summary" });
      }
      return;
    }

    // Story 25.2 (AC #10): Emotional history endpoint
    // GET /v1/wellness/:personaId/emotional-history?period=7d|30d
    // Returns: scores by day, check-in count, exercise count, prosody mismatch rate
    // NEVER exposes raw text responses (AC #10 privacy)
    if (path.startsWith("/api/v1/wellness/") && path.endsWith("/emotional-history") && req.method === "GET") {
      const personaId = path.split("/")[4];
      const periodParam = url.searchParams.get("period") ?? "7d";
      const days = periodParam === "30d" ? 30 : 7;
      if (!personaId) {
        respond(res, 400, { error: "Missing personaId" });
        return;
      }
      try {
        const history = getEmotionalHistory(personaId, days);
        respond(res, 200, history);
      } catch (err) {
        respond(res, 500, { error: "Unable to fetch emotional history" });
      }
      return;
    }

    // =====================================================================
    // ROUTINES / SHOPPING / RADIO
    // =====================================================================

    if (path === "/api/routines" && req.method === "GET") {
      respond(res, 200, { routines: getRoutinesForDashboard() });
      return;
    }

    // =====================================================================
    // Story 16.2 / FR96: Conversational Routines REST API (/v1/routines)
    // =====================================================================

    if (path === "/v1/routines" && req.method === "GET") {
      try {
        const { getRoutinesForSpeaker } = await import("../tools/routine-manager.js");
        const speakerId = (req.headers["x-speaker-id"] as string) || "dashboard";
        const routines = getRoutinesForSpeaker(speakerId);
        respond(res, 200, { success: true, data: routines });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "ROUTINE_LIST_ERROR", correlationId: `dash-${Date.now()}` });
      }
      return;
    }

    if (path.startsWith("/v1/routines/") && req.method === "GET" && !path.includes("/execute") && !path.includes("/skip") && !path.includes("/toggle")) {
      try {
        const routineId = parseInt(path.split("/")[3], 10);
        const { getRoutineById } = await import("../tools/routine-manager.js");
        const routine = getRoutineById(routineId);
        if (!routine) {
          respond(res, 404, { success: false, error: "Routine not found", code: "ROUTINE_NOT_FOUND", correlationId: `dash-${Date.now()}` });
        } else {
          respond(res, 200, { success: true, data: routine });
        }
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "ROUTINE_GET_ERROR", correlationId: `dash-${Date.now()}` });
      }
      return;
    }

    if (path === "/v1/routines" && req.method === "POST") {
      try {
        const body = JSON.parse(await readBody(req));
        const { createRoutine: createConvRoutine } = await import("../tools/routine-manager.js");
        const { refreshIndex } = await import("../tools/routine-trigger-resolver.js");
        const speakerId = (req.headers["x-speaker-id"] as string) || "dashboard";
        const routine = createConvRoutine({
          name: body.name,
          displayName: body.displayName,
          triggerType: body.triggerType,
          triggerConfig: body.triggerConfig,
          actions: body.actions,
          createdBy: speakerId,
          scope: body.scope,
        });
        if (routine.triggerType === "vocal") refreshIndex();
        respond(res, 201, { success: true, data: routine });
      } catch (err) {
        respond(res, 400, { success: false, error: String(err), code: "ROUTINE_CREATE_ERROR", correlationId: `dash-${Date.now()}` });
      }
      return;
    }

    if (path.startsWith("/v1/routines/") && req.method === "PATCH") {
      try {
        const routineId = parseInt(path.split("/")[3], 10);
        const body = JSON.parse(await readBody(req));
        const { updateRoutine: updateConvRoutine } = await import("../tools/routine-manager.js");
        const { isAdmin } = await import("../household/foyer-manager.js");
        const speakerId = (req.headers["x-speaker-id"] as string) || "dashboard";
        const routine = updateConvRoutine(routineId, body, speakerId, isAdmin(speakerId));
        respond(res, 200, { success: true, data: routine });
      } catch (err) {
        respond(res, 400, { success: false, error: String(err), code: "ROUTINE_UPDATE_ERROR", correlationId: `dash-${Date.now()}` });
      }
      return;
    }

    if (path.startsWith("/v1/routines/") && req.method === "DELETE" && path.split("/").length === 4) {
      try {
        const routineId = parseInt(path.split("/")[3], 10);
        const { deleteRoutine: deleteConvRoutine } = await import("../tools/routine-manager.js");
        const { isAdmin } = await import("../household/foyer-manager.js");
        const speakerId = (req.headers["x-speaker-id"] as string) || "dashboard";
        const deleted = deleteConvRoutine(routineId, speakerId, isAdmin(speakerId));
        if (deleted) {
          respond(res, 200, { success: true, data: { deleted: true } });
        } else {
          respond(res, 403, { success: false, error: "Permission denied or not found", code: "ROUTINE_DELETE_DENIED", correlationId: `dash-${Date.now()}` });
        }
      } catch (err) {
        respond(res, 400, { success: false, error: String(err), code: "ROUTINE_DELETE_ERROR", correlationId: `dash-${Date.now()}` });
      }
      return;
    }

    if (path.match(/^\/v1\/routines\/\d+\/execute$/) && req.method === "POST") {
      try {
        const routineId = parseInt(path.split("/")[3], 10);
        const { executeRoutine: execConvRoutine } = await import("../tools/routine-manager.js");
        const speakerId = (req.headers["x-speaker-id"] as string) || "dashboard";
        const corrId = `dash-exec-${Date.now()}`;
        const result = await execConvRoutine(routineId, speakerId, corrId);
        respond(res, 200, { success: true, data: result });
      } catch (err) {
        respond(res, 400, { success: false, error: String(err), code: "ROUTINE_EXEC_ERROR", correlationId: `dash-${Date.now()}` });
      }
      return;
    }

    if (path.match(/^\/v1\/routines\/\d+\/skip$/) && req.method === "POST") {
      try {
        const routineId = parseInt(path.split("/")[3], 10);
        const body = JSON.parse(await readBody(req));
        const { skipNextOccurrence } = await import("../tools/routine-manager.js");
        skipNextOccurrence(routineId, body.date);
        respond(res, 200, { success: true, data: { skipped: true } });
      } catch (err) {
        respond(res, 400, { success: false, error: String(err), code: "ROUTINE_SKIP_ERROR", correlationId: `dash-${Date.now()}` });
      }
      return;
    }

    if (path.match(/^\/v1\/routines\/\d+\/toggle$/) && req.method === "POST") {
      try {
        const routineId = parseInt(path.split("/")[3], 10);
        const { toggleRoutine } = await import("../tools/routine-manager.js");
        const { isAdmin } = await import("../household/foyer-manager.js");
        const speakerId = (req.headers["x-speaker-id"] as string) || "dashboard";
        const newState = toggleRoutine(routineId, speakerId, isAdmin(speakerId));
        respond(res, 200, { success: true, data: { isActive: newState } });
      } catch (err) {
        respond(res, 400, { success: false, error: String(err), code: "ROUTINE_TOGGLE_ERROR", correlationId: `dash-${Date.now()}` });
      }
      return;
    }

    if (path === "/api/shopping" && req.method === "GET") {
      respond(res, 200, { items: getListItems() });
      return;
    }

    if (path === "/api/radio" && req.method === "GET") {
      respond(res, 200, { playing: isPlaying(), station: getCurrentStation() });
      return;
    }

    // =====================================================================
    // SERVICE MANAGEMENT
    // =====================================================================

    if (path === "/api/services/action" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const service = body.service as string;
      const action = body.action as string;

      const allowedServices = ["diva-server", "diva-audio", "diva-memory", "intent-router", "diva-embedded", "paroli-tts", "rkllama", "diva-watchdog", "diva-firewall"];
      const allowedActions = ["start", "stop", "restart", "status"];

      if (!allowedServices.includes(service)) {
        respond(res, 400, { error: `Service not allowed: ${service}` });
        return;
      }
      if (!allowedActions.includes(action)) {
        respond(res, 400, { error: `Action not allowed: ${action}` });
        return;
      }

      try {
        const output = execSync(`systemctl ${action} ${service} 2>&1`, { timeout: 15000 }).toString().trim();
        const statusOutput = execSync(`systemctl is-active ${service} 2>&1 || true`, { timeout: 5000 }).toString().trim();
        respond(res, 200, { service, action, status: statusOutput, output });
      } catch (err: any) {
        const statusOutput = execSync(`systemctl is-active ${service} 2>&1 || true`, { timeout: 5000 }).toString().trim();
        respond(res, 200, { service, action, status: statusOutput, output: err.stderr?.toString() || err.message });
      }
      return;
    }

    if (path === "/api/services/list" && req.method === "GET") {
      const services = ["diva-server", "diva-audio", "diva-memory", "intent-router", "paroli-tts", "rkllama", "diva-watchdog"];
      const result: Record<string, { active: string; pid: string; memory: string; uptime: string }> = {};

      // Also check Docker containers
      try {
        const dockerPs = execSync("docker ps --format '{{.Names}}:{{.Status}}' 2>/dev/null || true", { timeout: 5000 }).toString().trim();
        for (const line of dockerPs.split("\n")) {
          if (!line) continue;
          const [name, status] = line.split(":");
          if (name) {
            result[`docker:${name}`] = {
              active: status?.includes("Up") ? "active" : "inactive",
              pid: "docker",
              memory: "-",
              uptime: status || "-",
            };
          }
        }
      } catch {}

      for (const svc of services) {
        try {
          const active = execSync(`systemctl is-active ${svc} 2>&1 || true`, { timeout: 3000 }).toString().trim();
          let pid = "-", memory = "-", uptime = "-";
          if (active === "active") {
            try {
              pid = execSync(`systemctl show ${svc} --property=MainPID --value 2>/dev/null`, { timeout: 3000 }).toString().trim();
              memory = execSync(`systemctl show ${svc} --property=MemoryCurrent --value 2>/dev/null`, { timeout: 3000 }).toString().trim();
              const ts = execSync(`systemctl show ${svc} --property=ActiveEnterTimestampMonotonic --value 2>/dev/null`, { timeout: 3000 }).toString().trim();
              const mono = execSync("cat /proc/uptime | awk '{print $1}'", { timeout: 3000 }).toString().trim();
              if (ts && mono) {
                const startSec = parseInt(ts) / 1000000;
                const nowSec = parseFloat(mono);
                const diffSec = nowSec - startSec;
                const mins = Math.floor(diffSec / 60);
                const hrs = Math.floor(mins / 60);
                uptime = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
              }
            } catch {}
          }
          result[svc] = { active, pid, memory, uptime };
        } catch {
          result[svc] = { active: "unknown", pid: "-", memory: "-", uptime: "-" };
        }
      }
      respond(res, 200, { services: result });
      return;
    }

    if (path === "/api/services/kill-all" && req.method === "POST") {
      try {
        execSync("systemctl stop diva-audio diva-memory intent-router paroli-tts rkllama 2>&1 || true", { timeout: 15000 });
        execSync("docker stop homeassistant mosquitto 2>&1 || true", { timeout: 15000 });
        execSync("pkill -9 arecord 2>&1 || true", { timeout: 3000 });
        execSync("pkill -f mpv 2>&1 || true", { timeout: 3000 });
        respond(res, 200, { status: "all services stopped (including Docker HA)" });
      } catch (err: any) {
        respond(res, 200, { status: "partial stop", error: err.message });
      }
      return;
    }

    if (path === "/api/services/start-all" && req.method === "POST") {
      try {
        execSync("systemctl start diva-audio diva-memory intent-router paroli-tts rkllama diva-watchdog 2>&1 || true", { timeout: 15000 });
        execSync("cd /opt/diva-embedded/docker && docker compose up -d 2>&1 || true", { timeout: 30000 });
        respond(res, 200, { status: "all services started (including Docker HA)" });
      } catch (err: any) {
        respond(res, 200, { status: "partial start", error: err.message });
      }
      return;
    }

    if (path === "/api/services/restart-all" && req.method === "POST") {
      try {
        // Stop all
        execSync("systemctl stop diva-audio diva-memory intent-router paroli-tts 2>&1 || true", { timeout: 15000 });
        execSync("pkill -9 arecord 2>&1 || true", { timeout: 3000 });
        // Restart Docker containers
        execSync("docker restart homeassistant mosquitto 2>&1 || true", { timeout: 30000 });
        // Start all
        execSync("systemctl start diva-audio diva-memory intent-router paroli-tts rkllama diva-watchdog 2>&1 || true", { timeout: 15000 });
        // Restart diva-server last (it's the one running this code)
        execSync("systemctl restart diva-server 2>&1 || true", { timeout: 10000 });
        respond(res, 200, { status: "all services restarted" });
      } catch (err: any) {
        respond(res, 200, { status: "partial restart", error: err.message });
      }
      return;
    }

    // =====================================================================
    // TUNING — Audio / Wake Word / VAD
    // =====================================================================

    if (path === "/api/tuning/audio" && req.method === "GET") {
      try {
        const r = await fetch("http://localhost:9010/tuning", { signal: AbortSignal.timeout(3000) });
        respond(res, 200, await r.json());
      } catch {
        respond(res, 500, { error: "Audio server unreachable" });
      }
      return;
    }

    if (path === "/api/tuning/audio" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const r = await fetch("http://localhost:9010/tuning", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(3000),
        });
        respond(res, 200, await r.json());
      } catch {
        respond(res, 500, { error: "Audio server unreachable" });
      }
      return;
    }

    // =====================================================================
    // TUNING — Speaker ID
    // =====================================================================

    if (path === "/api/tuning/speaker" && req.method === "GET") {
      try {
        const r = await fetch("http://localhost:9002/speaker/tuning", { signal: AbortSignal.timeout(3000) });
        respond(res, 200, await r.json());
      } catch {
        respond(res, 500, { error: "Memory service unreachable" });
      }
      return;
    }

    if (path === "/api/tuning/speaker" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const r = await fetch("http://localhost:9002/speaker/tuning", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(3000),
        });
        respond(res, 200, await r.json());
      } catch {
        respond(res, 500, { error: "Memory service unreachable" });
      }
      return;
    }

    if (path === "/api/speakers" && req.method === "GET") {
      try {
        const r = await fetch("http://localhost:9002/speaker/list", { signal: AbortSignal.timeout(3000) });
        respond(res, 200, await r.json());
      } catch {
        respond(res, 500, { error: "Memory service unreachable" });
      }
      return;
    }

    if (path === "/api/speakers/delete" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        const name = parsed.name || "";
        const r = await fetch("http://localhost:9002/speaker/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(3000),
        });
        if (name) deletePersona(name);
        respond(res, r.status, await r.json());
      } catch {
        respond(res, 500, { error: "Memory service unreachable" });
      }
      return;
    }

    // =====================================================================
    // LIVE LOGS — SSE stream + journalctl
    // =====================================================================

    if (path === "/api/logs/stream" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write("data: {\"connected\":true}\n\n");

      const services = url.searchParams.get("services") || "diva-server,diva-audio,diva-memory,intent-router";
      const units = services.split(",").map((s: string) => `-u ${s.trim()}`).join(" ");

      const child = spawn("journalctl", [
        ...units.split(" "),
        "-f", "--no-pager", "-o", "json", "--since", "now",
      ], { shell: true });

      child.stdout.on("data", (chunk: Buffer) => {
        const lines = chunk.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            const msg = entry.MESSAGE || "";
            if (msg.includes("GET /health") || msg.includes("GET /tuning")) continue;
            const data = {
              ts: entry.__REALTIME_TIMESTAMP
                ? new Date(parseInt(entry.__REALTIME_TIMESTAMP) / 1000).toISOString()
                : new Date().toISOString(),
              unit: entry._SYSTEMD_UNIT || "unknown",
              msg,
              priority: entry.PRIORITY || "6",
            };
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          } catch {
            res.write(`data: ${JSON.stringify({ ts: new Date().toISOString(), unit: "raw", msg: line, priority: "6" })}\n\n`);
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        res.write(`data: ${JSON.stringify({ ts: new Date().toISOString(), unit: "stderr", msg: chunk.toString().trim(), priority: "3" })}\n\n`);
      });

      req.on("close", () => { child.kill("SIGTERM"); });
      return;
    }

    if (path === "/api/logs/journalctl" && req.method === "GET") {
      const services = url.searchParams.get("services") || "diva-server,diva-audio,diva-memory,intent-router";
      const lines = parseInt(url.searchParams.get("lines") || "100");
      const units = services.split(",").map((s: string) => `-u ${s.trim()}`).join(" ");

      try {
        const raw = execSync(
          `journalctl ${units} --no-pager -o json -n ${lines} 2>/dev/null || true`,
          { timeout: 5000, maxBuffer: 1024 * 1024 }
        ).toString();

        const entries = raw.split("\n").filter(Boolean).map((line: string) => {
          try {
            const entry = JSON.parse(line);
            const msg2 = entry.MESSAGE || "";
            if (msg2.includes("GET /health") || msg2.includes("GET /tuning")) return null;
            return {
              ts: entry.__REALTIME_TIMESTAMP
                ? new Date(parseInt(entry.__REALTIME_TIMESTAMP) / 1000).toISOString()
                : "",
              unit: (entry._SYSTEMD_UNIT || "").replace(".service", ""),
              msg: msg2,
              priority: entry.PRIORITY || "6",
            };
          } catch { return null; }
        }).filter(Boolean);

        respond(res, 200, { entries });
      } catch (err) {
        respond(res, 500, { error: String(err) });
      }
      return;
    }

    // =====================================================================
    // MEMORY
    // =====================================================================

    if (path === "/api/memory/users" && req.method === "GET") {
      try {
        const speakersRes = await fetch("http://localhost:9002/speaker/list", { signal: AbortSignal.timeout(3000) });
        const speakersData = (await speakersRes.json()) as { speakers?: Record<string, unknown> };
        const users = ["default", ...Object.keys(speakersData.speakers ?? {})];
        respond(res, 200, { users });
      } catch {
        respond(res, 200, { users: ["default"] });
      }
      return;
    }

    if (path === "/api/memory/list" && req.method === "GET") {
      const userId = url.searchParams.get("user_id") || "default";
      try {
        const r = await fetch("http://localhost:9002/memory/all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId }),
          signal: AbortSignal.timeout(5000),
        });
        const data = (await r.json()) as { memories?: Array<{ memory: string; id: string }> };
        respond(res, 200, { user_id: userId, memories: data.memories ?? [] });
      } catch (err) {
        respond(res, 200, { user_id: userId, memories: [], error: String(err) });
      }
      return;
    }

    if (path === "/api/memory/search" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      try {
        const r = await fetch("http://localhost:9002/memory/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: body.user_id || "default", query: body.query || "" }),
          signal: AbortSignal.timeout(5000),
        });
        respond(res, 200, await r.json());
      } catch (err) {
        respond(res, 200, { memories: [], error: String(err) });
      }
      return;
    }

    if (path === "/api/memory/delete" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      try {
        const r = await fetch("http://localhost:9002/memory/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memory_id: body.memory_id }),
          signal: AbortSignal.timeout(5000),
        });
        respond(res, 200, await r.json());
      } catch (err) {
        respond(res, 500, { error: String(err) });
      }
      return;
    }

    if (path === "/api/memory/add" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      try {
        const r = await fetch("http://localhost:9002/memory/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: body.user_id || "default", text: body.text }),
          signal: AbortSignal.timeout(10000),
        });
        respond(res, 200, await r.json());
      } catch (err) {
        respond(res, 500, { error: String(err) });
      }
      return;
    }

    // =====================================================================
    // MUSIC — Spotify OAuth + YouTube Music
    // =====================================================================

    if (path === "/api/music/spotify/status" && req.method === "GET") {
      const spotifyMod = await import("../music/spotify-player.js");
      respond(res, 200, { configured: spotifyMod.isConfigured(), authenticated: spotifyMod.isAuthenticated() });
      return;
    }

    if (path === "/api/music/spotify/config" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const spotifyMod = await import("../music/spotify-player.js");
      spotifyMod.saveConfig({
        client_id: body.client_id,
        client_secret: body.client_secret,
        redirect_uri: body.redirect_uri || `http://${req.headers.host}/api/music/spotify/callback`,
      });
      respond(res, 200, { status: "ok" });
      return;
    }

    if (path === "/api/music/spotify/authorize" && req.method === "GET") {
      const spotifyMod = await import("../music/spotify-player.js");
      const authUrl = spotifyMod.getAuthorizeUrl();
      if (!authUrl) {
        respond(res, 400, { error: "Spotify not configured" });
        return;
      }
      res.writeHead(302, { Location: authUrl });
      res.end();
      return;
    }

    if (path === "/api/music/spotify/callback" && req.method === "GET") {
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      if (error || !code) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><body><h2>Erreur Spotify</h2><p>${error || "Pas de code"}</p><p><a href="/">Retour</a></p></body></html>`);
        return;
      }
      const spotifyMod = await import("../music/spotify-player.js");
      const success = await spotifyMod.exchangeCode(code);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(success
        ? `<html><body><h2>Spotify connecte !</h2><p><a href="/">Retour au dashboard</a></p></body></html>`
        : `<html><body><h2>Erreur</h2><p><a href="/">Retour</a></p></body></html>`);
      return;
    }

    if (path === "/api/music/spotify/disconnect" && req.method === "POST") {
      const { unlinkSync } = await import("node:fs");
      try { unlinkSync("/opt/diva-embedded/data/music/spotify-tokens.json"); } catch {}
      respond(res, 200, { status: "disconnected" });
      return;
    }

    if (path === "/api/music/youtube/status" && req.method === "GET") {
      const ytMod = await import("../music/youtube-player.js");
      respond(res, 200, { hasCookies: ytMod.hasCookies() });
      return;
    }

    if (path === "/api/music/youtube/cookies" && req.method === "POST") {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      if (!parsed.cookies) {
        respond(res, 400, { error: "No cookies provided" });
        return;
      }
      await writeFile("/opt/diva-embedded/data/music/ytmusic-cookies.txt", parsed.cookies);
      respond(res, 200, { status: "ok" });
      return;
    }

    if (path === "/api/music/youtube/disconnect" && req.method === "POST") {
      const { unlinkSync } = await import("node:fs");
      try { unlinkSync("/opt/diva-embedded/data/music/ytmusic-cookies.txt"); } catch {}
      respond(res, 200, { status: "disconnected" });
      return;
    }

    if (path === "/api/music/status" && req.method === "GET") {
      const ytMod = await import("../music/youtube-player.js");
      const spotifyMod = await import("../music/spotify-player.js");
      const ytTrack = ytMod.getCurrentTrack();
      let spTrack = null;
      if (spotifyMod.isAuthenticated()) {
        try { spTrack = await spotifyMod.getCurrentlyPlaying(); } catch {}
      }
      respond(res, 200, {
        youtube: { playing: ytMod.isPlaying(), track: ytTrack },
        spotify: { authenticated: spotifyMod.isAuthenticated(), track: spTrack },
        radio: { playing: isPlaying(), station: getCurrentStation() },
      });
      return;
    }

    // =====================================================================
    // NETWORK — WiFi
    // =====================================================================

    if (path === "/api/network/wifi/status" && req.method === "GET") {
      try {
        const active = execSync("nmcli -t -f active,ssid,signal,security dev wifi list 2>/dev/null | head -20", { timeout: 10000 }).toString().trim();
        const connection = execSync("nmcli -t -f NAME,DEVICE con show --active 2>/dev/null | grep wl || true", { timeout: 5000 }).toString().trim();
        const ip = execSync("ip -4 addr show wlP2p33s0 2>/dev/null | grep inet | awk '{print $2}' || true", { timeout: 3000 }).toString().trim();

        let connectedSSID = "";
        if (connection) connectedSSID = connection.split(":")[0] || "";

        const networks = active.split("\n").filter(Boolean).map(line => {
          const parts = line.split(":");
          return { active: parts[0] === "yes", ssid: parts[1] || "", signal: parseInt(parts[2] || "0"), security: parts[3] || "" };
        }).filter(n => n.ssid);

        respond(res, 200, { connected: !!connectedSSID, ssid: connectedSSID, ip, networks });
      } catch (err) {
        respond(res, 500, { error: String(err) });
      }
      return;
    }

    if (path === "/api/network/wifi/connect" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const ssid = (body.ssid || "").replace(/[^a-zA-Z0-9_ \-\.]/g, "");
      const password = body.password || "";
      if (!ssid) { respond(res, 400, { error: "SSID required" }); return; }
      try {
        if (password) {
          execSync(`nmcli device wifi connect "${ssid}" password "${password.replace(/"/g, '\\"')}" 2>&1`, { timeout: 30000 });
        } else {
          execSync(`nmcli device wifi connect "${ssid}" 2>&1`, { timeout: 30000 });
        }
        const ip = execSync("ip -4 addr show wlP2p33s0 2>/dev/null | grep inet | awk '{print $2}' || true", { timeout: 3000 }).toString().trim();
        respond(res, 200, { status: "connected", ssid, ip });
      } catch (err: any) {
        respond(res, 400, { error: err.stderr?.toString() || err.message || String(err) });
      }
      return;
    }

    if (path === "/api/network/wifi/disconnect" && req.method === "POST") {
      try {
        execSync("nmcli device disconnect wlP2p33s0 2>&1 || true", { timeout: 10000 });
        respond(res, 200, { status: "disconnected" });
      } catch (err) {
        respond(res, 500, { error: String(err) });
      }
      return;
    }

    if (path === "/api/network/wifi/forget" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const ssid = (body.ssid || "").replace(/[^a-zA-Z0-9_ \-\.]/g, "");
      if (!ssid) { respond(res, 400, { error: "SSID required" }); return; }
      try {
        execSync(`nmcli connection delete "${ssid}" 2>&1 || true`, { timeout: 10000 });
        respond(res, 200, { status: "forgotten", ssid });
      } catch (err) {
        respond(res, 500, { error: String(err) });
      }
      return;
    }

    // =====================================================================
    // NETWORK — Bluetooth
    // =====================================================================

    if (path === "/api/network/bluetooth/status" && req.method === "GET") {
      try {
        const powered = execSync("bluetoothctl show 2>/dev/null | grep 'Powered:' | awk '{print $2}'", { timeout: 5000 }).toString().trim();
        const pairedRaw = execSync("bluetoothctl devices Paired 2>/dev/null || bluetoothctl paired-devices 2>/dev/null || true", { timeout: 5000 }).toString().trim();
        const connectedRaw = execSync("bluetoothctl devices Connected 2>/dev/null || true", { timeout: 5000 }).toString().trim();

        const paired = pairedRaw.split("\n").filter(Boolean).map(line => {
          const match = line.match(/Device\s+([0-9A-F:]+)\s+(.+)/i);
          if (!match) return null;
          return { mac: match[1], name: match[2] };
        }).filter(Boolean);

        const connectedMacs = new Set(connectedRaw.split("\n").filter(Boolean).map(line => {
          const match = line.match(/Device\s+([0-9A-F:]+)/i);
          return match ? match[1] : "";
        }).filter(Boolean));

        const devices = paired.map((d: any) => ({ ...d, connected: connectedMacs.has(d.mac) }));
        respond(res, 200, { powered: powered === "yes", devices });
      } catch (err) {
        respond(res, 500, { error: String(err) });
      }
      return;
    }

    if (path === "/api/network/bluetooth/scan" && req.method === "POST") {
      try {
        execSync("bluetoothctl --timeout 5 scan on 2>/dev/null || true", { timeout: 10000 });
        const raw = execSync("bluetoothctl devices 2>/dev/null || true", { timeout: 5000 }).toString().trim();
        const pairedRaw = execSync("bluetoothctl devices Paired 2>/dev/null || bluetoothctl paired-devices 2>/dev/null || true", { timeout: 5000 }).toString().trim();

        const pairedMacs = new Set(pairedRaw.split("\n").filter(Boolean).map(line => {
          const match = line.match(/Device\s+([0-9A-F:]+)/i);
          return match ? match[1] : "";
        }).filter(Boolean));

        const devices = raw.split("\n").filter(Boolean).map(line => {
          const match = line.match(/Device\s+([0-9A-F:]+)\s+(.+)/i);
          if (!match) return null;
          return { mac: match[1], name: match[2], paired: pairedMacs.has(match[1]) };
        }).filter(Boolean);

        respond(res, 200, { devices });
      } catch (err) {
        respond(res, 500, { error: String(err) });
      }
      return;
    }

    if (path === "/api/network/bluetooth/pair" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const mac = (body.mac || "").replace(/[^0-9A-Fa-f:]/g, "");
      if (!mac) { respond(res, 400, { error: "MAC address required" }); return; }
      try {
        execSync(`bluetoothctl pair ${mac} 2>&1 || true`, { timeout: 15000 });
        execSync(`bluetoothctl trust ${mac} 2>&1 || true`, { timeout: 5000 });
        execSync(`bluetoothctl connect ${mac} 2>&1 || true`, { timeout: 10000 });
        respond(res, 200, { status: "paired", mac });
      } catch (err: any) {
        respond(res, 400, { error: err.stderr?.toString() || err.message });
      }
      return;
    }

    if (path === "/api/network/bluetooth/connect" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const mac = (body.mac || "").replace(/[^0-9A-Fa-f:]/g, "");
      if (!mac) { respond(res, 400, { error: "MAC address required" }); return; }
      try {
        execSync(`bluetoothctl connect ${mac} 2>&1`, { timeout: 10000 });
        respond(res, 200, { status: "connected", mac });
      } catch (err: any) {
        respond(res, 400, { error: err.stderr?.toString() || err.message });
      }
      return;
    }

    if (path === "/api/network/bluetooth/disconnect" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const mac = (body.mac || "").replace(/[^0-9A-Fa-f:]/g, "");
      if (!mac) { respond(res, 400, { error: "MAC address required" }); return; }
      try {
        execSync(`bluetoothctl disconnect ${mac} 2>&1`, { timeout: 10000 });
        respond(res, 200, { status: "disconnected", mac });
      } catch (err) {
        respond(res, 500, { error: String(err) });
      }
      return;
    }

    if (path === "/api/network/bluetooth/remove" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const mac = (body.mac || "").replace(/[^0-9A-Fa-f:]/g, "");
      if (!mac) { respond(res, 400, { error: "MAC address required" }); return; }
      try {
        execSync(`bluetoothctl remove ${mac} 2>&1`, { timeout: 10000 });
        respond(res, 200, { status: "removed", mac });
      } catch (err) {
        respond(res, 500, { error: String(err) });
      }
      return;
    }

    // =====================================================================
    // NEW v2: ONNX Model Management
    // =====================================================================

    if (path === "/api/models/wakeword" && req.method === "GET") {
      const models = await listOnnxModels();
      respond(res, 200, { models });
      return;
    }

    if (path === "/api/models/wakeword" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const modelPath = body.path as string;

      // Security: only allow paths under /opt/diva-embedded/
      if (!modelPath || !modelPath.startsWith("/opt/diva-embedded/") || !modelPath.endsWith(".onnx")) {
        respond(res, 400, { error: "Invalid model path" });
        return;
      }
      if (!existsSync(modelPath)) {
        respond(res, 404, { error: "Model file not found" });
        return;
      }

      try {
        // Update the audio server's model path via its API
        const r = await fetch("http://localhost:9010/model/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model_path: modelPath }),
          signal: AbortSignal.timeout(10000),
        });

        if (r.ok) {
          respond(res, 200, { status: "switched", path: modelPath });
        } else {
          // Fallback: restart diva-audio with the new model
          // Update the WAKEWORD_MODEL_PATH in the audio server config
          respond(res, 200, {
            status: "restart_required",
            path: modelPath,
            message: "Audio server doesn't support hot-swap. Restarting diva-audio...",
          });
          // Restart diva-audio
          execSync("systemctl restart diva-audio 2>&1 || true", { timeout: 15000 });
        }
      } catch {
        respond(res, 500, { error: "Failed to switch model" });
      }
      return;
    }

    // Upload a new ONNX model
    if (path === "/api/models/wakeword/upload" && req.method === "POST") {
      const { fields, file } = await parseMultipart(req);
      if (!file || !file.name.endsWith(".onnx")) {
        respond(res, 400, { error: "Only .onnx files accepted" });
        return;
      }
      const dest = join(ASSETS_DIR, file.name);
      await writeFile(dest, file.data);
      respond(res, 200, { uploaded: file.name, path: dest, size: file.data.length });
      return;
    }

    // =====================================================================
    // NEW v2: Env Config
    // =====================================================================

    if (path === "/api/config/env" && req.method === "GET") {
      const config = await readEnvConfig();
      respond(res, 200, { config, editableKeys: SAFE_ENV_KEYS });
      return;
    }

    if (path === "/api/config/env" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const updated = await updateEnvConfig(body);
      respond(res, 200, { updated, note: "Restart diva-server for changes to take effect" });
      return;
    }

    // =====================================================================
    // NEW v2: Proactive Config
    // =====================================================================

    if (path === "/api/config/proactive" && req.method === "GET") {
      try {
        const content = await readFile(PROACTIVE_CONFIG_PATH, "utf-8");
        respond(res, 200, JSON.parse(content));
      } catch {
        respond(res, 200, { enabled: false, companionshipTimes: [], timeAnnouncementInterval: 120, dailySummaryTime: "21:00" });
      }
      return;
    }

    if (path === "/api/config/proactive" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      await writeFile(PROACTIVE_CONFIG_PATH, JSON.stringify(body, null, 2));
      respond(res, 200, { status: "saved", config: body });
      return;
    }

    // =====================================================================
    // Story 4.5 — Vocal Secret Management
    // =====================================================================

    if (path === "/api/vocal-secret/set" && req.method === "POST") {
      const { setSecret, normalizeSecret } = await import("../security/vocal-secret.js");
      const body = JSON.parse(await readBody(req));
      const { speakerId, secret, confirmSecret } = body;
      if (!speakerId || !secret || !confirmSecret) {
        respond(res, 400, { error: "Missing speakerId, secret, or confirmSecret" });
        return;
      }
      if (normalizeSecret(secret) !== normalizeSecret(confirmSecret)) {
        respond(res, 400, { error: "Secrets do not match" });
        return;
      }
      await setSecret(speakerId, secret);
      respond(res, 200, { success: true });
      return;
    }

    if (path === "/api/vocal-secret/change" && req.method === "POST") {
      const { changeSecret, normalizeSecret } = await import("../security/vocal-secret.js");
      const body = JSON.parse(await readBody(req));
      const { speakerId, oldSecret, newSecret, confirmNewSecret } = body;
      if (!speakerId || !oldSecret || !newSecret || !confirmNewSecret) {
        respond(res, 400, { error: "Missing required fields" });
        return;
      }
      if (normalizeSecret(newSecret) !== normalizeSecret(confirmNewSecret)) {
        respond(res, 400, { error: "New secrets do not match" });
        return;
      }
      const result = await changeSecret(speakerId, oldSecret, newSecret);
      if (!result.success) {
        respond(res, 403, { success: false, reason: result.reason });
        return;
      }
      respond(res, 200, { success: true });
      return;
    }

    if (path.startsWith("/api/vocal-secret/status/") && req.method === "GET") {
      const { hasSecret, isLocked } = await import("../security/vocal-secret.js");
      const targetSpeakerId = path.split("/api/vocal-secret/status/")[1];
      if (!targetSpeakerId) {
        respond(res, 400, { error: "Missing speakerId" });
        return;
      }
      const hasSecretResult = hasSecret(targetSpeakerId);
      const lockStatus = isLocked(targetSpeakerId);
      respond(res, 200, {
        hasSecret: hasSecretResult,
        isLocked: lockStatus.locked,
        ...(lockStatus.locked && lockStatus.remainingMs
          ? { lockedUntil: new Date(Date.now() + lockStatus.remainingMs).toISOString() }
          : {}),
      });
      return;
    }

    // =====================================================================
    // Story 16.1 — Home Modes REST API
    // =====================================================================

    // GET /v1/home-mode/active — current active mode
    if (path === "/v1/home-mode/active" && req.method === "GET") {
      const { getActiveMode } = await import("../smarthome/mode-manager.js");
      const active = getActiveMode();
      if (!active) {
        respond(res, 200, { success: true, data: null });
      } else {
        respond(res, 200, {
          success: true,
          data: {
            mode: active.name,
            displayName: active.displayName,
            activatedAt: active.updatedAt,
            activatedBy: active.createdBy || "system",
          },
        });
      }
      return;
    }

    // GET /v1/home-modes — list all modes with triggers
    if (path === "/v1/home-modes" && req.method === "GET") {
      const { getModes } = await import("../smarthome/mode-manager.js");
      const { getTriggersForMode } = await import("../smarthome/mode-trigger-resolver.js");
      const modes = getModes();
      const data = modes.map((m) => ({
        ...m,
        triggers: getTriggersForMode(m.id),
      }));
      respond(res, 200, { success: true, data });
      return;
    }

    // POST /v1/home-mode/activate — activate mode from dashboard
    if (path === "/v1/home-mode/activate" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const { modeId } = body;
      if (!modeId || typeof modeId !== "number") {
        respond(res, 400, { success: false, error: "modeId is required and must be a number", code: "INVALID_INPUT" });
        return;
      }
      const { activateMode } = await import("../smarthome/mode-manager.js");
      const { generateCorrelationId } = await import("../monitoring/correlation.js");
      try {
        const result = await activateMode(modeId, "dashboard", generateCorrelationId());
        respond(res, 200, { success: true, data: result });
      } catch (err) {
        respond(res, 404, { success: false, error: err instanceof Error ? err.message : String(err), code: "MODE_NOT_FOUND" });
      }
      return;
    }

    // POST /v1/home-modes — create custom mode from dashboard
    if (path === "/v1/home-modes" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const { name, displayName, actions, triggers } = body;
      if (!name || !displayName || !actions) {
        respond(res, 400, { success: false, error: "name, displayName, and actions are required", code: "INVALID_INPUT" });
        return;
      }
      const { createCustomMode } = await import("../smarthome/mode-manager.js");
      const { addTrigger } = await import("../smarthome/mode-trigger-resolver.js");
      try {
        const mode = createCustomMode(name, displayName, actions, "dashboard");
        if (triggers && Array.isArray(triggers)) {
          for (const phrase of triggers) {
            try { addTrigger(mode.id, phrase, false); } catch { /* skip duplicates */ }
          }
        }
        respond(res, 201, { success: true, data: mode });
      } catch (err) {
        respond(res, 400, { success: false, error: err instanceof Error ? err.message : String(err), code: "CREATE_FAILED" });
      }
      return;
    }

    // PATCH /v1/home-modes/:id — update mode
    if (path.match(/^\/v1\/home-modes\/\d+$/) && req.method === "PATCH") {
      const modeId = parseInt(path.split("/").pop()!);
      const body = JSON.parse(await readBody(req));
      const { getModeById, updateModeActions } = await import("../smarthome/mode-manager.js");
      const mode = getModeById(modeId);
      if (!mode) {
        respond(res, 404, { success: false, error: "Mode not found", code: "MODE_NOT_FOUND" });
        return;
      }
      if (body.actions) {
        updateModeActions(modeId, body.actions);
      }
      respond(res, 200, { success: true, data: getModeById(modeId) });
      return;
    }

    // DELETE /v1/home-modes/:id — delete custom mode
    if (path.match(/^\/v1\/home-modes\/\d+$/) && req.method === "DELETE") {
      const modeId = parseInt(path.split("/").pop()!);
      const { getModeById, deleteMode } = await import("../smarthome/mode-manager.js");
      const mode = getModeById(modeId);
      if (!mode) {
        respond(res, 404, { success: false, error: "Mode not found", code: "MODE_NOT_FOUND" });
        return;
      }
      if (mode.isBuiltin) {
        respond(res, 400, { success: false, error: "Les modes builtin ne peuvent pas etre supprimes", code: "BUILTIN_MODE" });
        return;
      }
      const deleted = deleteMode(modeId, "dashboard", true);
      if (deleted) {
        respond(res, 200, { success: true });
      } else {
        respond(res, 400, { success: false, error: "Failed to delete mode", code: "DELETE_FAILED" });
      }
      return;
    }

    // =====================================================================
    // Story 15.2 Task 4: Device assignment endpoints
    // =====================================================================

    // GET /v1/devices — list devices grouped by room
    if (path === "/v1/devices" && req.method === "GET") {
      const { getEntityMappings } = await import("../smarthome/ha-connector.js");
      const mappings = getEntityMappings();

      const byRoom: Record<string, Array<{ entityId: string; voiceName: string; domain: string; friendlyName?: string }>> = {};
      const unassigned: Array<{ entityId: string; voiceName: string; domain: string; friendlyName?: string }> = [];

      for (const m of mappings) {
        const entry = {
          entityId: m.entityId,
          voiceName: m.voiceName,
          domain: m.domain,
          friendlyName: (m as unknown as Record<string, unknown>).friendlyName as string | undefined,
        };
        const room = m.area;
        if (!room || room === "" || room === "non-assigne") {
          unassigned.push(entry);
        } else {
          if (!byRoom[room]) byRoom[room] = [];
          byRoom[room].push(entry);
        }
      }

      respond(res, 200, { success: true, data: { rooms: byRoom, unassigned } });
      return;
    }

    // PUT /v1/devices/:entityId/room — assign device to room
    if (path.match(/^\/v1\/devices\/[^/]+\/room$/) && req.method === "PUT") {
      const parts = path.split("/");
      const entityId = decodeURIComponent(parts[3]);
      const body = JSON.parse(await readBody(req));
      const room = body.room;

      if (!room || typeof room !== "string") {
        respond(res, 400, { success: false, error: "room is required", code: "INVALID_INPUT" });
        return;
      }

      try {
        const { assignDeviceToRoom } = await import("../smarthome/device-assigner.js");
        const { getCorrelationId } = await import("../monitoring/correlation.js");
        const result = assignDeviceToRoom(entityId, room, undefined, getCorrelationId(), "dashboard");
        respond(res, 200, { success: true, data: result });
      } catch (err) {
        const errObj = err as { code?: string; message?: string };
        respond(res, 400, { success: false, error: errObj.message || String(err), code: errObj.code || "ASSIGNMENT_ERROR" });
      }
      return;
    }

    // PUT /v1/devices/:entityId/name — rename device
    if (path.match(/^\/v1\/devices\/[^/]+\/name$/) && req.method === "PUT") {
      const parts = path.split("/");
      const entityId = decodeURIComponent(parts[3]);
      const body = JSON.parse(await readBody(req));
      const friendlyName = body.friendlyName;

      if (!friendlyName || typeof friendlyName !== "string") {
        respond(res, 400, { success: false, error: "friendlyName is required", code: "INVALID_INPUT" });
        return;
      }

      try {
        const { renameDevice } = await import("../smarthome/device-assigner.js");
        const { getCorrelationId } = await import("../monitoring/correlation.js");
        const result = renameDevice(entityId, friendlyName, getCorrelationId());
        respond(res, 200, { success: true, data: result });
      } catch (err) {
        const errObj = err as { code?: string; message?: string };
        respond(res, 400, { success: false, error: errObj.message || String(err), code: errObj.code || "RENAME_ERROR" });
      }
      return;
    }

    // =====================================================================
    // SMARTHOME DISCOVERY — Story 13.2 (Task 4)
    // =====================================================================

    // GET /api/smarthome/discovered — list discovered devices
    if (path === "/api/smarthome/discovered" && req.method === "GET") {
      const { HADiscovery } = await import("../smarthome/ha-discovery.js");
      const discovery = new HADiscovery();
      const result = await discovery.scanDevices("dashboard");
      const devices = result.devices.map(d => ({
        entityId: d.entityId,
        friendlyName: d.friendlyName,
        domain: d.domain,
        type: d.type,
        typeLabelFr: d.typeLabelFr,
        protocol: d.protocol,
        state: d.state,
        areaId: d.areaId,
        areaName: d.areaName,
        configured: d.configured,
      }));
      respond(res, 200, {
        devices,
        totalCount: result.totalCount,
        fromCache: result.fromCache,
        error: result.error,
      });
      return;
    }

    // GET /api/smarthome/rooms — list existing rooms
    if (path === "/api/smarthome/rooms" && req.method === "GET") {
      const { HADeviceConfigurator } = await import("../smarthome/ha-device-configurator.js");
      const configurator = new HADeviceConfigurator();
      const rooms = await configurator.getRooms("dashboard");
      respond(res, 200, { rooms });
      return;
    }

    // POST /api/smarthome/configure — name and assign a device
    if (path === "/api/smarthome/configure" && req.method === "POST") {
      const cfgBody = JSON.parse(await readBody(req));
      const { entity_id, room, friendly_name } = cfgBody;
      if (!entity_id || !room) {
        respond(res, 400, { success: false, error: "entity_id and room required" });
        return;
      }
      const { HADeviceConfigurator } = await import("../smarthome/ha-device-configurator.js");
      const configurator = new HADeviceConfigurator();
      const cfgResult = await configurator.configureDevice(
        entity_id, room, "light", friendly_name, undefined, "dashboard"
      );
      respond(res, cfgResult.success ? 200 : 500, cfgResult);
      return;
    }

    // POST /api/smarthome/rooms — create a new room
    if (path === "/api/smarthome/rooms" && req.method === "POST") {
      const roomBody = JSON.parse(await readBody(req));
      const { name: roomName } = roomBody;
      if (!roomName) {
        respond(res, 400, { success: false, error: "name required" });
        return;
      }
      const { HADeviceConfigurator } = await import("../smarthome/ha-device-configurator.js");
      const configurator = new HADeviceConfigurator();
      const areaId = await configurator.createRoom(roomName, "dashboard");
      if (areaId) {
        respond(res, 200, { success: true, areaId, name: roomName });
      } else {
        respond(res, 500, { success: false, error: "Failed to create room" });
      }
      return;
    }

    // POST /api/smarthome/scan — trigger a re-scan
    if (path === "/api/smarthome/scan" && req.method === "POST") {
      const { HADiscovery, clearCache } = await import("../smarthome/ha-discovery.js");
      clearCache();
      const discovery = new HADiscovery();
      const scanResult = await discovery.scanDevices("dashboard-rescan");
      const scanDevices = scanResult.devices.map(d => ({
        entityId: d.entityId,
        friendlyName: d.friendlyName,
        domain: d.domain,
        type: d.type,
        typeLabelFr: d.typeLabelFr,
        protocol: d.protocol,
        state: d.state,
        areaId: d.areaId,
        areaName: d.areaName,
        configured: d.configured,
      }));
      respond(res, 200, {
        devices: scanDevices,
        totalCount: scanResult.totalCount,
        fromCache: false,
        error: scanResult.error,
      });
      return;
    }

    // =====================================================================
    // Story 16.3 — Family Scenarios REST API
    // =====================================================================

    // GET /v1/family-scenarios — list all scenarios
    if (path === "/v1/family-scenarios" && req.method === "GET") {
      const { getScenarios, loadScenarios, ensureScenarioSchema } = await import("../smarthome/scenario-manager.js");
      ensureScenarioSchema();
      if (getScenarios().length === 0) loadScenarios();
      respond(res, 200, { success: true, data: getScenarios() });
      return;
    }

    // GET /v1/family-scenarios/log — activity log
    if (path.startsWith("/v1/family-scenarios/log") && req.method === "GET") {
      const { getScenarioLog } = await import("../smarthome/scenario-manager.js");
      const urlObj = new URL(req.url ?? "", "http://localhost");
      const limit = parseInt(urlObj.searchParams.get("limit") ?? "50");
      const scenarioIdParam = urlObj.searchParams.get("scenarioId");
      const scenarioId = scenarioIdParam ? parseInt(scenarioIdParam) : undefined;
      const entries = getScenarioLog({ limit, scenarioId });
      respond(res, 200, { success: true, data: entries });
      return;
    }

    // GET /v1/family-scenarios/:id
    if (/^\/v1\/family-scenarios\/(\d+)$/.test(path) && req.method === "GET") {
      const id = parseInt(path.split("/").pop() ?? "0");
      const { getScenarioById } = await import("../smarthome/scenario-manager.js");
      const scenario = getScenarioById(id);
      if (!scenario) {
        respond(res, 404, { success: false, error: "Scenario not found", code: "NOT_FOUND" });
      } else {
        respond(res, 200, { success: true, data: scenario });
      }
      return;
    }

    // POST /v1/family-scenarios — create custom scenario
    if (path === "/v1/family-scenarios" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const { createCustomScenario } = await import("../smarthome/scenario-manager.js");
      const speakerId = String(body.createdBy ?? "dashboard");
      try {
        const scenario = createCustomScenario({
          name: body.name,
          displayName: body.displayName,
          triggerType: body.triggerType,
          triggerConfig: body.triggerConfig ?? {},
          actions: body.actions ?? [],
          modeAction: body.modeAction,
          notifications: body.notifications,
          createdBy: speakerId,
        });
        respond(res, 201, { success: true, data: scenario });
      } catch (err) {
        respond(res, 400, { success: false, error: String(err), code: "CREATE_FAILED" });
      }
      return;
    }

    // PATCH /v1/family-scenarios/:id — update scenario
    if (/^\/v1\/family-scenarios\/(\d+)$/.test(path) && req.method === "PATCH") {
      const id = parseInt(path.split("/").pop() ?? "0");
      const body = JSON.parse(await readBody(req));
      const { updateScenario } = await import("../smarthome/scenario-manager.js");
      const speakerId = String(body.speakerId ?? "dashboard");
      const isAdmin = body.isAdmin === true;
      try {
        const scenario = updateScenario(id, body, speakerId, isAdmin);
        respond(res, 200, { success: true, data: scenario });
      } catch (err) {
        const errMsg = String(err);
        if (errMsg.includes("builtin") || errMsg.includes("Permission")) {
          respond(res, 403, { success: false, error: errMsg, code: "PERMISSION_DENIED" });
        } else {
          respond(res, 400, { success: false, error: errMsg, code: "UPDATE_FAILED" });
        }
      }
      return;
    }

    // DELETE /v1/family-scenarios/:id — delete custom scenario
    if (/^\/v1\/family-scenarios\/(\d+)$/.test(path) && req.method === "DELETE") {
      const id = parseInt(path.split("/").pop() ?? "0");
      const { deleteScenario, getScenarioById } = await import("../smarthome/scenario-manager.js");
      const scenario = getScenarioById(id);
      if (!scenario) {
        respond(res, 404, { success: false, error: "Scenario not found", code: "NOT_FOUND" });
        return;
      }
      if (scenario.isBuiltin) {
        respond(res, 403, { success: false, error: "Les scenarios builtin ne peuvent pas etre supprimes", code: "BUILTIN_SCENARIO" });
        return;
      }
      const ok = deleteScenario(id, "dashboard", true);
      respond(res, ok ? 200 : 400, { success: ok });
      return;
    }

    // POST /v1/family-scenarios/:id/execute — manual execute
    if (/^\/v1\/family-scenarios\/(\d+)\/execute$/.test(path) && req.method === "POST") {
      const id = parseInt(path.split("/")[3]);
      const { executeScenario } = await import("../smarthome/scenario-manager.js");
      const { newCorrelationId } = await import("../monitoring/correlation.js");
      const correlationId = newCorrelationId();
      try {
        const result = await executeScenario(id, "dashboard", "dashboard", correlationId);
        respond(res, 200, { success: true, data: { failures: result.failures, actionCount: result.actionResults.length } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "EXECUTE_FAILED", correlationId });
      }
      return;
    }

    // POST /v1/family-scenarios/:id/toggle — toggle active state
    if (/^\/v1\/family-scenarios\/(\d+)\/toggle$/.test(path) && req.method === "POST") {
      const id = parseInt(path.split("/")[3]);
      const { toggleScenario } = await import("../smarthome/scenario-manager.js");
      try {
        const scenario = toggleScenario(id);
        respond(res, 200, { success: true, data: scenario });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "TOGGLE_FAILED" });
      }
      return;
    }

    // =====================================================================
    // Story 16.4 — Advanced Scenes REST API
    // =====================================================================

    // GET /v1/advanced-scenes/running — running scenes (must be before :id)
    if (path === "/v1/advanced-scenes/running" && req.method === "GET") {
      const { getRunningScenes } = await import("../smarthome/scene-executor.js");
      respond(res, 200, { success: true, data: getRunningScenes() });
      return;
    }

    // GET /v1/advanced-scenes — list all scenes
    if (path === "/v1/advanced-scenes" && req.method === "GET") {
      const { getScenes, loadScenes: loadAdvancedScenes, ensureAdvancedSceneSchema } = await import("../smarthome/scene-manager.js");
      ensureAdvancedSceneSchema();
      if (getScenes().length === 0) loadAdvancedScenes();
      respond(res, 200, { success: true, data: getScenes() });
      return;
    }

    // GET /v1/advanced-scenes/:id
    if (/^\/v1\/advanced-scenes\/(\d+)$/.test(path) && req.method === "GET") {
      const id = parseInt(path.split("/").pop() ?? "0");
      const { getSceneById } = await import("../smarthome/scene-manager.js");
      const scene = getSceneById(id);
      if (!scene) {
        respond(res, 404, { success: false, error: "Scene not found", code: "NOT_FOUND" });
      } else {
        respond(res, 200, { success: true, data: scene });
      }
      return;
    }

    // POST /v1/advanced-scenes — create a scene
    if (path === "/v1/advanced-scenes" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const { createScene } = await import("../smarthome/scene-manager.js");
      try {
        const scene = createScene(
          body.name,
          body.displayName,
          body.steps ?? [],
          String(body.ownerId ?? "dashboard"),
        );
        respond(res, 201, { success: true, data: scene });
      } catch (err) {
        respond(res, 400, { success: false, error: String(err), code: "CREATE_FAILED" });
      }
      return;
    }

    // PATCH /v1/advanced-scenes/:id — update a scene
    if (/^\/v1\/advanced-scenes\/(\d+)$/.test(path) && req.method === "PATCH") {
      const id = parseInt(path.split("/").pop() ?? "0");
      const body = JSON.parse(await readBody(req));
      const { updateScene } = await import("../smarthome/scene-manager.js");
      try {
        const scene = updateScene(id, body);
        respond(res, 200, { success: true, data: scene });
      } catch (err) {
        respond(res, 400, { success: false, error: String(err), code: "UPDATE_FAILED" });
      }
      return;
    }

    // DELETE /v1/advanced-scenes/:id — delete a scene
    if (/^\/v1\/advanced-scenes\/(\d+)$/.test(path) && req.method === "DELETE") {
      const id = parseInt(path.split("/").pop() ?? "0");
      const { deleteScene } = await import("../smarthome/scene-manager.js");
      const ok = deleteScene(id, "dashboard", true);
      respond(res, ok ? 200 : 404, { success: ok });
      return;
    }

    // POST /v1/advanced-scenes/:id/execute — manually execute a scene
    if (/^\/v1\/advanced-scenes\/(\d+)\/execute$/.test(path) && req.method === "POST") {
      const id = parseInt(path.split("/")[3]);
      const { getSceneById } = await import("../smarthome/scene-manager.js");
      const { executeScene } = await import("../smarthome/scene-executor.js");
      const { newCorrelationId } = await import("../monitoring/correlation.js");
      const scene = getSceneById(id);
      if (!scene) {
        respond(res, 404, { success: false, error: "Scene not found", code: "NOT_FOUND" });
        return;
      }
      const correlationId = newCorrelationId();
      try {
        const result = await executeScene(scene, "dashboard", correlationId);
        respond(res, 200, { success: true, data: { cancelled: result.cancelled, anomalies: result.anomalies, stepCount: result.stepResults.length } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "EXECUTE_FAILED", correlationId });
      }
      return;
    }

    // POST /v1/advanced-scenes/:id/cancel — cancel a running scene
    if (/^\/v1\/advanced-scenes\/(\d+)\/cancel$/.test(path) && req.method === "POST") {
      const { cancelScene } = await import("../smarthome/scene-executor.js");
      const body = JSON.parse(await readBody(req).catch(() => "{}"));
      const result = cancelScene(body.correlationId);
      respond(res, result.cancelled ? 200 : 404, { success: result.cancelled, data: result });
      return;
    }

    // GET /v1/habit-patterns/:speakerId — habit patterns for a member
    if (/^\/v1\/habit-patterns\/([^/]+)$/.test(path) && req.method === "GET") {
      const speakerId = path.split("/").pop() ?? "";
      const { getHabitPatterns } = await import("../smarthome/habit-tracker.js");
      respond(res, 200, { success: true, data: getHabitPatterns(speakerId) });
      return;
    }

    // =====================================================================
    // Story 25.3: GET /v1/education/:personaId/progress — gamification dashboard (AC #6, Task 8)
    // Returns: level, XP, badges, subject breakdown, quiz history.
    // NEVER exposes conversation content (classification orange).
    // =====================================================================
    if (/^\/v1\/education\/([^/]+)\/progress$/.test(path) && req.method === "GET") {
      try {
        const personaId = path.split("/")[3];
        const periodParam = url.searchParams.get("period");
        const period: "7d" | "30d" = periodParam === "7d" ? "7d" : "30d";
        const data = gamificationEngine.getProgressForDashboard(personaId, period);
        respond(res, 200, { success: true, data });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // =====================================================================
    // Story 16.5: Scene Contextual Suggestions
    // =====================================================================

    // GET /api/domotique/scenes/suggestions
    if (path === "/api/domotique/scenes/suggestions" && req.method === "GET") {
      try {
        const activeMode = getActiveModeForScenes();
        const modeName = activeMode?.name ?? null;
        const result = getSceneSuggestions(modeName);
        respond(res, 200, { success: true, data: result });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "SUGGESTIONS_FAILED" });
      }
      return;
    }

    // POST /api/domotique/scenes — create scene
    if (path === "/api/domotique/scenes" && req.method === "POST") {
      try {
        const body = JSON.parse(await readBody(req));
        const { name, icon, actions, timeSlots } = body as {
          name: string;
          icon: string;
          actions: SceneAction[];
          timeSlots?: TimeSlot[];
        };
        const scene = createScene(name, icon || "star", actions, timeSlots ?? []);
        respond(res, 201, { success: true, data: scene });
      } catch (err) {
        const msg = String(err);
        if (msg.includes("empty") || msg.includes("30 characters") || msg.includes("at least one action")) {
          respond(res, 400, { success: false, error: msg, code: "VALIDATION_ERROR" });
        } else if (msg.includes("already exists")) {
          respond(res, 409, { success: false, error: msg, code: "DUPLICATE_NAME" });
        } else {
          respond(res, 500, { success: false, error: msg, code: "CREATE_FAILED" });
        }
      }
      return;
    }

    // PATCH /api/domotique/scenes/:id — update scene
    if (/^\/api\/domotique\/scenes\/\d+$/.test(path) && req.method === "PATCH") {
      try {
        const id = parseInt(path.split("/").pop()!);
        const body = JSON.parse(await readBody(req));
        const scene = updateScene(id, body);
        respond(res, 200, { success: true, data: scene });
      } catch (err) {
        const msg = String(err);
        if (msg.includes("not found")) {
          respond(res, 404, { success: false, error: msg, code: "NOT_FOUND" });
        } else {
          respond(res, 400, { success: false, error: msg, code: "UPDATE_FAILED" });
        }
      }
      return;
    }

    // DELETE /api/domotique/scenes/:id — delete scene
    if (/^\/api\/domotique\/scenes\/\d+$/.test(path) && req.method === "DELETE") {
      try {
        const id = parseInt(path.split("/").pop()!);
        const deleted = deleteScene(id);
        if (!deleted) {
          respond(res, 404, { success: false, error: "Scene not found", code: "NOT_FOUND" });
          return;
        }
        respond(res, 200, { success: true, data: { deleted: true } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "DELETE_FAILED" });
      }
      return;
    }

    // PUT /api/domotique/scenes/:id/favorite — toggle favorite
    if (/^\/api\/domotique\/scenes\/\d+\/favorite$/.test(path) && req.method === "PUT") {
      try {
        const id = parseInt(path.split("/")[4]);
        const result = toggleFavorite(id);
        respond(res, 200, { success: true, data: result });
      } catch (err) {
        const msg = String(err);
        if (msg.includes("not found")) {
          respond(res, 404, { success: false, error: msg, code: "NOT_FOUND" });
        } else {
          respond(res, 500, { success: false, error: msg, code: "FAVORITE_FAILED" });
        }
      }
      return;
    }

    // PATCH /api/domotique/scenes/favorites/reorder — reorder favorites
    if (path === "/api/domotique/scenes/favorites/reorder" && req.method === "PATCH") {
      try {
        const body = JSON.parse(await readBody(req));
        const { orderedIds } = body as { orderedIds: number[] };
        reorderFavorites(orderedIds);
        respond(res, 200, { success: true, data: { reordered: true } });
      } catch (err) {
        respond(res, 400, { success: false, error: String(err), code: "REORDER_FAILED" });
      }
      return;
    }

    // POST /api/domotique/scenes/:id/execute — execute scene
    if (/^\/api\/domotique\/scenes\/\d+\/execute$/.test(path) && req.method === "POST") {
      try {
        const id = parseInt(path.split("/")[4]);
        const correlationId = req.headers["x-correlation-id"] as string || `scene-${Date.now()}`;
        const personaId = url.searchParams.get("personaId") || "dashboard";
        const result = await executeScene(id, personaId, "dashboard", correlationId);
        respond(res, 200, { success: true, data: result });
      } catch (err) {
        const msg = String(err);
        if (msg.includes("not found")) {
          respond(res, 404, { success: false, error: msg, code: "NOT_FOUND" });
        } else {
          respond(res, 500, { success: false, error: msg, code: "EXECUTE_FAILED" });
        }
      }
      return;
    }

    // =====================================================================
    // Story 16.6: Weather Automation REST API (/v1/weather/*)
    // =====================================================================

    // GET /v1/weather/current — cached weather + forecasts
    if (path === "/v1/weather/current" && req.method === "GET") {
      const weather = getWeather();
      if (weather) {
        respond(res, 200, { success: true, data: weather });
      } else {
        respond(res, 200, { success: true, data: null });
      }
      return;
    }

    // GET /v1/weather/rules — list rules with state and thresholds
    if (path === "/v1/weather/rules" && req.method === "GET") {
      try {
        const rules = loadRuleConfigs();
        respond(res, 200, { success: true, data: rules });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "RULES_LOAD_FAILED", correlationId: "" });
      }
      return;
    }

    // PATCH /v1/weather/rules/:ruleName — toggle or update rule
    if (path.match(/^\/v1\/weather\/rules\/[^/]+$/) && req.method === "PATCH") {
      try {
        const ruleName = decodeURIComponent(path.split("/")[4]);
        const body = JSON.parse(await readBody(req));
        const { getCompanionDb } = await import("../security/database-manager.js");
        const db = getCompanionDb();

        const sets: string[] = [];
        const vals: unknown[] = [];
        if (body.isEnabled !== undefined) {
          sets.push("is_enabled = ?");
          vals.push(body.isEnabled ? 1 : 0);
        }
        if (body.thresholdOverrides !== undefined) {
          sets.push("threshold_overrides = ?");
          vals.push(JSON.stringify(body.thresholdOverrides));
        }
        if (sets.length > 0) {
          sets.push("updated_at = datetime('now')");
          vals.push(ruleName);
          db.prepare(`UPDATE weather_rules_config SET ${sets.join(", ")} WHERE rule_name = ?`).run(...vals);
        }
        respond(res, 200, { success: true, data: { ruleName, ...body } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "RULE_UPDATE_FAILED", correlationId: "" });
      }
      return;
    }

    // GET /v1/weather/devices — list weather-reactive devices
    if (path === "/v1/weather/devices" && req.method === "GET") {
      const devices = getAllDevices();
      respond(res, 200, { success: true, data: devices });
      return;
    }

    // POST /v1/weather/devices — add a weather-reactive device
    if (path === "/v1/weather/devices" && req.method === "POST") {
      try {
        const body = JSON.parse(await readBody(req));
        const config = addDevice(body.entityId, body.deviceType, body.orientation, body.roomName);
        respond(res, 201, { success: true, data: config });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "DEVICE_ADD_FAILED", correlationId: "" });
      }
      return;
    }

    // PATCH /v1/weather/devices/:entityId — update device config
    if (path.match(/^\/v1\/weather\/devices\/[^/]+$/) && req.method === "PATCH") {
      try {
        const entityId = decodeURIComponent(path.split("/")[4]);
        const body = JSON.parse(await readBody(req));
        updateDevice(entityId, {
          orientation: body.orientation,
          roomName: body.roomName,
          weatherReactive: body.weatherReactive,
        });
        respond(res, 200, { success: true, data: { entityId, ...body } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "DEVICE_UPDATE_FAILED", correlationId: "" });
      }
      return;
    }

    // GET /v1/weather/actions-log — paginated history
    if (path === "/v1/weather/actions-log" && req.method === "GET") {
      try {
        const page = parseInt(url.searchParams.get("page") ?? "1");
        const limit = parseInt(url.searchParams.get("limit") ?? "50");
        const offset = (page - 1) * limit;
        const { getCompanionDb } = await import("../security/database-manager.js");
        const db = getCompanionDb();
        const rows = db.prepare("SELECT * FROM weather_actions_log ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
        const countRow = db.prepare("SELECT COUNT(*) as total FROM weather_actions_log").get() as { total: number };
        respond(res, 200, { success: true, data: { items: rows, total: countRow.total, page, limit } });
      } catch (err) {
        respond(res, 200, { success: true, data: { items: [], total: 0, page: 1, limit: 50 } });
      }
      return;
    }

    // GET /v1/weather/seasonal-profile/active — active seasonal profile
    if (path === "/v1/weather/seasonal-profile/active" && req.method === "GET") {
      const profile = getActiveSeasonalProfile();
      respond(res, 200, { success: true, data: profile });
      return;
    }

    // =====================================================================
    // Story 25.5: Interaction Limits & Usage API (/v1/interaction/*)
    // =====================================================================

    // GET /v1/interaction/:personaId/usage?period=7d|30d
    if (path.match(/^\/v1\/interaction\/[^/]+\/usage$/) && req.method === "GET") {
      try {
        const personaId = path.split("/")[3];
        const period = url.searchParams.get("period") || "7d";
        const days = period === "30d" ? 30 : 7;
        const { getInteractionLimiter } = await import("../companion/interaction-limiter.js");
        const { getInactivityMonitor } = await import("../companion/inactivity-monitor.js");
        const limiter = getInteractionLimiter();
        const monitor = getInactivityMonitor();
        const metrics = limiter.getDailyMetrics(personaId, days);
        const limit = limiter.getActiveLimit(personaId);
        const inactivityAlerts = monitor.getInactivityAlertsSent(personaId, days);
        respond(res, 200, {
          success: true,
          data: {
            personaId,
            period,
            dailyUsageMinutes: metrics.dailyUsageMinutes,
            dailyInteractionCount: metrics.dailyInteractionCount,
            bypassAttemptsCount: metrics.bypassAttemptsCount,
            extensionsCount: metrics.extensionsCount,
            limitReachedCount: metrics.limitReachedCount,
            inactivityAlertsSent: inactivityAlerts,
            limitConfigured: limit ? limit.dailyLimitMinutes : null,
            history: metrics.history.map((h) => ({
              date: h.date,
              usageMinutes: Math.round(h.totalSeconds / 60),
              interactions: h.interactionCount,
              bypassAttempts: h.bypassAttempts,
              extensions: h.extensionCount,
              limitReached: h.limitReached,
            })),
          },
        });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // GET /v1/interaction/:personaId/limits
    if (path.match(/^\/v1\/interaction\/[^/]+\/limits$/) && req.method === "GET") {
      try {
        const personaId = path.split("/")[3];
        const { getInteractionLimiter } = await import("../companion/interaction-limiter.js");
        const limiter = getInteractionLimiter();
        const limit = limiter.getActiveLimit(personaId);
        respond(res, 200, {
          success: true,
          data: limit
            ? {
                dailyLimitMinutes: limit.dailyLimitMinutes,
                inactivityThresholdHours: limit.inactivityThresholdHours,
                alertContactPersonaId: limit.alertContactPersonaId,
                isSelfSet: limit.isSelfSet,
                active: limit.active,
              }
            : null,
        });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // PUT /v1/interaction/:personaId/limits
    if (path.match(/^\/v1\/interaction\/[^/]+\/limits$/) && req.method === "PUT") {
      try {
        const personaId = path.split("/")[3];
        const body = JSON.parse(await readBody(req));
        const { getInteractionLimiter } = await import("../companion/interaction-limiter.js");
        const { getInactivityMonitor } = await import("../companion/inactivity-monitor.js");
        const limiter = getInteractionLimiter();
        const monitor = getInactivityMonitor();

        if (body.dailyLimitMinutes !== undefined) {
          const createdBy = body.createdBy || "dashboard";
          const isSelfSet = body.isSelfSet ?? false;
          if (body.dailyLimitMinutes === null) {
            limiter.removeLimit(personaId, createdBy);
          } else {
            limiter.setLimit(personaId, body.dailyLimitMinutes, createdBy, isSelfSet);
          }
        }

        if (body.inactivityThresholdHours !== undefined) {
          monitor.configureInactivityAlert(
            personaId,
            body.inactivityThresholdHours,
            body.alertContactPersonaId || null,
          );
        }

        respond(res, 200, { success: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        respond(res, 400, { success: false, error: msg });
      }
      return;
    }

    // =====================================================================
    // Story 17.1: Parental Controls API (/v1/parental-controls/*)
    // =====================================================================

    // GET /v1/parental-controls/:speakerId — permissions & restrictions
    if (path.match(/^\/v1\/parental-controls\/[^/]+$/) && !path.includes("/notifications") && !path.includes("/permissions") && !path.includes("/schedules") && req.method === "GET") {
      try {
        const speakerId = decodeURIComponent(path.split("/")[3]);
        const { getPermissions, getSchedules, getRoomAssignments } = await import("../smarthome/parental-control-manager.js");
        const permissions = getPermissions(speakerId);
        const schedules = getSchedules(speakerId);
        const roomAssignments = getRoomAssignments(speakerId);
        respond(res, 200, { success: true, data: { speakerId, permissions, schedules, roomAssignments } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "PARENTAL_FETCH_FAILED", correlationId: "" });
      }
      return;
    }

    // POST /v1/parental-controls/permissions — add permission
    if (path === "/v1/parental-controls/permissions" && req.method === "POST") {
      try {
        const body = JSON.parse(await readBody(req));
        const { speakerId, roomId, permissionType } = body;
        if (!speakerId || !roomId || !permissionType) {
          respond(res, 400, { success: false, error: "Missing speakerId, roomId, or permissionType", code: "INVALID_PARAMS", correlationId: "" });
          return;
        }
        const { grantPermission } = await import("../smarthome/parental-control-manager.js");
        grantPermission(speakerId, roomId, permissionType, body.grantedBy ?? "dashboard-admin");
        respond(res, 200, { success: true, data: { speakerId, roomId, permissionType } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "PERMISSION_GRANT_FAILED", correlationId: "" });
      }
      return;
    }

    // DELETE /v1/parental-controls/permissions/:id — revoke permission
    if (path.match(/^\/v1\/parental-controls\/permissions\/\d+$/) && req.method === "DELETE") {
      try {
        const permId = parseInt(path.split("/")[4]);
        const { revokePermissionById } = await import("../smarthome/parental-control-manager.js");
        revokePermissionById(permId);
        respond(res, 200, { success: true, data: { id: permId } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "PERMISSION_REVOKE_FAILED", correlationId: "" });
      }
      return;
    }

    // POST /v1/parental-controls/schedules — add schedule restriction
    if (path === "/v1/parental-controls/schedules" && req.method === "POST") {
      try {
        const body = JSON.parse(await readBody(req));
        const { speakerId, startTime, endTime, daysMask, restrictionType } = body;
        if (!speakerId || !startTime || !endTime || !restrictionType) {
          respond(res, 400, { success: false, error: "Missing required fields", code: "INVALID_PARAMS", correlationId: "" });
          return;
        }
        const { addSchedule } = await import("../smarthome/parental-control-manager.js");
        const schedule = addSchedule(speakerId, startTime, endTime, daysMask ?? 127, restrictionType, body.createdBy ?? "dashboard-admin");
        respond(res, 200, { success: true, data: schedule });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "SCHEDULE_ADD_FAILED", correlationId: "" });
      }
      return;
    }

    // DELETE /v1/parental-controls/schedules/:id — remove schedule
    if (path.match(/^\/v1\/parental-controls\/schedules\/\d+$/) && req.method === "DELETE") {
      try {
        const schedId = parseInt(path.split("/")[4]);
        const { removeSchedule } = await import("../smarthome/parental-control-manager.js");
        removeSchedule(schedId);
        respond(res, 200, { success: true, data: { id: schedId } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "SCHEDULE_REMOVE_FAILED", correlationId: "" });
      }
      return;
    }

    // GET /v1/parental-controls/notifications?adminId=X — pending notifications
    if (path === "/v1/parental-controls/notifications" && req.method === "GET") {
      try {
        const adminId = url.searchParams.get("adminId") ?? undefined;
        const { getPendingNotifications } = await import("../smarthome/parental-control-manager.js");
        const notifications = getPendingNotifications(adminId);
        respond(res, 200, { success: true, data: notifications });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "NOTIFICATIONS_FETCH_FAILED", correlationId: "" });
      }
      return;
    }

    // PATCH /v1/parental-controls/notifications/:id/read — mark as read
    if (path.match(/^\/v1\/parental-controls\/notifications\/\d+\/read$/) && req.method === "PATCH") {
      try {
        const notifId = parseInt(path.split("/")[4]);
        const { markNotificationRead } = await import("../smarthome/parental-control-manager.js");
        markNotificationRead(notifId);
        respond(res, 200, { success: true, data: { id: notifId } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "NOTIFICATION_READ_FAILED", correlationId: "" });
      }
      return;
    }

    // =====================================================================
    // RENTAL MODE — Story 19.1
    // =====================================================================

    if (path === "/v1/rental-mode" && req.method === "POST") {
      try {
        const body = JSON.parse(await readBody(req));
        const { activateRentalMode } = await import("../smarthome/rental-mode-manager.js");
        // TODO: admin-only check via auth header in production
        const session = activateRentalMode(
          body.activatedBy ?? "admin",
          body.startDate,
          body.endDate,
          body.welcomeMessage,
        );
        respond(res, 200, { success: true, data: session });
      } catch (err) {
        respond(res, 400, { success: false, error: String(err), code: "RENTAL_ACTIVATE_FAILED", correlationId: "" });
      }
      return;
    }

    if (path === "/v1/rental-mode" && req.method === "DELETE") {
      try {
        const { getActiveSession, deactivateRentalMode, getRentalSummary } = await import("../smarthome/rental-mode-manager.js");
        const session = getActiveSession();
        if (!session) {
          respond(res, 404, { success: false, error: "No active rental session", code: "NO_ACTIVE_SESSION", correlationId: "" });
          return;
        }
        const summary = getRentalSummary(session.id);
        deactivateRentalMode(session.id);
        respond(res, 200, { success: true, data: { cancelled: true, summary } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "RENTAL_DEACTIVATE_FAILED", correlationId: "" });
      }
      return;
    }

    if (path === "/v1/rental-mode" && req.method === "GET") {
      try {
        const { getActiveSession, isRentalModeActive, getEntityPermissions } = await import("../smarthome/rental-mode-manager.js");
        const active = isRentalModeActive();
        const session = getActiveSession();
        const entities = session ? getEntityPermissions(session.id) : [];
        respond(res, 200, { success: true, data: { active, session, entities } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "RENTAL_STATUS_FAILED", correlationId: "" });
      }
      return;
    }

    if (path === "/v1/rental-mode/entities" && req.method === "POST") {
      try {
        const body = JSON.parse(await readBody(req));
        const { getActiveSession, setEntityPermissions } = await import("../smarthome/rental-mode-manager.js");
        const session = getActiveSession();
        if (!session) {
          respond(res, 404, { success: false, error: "No active rental session", code: "NO_ACTIVE_SESSION", correlationId: "" });
          return;
        }
        setEntityPermissions(session.id, body.entities);
        respond(res, 200, { success: true, data: { sessionId: session.id, entityCount: body.entities.length } });
      } catch (err) {
        respond(res, 400, { success: false, error: String(err), code: "RENTAL_ENTITIES_FAILED", correlationId: "" });
      }
      return;
    }

    if (path === "/v1/rental-mode/temp-codes" && req.method === "POST") {
      try {
        const body = JSON.parse(await readBody(req));
        const { generateCode } = await import("../smarthome/temp-code-manager.js");
        const result = generateCode(
          body.generatedBy ?? "admin",
          body.label,
          body.scope,
          body.expiresAt,
          body.maxUses,
        );
        respond(res, 200, { success: true, data: result });
      } catch (err) {
        respond(res, 400, { success: false, error: String(err), code: "TEMP_CODE_GENERATE_FAILED", correlationId: "" });
      }
      return;
    }

    if (path === "/v1/rental-mode/temp-codes" && req.method === "GET") {
      try {
        const { getActiveCodes } = await import("../smarthome/temp-code-manager.js");
        const generatedBy = url.searchParams.get("generatedBy") ?? "admin";
        const codes = getActiveCodes(generatedBy);
        respond(res, 200, { success: true, data: codes });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "TEMP_CODE_LIST_FAILED", correlationId: "" });
      }
      return;
    }

    if (path.startsWith("/v1/rental-mode/temp-codes/") && req.method === "DELETE") {
      try {
        const codeId = parseInt(path.split("/").pop()!);
        const { revokeCode } = await import("../smarthome/temp-code-manager.js");
        revokeCode(codeId);
        respond(res, 200, { success: true, data: { revoked: codeId } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "TEMP_CODE_REVOKE_FAILED", correlationId: "" });
      }
      return;
    }

    if (path === "/v1/rental-mode/logs" && req.method === "GET") {
      try {
        const { getSessionLogs } = await import("../smarthome/rental-action-logger.js");
        const sessionId = parseInt(url.searchParams.get("sessionId") ?? "0");
        const actor = url.searchParams.get("actor") ?? undefined;
        const actionType = url.searchParams.get("type") ?? undefined;
        const logs = getSessionLogs(sessionId, {
          actor,
          actionType: actionType as any,
        });
        respond(res, 200, { success: true, data: logs });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "RENTAL_LOGS_FAILED", correlationId: "" });
      }
      return;
    }

    // =====================================================================
    // Story 14.1: Automations & Shortcuts REST API
    // =====================================================================

    // GET /v1/automations?speakerId=X — list automations (admin/member)
    if (path === "/v1/automations" && req.method === "GET") {
      try {
        const { getAutomations } = await import("../smarthome/automation-manager.js");
        const speakerId = url.searchParams.get("speakerId") ?? "";
        const isAdmin = url.searchParams.get("admin") === "true";
        const data = getAutomations(speakerId, isAdmin);
        respond(res, 200, { success: true, data });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // DELETE /v1/automations/:id — deactivate automation
    if (/^\/v1\/automations\/(\d+)$/.test(path) && req.method === "DELETE") {
      try {
        const { deleteAutomation } = await import("../smarthome/automation-manager.js");
        const id = parseInt(path.split("/").pop() ?? "0");
        const ok = deleteAutomation(id);
        respond(res, ok ? 200 : 404, { success: ok });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // PATCH /v1/automations/:id — update trust_level or is_active
    if (/^\/v1\/automations\/(\d+)$/.test(path) && req.method === "PATCH") {
      try {
        const { updateAutomation } = await import("../smarthome/automation-manager.js");
        const id = parseInt(path.split("/").pop() ?? "0");
        const body = JSON.parse(await readBody(req).catch(() => "{}"));
        const updates: { trustLevel?: "ask" | "autonomous"; isActive?: boolean } = {};
        if (body.trustLevel) updates.trustLevel = body.trustLevel;
        if (body.isActive !== undefined) updates.isActive = body.isActive;
        const result = updateAutomation(id, updates);
        respond(res, result ? 200 : 404, { success: !!result, data: result });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // GET /v1/shortcuts?speakerId=X — list voice shortcuts
    if (path === "/v1/shortcuts" && req.method === "GET") {
      try {
        const { getShortcuts, getAllShortcuts } = await import("../smarthome/shortcut-manager.js");
        const speakerId = url.searchParams.get("speakerId");
        const data = speakerId ? getShortcuts(speakerId) : getAllShortcuts();
        respond(res, 200, { success: true, data });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // DELETE /v1/shortcuts/:id — delete voice shortcut
    if (/^\/v1\/shortcuts\/(\d+)$/.test(path) && req.method === "DELETE") {
      try {
        const { deleteShortcut } = await import("../smarthome/shortcut-manager.js");
        const id = parseInt(path.split("/").pop() ?? "0");
        const ok = deleteShortcut(id);
        respond(res, ok ? 200 : 404, { success: ok });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // =====================================================================
    // Story 25.6: Longitudinal wellness — timeline and patterns (AC #6)
    // GET /v1/wellness/:personaId/timeline?days=30
    // GET /v1/wellness/:personaId/patterns
    // =====================================================================

    const timelineMatch = path.match(/^\/v1\/wellness\/([^/]+)\/timeline$/);
    if (timelineMatch && req.method === "GET") {
      try {
        const personaId = decodeURIComponent(timelineMatch[1]);
        const urlObj = new URL(path, `http://${req.headers.host || "localhost"}`);
        const days = parseInt(new URL(req.url || path, `http://${req.headers.host || "localhost"}`).searchParams.get("days") || "30");
        const pAnalyzer = new PatternAnalyzer();
        const summarizer = new WellnessSummarizer(pAnalyzer);
        const timeline = summarizer.generateDashboardTimeline(personaId, days);
        respond(res, 200, { success: true, data: timeline });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    const patternsMatch = path.match(/^\/v1\/wellness\/([^/]+)\/patterns$/);
    if (patternsMatch && req.method === "GET") {
      try {
        const personaId = decodeURIComponent(patternsMatch[1]);
        const pAnalyzer = new PatternAnalyzer();
        const alerts = pAnalyzer.getActiveAlerts(personaId);
        const correlations = pAnalyzer.getStoredCorrelations(personaId);
        respond(res, 200, { success: true, data: { alerts, correlations } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // =====================================================================
    // Story 14.2: Eco-coach energy endpoints
    // =====================================================================

    // GET /v1/energy/report?month=YYYY-MM
    if (path === "/v1/energy/report" && req.method === "GET") {
      try {
        const { getOrGenerateReport } = await import("../smarthome/eco-coach.js");
        const urlObj = new URL(req.url || path, `http://${req.headers.host || "localhost"}`);
        const month = urlObj.searchParams.get("month") ||
          `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
        const data = getOrGenerateReport(month);
        respond(res, 200, { success: true, data });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "ENERGY_REPORT_ERROR" });
      }
      return;
    }

    // GET /v1/energy/stats?entityId=X&from=YYYY-MM-DD&to=YYYY-MM-DD
    if (path === "/v1/energy/stats" && req.method === "GET") {
      try {
        const { getEnergyStats } = await import("../smarthome/eco-coach.js");
        const urlObj = new URL(req.url || path, `http://${req.headers.host || "localhost"}`);
        const entityId = urlObj.searchParams.get("entityId") || undefined;
        const from = urlObj.searchParams.get("from") || undefined;
        const to = urlObj.searchParams.get("to") || undefined;
        const data = getEnergyStats(entityId, from, to);
        respond(res, 200, { success: true, data });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "ENERGY_STATS_ERROR" });
      }
      return;
    }

    // GET /v1/energy/config
    if (path === "/v1/energy/config" && req.method === "GET") {
      try {
        const { getAllConfig } = await import("../smarthome/eco-coach.js");
        const data = getAllConfig();
        respond(res, 200, { success: true, data });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "ENERGY_CONFIG_ERROR" });
      }
      return;
    }

    // PATCH /v1/energy/config
    if (path === "/v1/energy/config" && req.method === "PATCH") {
      try {
        const body = await readBody(req);
        const { key, value, scope } = JSON.parse(body);
        if (!key || value === undefined) {
          respond(res, 400, { success: false, error: "Missing key or value", code: "INVALID_PARAMS" });
          return;
        }
        const { setConfig } = await import("../smarthome/eco-coach.js");
        setConfig(key, String(value), scope || "global");
        respond(res, 200, { success: true });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "ENERGY_CONFIG_UPDATE_ERROR" });
      }
      return;
    }

    // GET /v1/energy/alerts?speakerId=X&limit=50
    if (path === "/v1/energy/alerts" && req.method === "GET") {
      try {
        const { getAlertHistory } = await import("../smarthome/eco-coach.js");
        const urlObj = new URL(req.url || path, `http://${req.headers.host || "localhost"}`);
        const speakerId = urlObj.searchParams.get("speakerId") || undefined;
        const limit = parseInt(urlObj.searchParams.get("limit") || "50");
        const data = getAlertHistory(speakerId, limit);
        respond(res, 200, { success: true, data });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "ENERGY_ALERTS_ERROR" });
      }
      return;
    }

    // =====================================================================
    // Story 14.3: LED Pattern & Config endpoints (Task 6)
    // =====================================================================

    // GET /v1/led-patterns — list all configured patterns
    if (path === "/v1/led-patterns" && req.method === "GET") {
      try {
        const { getLedPatternEngine } = await import("../feedback/led-pattern-engine.js");
        const engine = getLedPatternEngine();
        const patterns = Object.fromEntries(engine.getPatterns());
        respond(res, 200, { success: true, data: patterns });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "LED_PATTERNS_ERROR" });
      }
      return;
    }

    // PATCH /v1/led-patterns/:name — modify a pattern's parameters
    if (/^\/v1\/led-patterns\/([a-z_-]+)$/.test(path) && req.method === "PATCH") {
      try {
        const { getLedPatternEngine } = await import("../feedback/led-pattern-engine.js");
        const name = path.split("/").pop() ?? "";
        const body = JSON.parse(await readBody(req));
        const engine = getLedPatternEngine();
        const ok = engine.updatePattern(name, body);
        respond(res, ok ? 200 : 404, { success: ok });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "LED_PATTERN_UPDATE_ERROR" });
      }
      return;
    }

    // GET /v1/led-config — global LED configuration
    if (path === "/v1/led-config" && req.method === "GET") {
      try {
        const { getLedPatternEngine } = await import("../feedback/led-pattern-engine.js");
        const engine = getLedPatternEngine();
        respond(res, 200, {
          success: true,
          data: {
            enabled: true,
            nightMode: engine.getNightModeConfig(),
            brightness: engine.getBrightness(),
          },
        });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "LED_CONFIG_ERROR" });
      }
      return;
    }

    // PATCH /v1/led-config — update global LED config
    if (path === "/v1/led-config" && req.method === "PATCH") {
      try {
        const { getLedPatternEngine } = await import("../feedback/led-pattern-engine.js");
        const body = JSON.parse(await readBody(req));
        const engine = getLedPatternEngine();
        if (body.nightMode) engine.setNightModeConfig(body.nightMode);
        if (body.brightness !== undefined) engine.setBrightness(body.brightness);
        respond(res, 200, { success: true });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "LED_CONFIG_UPDATE_ERROR" });
      }
      return;
    }

    // GET /v1/led-status — current LED state
    if (path === "/v1/led-status" && req.method === "GET") {
      try {
        const { getLedStateManager } = await import("../feedback/led-state-manager.js");
        const { getLedPatternEngine } = await import("../feedback/led-pattern-engine.js");
        const stateManager = getLedStateManager();
        const engine = getLedPatternEngine();
        respond(res, 200, {
          success: true,
          data: {
            currentState: stateManager.getCurrentState(),
            activePattern: engine.getCurrentPatternName(),
            brightness: engine.getBrightness(),
            nightModeActive: engine.isNightModeActive(),
            stateStack: stateManager.getStateStack(),
          },
        });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "LED_STATUS_ERROR" });
      }
      return;
    }

    // =====================================================================
    // Story 19.2 / Task 7: Fleet config endpoints
    // =====================================================================

    // POST /v1/fleet-config — configure fleet attachment (admin only)
    if (req.method === "POST" && path === "/v1/fleet-config") {
      try {
        const body = JSON.parse(await readBody(req));
        const { fleetUrl, deviceApiKey } = body;
        if (!fleetUrl || !deviceApiKey) {
          respond(res, 400, { success: false, error: "fleetUrl and deviceApiKey are required", code: "MISSING_FIELDS" });
          return;
        }
        const { getCompanionDb } = await import("../security/database-manager.js");
        const db = getCompanionDb();
        db.prepare(`
          INSERT INTO fleet_config (id, fleet_url, device_api_key, status, created_at, updated_at)
          VALUES (1, ?, ?, 'disconnected', datetime('now'), datetime('now'))
          ON CONFLICT(id) DO UPDATE SET fleet_url = ?, device_api_key = ?, status = 'disconnected', updated_at = datetime('now')
        `).run(fleetUrl, deviceApiKey, fleetUrl, deviceApiKey);
        respond(res, 200, { success: true, data: { fleetUrl, status: "disconnected" } });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "FLEET_CONFIG_ERROR" });
      }
      return;
    }

    // GET /v1/fleet-config — fleet connection status
    if (req.method === "GET" && path === "/v1/fleet-config") {
      try {
        const { getCompanionDb } = await import("../security/database-manager.js");
        const db = getCompanionDb();
        const row = db.prepare("SELECT fleet_url, residence_id, last_sync, status, created_at, updated_at FROM fleet_config WHERE id = 1").get() as Record<string, unknown> | undefined;
        if (!row) {
          respond(res, 200, { success: true, data: null });
        } else {
          respond(res, 200, {
            success: true,
            data: {
              fleetUrl: row.fleet_url,
              residenceId: row.residence_id,
              lastSync: row.last_sync,
              status: row.status,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            },
          });
        }
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "FLEET_CONFIG_ERROR" });
      }
      return;
    }

    // DELETE /v1/fleet-config — disconnect from fleet (admin only)
    if (req.method === "DELETE" && path === "/v1/fleet-config") {
      try {
        const { getCompanionDb } = await import("../security/database-manager.js");
        const db = getCompanionDb();
        db.prepare("DELETE FROM fleet_config WHERE id = 1").run();
        respond(res, 200, { success: true });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "FLEET_CONFIG_ERROR" });
      }
      return;
    }

    // =====================================================================
    // Story 19.3: Eco gamification REST endpoints
    // =====================================================================

    // GET /v1/eco-profile/{speakerId}
    if (req.method === "GET" && path.startsWith("/v1/eco-profile/")) {
      try {
        const { getEcoProfile } = await import("../companion/eco-gamification.js");
        const targetSpeakerId = path.replace("/v1/eco-profile/", "").split("?")[0];
        const profile = getEcoProfile(targetSpeakerId);
        respond(res, 200, { success: true, data: profile });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "ECO_PROFILE_ERROR" });
      }
      return;
    }

    // GET /v1/eco-badges
    if (req.method === "GET" && path === "/v1/eco-badges") {
      try {
        const { getAllBadges } = await import("../companion/eco-gamification.js");
        const badges = getAllBadges();
        respond(res, 200, { success: true, data: badges });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "ECO_BADGES_ERROR" });
      }
      return;
    }

    // POST /v1/eco-challenges
    if (req.method === "POST" && path === "/v1/eco-challenges") {
      try {
        const { createChallenge } = await import("../companion/eco-gamification.js");
        const body = await readBody(req);
        const data = JSON.parse(body);
        const challenge = createChallenge(
          data.createdBy || "admin",
          data.title,
          data.description,
          data.targetType,
          data.targetValue,
          data.unit || "",
          data.startDate,
          data.endDate,
          data.rewardDescription
        );
        respond(res, 201, { success: true, data: challenge });
      } catch (err) {
        respond(res, 400, { success: false, error: String(err), code: "ECO_CHALLENGE_CREATE_ERROR" });
      }
      return;
    }

    // GET /v1/eco-challenges
    if (req.method === "GET" && path.startsWith("/v1/eco-challenges") && !path.includes("/v1/eco-challenges/")) {
      try {
        const { getChallenges } = await import("../companion/eco-gamification.js");
        const urlObj = new URL(req.url || "/", "http://localhost");
        const statusParam = urlObj.searchParams.get("status");
        const statuses = statusParam ? statusParam.split(",") : undefined;
        const challenges = getChallenges(statuses);
        respond(res, 200, { success: true, data: challenges });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "ECO_CHALLENGES_ERROR" });
      }
      return;
    }

    // GET /v1/eco-challenges/{id}
    if (req.method === "GET" && /^\/v1\/eco-challenges\/\d+$/.test(path)) {
      try {
        const { getChallengeById } = await import("../companion/eco-gamification.js");
        const id = parseInt(path.split("/").pop()!);
        const challenge = getChallengeById(id);
        if (!challenge) {
          respond(res, 404, { success: false, error: "Challenge not found", code: "NOT_FOUND" });
        } else {
          respond(res, 200, { success: true, data: challenge });
        }
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "ECO_CHALLENGE_ERROR" });
      }
      return;
    }

    // DELETE /v1/eco-challenges/{id}
    if (req.method === "DELETE" && /^\/v1\/eco-challenges\/\d+$/.test(path)) {
      try {
        const { cancelChallenge } = await import("../companion/eco-gamification.js");
        const id = parseInt(path.split("/").pop()!);
        cancelChallenge(id);
        respond(res, 200, { success: true });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "ECO_CHALLENGE_CANCEL_ERROR" });
      }
      return;
    }

    // GET /v1/eco-leaderboard
    if (req.method === "GET" && path === "/v1/eco-leaderboard") {
      try {
        const { getLeaderboard } = await import("../companion/eco-gamification.js");
        const leaderboard = getLeaderboard();
        respond(res, 200, { success: true, data: leaderboard });
      } catch (err) {
        respond(res, 500, { success: false, error: String(err), code: "ECO_LEADERBOARD_ERROR" });
      }
      return;
    }

    // =====================================================================
    // Text Input — Remote testing console
    // =====================================================================
    if (path === "/api/text-input" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (!body?.text) { respond(res, 400, { error: "Champ 'text' requis" }); return; }
      try {
        const r = await fetch("http://localhost:3000/v1/text-input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: body.text, speaker: body.speaker ?? "georges" }),
          signal: AbortSignal.timeout(30000),
        });
        const result = await r.json();
        respond(res, r.status, result);
      } catch (err) {
        respond(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (path === "/console" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diva Console</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, system-ui, sans-serif; background: #0f0f0f; color: #e0e0e0; padding: 20px; }
  h1 { font-size: 1.4em; margin-bottom: 16px; color: #a78bfa; }
  #chat { max-width: 600px; margin: 0 auto; }
  #messages { min-height: 300px; max-height: 60vh; overflow-y: auto; border: 1px solid #333; border-radius: 12px; padding: 16px; margin-bottom: 12px; background: #1a1a1a; }
  .msg { margin: 8px 0; padding: 10px 14px; border-radius: 10px; max-width: 85%; }
  .msg.user { background: #3b3b5c; margin-left: auto; text-align: right; }
  .msg.diva { background: #1e3a2f; }
  .msg .label { font-size: 0.75em; color: #888; margin-bottom: 4px; }
  #input-row { display: flex; gap: 8px; }
  #text-input { flex: 1; padding: 12px; border-radius: 10px; border: 1px solid #444; background: #222; color: #e0e0e0; font-size: 1em; }
  #text-input:focus { outline: none; border-color: #a78bfa; }
  button { padding: 12px 20px; border-radius: 10px; border: none; background: #7c3aed; color: white; font-size: 1em; cursor: pointer; }
  button:hover { background: #6d28d9; }
  button:disabled { opacity: 0.5; cursor: wait; }
  .info { font-size: 0.8em; color: #666; margin-top: 8px; text-align: center; }
  select { padding: 8px; border-radius: 8px; border: 1px solid #444; background: #222; color: #e0e0e0; margin-bottom: 12px; }
</style></head><body>
<div id="chat">
  <h1>Diva Console</h1>
  <div>
    <select id="speaker">
      <option value="georges">Georges (admin)</option>
      <option value="warmstart_nicolas">Nicolas</option>
      <option value="unknown">Inconnu</option>
      <option value="guest">Invité</option>
    </select>
  </div>
  <div id="messages"></div>
  <div id="input-row">
    <input id="text-input" type="text" placeholder="Parle à Diva..." autofocus>
    <button id="send-btn" onclick="sendMsg()">Envoyer</button>
  </div>
  <div class="info">Bypass wake word + STT — envoie du texte directement au pipeline Diva</div>
</div>
<script>
const msgs = document.getElementById('messages');
const input = document.getElementById('text-input');
const btn = document.getElementById('send-btn');
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !btn.disabled) sendMsg(); });
async function sendMsg() {
  const text = input.value.trim();
  if (!text) return;
  const speaker = document.getElementById('speaker').value;
  addMsg('user', text, speaker);
  input.value = '';
  btn.disabled = true;
  try {
    const r = await fetch('/api/text-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speaker })
    });
    const d = await r.json();
    addMsg('diva', d.data?.response || d.error || JSON.stringify(d), 'Diva');
  } catch (e) {
    addMsg('diva', 'Erreur: ' + e.message, 'Diva');
  }
  btn.disabled = false;
  input.focus();
}
function addMsg(type, text, label) {
  const div = document.createElement('div');
  div.className = 'msg ' + type;
  div.innerHTML = '<div class="label">' + label + '</div>' + text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}
</script></body></html>`);
      return;
    }

    // =====================================================================
    // 404
    // =====================================================================
    respond(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("[DASHBOARD] Error:", err);
    respond(res, 500, { error: String(err) });
  }
}

function respond(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function startDashboard(): void {
  const server = createServer(handleRequest);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[DASHBOARD] Admin panel: http://0.0.0.0:${PORT}`);
  });
}
