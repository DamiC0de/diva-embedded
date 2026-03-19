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
import { listPersonas, createPersona, deletePersona, type PersonaType } from "../persona/engine.js";
import { getMedicationLog, getComplianceRate } from "../elderly/medication-manager.js";
import { getRepetitionStats } from "../elderly/repetition-tracker.js";
import { getRoutinesForDashboard } from "../tools/routines.js";
import { getListItems } from "../tools/shopping-list.js";
import { isPlaying, getCurrentStation } from "../tools/radio.js";

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
    "piper-tts": "http://localhost:8880/health",
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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

    // =====================================================================
    // ROUTINES / SHOPPING / RADIO
    // =====================================================================

    if (path === "/api/routines" && req.method === "GET") {
      respond(res, 200, { routines: getRoutinesForDashboard() });
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

      const allowedServices = ["diva-server", "diva-audio", "diva-memory", "intent-router", "diva-embedded"];
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
      const services = ["diva-server", "diva-audio", "diva-memory", "intent-router"];
      const result: Record<string, { active: string; pid: string; memory: string; uptime: string }> = {};

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
        execSync("systemctl stop diva-audio diva-memory intent-router 2>&1 || true", { timeout: 10000 });
        execSync("pkill -9 arecord 2>&1 || true", { timeout: 3000 });
        execSync("pkill -f mpv 2>&1 || true", { timeout: 3000 });
        respond(res, 200, { status: "all services stopped" });
      } catch (err: any) {
        respond(res, 200, { status: "partial stop", error: err.message });
      }
      return;
    }

    if (path === "/api/services/start-all" && req.method === "POST") {
      try {
        execSync("systemctl start diva-audio diva-memory intent-router 2>&1 || true", { timeout: 15000 });
        respond(res, 200, { status: "all services started" });
      } catch (err: any) {
        respond(res, 200, { status: "partial start", error: err.message });
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
