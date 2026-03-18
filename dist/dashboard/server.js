/**
 * Dashboard HTTP Server — Admin panel for Diva on port 3002
 *
 * Endpoints:
 * - GET  /                    → Dashboard HTML
 * - GET  /api/status          → Service health + system metrics
 * - GET  /api/metrics         → CPU/RAM/NPU/temp real-time
 * - GET  /api/logs            → Recent interaction logs
 * - GET  /api/timers          → Active timers
 * - GET  /api/sounds          → List configurable sounds
 * - POST /api/sounds/upload   → Upload custom sound
 * - GET  /api/dnd             → DND status
 * - POST /api/dnd             → Toggle DND
 */
import { createServer } from "node:http";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { listTimers } from "../tools/timer-manager.js";
import { getDNDStatus, enableDND, disableDND } from "../tools/dnd-manager.js";
import { listPersonas, createPersona, deletePersona } from "../persona/engine.js";
import { getMedicationLog, getComplianceRate } from "../elderly/medication-manager.js";
import { getRepetitionStats } from "../elderly/repetition-tracker.js";
import { getRoutinesForDashboard } from "../tools/routines.js";
import { getListItems } from "../tools/shopping-list.js";
import { isPlaying, getCurrentStation } from "../tools/radio.js";
const PORT = 3002;
const ASSETS_DIR = "/opt/diva-embedded/assets";
const DASHBOARD_HTML_PATH = "/opt/diva-embedded/src/dashboard/index.html";
const interactionLogs = [];
const MAX_LOGS = 200;
export function logInteraction(entry) {
    interactionLogs.push(entry);
    if (interactionLogs.length > MAX_LOGS) {
        interactionLogs.shift();
    }
}
// Configurable sounds mapping
const SOUND_SLOTS = {
    wakeword_ack: { description: "Wake word detected (confirmation)", defaultFile: "oui.wav" },
    idle_return: { description: "Return to idle / goodbye", defaultFile: "goodbye.wav" },
    timer_end: { description: "Timer expired", defaultFile: "bibop.wav" },
    thinking: { description: "Processing / thinking", defaultFile: "thinking.wav" },
};
// System metrics helpers
function getSystemMetrics() {
    try {
        const cpuTemp = execSync("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0", { timeout: 1000 }).toString().trim();
        const tempC = parseInt(cpuTemp) / 1000;
        const memInfo = execSync("free -m | awk 'NR==2{printf \"%s %s %s\", $2,$3,$7}'", { timeout: 1000 }).toString().trim().split(" ");
        const totalMB = parseInt(memInfo[0]);
        const usedMB = parseInt(memInfo[1]);
        const availMB = parseInt(memInfo[2]);
        const loadAvg = execSync("cat /proc/loadavg", { timeout: 1000 }).toString().trim().split(" ");
        const uptime = execSync("uptime -p", { timeout: 1000 }).toString().trim();
        // NPU usage (check if rkllama process exists)
        let npuActive = false;
        try {
            execSync("pgrep -f rkllama", { timeout: 1000 });
            npuActive = true;
        }
        catch { }
        // Disk usage
        const diskInfo = execSync("df -h / | awk 'NR==2{printf \"%s %s %s %s\", $2,$3,$4,$5}'", { timeout: 1000 }).toString().trim().split(" ");
        return {
            cpu: {
                tempC: Math.round(tempC * 10) / 10,
                load1m: parseFloat(loadAvg[0]),
                load5m: parseFloat(loadAvg[1]),
                load15m: parseFloat(loadAvg[2]),
            },
            memory: {
                totalMB,
                usedMB,
                availMB,
                usedPercent: Math.round((usedMB / totalMB) * 100),
            },
            npu: {
                active: npuActive,
            },
            disk: {
                total: diskInfo[0],
                used: diskInfo[1],
                avail: diskInfo[2],
                usedPercent: diskInfo[3],
            },
            uptime,
        };
    }
    catch (err) {
        return { error: String(err) };
    }
}
async function checkServiceHealth() {
    const services = {
        "diva-audio": "http://localhost:9010/health",
        "intent-router": "http://localhost:8882/health",
        "diva-memory": "http://localhost:9002/health",
        "stt-npu": "http://localhost:8881/health",
        "piper-tts": "http://localhost:8880/health",
        "qwen-npu": "http://localhost:8080/v1/models",
        "searxng": "http://localhost:8888/healthz",
        "embedding": "http://localhost:8883/health",
    };
    const results = {};
    await Promise.all(Object.entries(services).map(async ([name, url]) => {
        const t0 = Date.now();
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
            results[name] = {
                status: res.ok ? "ok" : `error:${res.status}`,
                latencyMs: Date.now() - t0,
            };
        }
        catch {
            results[name] = { status: "down", latencyMs: Date.now() - t0 };
        }
    }));
    return results;
}
async function listSounds() {
    const result = {};
    // List available wav files in assets
    let wavFiles = [];
    try {
        const files = await readdir(ASSETS_DIR);
        wavFiles = files.filter((f) => f.endsWith(".wav"));
    }
    catch { }
    for (const [slot, info] of Object.entries(SOUND_SLOTS)) {
        result[slot] = {
            slot,
            description: info.description,
            currentFile: info.defaultFile,
            files: wavFiles,
        };
    }
    return result;
}
// Parse multipart form data (simple implementation for file upload)
async function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const boundary = req.headers["content-type"]?.match(/boundary=(.+)/)?.[1];
        if (!boundary)
            return reject(new Error("No boundary"));
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            const body = Buffer.concat(chunks);
            const parts = body.toString("binary").split(`--${boundary}`);
            const fields = {};
            let file;
            for (const part of parts) {
                if (part.includes("filename=")) {
                    const nameMatch = part.match(/filename="(.+?)"/);
                    const headerEnd = part.indexOf("\r\n\r\n") + 4;
                    const dataEnd = part.lastIndexOf("\r\n");
                    if (nameMatch && headerEnd > 3 && dataEnd > headerEnd) {
                        file = {
                            name: nameMatch[1],
                            data: Buffer.from(part.slice(headerEnd, dataEnd), "binary"),
                        };
                    }
                }
                else if (part.includes("name=")) {
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
function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}
async function handleRequest(req, res) {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const path = url.pathname;
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
        // API endpoints
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
        if (path === "/api/logs" && req.method === "GET") {
            const limit = parseInt(url.searchParams.get("limit") ?? "50");
            respond(res, 200, { logs: interactionLogs.slice(-limit) });
            return;
        }
        if (path === "/api/timers" && req.method === "GET") {
            respond(res, 200, { timers: listTimers() });
            return;
        }
        if (path === "/api/sounds" && req.method === "GET") {
            const sounds = await listSounds();
            respond(res, 200, { sounds });
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
        if (path === "/api/dnd" && req.method === "GET") {
            respond(res, 200, getDNDStatus());
            return;
        }
        if (path === "/api/dnd" && req.method === "POST") {
            const body = JSON.parse(await readBody(req));
            if (body.enable) {
                enableDND((body.durationMin ?? 480) * 60 * 1000);
            }
            else {
                disableDND();
            }
            respond(res, 200, getDNDStatus());
            return;
        }
        // Personas
        if (path === "/api/personas" && req.method === "GET") {
            respond(res, 200, { personas: listPersonas() });
            return;
        }
        if (path === "/api/personas" && req.method === "POST") {
            const body = JSON.parse(await readBody(req));
            const profile = createPersona(body.id, body.name, body.type, body.greetingName);
            respond(res, 200, profile);
            return;
        }
        if (path.startsWith("/api/personas/") && req.method === "DELETE") {
            const id = path.split("/").pop() ?? "";
            respond(res, 200, { deleted: deletePersona(id) });
            return;
        }
        // Health / Elderly
        if (path === "/api/health/medications" && req.method === "GET") {
            const days = parseInt(url.searchParams.get("days") ?? "7");
            respond(res, 200, {
                log: getMedicationLog(days),
                compliance: getComplianceRate(days),
            });
            return;
        }
        if (path === "/api/health/repetitions" && req.method === "GET") {
            const days = parseInt(url.searchParams.get("days") ?? "7");
            respond(res, 200, getRepetitionStats(days));
            return;
        }
        // Routines
        if (path === "/api/routines" && req.method === "GET") {
            respond(res, 200, { routines: getRoutinesForDashboard() });
            return;
        }
        // Shopping list
        if (path === "/api/shopping" && req.method === "GET") {
            respond(res, 200, { items: getListItems() });
            return;
        }
        // Radio
        if (path === "/api/radio" && req.method === "GET") {
            respond(res, 200, { playing: isPlaying(), station: getCurrentStation() });
            return;
        }
        // Service management (start/stop/restart)
        if (path === "/api/services/action" && req.method === "POST") {
            const body = JSON.parse(await readBody(req));
            const service = body.service;
            const action = body.action;
            // Whitelist of allowed services
            const allowedServices = [
                "diva-server", "diva-audio", "diva-memory",
                "intent-router", "diva-embedded",
            ];
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
                // After action, get current status
                const statusOutput = execSync(`systemctl is-active ${service} 2>&1 || true`, { timeout: 5000 }).toString().trim();
                respond(res, 200, { service, action, status: statusOutput, output });
            }
            catch (err) {
                const statusOutput = execSync(`systemctl is-active ${service} 2>&1 || true`, { timeout: 5000 }).toString().trim();
                respond(res, 200, { service, action, status: statusOutput, output: err.stderr?.toString() || err.message });
            }
            return;
        }
        // List all diva services with detailed status
        if (path === "/api/services/list" && req.method === "GET") {
            const services = ["diva-server", "diva-audio", "diva-memory", "intent-router"];
            const result = {};
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
                                const startSec = parseInt(ts) / 1000000; // monotonic is in microseconds
                                const nowSec = parseFloat(mono);
                                const diffSec = nowSec - startSec;
                                const mins = Math.floor(diffSec / 60);
                                const hrs = Math.floor(mins / 60);
                                uptime = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
                            }
                        }
                        catch { }
                    }
                    result[svc] = { active, pid, memory, uptime };
                }
                catch {
                    result[svc] = { active: "unknown", pid: "-", memory: "-", uptime: "-" };
                }
            }
            respond(res, 200, { services: result });
            return;
        }
        // Kill all diva processes (emergency stop)
        if (path === "/api/services/kill-all" && req.method === "POST") {
            try {
                execSync("systemctl stop diva-audio diva-memory intent-router 2>&1 || true", { timeout: 10000 });
                execSync("pkill -9 arecord 2>&1 || true", { timeout: 3000 });
                execSync("pkill -f mpv 2>&1 || true", { timeout: 3000 });
                respond(res, 200, { status: "all services stopped" });
            }
            catch (err) {
                respond(res, 200, { status: "partial stop", error: err.message });
            }
            // Note: diva-server itself stays alive since it's serving this request
            // It will be stopped by systemd if the user also stops diva-server
            return;
        }
        // Start all diva services
        if (path === "/api/services/start-all" && req.method === "POST") {
            try {
                execSync("systemctl start diva-audio diva-memory intent-router 2>&1 || true", { timeout: 15000 });
                respond(res, 200, { status: "all services started" });
            }
            catch (err) {
                respond(res, 200, { status: "partial start", error: err.message });
            }
            return;
        }
        // 404
        respond(res, 404, { error: "Not found" });
    }
    catch (err) {
        console.error("[DASHBOARD] Error:", err);
        respond(res, 500, { error: String(err) });
    }
}
function respond(res, code, data) {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
}
export function startDashboard() {
    const server = createServer(handleRequest);
    server.listen(PORT, "0.0.0.0", () => {
        console.log(`[DASHBOARD] Admin panel: http://0.0.0.0:${PORT}`);
    });
}
//# sourceMappingURL=server.js.map