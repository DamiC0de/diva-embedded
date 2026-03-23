/**
 * Production Dashboard — Diva voice assistant household management on port 3080
 *
 * Endpoints:
 * - GET  /                             → Dashboard HTML (or wizard redirect)
 * - GET  /wizard.html                  → First-boot wizard
 * - GET  /api/auth                     → Check session
 * - POST /api/auth                     → Login (password)
 * - POST /api/auth/logout              → Destroy session
 * - POST /api/auth/setup               → Set initial admin password (first boot only)
 * - GET  /api/foyer                    → Foyer info + members
 * - PUT  /api/foyer                    → Update foyer name
 * - GET  /api/foyer/members            → List active members
 * - POST /api/foyer/members            → Add member
 * - DELETE /api/foyer/members/:id      → Remove (deactivate) member
 * - POST /api/foyer/members/:id/promote  → Promote to admin
 * - POST /api/foyer/members/:id/demote   → Demote from admin
 * - GET  /api/settings                 → Privacy & backup status
 * - POST /api/settings/backup          → Trigger manual backup
 *
 * Wizard (Story 12.2):
 * - GET  /api/wizard/status       → { needsWizard, currentStep }
 * - POST /api/wizard/step1        → Create admin password + session
 * - GET  /api/wizard/step2        → List foyer members
 * - POST /api/wizard/step2        → Update foyer members
 * - GET  /api/wizard/step3        → Scan home automation devices
 * - POST /api/wizard/step3        → Configure devices (name, room)
 * - POST /api/wizard/step4        → Save privacy settings
 * - POST /api/wizard/step5        → Finalize wizard
 *
 * Auth: scrypt password hash stored in foyer table, session cookie.
 * No external dependencies — uses node:http, node:crypto, node:fs.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { log } from "../monitoring/logger.js";
import { getCompanionDb } from "../security/database-manager.js";
import { getRetentionStatus } from "../security/retention-manager.js";
import { getAllConsents, getActiveConsents } from "../security/consent-manager.js";
import { generateExport, writeExportFile, canRequestExport, scheduleExportCleanup } from "../security/data-export.js";
import { initiateErasure, cancelErasure } from "../security/data-erasure.js";
import { recordActivity, ensureActivitySchema, onActivityRecorded } from "./services/activity-recorder.js";
import { DashboardWebSocketServer } from "./services/websocket-server.js";
import { onStateChange } from "../smarthome/ha-connector.js";
import { getScenes, createScene, toggleFavorite, executeScene, ensureScenesSchema, type SceneAction } from "./routes/domotique-scenes.js";
import { handleGetActivity } from "./routes/domotique-activity.js";
import { handleGetVapidKey, handlePushSubscribe, handlePushPreferences, handleWidgetStatus, handleWidgetAction } from "./routes/pwa.js";
import {
  handleGetHousingTypes,
  handleApplyTemplate,
  handleGetOrphanDevices,
  handleAssignDevices,
  handleGetSuggestedRoutines,
  handleActivateRoutines,
  handleGetSuggestedScenes,
  handleApplyScenes,
} from "./routes/onboarding-templates.js";
import { ensurePushSchema, initVapidKeys, broadcastNotification, type PushPayload } from "./services/push-service.js";
import { onAlertCreated, type DomotiqueAlert } from "../smarthome/domotique-alerts.js";
// Story 18.5/18.6: Device health monitoring
import {
  handleHealthOverview,
  handleDeviceDetail,
  handleDiagnose,
  handleGetNotifications,
  handleMarkNotificationRead,
  handleHealthSummary,
  handleDeviceRestart,
  handleAcknowledgeAlert,
} from "./routes/device-health.js";
import { ensureDeviceHealthSchema } from "./services/device-health.js";
import { startHealthMonitor, stopHealthMonitor } from "./services/health-monitor.js";
// Story 18.5/18.7: Weekly planning
import { handleGetPlanning, handleGetConflicts, handleGetSuggestions, handleDismissSuggestion } from "./routes/weekly-planning.js";
// Story 18.7: Coaching vocal
import { handleStartCoaching, handleNextStep, handleEndCoaching, handleGetProactiveSuggestions } from "./routes/coaching.js";
import { setWsCallback } from "./services/coaching-vocal.js";
import {
  getFoyer,
  initFoyer,
  getMembers,
  addMember,
  removeMember,
  promoteAdmin,
  demoteAdmin,
  setFoyerStatus,
  ensureSchema,
  type Foyer,
  type FoyerMember,
} from "../household/foyer-manager.js";

const PORT = 3080;
const PUBLIC_DIR = join(import.meta.dirname, "public");
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DATA_DIR = "/opt/diva-embedded/data";

// =====================================================================
// Password Hashing (scrypt — no extra deps)
// =====================================================================

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// =====================================================================
// Dashboard Password (stored in foyer table via extra column)
// =====================================================================

function ensureDashPasswordColumn(): void {
  const db = getCompanionDb();
  try {
    db.prepare("SELECT dash_password FROM foyer LIMIT 1").get();
  } catch {
    db.exec("ALTER TABLE foyer ADD COLUMN dash_password TEXT");
    log.info("Added dash_password column to foyer table");
  }
}

function getDashPassword(): string | null {
  ensureDashPasswordColumn();
  const db = getCompanionDb();
  const row = db.prepare("SELECT dash_password FROM foyer LIMIT 1").get() as
    | { dash_password: string | null }
    | undefined;
  return row?.dash_password ?? null;
}

function setDashPassword(password: string): void {
  ensureDashPasswordColumn();
  const db = getCompanionDb();
  const hash = hashPassword(password);
  db.prepare("UPDATE foyer SET dash_password = ?, updated_at = datetime('now')").run(hash);
  log.info("Dashboard password set");
  // Sync password to Home Assistant user (async, non-blocking)
  syncHAPassword(password).catch((err) => {
    log.warn("Failed to sync password to Home Assistant", {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Sync the dashboard password to the Home Assistant local user.
 * Uses the HA WebSocket API to change the password of the "diva" user.
 * Non-blocking — failure doesn't affect dashboard auth.
 */
async function syncHAPassword(newPassword: string): Promise<void> {
  const haUrl = process.env.HA_URL ?? "http://localhost:8123";
  const haToken = process.env.HA_TOKEN ?? "";
  if (!haToken) {
    log.info("HA password sync skipped — no HA_TOKEN configured");
    return;
  }

  const wsUrl = haUrl.replace(/^http/, "ws") + "/api/websocket";

  const { default: WebSocket } = await import("ws");
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("HA WebSocket timeout"));
    }, 10000);

    let msgId = 0;

    ws.on("message", async (data: Buffer) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: haToken }));
      } else if (msg.type === "auth_ok") {
        // Find the HA local user
        ws.send(JSON.stringify({ id: ++msgId, type: "config/auth/list" }));
      } else if (msg.type === "auth_invalid") {
        clearTimeout(timeout);
        ws.close();
        reject(new Error("HA auth invalid"));
      } else if (msg.id === 1 && msg.success) {
        // Got user list — find the non-system user with homeassistant credentials
        const users = msg.result as Array<{
          id: string;
          username: string | null;
          system_generated: boolean;
          credentials: Array<{ type: string }>;
        }>;
        const divaUser = users.find(
          (u) => !u.system_generated && u.credentials.some((c) => c.type === "homeassistant"),
        );

        if (!divaUser) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error("No HA local user found"));
          return;
        }

        const username = divaUser.username ?? "diva";

        // Step 1: Delete existing credentials
        ws.send(JSON.stringify({
          id: ++msgId,
          type: "config/auth_provider/homeassistant/delete",
          username,
        }));
      } else if (msg.id === 2) {
        // Delete result — now recreate with new password
        if (!msg.success) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`HA credential delete failed: ${JSON.stringify(msg.error)}`));
          return;
        }

        // Step 2: Recreate credentials with new password
        // Re-fetch user to get user_id (we need it for create)
        ws.send(JSON.stringify({ id: ++msgId, type: "config/auth/list" }));
      } else if (msg.id === 3 && msg.success) {
        // Got user list again after delete — find user_id and create
        const users = msg.result as Array<{
          id: string;
          username: string | null;
          system_generated: boolean;
        }>;
        const divaUser = users.find((u) => !u.system_generated);

        if (!divaUser) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error("No HA user found after delete"));
          return;
        }

        ws.send(JSON.stringify({
          id: ++msgId,
          type: "config/auth_provider/homeassistant/create",
          user_id: divaUser.id,
          username: divaUser.username ?? "diva",
          password: newPassword,
        }));
      } else if (msg.id === 4) {
        clearTimeout(timeout);
        ws.close();
        if (msg.success) {
          log.info("HA password synced successfully");
          resolve();
        } else {
          reject(new Error(`HA password create failed: ${JSON.stringify(msg.error)}`));
        }
      }
    });

    ws.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// =====================================================================
// Wizard Schema (Story 12.2 — Task 1.1, 5.1)
// =====================================================================

const MIN_PASSWORD_LENGTH = 8;
const WIZARD_STEPS_COUNT = 5;

function ensureWizardColumns(): void {
  const db = getCompanionDb();
  try {
    db.prepare("SELECT wizard_completed FROM foyer LIMIT 1").get();
  } catch {
    db.exec("ALTER TABLE foyer ADD COLUMN wizard_completed INTEGER DEFAULT 0");
    log.info("Added wizard_completed column to foyer table");
  }
}

function ensureFoyerSettingsTable(): void {
  const db = getCompanionDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS foyer_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Default privacy-first values
  db.exec(`
    INSERT OR IGNORE INTO foyer_settings (setting_key, setting_value) VALUES
      ('telemetry_enabled', 'false'),
      ('memory_retention', 'medium'),
      ('wellness_detection_enabled', 'true')
  `);
}

function getWizardCompleted(): boolean {
  ensureWizardColumns();
  const db = getCompanionDb();
  const row = db.prepare("SELECT wizard_completed FROM foyer LIMIT 1").get() as
    | { wizard_completed: number }
    | undefined;
  return row?.wizard_completed === 1;
}

// =====================================================================
// Session Store (in-memory — reboot clears sessions, acceptable for embedded)
// =====================================================================

interface Session {
  token: string;
  createdAt: number;
}

const sessions = new Map<string, Session>();

function createSession(): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { token, createdAt: Date.now() });
  return token;
}

function validateSession(token: string | undefined): boolean {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function destroySession(token: string): void {
  sessions.delete(token);
}

function getSessionToken(req: IncomingMessage): string | undefined {
  const cookie = req.headers.cookie;
  if (!cookie) return undefined;
  const match = cookie.match(/diva_session=([a-f0-9]+)/);
  return match?.[1];
}

// =====================================================================
// Rate Limiting (AC8 — Task 5.4: max 5 attempts per minute per IP)
// =====================================================================

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 5;

interface RateLimitEntry {
  attempts: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

function getClientIP(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

/** Returns true if the request is rate-limited (should be blocked). */
export function isRateLimited(req: IncomingMessage): boolean {
  const ip = getClientIP(req);
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { attempts: 1, windowStart: now });
    return false;
  }

  entry.attempts++;
  if (entry.attempts > RATE_LIMIT_MAX) {
    return true;
  }
  return false;
}

/** Reset rate limit for an IP (e.g. after successful login). */
export function resetRateLimit(req: IncomingMessage): void {
  const ip = getClientIP(req);
  rateLimitStore.delete(ip);
}

// Periodic cleanup of old rate limit entries (every 5 minutes)
const rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(ip);
    }
  }
}, 5 * 60_000);
if (rateLimitCleanupInterval && typeof rateLimitCleanupInterval === "object" && "unref" in rateLimitCleanupInterval) {
  rateLimitCleanupInterval.unref();
}

// =====================================================================
// Session Cleanup (AC3 — Task 2.5: automatic cleanup of expired sessions)
// =====================================================================

const sessionCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(token);
    }
  }
}, 60_000); // Every minute
if (sessionCleanupInterval && typeof sessionCleanupInterval === "object" && "unref" in sessionCleanupInterval) {
  sessionCleanupInterval.unref();
}

// =====================================================================
// HTTP Helpers
// =====================================================================

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 64 * 1024; // 64 KB
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) return parsed;
    return null;
  } catch {
    return null;
  }
}

// =====================================================================
// Static File Serving
// =====================================================================

async function serveStatic(res: ServerResponse, filePath: string): Promise<void> {
  // Prevent directory traversal
  const resolved = join(PUBLIC_DIR, filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, "Forbidden");
    return;
  }

  try {
    const info = await stat(resolved);
    if (!info.isFile()) {
      sendError(res, 404, "Not found");
      return;
    }

    const ext = extname(resolved);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const content = await readFile(resolved);

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(content);
  } catch {
    sendError(res, 404, "Not found");
  }
}

// =====================================================================
// Auth Middleware
// =====================================================================

function requireAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const token = getSessionToken(req);
  if (!validateSession(token)) {
    sendError(res, 401, "Non authentifié");
    return false;
  }
  return true;
}

// =====================================================================
// API Route Handlers
// =====================================================================

async function handleAuth(req: IncomingMessage, res: ServerResponse, method: string): Promise<void> {
  if (method === "GET") {
    // Check if session is valid
    const token = getSessionToken(req);
    const authenticated = validateSession(token);
    const hasPassword = getDashPassword() !== null;
    sendJson(res, 200, { authenticated, hasPassword });
    return;
  }

  if (method === "POST") {
    // Rate limiting (AC8 — Task 5.4)
    if (isRateLimited(req)) {
      sendJson(res, 429, { success: false, error: "Trop de tentatives. Réessayez dans une minute.", code: "RATE_LIMITED" });
      return;
    }

    const body = parseJson(await readBody(req));
    if (!body || typeof body.password !== "string" || !(body.password as string).trim()) {
      sendJson(res, 400, { success: false, error: "Mot de passe requis", code: "VALIDATION_ERROR" });
      return;
    }

    const stored = getDashPassword();
    if (!stored) {
      sendJson(res, 403, { success: false, error: "Aucun mot de passe configuré. Utilisez /api/auth/setup.", code: "NO_PASSWORD" });
      return;
    }

    if (!verifyPassword(body.password as string, stored)) {
      log.warn("Dashboard login failed — wrong password");
      sendJson(res, 401, { success: false, error: "Mot de passe incorrect", code: "AUTH_FAILED" });
      return;
    }

    resetRateLimit(req);
    const token = createSession();
    log.info("Dashboard login successful");
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": `diva_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
    });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  sendError(res, 405, "Méthode non autorisée");
}

async function handleAuthSetup(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const existing = getDashPassword();
  if (existing) {
    sendError(res, 403, "Mot de passe déjà configuré");
    return;
  }

  const body = parseJson(await readBody(req));
  if (!body || typeof body.password !== "string" || (body.password as string).length < 4) {
    sendError(res, 400, "Mot de passe requis (minimum 4 caractères)");
    return;
  }

  // Ensure foyer exists
  initFoyer();
  setDashPassword(body.password as string);

  // Also provision Home Assistant with the same password
  const username = (body.username as string) || "diva";
  try {
    const { execSync } = await import("node:child_process");
    execSync(
      `/opt/diva-embedded/scripts/ha-auto-provision.sh "${username}" "${body.password as string}"`,
      { timeout: 60000, stdio: "pipe" }
    );
    log.info("Home Assistant provisioned with dashboard password");
  } catch (e) {
    log.warn("HA auto-provision failed (may already be provisioned)", { error: String(e) });
  }

  const token = createSession();
  log.info("Dashboard initial password set via wizard");
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Set-Cookie": `diva_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
  });
  res.end(JSON.stringify({ ok: true }));
}

async function handleAuthLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = getSessionToken(req);
  if (token) destroySession(token);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Set-Cookie": "diva_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
  });
  res.end(JSON.stringify({ success: true }));
}

function handleGetFoyer(req: IncomingMessage, res: ServerResponse): void {
  if (!requireAuth(req, res)) return;

  const foyer = getFoyer();
  if (!foyer) {
    sendJson(res, 200, { foyer: null, members: [] });
    return;
  }

  const members = getMembers(foyer.id);
  sendJson(res, 200, { foyer, members });
}

async function handleUpdateFoyer(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;

  const body = parseJson(await readBody(req));
  if (!body || typeof body.name !== "string" || !(body.name as string).trim()) {
    sendError(res, 400, "Nom du foyer requis");
    return;
  }

  const db = getCompanionDb();
  db.prepare("UPDATE foyer SET name = ?, updated_at = datetime('now')").run((body.name as string).trim());
  log.info("Foyer name updated via dashboard", { name: body.name });

  const foyer = getFoyer();
  sendJson(res, 200, { foyer });
}

function handleGetMembers(req: IncomingMessage, res: ServerResponse): void {
  if (!requireAuth(req, res)) return;

  const foyer = getFoyer();
  if (!foyer) {
    sendJson(res, 200, { members: [] });
    return;
  }

  const members = getMembers(foyer.id);
  sendJson(res, 200, { members });
}

async function handleAddMember(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;

  const body = parseJson(await readBody(req));
  if (!body || typeof body.name !== "string" || !(body.name as string).trim()) {
    sendError(res, 400, "Nom du membre requis");
    return;
  }

  const foyer = getFoyer();
  if (!foyer) {
    sendError(res, 404, "Aucun foyer configuré");
    return;
  }

  const member = addMember(foyer.id, {
    name: (body.name as string).trim(),
    age: typeof body.age === "number" ? body.age as number : undefined,
    relation: typeof body.relation === "string" ? body.relation as string : undefined,
    isAdmin: body.isAdmin === true,
  });

  log.info("Member added via dashboard", { name: member.name });
  sendJson(res, 201, { member });
}

function handleRemoveMember(res: ServerResponse, memberId: string): void {
  const ok = removeMember(memberId);
  if (!ok) {
    sendError(res, 404, "Membre introuvable");
    return;
  }
  log.info("Member removed via dashboard", { memberId });
  sendJson(res, 200, { ok: true });
}

function handlePromoteMember(res: ServerResponse, memberId: string): void {
  const ok = promoteAdmin(memberId);
  if (!ok) {
    sendError(res, 404, "Membre introuvable");
    return;
  }
  sendJson(res, 200, { ok: true });
}

function handleDemoteMember(res: ServerResponse, memberId: string): void {
  const ok = demoteAdmin(memberId);
  if (!ok) {
    sendError(res, 400, "Impossible de rétrograder (dernier admin ?)");
    return;
  }
  sendJson(res, 200, { ok: true });
}

function handleGetSettings(req: IncomingMessage, res: ServerResponse): void {
  if (!requireAuth(req, res)) return;

  // Check backup status
  const backupDir = join(DATA_DIR, "backups");
  let lastBackup: string | null = null;
  try {
    if (existsSync(backupDir)) {
      const { mtimeMs } = statSync(backupDir);
      lastBackup = new Date(mtimeMs).toISOString();
    }
  } catch {
    // Ignore
  }

  const foyer = getFoyer();
  sendJson(res, 200, {
    foyer: foyer
      ? { name: foyer.name, status: foyer.status }
      : null,
    backup: {
      lastBackup,
      backupDir,
    },
    privacy: {
      localOnly: true,
      dataDir: DATA_DIR,
      databases: ["diva.db", "diva-medical.db", "audit.db"],
    },
  });
}

async function handleBackup(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;

  try {
    const backupDir = join(DATA_DIR, "backups");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(backupDir, `backup-${timestamp}`);

    execSync(`mkdir -p "${backupPath}"`);

    // Copy SQLite databases using .backup API via CLI
    for (const dbFile of ["diva.db", "diva-medical.db", "audit.db"]) {
      const src = join(DATA_DIR, dbFile);
      if (existsSync(src)) {
        execSync(`sqlite3 "${src}" ".backup '${join(backupPath, dbFile)}'"`, { timeout: 30_000 });
      }
    }

    log.info("Manual backup completed", { backupPath });
    sendJson(res, 200, { ok: true, backupPath });
  } catch (err) {
    log.error("Backup failed", { error: String(err) });
    sendError(res, 500, "Échec de la sauvegarde");
  }
}

// =====================================================================
// Souvenirs Handler (AC5 — Task 3.3: recent Mem0 memories)
// =====================================================================

const MEM0_URL = process.env.MEM0_URL || "http://localhost:9002";

async function handleSouvenirsRecent(res: ServerResponse): Promise<void> {
  try {
    const resp = await fetch(`${MEM0_URL}/memories?limit=20`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      sendJson(res, 200, { success: true, data: { souvenirs: [], source: "mem0", error: "Service indisponible" } });
      return;
    }
    const memories = await resp.json();
    sendJson(res, 200, { success: true, data: { souvenirs: memories } });
  } catch {
    // Graceful degradation — Mem0 might not be running
    sendJson(res, 200, { success: true, data: { souvenirs: [], source: "mem0", error: "Service indisponible" } });
  }
}

// =====================================================================
// Parametres Handler (AC5 — Task 3.4: general configuration)
// =====================================================================

function handleGetParametres(req: IncomingMessage, res: ServerResponse): void {
  if (!requireAuth(req, res)) return;

  const foyer = getFoyer();
  sendJson(res, 200, {
    success: true,
    data: {
      foyer: foyer ? { name: foyer.name, status: foyer.status } : null,
      system: {
        version: process.env.npm_package_version || "0.2.0-proto",
        nodeVersion: process.version,
        uptime: Math.floor(process.uptime()),
        platform: process.platform,
        arch: process.arch,
      },
      services: {
        dashboardPort: PORT,
        dashboardDevPort: 3002,
        mem0Url: MEM0_URL,
        haUrl: HA_URL_INTERNAL,
      },
    },
  });
}

async function handleUpdateParametres(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;

  const body = parseJson(await readBody(req));
  if (!body) {
    sendJson(res, 400, { success: false, error: "Corps de requête invalide", code: "VALIDATION_ERROR" });
    return;
  }

  // Update foyer name if provided
  if (typeof body.foyerName === "string" && (body.foyerName as string).trim()) {
    const db = getCompanionDb();
    db.prepare("UPDATE foyer SET name = ?, updated_at = datetime('now')").run((body.foyerName as string).trim());
    log.info("Foyer name updated via parametres", { name: body.foyerName });
  }

  // Update dashboard password if provided (with current password verification)
  if (typeof body.newPassword === "string" && (body.newPassword as string).length >= 8) {
    // Verify current password first
    if (typeof body.currentPassword !== "string") {
      sendJson(res, 400, { success: false, error: "Mot de passe actuel requis", code: "VALIDATION_ERROR" });
      return;
    }
    const stored = getDashPassword();
    if (stored && !verifyPassword(body.currentPassword as string, stored)) {
      sendJson(res, 403, { success: false, error: "Mot de passe actuel incorrect", code: "AUTH_ERROR" });
      return;
    }
    setDashPassword(body.newPassword as string);
    log.info("Dashboard password updated via parametres (+ HA sync)");
  } else if (typeof body.newPassword === "string") {
    sendJson(res, 400, { success: false, error: "Minimum 8 caractères", code: "VALIDATION_ERROR" });
    return;
  }

  sendJson(res, 200, { success: true });
}

// =====================================================================
// Wizard Handlers (Story 12.2 — AC1–AC9)
// =====================================================================

async function handleWizardStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    ensureWizardColumns();
    const db = getCompanionDb();
    const row = db.prepare("SELECT dash_password, wizard_completed FROM foyer LIMIT 1").get() as
      | { dash_password: string | null; wizard_completed: number }
      | undefined;

    if (!row) {
      // No foyer row at all — needs wizard
      sendJson(res, 200, { success: true, data: { needsWizard: true, currentStep: 1 } });
      return;
    }

    if (row.wizard_completed === 1) {
      sendJson(res, 200, { success: true, data: { needsWizard: false } });
      return;
    }

    // Determine current step based on what is already configured
    let currentStep = 1;
    if (row.dash_password) {
      currentStep = 2;
    }

    sendJson(res, 200, { success: true, data: { needsWizard: true, currentStep } });
  } catch (err) {
    log.error("Wizard status error", { error: String(err) });
    sendJson(res, 500, { success: false, error: "Erreur interne", code: "INTERNAL_ERROR" });
  }
}

async function handleWizardStep1(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = parseJson(await readBody(req));
    if (!body || typeof body.password !== "string" || typeof body.confirmation !== "string") {
      sendJson(res, 400, { success: false, error: "Mot de passe et confirmation requis", code: "VALIDATION_ERROR" });
      return;
    }

    const password = body.password as string;
    const confirmation = body.confirmation as string;

    if (password.length < MIN_PASSWORD_LENGTH) {
      sendJson(res, 400, {
        success: false,
        error: `Le mot de passe doit faire au minimum ${MIN_PASSWORD_LENGTH} caracteres`,
        code: "VALIDATION_ERROR",
      });
      return;
    }

    if (password !== confirmation) {
      sendJson(res, 400, { success: false, error: "Les mots de passe ne correspondent pas", code: "VALIDATION_ERROR" });
      return;
    }

    // Ensure foyer row exists
    initFoyer();
    setDashPassword(password);

    const token = createSession();
    log.info("Wizard step 1 completed — admin password set");

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": `diva_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
    });
    res.end(JSON.stringify({ success: true, data: { message: "Mot de passe cree" } }));
  } catch (err) {
    log.error("Wizard step1 error", { error: String(err) });
    sendJson(res, 500, { success: false, error: "Erreur interne", code: "INTERNAL_ERROR" });
  }
}

function handleWizardStep2Get(req: IncomingMessage, res: ServerResponse): void {
  if (!requireAuth(req, res)) return;

  try {
    const foyer = getFoyer();
    if (!foyer) {
      sendJson(res, 200, { success: true, data: { members: [], count: 0 } });
      return;
    }

    const members = getMembers(foyer.id);
    const mapped = members.map((m) => ({
      id: m.id,
      greetingName: m.name,
      role: m.isAdmin ? "admin" : (m.relation === "enfant" ? "enfant" : "membre"),
      speakerStatus: m.state,
    }));

    sendJson(res, 200, { success: true, data: { members: mapped, count: mapped.length } });
  } catch (err) {
    log.error("Wizard step2 GET error", { error: String(err) });
    sendJson(res, 500, { success: false, error: "Erreur interne", code: "INTERNAL_ERROR" });
  }
}

async function handleWizardStep2Post(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;

  try {
    const body = parseJson(await readBody(req));
    if (!body || !Array.isArray(body.members)) {
      sendJson(res, 400, { success: false, error: "Liste des membres requise", code: "VALIDATION_ERROR" });
      return;
    }

    const foyer = getFoyer() || initFoyer();
    const db = getCompanionDb();
    const membersInput = body.members as Array<{
      id?: string;
      greetingName: string;
      role: string;
      _deleted?: boolean;
    }>;

    // Validate all entries
    for (const m of membersInput) {
      if (!m._deleted && (!m.greetingName || typeof m.greetingName !== "string" || !m.greetingName.trim())) {
        sendJson(res, 400, { success: false, error: "Chaque membre doit avoir un prenom", code: "VALIDATION_ERROR" });
        return;
      }
    }

    // Process updates within a transaction
    const processMembers = db.transaction(() => {
      for (const m of membersInput) {
        if (m._deleted && m.id) {
          // Delete existing member
          removeMember(m.id);
        } else if (m.id) {
          // Update existing member
          const isAdmin = m.role === "admin" ? 1 : 0;
          const relation = m.role === "enfant" ? "enfant" : null;
          db.prepare(
            "UPDATE foyer_members SET name = ?, is_admin = ?, relation = ?, updated_at = datetime('now') WHERE id = ?"
          ).run(m.greetingName.trim(), isAdmin, relation, m.id);
        } else {
          // Add new member
          addMember(foyer.id, {
            name: m.greetingName.trim(),
            isAdmin: m.role === "admin",
            relation: m.role === "enfant" ? "enfant" : undefined,
          });
        }
      }
    });

    processMembers();
    log.info("Wizard step 2 completed — members updated");

    // Return updated list
    const updated = getMembers(foyer.id).map((m) => ({
      id: m.id,
      greetingName: m.name,
      role: m.isAdmin ? "admin" : (m.relation === "enfant" ? "enfant" : "membre"),
      speakerStatus: m.state,
    }));

    sendJson(res, 200, { success: true, data: { members: updated, count: updated.length } });
  } catch (err) {
    log.error("Wizard step2 POST error", { error: String(err) });
    sendJson(res, 500, { success: false, error: "Erreur interne", code: "INTERNAL_ERROR" });
  }
}

async function handleWizardStep3Get(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;

  try {
    const token = await getHAToken();
    if (!token) {
      sendJson(res, 200, {
        success: true,
        data: {
          devices: [],
          rooms: [],
          haAvailable: false,
          message: "Home Assistant n'est pas installe. Vous pourrez configurer la domotique plus tard.",
        },
      });
      return;
    }

    const resp = await fetch(`${HA_URL_INTERNAL}/api/states`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(3000),
    });

    if (!resp.ok) {
      sendJson(res, 200, {
        success: true,
        data: {
          devices: [],
          rooms: [],
          haAvailable: false,
          message: "Home Assistant n'est pas accessible.",
        },
      });
      return;
    }

    const states = (await resp.json()) as Array<{
      entity_id: string;
      state: string;
      attributes: Record<string, unknown>;
    }>;

    const domains = ["light", "sensor", "switch", "cover"];
    const devices = states
      .filter((s) => domains.some((d) => s.entity_id.startsWith(d + ".")))
      .map((s) => ({
        entityId: s.entity_id,
        name: (s.attributes?.friendly_name as string) || s.entity_id,
        deviceType: s.entity_id.split(".")[0],
        state: s.state,
        room: null as string | null,
        customName: null as string | null,
      }));

    // Group by type
    const grouped: Record<string, typeof devices> = {};
    for (const d of devices) {
      if (!grouped[d.deviceType]) grouped[d.deviceType] = [];
      grouped[d.deviceType].push(d);
    }

    // Get rooms from HA
    let rooms: Array<{ areaId: string; name: string }> = [];
    try {
      const { listAreas } = await import("../smarthome/ha-websocket.js");
      const areas = await listAreas();
      rooms = areas.map((a: { area_id: string; name: string }) => ({ areaId: a.area_id, name: a.name }));
    } catch {
      // HA WebSocket not available — continue without rooms
    }

    sendJson(res, 200, {
      success: true,
      data: {
        devices,
        grouped,
        rooms,
        haAvailable: true,
        count: devices.length,
      },
    });
  } catch (err) {
    // Graceful degradation on timeout or connection error
    const isTimeout = String(err).includes("timeout") || String(err).includes("abort");
    sendJson(res, 200, {
      success: true,
      data: {
        devices: [],
        rooms: [],
        haAvailable: false,
        message: isTimeout
          ? "Le scan domotique a expire (timeout). Reessayez plus tard."
          : "Home Assistant n'est pas installe. Vous pourrez configurer la domotique plus tard.",
      },
    });
  }
}

async function handleWizardStep3Post(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;

  try {
    const body = parseJson(await readBody(req));
    if (!body || !Array.isArray(body.devices)) {
      sendJson(res, 400, { success: false, error: "Liste des appareils requise", code: "VALIDATION_ERROR" });
      return;
    }

    const devicesInput = body.devices as Array<{
      entityId: string;
      customName?: string;
      roomId?: string;
    }>;

    // Assign devices to rooms via HA
    let assignedCount = 0;
    for (const d of devicesInput) {
      if (d.roomId) {
        try {
          const { assignEntityToArea } = await import("../smarthome/ha-websocket.js");
          await assignEntityToArea(d.entityId, d.roomId);
          assignedCount++;
        } catch {
          // Skip individual assignment failures
        }
      }
    }

    log.info("Wizard step 3 completed — devices configured", { assignedCount });
    sendJson(res, 200, { success: true, data: { assignedCount } });
  } catch (err) {
    log.error("Wizard step3 POST error", { error: String(err) });
    sendJson(res, 500, { success: false, error: "Erreur interne", code: "INTERNAL_ERROR" });
  }
}

async function handleWizardStep4Post(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;

  try {
    ensureFoyerSettingsTable();
    const body = parseJson(await readBody(req));
    if (!body) {
      sendJson(res, 400, { success: false, error: "Parametres requis", code: "VALIDATION_ERROR" });
      return;
    }

    const db = getCompanionDb();
    const validSettings: Record<string, string[]> = {
      telemetry_enabled: ["true", "false"],
      memory_retention: ["short", "medium", "long"],
      wellness_detection_enabled: ["true", "false"],
    };

    const updateStmt = db.prepare(
      "INSERT OR REPLACE INTO foyer_settings (setting_key, setting_value, updated_at) VALUES (?, ?, datetime('now'))"
    );

    const updates = db.transaction(() => {
      let count = 0;
      for (const [key, allowedValues] of Object.entries(validSettings)) {
        const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        const value = body[camelKey] ?? body[key];
        if (value !== undefined) {
          const strValue = String(value);
          if (!allowedValues.includes(strValue)) {
            continue; // Skip invalid values
          }
          updateStmt.run(key, strValue);
          count++;
        }
      }
      return count;
    });

    const savedCount = updates();
    log.info("Wizard step 4 completed — privacy settings saved", { savedCount });
    sendJson(res, 200, { success: true, data: { savedCount } });
  } catch (err) {
    log.error("Wizard step4 POST error", { error: String(err) });
    sendJson(res, 500, { success: false, error: "Erreur interne", code: "INTERNAL_ERROR" });
  }
}

async function handleWizardStep5Post(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;

  try {
    ensureWizardColumns();
    const db = getCompanionDb();

    // Mark wizard as completed
    db.prepare("UPDATE foyer SET wizard_completed = 1, updated_at = datetime('now')").run();

    // Also set foyer status to CONFIGURED
    setFoyerStatus("CONFIGURED");

    // Build summary
    const foyer = getFoyer();
    const members = foyer ? getMembers(foyer.id) : [];

    // Count configured devices (from HA if available)
    let deviceCount = 0;
    try {
      const token = await getHAToken();
      if (token) {
        const resp = await fetch(`${HA_URL_INTERNAL}/api/states`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) {
          const states = (await resp.json()) as Array<{ entity_id: string }>;
          const domains = ["light", "sensor", "switch", "cover"];
          deviceCount = states.filter((s) => domains.some((d) => s.entity_id.startsWith(d + "."))).length;
        }
      }
    } catch {
      // Ignore — device count is just for the summary
    }

    // Get privacy settings
    ensureFoyerSettingsTable();
    const settings = db.prepare("SELECT setting_key, setting_value FROM foyer_settings").all() as Array<{
      setting_key: string;
      setting_value: string;
    }>;

    const privacySettings: Record<string, string> = {};
    for (const s of settings) {
      privacySettings[s.setting_key] = s.setting_value;
    }

    log.info("Wizard step 5 completed — wizard finalized", { memberCount: members.length, deviceCount });

    sendJson(res, 200, {
      success: true,
      data: {
        summary: {
          memberCount: members.length,
          deviceCount,
          privacySettings,
        },
        message: "Configuration terminee. Bienvenue dans votre foyer Diva !",
      },
    });
  } catch (err) {
    log.error("Wizard step5 POST error", { error: String(err) });
    sendJson(res, 500, { success: false, error: "Erreur interne", code: "INTERNAL_ERROR" });
  }
}

// =====================================================================
// Request Router
// =====================================================================

// =====================================================================
// Domotique handlers — proxy to Home Assistant REST API
// =====================================================================

import { readFileSync, writeFileSync } from "node:fs";

let cachedHAToken = "";

function getHATokenSync(): string {
  if (cachedHAToken) return cachedHAToken;
  try {
    cachedHAToken = readFileSync("/opt/diva-embedded/data/.ha-token", "utf-8").trim();
    return cachedHAToken;
  } catch {
    return process.env.HA_TOKEN || "";
  }
}

async function getHAToken(): Promise<string> {
  const token = getHATokenSync();
  if (token) return token;

  // Try refresh
  try {
    const refreshToken = readFileSync("/opt/diva-embedded/data/.ha-refresh-token", "utf-8").trim();
    const resp = await fetch("http://localhost:8123/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${refreshToken}&client_id=http://localhost:8123/`,
    });
    if (resp.ok) {
      const data = (await resp.json()) as { access_token: string };
      cachedHAToken = data.access_token;
      writeFileSync("/opt/diva-embedded/data/.ha-token", cachedHAToken);
      log.info("HA token auto-refreshed");
      return cachedHAToken;
    }
  } catch {}
  return "";
}

const HA_URL_INTERNAL = "http://localhost:8123";

async function haFetch(path: string, options?: RequestInit): Promise<any> {
  const token = await getHAToken();
  if (!token) throw new Error("No HA token configured");
  const resp = await fetch(`${HA_URL_INTERNAL}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  if (!resp.ok) throw new Error(`HA API error: ${resp.status}`);
  return resp.json();
}

async function handleDomotiqueStatus(res: ServerResponse): Promise<void> {
  try {
    const config = await haFetch("/api/config");
    sendJson(res, 200, { connected: true, version: config.version, location: config.location_name });
  } catch {
    sendJson(res, 200, { connected: false, error: "Home Assistant non accessible" });
  }
}

async function handleDomotiqueDevices(res: ServerResponse): Promise<void> {
  try {
    const states = await haFetch("/api/states");
    const domains = ["light", "switch", "climate", "cover", "sensor", "binary_sensor", "media_player"];

    // Get areas and entity registry to cross-reference
    let areas: any[] = [];
    let entityRegistry: any[] = [];
    try {
      const { listAreas, haWsCommand } = await import("../smarthome/ha-websocket.js");
      areas = await listAreas();
      entityRegistry = await haWsCommand("config/entity_registry/list") || [];
    } catch {}

    // Build area_id → name map
    const areaMap: Record<string, string> = {};
    for (const area of areas) {
      areaMap[area.area_id] = area.name;
    }

    // Build entity_id → area_id map from entity registry
    const entityAreaMap: Record<string, string> = {};
    for (const ent of entityRegistry) {
      if (ent.area_id) {
        entityAreaMap[ent.entity_id] = ent.area_id;
      }
    }

    const devices = (states as any[])
      .filter((s: any) => domains.some(d => s.entity_id.startsWith(d + ".")))
      .map((s: any) => {
        const areaId = entityAreaMap[s.entity_id] || null;
        const roomName = areaId ? areaMap[areaId] : null;
        return {
          id: s.entity_id,
          name: s.attributes?.friendly_name || s.entity_id,
          state: s.state,
          domain: s.entity_id.split(".")[0],
          room: roomName,
          area_id: areaId,
          attributes: { brightness: s.attributes?.brightness, temperature: s.attributes?.temperature },
        };
      });

    sendJson(res, 200, { devices, count: devices.length, areas });
  } catch (e) {
    sendJson(res, 500, { error: String(e) });
  }
}

async function handleDomotiqueControl(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = parseJson(await readBody(req));
  if (!body || !body.entity_id || !body.action) {
    sendError(res, 400, "entity_id et action requis");
    return;
  }
  try {
    const domain = (body.entity_id as string).split(".")[0];
    await haFetch(`/api/services/${domain}/${body.action as string}`, {
      method: "POST",
      body: JSON.stringify({ entity_id: body.entity_id }),
    });
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { error: String(e) });
  }
}

async function handleDomotiqueDiscover(res: ServerResponse): Promise<void> {
  try {
    const { runFullDiscovery } = await import("../smarthome/auto-discover.js");
    const token = await getHAToken();
    const result = await runFullDiscovery(token, HA_URL_INTERNAL);
    sendJson(res, 200, result || { rooms: [], totalDevices: 0 });
  } catch (e) {
    sendJson(res, 500, { error: String(e) });
  }
}

async function handleDomotiqueRooms(req: IncomingMessage, res: ServerResponse, method: string): Promise<void> {
  const { listAreas, createArea, deleteArea } = await import("../smarthome/ha-websocket.js");

  if (method === "GET") {
    try {
      const areas = await listAreas();
      sendJson(res, 200, { rooms: areas });
    } catch (e) {
      sendJson(res, 200, { rooms: [] });
    }
    return;
  }

  if (method === "POST") {
    const body = parseJson(await readBody(req));
    if (!body || !body.name) { sendError(res, 400, "name requis"); return; }
    try {
      const area = await createArea(body.name as string);
      log.info("Room created in HA", { name: body.name, area });
      sendJson(res, 200, { ok: true, area });
    } catch (e) {
      sendJson(res, 500, { error: String(e) });
    }
    return;
  }

  if (method === "DELETE") {
    const body = parseJson(await readBody(req));
    if (!body || !body.area_id) { sendError(res, 400, "area_id requis"); return; }
    try {
      await deleteArea(body.area_id as string);
      log.info("Room deleted in HA", { areaId: body.area_id });
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 500, { error: String(e) });
    }
    return;
  }

  sendError(res, 405, "Method not allowed");
}

async function handleDomotiqueAssign(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = parseJson(await readBody(req));
  if (!body || !body.entity_id || !body.area_id) {
    sendError(res, 400, "entity_id et area_id requis");
    return;
  }
  try {
    const { assignEntityToArea } = await import("../smarthome/ha-websocket.js");
    await assignEntityToArea(body.entity_id as string, body.area_id as string);
    log.info("Device assigned to room", { entityId: body.entity_id, areaId: body.area_id });
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { error: String(e) });
  }
}

// =====================================================================
// Story 12.3 — Vue par pièces : helpers de conversion
// =====================================================================

/**
 * Convertit la luminosité HA (0-255) en pourcentage affichable (0-100%).
 * AC9 : vocabulaire humain — jamais de valeur brute 0-255.
 */
function brightnessToPercent(haValue: number): number {
  return Math.round((haValue / 255) * 100);
}

/**
 * Convertit color_temp HA (mired) en Kelvin puis en terme humain.
 * AC9 : pas de color_temp en mired dans l'interface.
 */
function colorTempToHuman(mired: number): { kelvin: number; label: string } {
  const kelvin = Math.round(1_000_000 / mired);
  let label: string;
  if (kelvin < 3000) label = "blanc chaud";
  else if (kelvin <= 4500) label = "blanc neutre";
  else label = "blanc froid";
  return { kelvin, label };
}

/**
 * Retourne l'icône correspondant au type de pièce.
 * AC1 : icône representative du type de pièce.
 */
function getRoomIcon(roomName: string): string {
  const lower = roomName.toLowerCase();
  if (lower.includes("salon") || lower.includes("living")) return "🛋️";
  if (lower.includes("cuisine") || lower.includes("kitchen")) return "🍳";
  if (lower.includes("chambre enfant") || lower.includes("nursery")) return "👶";
  if (lower.includes("chambre") || lower.includes("bedroom")) return "🛏️";
  if (lower.includes("salle de bain") || lower.includes("bathroom")) return "🚿";
  if (lower.includes("bureau") || lower.includes("office")) return "💻";
  if (lower.includes("exterieur") || lower.includes("jardin") || lower.includes("garden")) return "🌳";
  if (lower.includes("garage")) return "🚗";
  if (lower.includes("entree") || lower.includes("couloir") || lower.includes("hall")) return "🚪";
  if (lower.includes("cave") || lower.includes("grenier")) return "📦";
  return "🏠";
}

/**
 * Détermine le type d'appareil (light, switch, cover, climate, sensor).
 */
function getDeviceType(entityId: string): "light" | "switch" | "cover" | "climate" | "sensor" {
  const domain = entityId.split(".")[0];
  if (domain === "light") return "light";
  if (domain === "switch") return "switch";
  if (domain === "cover") return "cover";
  if (domain === "climate") return "climate";
  return "sensor";
}

/**
 * Construit les attributs normalisés d'un appareil (vocabulaire humain).
 */
function buildDeviceAttributes(haState: Record<string, unknown>, deviceType: string): Record<string, unknown> {
  const attrs = (haState.attributes as Record<string, unknown>) || {};
  const result: Record<string, unknown> = {};

  if (deviceType === "light") {
    if (attrs.brightness !== undefined) {
      result.brightnessPercent = brightnessToPercent(attrs.brightness as number);
    }
    if (attrs.color_temp !== undefined) {
      const ct = colorTempToHuman(attrs.color_temp as number);
      result.colorKelvin = ct.kelvin;
      result.colorLabel = ct.label;
    }
  }

  if (deviceType === "cover") {
    if (attrs.current_position !== undefined) {
      result.positionPercent = attrs.current_position as number;
    }
  }

  if (deviceType === "climate" || deviceType === "sensor") {
    if (attrs.temperature !== undefined) {
      result.temperature = attrs.temperature as number;
    }
    if (attrs.current_temperature !== undefined) {
      result.currentTemperature = attrs.current_temperature as number;
    }
    if (attrs.humidity !== undefined) {
      result.humidity = attrs.humidity as number;
    }
  }

  return result;
}

/**
 * Story 12.3 — Task 1 : Endpoint GET /api/domotique/rooms enrichi.
 *
 * Retourne les pièces avec :
 * - nom, icône, stats résumé (nb appareils, lumières allumées, température)
 * - liste des appareils avec entityId, friendlyName, type, state, attributs normalisés
 * - haAvailable: false si HA non accessible
 *
 * AC1, AC7, AC8, AC9 — parité vocal-dashboard (AC6) :
 *   Toggle pièce → "Diva, allume le salon" / "Diva, éteins le salon"
 */
async function handleDomotiqueRoomsEnriched(res: ServerResponse): Promise<void> {
  try {
    // Récupère toutes les entités HA et le registre d'entités (pour area_id)
    let states: Array<Record<string, unknown>> = [];
    let entityRegistry: Array<Record<string, unknown>> = [];
    let areas: Array<Record<string, unknown>> = [];

    try {
      states = (await haFetch("/api/states")) as Array<Record<string, unknown>>;
    } catch {
      sendJson(res, 200, { success: true, data: { rooms: [], haAvailable: false } });
      return;
    }

    try {
      const { listAreas, haWsCommand } = await import("../smarthome/ha-websocket.js");
      areas = await listAreas() as Array<Record<string, unknown>>;
      entityRegistry = (await haWsCommand("config/entity_registry/list") || []) as Array<Record<string, unknown>>;
    } catch { /* HA WebSocket optionnel */ }

    const SUPPORTED_DOMAINS = ["light", "switch", "cover", "climate", "sensor", "binary_sensor"];

    // Map entity_id → area_id depuis le registre
    const entityAreaMap: Record<string, string> = {};
    for (const ent of entityRegistry) {
      if (ent.area_id && ent.entity_id) {
        entityAreaMap[ent.entity_id as string] = ent.area_id as string;
      }
    }

    // Map area_id → nom de pièce
    const areaMap: Record<string, string> = {};
    for (const area of areas) {
      if (area.area_id && area.name) {
        areaMap[area.area_id as string] = area.name as string;
      }
    }

    // Grouper les entités par area_id
    const roomDevicesMap: Record<string, Array<{
      entityId: string;
      friendlyName: string;
      type: string;
      state: string;
      attributes: Record<string, unknown>;
    }>> = {};

    for (const s of states) {
      const entityId = s.entity_id as string;
      const domain = entityId.split(".")[0];
      if (!SUPPORTED_DOMAINS.includes(domain)) continue;

      const areaId = entityAreaMap[entityId];
      if (!areaId) continue; // Pas de pièce assignée → on ignore

      if (!roomDevicesMap[areaId]) roomDevicesMap[areaId] = [];

      const deviceType = getDeviceType(entityId);
      const haAttrs = (s.attributes as Record<string, unknown>) || {};
      const friendlyName = (haAttrs.friendly_name as string) || entityId;

      roomDevicesMap[areaId].push({
        entityId,
        friendlyName,
        type: deviceType,
        state: s.state as string,
        attributes: buildDeviceAttributes(s, deviceType),
      });
    }

    // Construire la liste des pièces (filtrer celles sans appareils — AC1 Task 1.4)
    const rooms = Object.entries(roomDevicesMap)
      .filter(([, devices]) => devices.length > 0)
      .map(([areaId, devices]) => {
        const roomName = areaMap[areaId] || areaId;

        // Stats résumé (AC1 / Task 1.3)
        const totalDevices = devices.length;
        const lightsOn = devices.filter(d => d.type === "light" && d.state === "on").length;

        // Température ambiante : premier capteur température de la pièce (Task 1.3)
        const tempSensor = devices.find(d =>
          d.type === "sensor" &&
          d.attributes.temperature !== undefined
        );
        const ambientTemperature = tempSensor ? tempSensor.attributes.temperature as number : null;

        return {
          roomId: areaId,
          name: roomName,
          icon: getRoomIcon(roomName),
          totalDevices,
          lightsOn,
          ambientTemperature,
          devices,
        };
      });

    sendJson(res, 200, { success: true, data: { rooms, haAvailable: true } });
  } catch (e) {
    log.warn("handleDomotiqueRoomsEnriched error", { error: String(e) });
    sendJson(res, 200, { success: true, data: { rooms: [], haAvailable: false } });
  }
}

/**
 * Story 12.3 — Task 2 : Endpoint GET /api/domotique/room/:roomId
 *
 * Retourne le détail complet d'une pièce avec tous ses appareils.
 * AC3, AC7 — 404 si pièce inexistante ou sans appareils.
 *
 * Parité vocal-dashboard (AC6) :
 *   Toggle appareil → "Diva, éteins la lampe du bureau"
 *   Slider luminosité → "Diva, mets le salon à 50%"
 */
async function handleDomotiqueRoomDetail(roomId: string, res: ServerResponse): Promise<void> {
  try {
    let states: Array<Record<string, unknown>> = [];
    let entityRegistry: Array<Record<string, unknown>> = [];
    let areas: Array<Record<string, unknown>> = [];

    try {
      states = (await haFetch("/api/states")) as Array<Record<string, unknown>>;
    } catch {
      sendJson(res, 503, { success: false, error: "Home Assistant non accessible", code: "HA_UNREACHABLE" });
      return;
    }

    try {
      const { listAreas, haWsCommand } = await import("../smarthome/ha-websocket.js");
      areas = await listAreas() as Array<Record<string, unknown>>;
      entityRegistry = (await haWsCommand("config/entity_registry/list") || []) as Array<Record<string, unknown>>;
    } catch { /* optionnel */ }

    // Map entity_id → area_id
    const entityAreaMap: Record<string, string> = {};
    for (const ent of entityRegistry) {
      if (ent.area_id && ent.entity_id) {
        entityAreaMap[ent.entity_id as string] = ent.area_id as string;
      }
    }

    // Trouver le nom de la pièce
    const area = areas.find(a => a.area_id === roomId);
    const roomName = area ? (area.name as string) : roomId;

    const SUPPORTED_DOMAINS = ["light", "switch", "cover", "climate", "sensor", "binary_sensor"];
    const devices = [];

    for (const s of states) {
      const entityId = s.entity_id as string;
      const domain = entityId.split(".")[0];
      if (!SUPPORTED_DOMAINS.includes(domain)) continue;
      if (entityAreaMap[entityId] !== roomId) continue;

      const deviceType = getDeviceType(entityId);
      const haAttrs = (s.attributes as Record<string, unknown>) || {};
      const friendlyName = (haAttrs.friendly_name as string) || entityId;

      // Contrôles disponibles par type (AC3)
      const controls: Record<string, unknown> = {};
      if (deviceType === "light") {
        controls.canToggle = true;
        controls.canSetBrightness = haAttrs.supported_features !== undefined
          ? ((haAttrs.supported_features as number) & 1) !== 0
          : true; // assume brightness supported for lights
      } else if (deviceType === "switch") {
        controls.canToggle = true;
      } else if (deviceType === "cover") {
        controls.canToggle = true;
        controls.canSetPosition = true;
      } else if (deviceType === "climate") {
        controls.canSetTemperature = true;
        controls.minTemp = (haAttrs.min_temp as number) || 10;
        controls.maxTemp = (haAttrs.max_temp as number) || 35;
      }
      // sensors: lecture seule

      devices.push({
        entityId,
        friendlyName,
        type: deviceType,
        state: s.state as string,
        attributes: buildDeviceAttributes(s, deviceType),
        controls,
        isOffline: s.state === "unavailable",
      });
    }

    if (devices.length === 0) {
      sendJson(res, 404, { success: false, error: "Pièce non trouvée ou sans appareils", code: "ROOM_NOT_FOUND" });
      return;
    }

    sendJson(res, 200, {
      success: true,
      data: {
        roomId,
        name: roomName,
        icon: getRoomIcon(roomName),
        devices,
      },
    });
  } catch (e) {
    log.warn("handleDomotiqueRoomDetail error", { roomId, error: String(e) });
    sendJson(res, 500, { success: false, error: "Erreur interne", code: "INTERNAL_ERROR" });
  }
}

/**
 * Story 12.3 — Task 3 : Endpoint POST /api/domotique/command
 *
 * Reçoit { entityId, action, value? } et exécute la commande HA.
 * AC2, AC4, AC7
 *
 * Actions supportées :
 *   toggle → homeassistant/toggle
 *   turn_on / turn_off → {domain}/turn_on|turn_off
 *   set_brightness → light/turn_on avec brightness_pct
 *   set_position → cover/set_cover_position
 *   set_temperature → climate/set_temperature
 *
 * Parité vocal-dashboard (AC6) :
 *   toggle → "Diva, bascule {appareil}"
 *   set_brightness 50 → "Diva, mets le salon à 50%"
 *   set_position 80 → "Diva, ouvre les volets à 80%"
 *   set_temperature 21 → "Diva, mets le chauffage à 21"
 *
 * Timeout HA : 3 secondes (architecture Diva).
 * Les entity_id ne sont jamais exposés dans l'interface (AC9).
 */
async function handleDomotiqueCommand(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = parseJson(await readBody(req));

  if (!body || !body.entityId || !body.action) {
    sendJson(res, 400, { success: false, error: "entityId et action requis", code: "INVALID_REQUEST" });
    return;
  }

  const entityId = body.entityId as string;
  const action = body.action as string;
  const value = body.value as number | undefined;
  const correlationId = (req.headers["x-correlation-id"] as string) || undefined;

  const domain = entityId.split(".")[0];
  const validActions = ["toggle", "turn_on", "turn_off", "set_brightness", "set_position", "set_temperature"];

  if (!validActions.includes(action)) {
    sendJson(res, 400, { success: false, error: `Action inconnue: ${action}`, code: "INVALID_ACTION" });
    return;
  }

  let haEndpoint: string;
  let haBody: Record<string, unknown> = { entity_id: entityId };

  switch (action) {
    case "toggle":
      haEndpoint = `services/homeassistant/toggle`;
      break;
    case "turn_on":
      haEndpoint = `services/${domain}/turn_on`;
      break;
    case "turn_off":
      haEndpoint = `services/${domain}/turn_off`;
      break;
    case "set_brightness":
      haEndpoint = `services/light/turn_on`;
      haBody = { entity_id: entityId, brightness_pct: value ?? 100 };
      break;
    case "set_position":
      haEndpoint = `services/cover/set_cover_position`;
      haBody = { entity_id: entityId, position: value ?? 50 };
      break;
    case "set_temperature":
      haEndpoint = `services/climate/set_temperature`;
      haBody = { entity_id: entityId, temperature: value ?? 20 };
      break;
    default:
      sendJson(res, 400, { success: false, error: "Action non supportée", code: "INVALID_ACTION" });
      return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const token = await getHAToken();
    if (!token) {
      sendJson(res, 503, { success: false, error: "Token HA non configuré", code: "HA_UNREACHABLE" });
      return;
    }

    const resp = await fetch(`${HA_URL_INTERNAL}/api/${haEndpoint}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(correlationId ? { "X-Correlation-Id": correlationId } : {}),
      },
      body: JSON.stringify(haBody),
    });

    clearTimeout(timeoutId);

    if (resp.status === 404) {
      log.warn("HA command: entity not found", { entityId, action, correlationId });
      sendJson(res, 200, { success: false, error: "Appareil non trouvé", code: "ENTITY_NOT_FOUND" });
      return;
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.status.toString());
      log.warn("HA command failed", { entityId, action, status: resp.status, error: errText, correlationId });
      sendJson(res, 200, { success: false, error: "Erreur Home Assistant", code: "HA_ERROR" });
      return;
    }

    // Récupère l'état actuel après commande
    let newState: string | null = null;
    try {
      const stateResp = (await haFetch(`states/${entityId}`)) as { state?: string };
      newState = stateResp?.state ?? null;
    } catch { /* état optionnel */ }

    log.info("HA command executed", { entityId, action, value, newState, correlationId });

    // Story 18.1 — Task 3.3: Record activity after successful dashboard command
    recordActivity(null, entityId, action, "dashboard");

    sendJson(res, 200, { success: true, data: { newState } });

  } catch (e) {
    clearTimeout(timeoutId);
    const isTimeout = (e instanceof Error && e.name === "AbortError");
    const code = isTimeout ? "HA_TIMEOUT" : "HA_UNREACHABLE";
    const errorMsg = isTimeout
      ? "Appareil injoignable, réessayez"
      : "Home Assistant non accessible";

    log.warn("HA command error", { entityId, action, code, error: String(e), correlationId });
    sendJson(res, 200, { success: false, error: errorMsg, code });
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;
  const method = req.method || "GET";

  // Security headers (AC8)
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "same-origin");

  try {
    // --- Auth routes (no session required) ---
    if (path === "/api/auth") {
      await handleAuth(req, res, method);
      return;
    }
    if (path === "/api/auth/setup" && method === "POST") {
      await handleAuthSetup(req, res);
      return;
    }
    if (path === "/api/auth/logout" && method === "POST") {
      await handleAuthLogout(req, res);
      return;
    }

    // AC5 — /api/auth/status (aliases for story compatibility)
    if (path === "/api/auth/status" && method === "GET") {
      const token = getSessionToken(req);
      const authenticated = validateSession(token);
      const wizardCompleted = getWizardCompleted();
      sendJson(res, 200, { success: true, data: { authenticated, wizardCompleted } });
      return;
    }

    // --- Wizard routes (Story 12.2) ---
    if (path === "/api/wizard/status" && method === "GET") {
      await handleWizardStatus(req, res);
      return;
    }
    if (path === "/api/wizard/step1" && method === "POST") {
      await handleWizardStep1(req, res);
      return;
    }
    if (path === "/api/wizard/step2" && method === "GET") {
      handleWizardStep2Get(req, res);
      return;
    }
    if (path === "/api/wizard/step2" && method === "POST") {
      await handleWizardStep2Post(req, res);
      return;
    }
    if (path === "/api/wizard/step3" && method === "GET") {
      await handleWizardStep3Get(req, res);
      return;
    }
    if (path === "/api/wizard/step3" && method === "POST") {
      await handleWizardStep3Post(req, res);
      return;
    }
    if (path === "/api/wizard/step4" && method === "POST") {
      await handleWizardStep4Post(req, res);
      return;
    }
    if (path === "/api/wizard/step5" && method === "POST") {
      await handleWizardStep5Post(req, res);
      return;
    }

    // --- Foyer routes ---
    if (path === "/api/foyer" && method === "GET") {
      handleGetFoyer(req, res);
      return;
    }
    if (path === "/api/foyer" && method === "PUT") {
      await handleUpdateFoyer(req, res);
      return;
    }

    // --- Members routes ---
    if (path === "/api/foyer/members" && method === "GET") {
      handleGetMembers(req, res);
      return;
    }
    if (path === "/api/foyer/members" && method === "POST") {
      await handleAddMember(req, res);
      return;
    }

    // DELETE /api/foyer/members/:id
    const deleteMatch = path.match(/^\/api\/foyer\/members\/([a-f0-9-]+)$/) ;
    if (deleteMatch && method === "DELETE") {
      if (!requireAuth(req, res)) return;
      handleRemoveMember(res, deleteMatch[1]);
      return;
    }

    // POST /api/foyer/members/:id/promote
    const promoteMatch = path.match(/^\/api\/foyer\/members\/([a-f0-9-]+)\/promote$/);
    if (promoteMatch && method === "POST") {
      if (!requireAuth(req, res)) return;
      handlePromoteMember(res, promoteMatch[1]);
      return;
    }

    // POST /api/foyer/members/:id/demote
    const demoteMatch = path.match(/^\/api\/foyer\/members\/([a-f0-9-]+)\/demote$/);
    if (demoteMatch && method === "POST") {
      if (!requireAuth(req, res)) return;
      handleDemoteMember(res, demoteMatch[1]);
      return;
    }

    // --- Settings routes ---
    if (path === "/api/settings" && method === "GET") {
      handleGetSettings(req, res);
      return;
    }
    if (path === "/api/settings/backup" && method === "POST") {
      await handleBackup(req, res);
      return;
    }

    // --- Foyer status update (for wizard) ---
    if (path === "/api/foyer/status" && method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req));
      if (!body || typeof body.status !== "string") {
        sendError(res, 400, "Status requis");
        return;
      }
      const validStatuses = ["CONFIGURED", "INCOMPLETE", "NOT_CONFIGURED"];
      if (!validStatuses.includes(body.status as string)) {
        sendError(res, 400, "Status invalide");
        return;
      }
      setFoyerStatus(body.status as "CONFIGURED" | "INCOMPLETE" | "NOT_CONFIGURED");
      sendJson(res, 200, { ok: true });
      return;
    }

    // --- Domotique routes (proxy to HA) ---
    if (path === "/api/domotique/status" && method === "GET") {
      if (!requireAuth(req, res)) return;
      await handleDomotiqueStatus(res);
      return;
    }
    if (path === "/api/domotique/devices" && method === "GET") {
      if (!requireAuth(req, res)) return;
      await handleDomotiqueDevices(res);
      return;
    }
    if (path === "/api/domotique/control" && method === "POST") {
      if (!requireAuth(req, res)) return;
      await handleDomotiqueControl(req, res);
      return;
    }
    if (path === "/api/domotique/discover" && method === "POST") {
      if (!requireAuth(req, res)) return;
      await handleDomotiqueDiscover(res);
      return;
    }
    if (path === "/api/domotique/rooms") {
      if (!requireAuth(req, res)) return;
      await handleDomotiqueRooms(req, res, method);
      return;
    }
    if (path === "/api/domotique/assign" && method === "POST") {
      if (!requireAuth(req, res)) return;
      await handleDomotiqueAssign(req, res);
      return;
    }

    // --- Story 12.3 : Vue par pièces enrichie ---
    // GET /api/domotique/rooms (enrichi) — retourne pièces avec stats et appareils complets
    if (path === "/api/domotique/rooms/enriched" && method === "GET") {
      if (!requireAuth(req, res)) return;
      await handleDomotiqueRoomsEnriched(res);
      return;
    }
    // GET /api/domotique/room/:roomId — détail d'une pièce
    const roomDetailMatch = path.match(/^\/api\/domotique\/room\/([^/]+)$/);
    if (roomDetailMatch && method === "GET") {
      if (!requireAuth(req, res)) return;
      await handleDomotiqueRoomDetail(roomDetailMatch[1], res);
      return;
    }
    // POST /api/domotique/command — envoyer une commande à un appareil
    if (path === "/api/domotique/command" && method === "POST") {
      if (!requireAuth(req, res)) return;
      await handleDomotiqueCommand(req, res);
      return;
    }

    // --- Story 18.1 : Scenes routes ---
    if (path === "/api/domotique/scenes" && method === "GET") {
      if (!requireAuth(req, res)) return;
      try {
        const scenes = getScenes();
        sendJson(res, 200, { success: true, data: { scenes } });
      } catch (err) {
        log.warn("GET /api/domotique/scenes error", { error: String(err) });
        sendJson(res, 500, { success: false, error: "Erreur interne", code: "INTERNAL_ERROR" });
      }
      return;
    }
    if (path === "/api/domotique/scenes" && method === "POST") {
      if (!requireAuth(req, res)) return;
      try {
        const body = parseJson(await readBody(req));
        if (!body || typeof body.name !== "string" || !(body.name as string).trim()) {
          sendJson(res, 400, { success: false, error: "Nom requis", code: "VALIDATION_ERROR" });
          return;
        }
        if (!body.actions || !Array.isArray(body.actions) || (body.actions as unknown[]).length === 0) {
          sendJson(res, 400, { success: false, error: "Actions requises", code: "VALIDATION_ERROR" });
          return;
        }
        const scene = createScene(
          (body.name as string).trim(),
          (body.icon as string) || "default",
          body.actions as SceneAction[],
          body.timeSlots as string[] | null | undefined,
        );
        sendJson(res, 201, { success: true, data: { scene } });
      } catch (err) {
        log.warn("POST /api/domotique/scenes error", { error: String(err) });
        sendJson(res, 500, { success: false, error: "Erreur interne", code: "INTERNAL_ERROR" });
      }
      return;
    }
    // PUT /api/domotique/scenes/:id/favorite — toggle favorite
    const sceneFavMatch = path.match(/^\/api\/domotique\/scenes\/(\d+)\/favorite$/);
    if (sceneFavMatch && method === "PUT") {
      if (!requireAuth(req, res)) return;
      try {
        const id = parseInt(sceneFavMatch[1], 10);
        const scene = toggleFavorite(id);
        if (!scene) {
          sendJson(res, 404, { success: false, error: "Scene introuvable", code: "NOT_FOUND" });
          return;
        }
        sendJson(res, 200, { success: true, data: { scene } });
      } catch (err) {
        log.warn("PUT scenes favorite error", { error: String(err) });
        sendJson(res, 500, { success: false, error: "Erreur interne", code: "INTERNAL_ERROR" });
      }
      return;
    }
    // POST /api/domotique/scenes/:id/execute — execute scene
    const sceneExecMatch = path.match(/^\/api\/domotique\/scenes\/(\d+)\/execute$/);
    if (sceneExecMatch && method === "POST") {
      if (!requireAuth(req, res)) return;
      try {
        const id = parseInt(sceneExecMatch[1], 10);
        const result = await executeScene(id, async (entityId, action, value) => {
          // Execute via HA directly
          const domain = entityId.split(".")[0];
          let haEndpoint: string;
          let haBody: Record<string, unknown> = { entity_id: entityId };
          switch (action) {
            case "toggle": haEndpoint = "services/homeassistant/toggle"; break;
            case "turn_on": haEndpoint = `services/${domain}/turn_on`; break;
            case "turn_off": haEndpoint = `services/${domain}/turn_off`; break;
            case "set_brightness":
              haEndpoint = "services/light/turn_on";
              haBody = { entity_id: entityId, brightness_pct: value ?? 100 };
              break;
            case "set_position":
              haEndpoint = "services/cover/set_cover_position";
              haBody = { entity_id: entityId, position: value ?? 50 };
              break;
            case "set_temperature":
              haEndpoint = "services/climate/set_temperature";
              haBody = { entity_id: entityId, temperature: value ?? 20 };
              break;
            default: haEndpoint = `services/${domain}/${action}`; break;
          }
          try {
            await haFetch(haEndpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(haBody),
              signal: AbortSignal.timeout(3000),
            });
            return { success: true };
          } catch (e) {
            return { success: false, error: e instanceof Error ? e.message : String(e) };
          }
        });
        sendJson(res, 200, { success: result.success, data: { results: result.results } });
      } catch (err) {
        log.warn("POST scenes execute error", { error: String(err) });
        sendJson(res, 500, { success: false, error: "Erreur interne", code: "INTERNAL_ERROR" });
      }
      return;
    }

    // --- Story 18.1 : Activity feed route ---
    if (path === "/api/domotique/activity" && method === "GET") {
      if (!requireAuth(req, res)) return;
      try {
        const activityResult = handleGetActivity(url.searchParams);
        sendJson(res, 200, activityResult);
      } catch (err) {
        log.warn("GET /api/domotique/activity error", { error: String(err) });
        sendJson(res, 500, { success: false, error: "Erreur interne", code: "INTERNAL_ERROR" });
      }
      return;
    }

    // --- Story 8.1 (AC6): Retention status endpoint ---
    if (path === "/v1/retention-status" && method === "GET") {
      if (!requireAuth(req, res)) return;
      try {
        const status = getRetentionStatus();
        sendJson(res, 200, { success: true, data: status });
      } catch (err) {
        sendJson(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // --- Story 8.3: Consent registry endpoint ---
    if (path === "/v1/consent-registry" && method === "GET") {
      if (!requireAuth(req, res)) return;
      try {
        const summary = getAllConsents();
        sendJson(res, 200, { success: true, data: summary });
      } catch (err) {
        sendJson(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // --- Story 8.3: Speaker consent endpoint ---
    const consentMatch = path.match(/^\/v1\/consent-registry\/(.+)$/);
    if (consentMatch && method === "GET") {
      if (!requireAuth(req, res)) return;
      try {
        const consents = getActiveConsents(consentMatch[1]);
        sendJson(res, 200, { success: true, data: consents });
      } catch (err) {
        sendJson(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // --- Story 8.3: Data export endpoint ---
    const exportMatch = path.match(/^\/v1\/export\/(.+)$/);
    if (exportMatch && method === "GET") {
      if (!requireAuth(req, res)) return;
      try {
        const speakerId = exportMatch[1];
        const exportData = await generateExport(speakerId, speakerId, "dashboard");
        const filePath = writeExportFile(exportData, speakerId);
        scheduleExportCleanup(filePath);
        const fileContent = await readFile(filePath, "utf-8");
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="diva-export-${speakerId}.json"`,
        });
        res.end(fileContent);
      } catch (err) {
        sendJson(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // --- Story 8.3: Erasure initiation endpoint ---
    const erasureMatch = path.match(/^\/v1\/erasure\/(.+)$/);
    if (erasureMatch && method === "POST") {
      if (!requireAuth(req, res)) return;
      try {
        const request = initiateErasure(erasureMatch[1], "dashboard");
        sendJson(res, 200, { success: true, data: request });
      } catch (err) {
        sendJson(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // --- Story 8.3: Erasure cancellation endpoint ---
    if (erasureMatch && method === "DELETE") {
      if (!requireAuth(req, res)) return;
      try {
        const cancelled = cancelErasure(erasureMatch[1], "dashboard");
        sendJson(res, 200, { success: true, data: { cancelled } });
      } catch (err) {
        sendJson(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // --- Story 8.4: RGPD compliance dashboard endpoint ---
    if (path === "/v1/rgpd-compliance" && method === "GET") {
      if (!requireAuth(req, res)) return;
      try {
        const { getComplianceDashboard } = await import("../security/rgpd-compliance.js");
        const dashboard = getComplianceDashboard();
        sendJson(res, 200, { success: true, data: dashboard });
      } catch (err) {
        sendJson(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // --- Story 8.4: Processing registry endpoint ---
    if (path === "/v1/processing-registry" && method === "GET") {
      if (!requireAuth(req, res)) return;
      try {
        const { getRegistry } = await import("../security/processing-registry.js");
        const registry = getRegistry();
        sendJson(res, 200, { success: true, data: registry });
      } catch (err) {
        sendJson(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // --- Story 8.4: DPIA endpoint ---
    const dpiaMatch = path.match(/^\/v1\/dpia\/(.+)$/);
    if (dpiaMatch && method === "GET") {
      if (!requireAuth(req, res)) return;
      try {
        const { getDpiaForTreatment } = await import("../security/dpia-generator.js");
        const dpia = getDpiaForTreatment(dpiaMatch[1]);
        if (!dpia) {
          sendJson(res, 404, { success: false, error: "DPIA not found" });
        } else {
          sendJson(res, 200, { success: true, data: dpia });
        }
      } catch (err) {
        sendJson(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // --- Story 8.4: Breach report endpoint ---
    if (path === "/v1/breach-report" && method === "GET") {
      if (!requireAuth(req, res)) return;
      try {
        const { getBreachReport } = await import("../security/breach-detector.js");
        const report = getBreachReport();
        sendJson(res, 200, { success: true, data: report });
      } catch (err) {
        sendJson(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // --- Story 8.4: RGPD export endpoint ---
    if (path === "/v1/rgpd-export" && method === "GET") {
      if (!requireAuth(req, res)) return;
      try {
        const { exportRegistry } = await import("../security/processing-registry.js");
        const { getCorrelationId } = await import("../monitoring/correlation.js");
        const filePath = exportRegistry(getCorrelationId());
        const fileContent = await readFile(filePath, "utf-8");
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="diva-rgpd-registry.json"`,
        });
        res.end(fileContent);
      } catch (err) {
        sendJson(res, 500, { success: false, error: String(err) });
      }
      return;
    }

    // --- Story 18.3 : PWA routes (widget + push) ---
    // GET /api/push/vapid-key — no auth required
    if (path === "/api/push/vapid-key" && method === "GET") {
      handleGetVapidKey(req, res);
      return;
    }
    // POST /api/push/subscribe — auth required
    if (path === "/api/push/subscribe" && method === "POST") {
      if (!requireAuth(req, res)) return;
      await handlePushSubscribe(req, res);
      return;
    }
    // PUT /api/push/preferences — auth required
    if (path === "/api/push/preferences" && method === "PUT") {
      if (!requireAuth(req, res)) return;
      await handlePushPreferences(req, res);
      return;
    }
    // GET /api/widget/status — auth required
    if (path === "/api/widget/status" && method === "GET") {
      if (!requireAuth(req, res)) return;
      await handleWidgetStatus(req, res);
      return;
    }
    // POST /api/widget/action — auth required
    if (path === "/api/widget/action" && method === "POST") {
      if (!requireAuth(req, res)) return;
      await handleWidgetAction(req, res);
      return;
    }

    // --- Story 18.4 : Onboarding templates routes ---
    if (path === "/api/onboarding/housing-types" && method === "GET") {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, handleGetHousingTypes());
      return;
    }
    if (path === "/api/onboarding/apply-template" && method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req));
      if (!body) { sendJson(res, 400, { success: false, error: "Corps JSON invalide", code: "PARSE_ERROR" }); return; }
      const result = await handleApplyTemplate(body);
      sendJson(res, result.success ? 200 : 400, result);
      return;
    }
    if (path === "/api/onboarding/orphan-devices" && method === "GET") {
      if (!requireAuth(req, res)) return;
      const result = await handleGetOrphanDevices();
      sendJson(res, result.success ? 200 : 500, result);
      return;
    }
    if (path === "/api/onboarding/assign-devices" && method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req));
      if (!body) { sendJson(res, 400, { success: false, error: "Corps JSON invalide", code: "PARSE_ERROR" }); return; }
      const result = await handleAssignDevices(body);
      sendJson(res, result.success ? 200 : 400, result);
      return;
    }
    if (path === "/api/onboarding/suggested-routines" && method === "GET") {
      if (!requireAuth(req, res)) return;
      const result = await handleGetSuggestedRoutines();
      sendJson(res, 200, result);
      return;
    }
    if (path === "/api/onboarding/activate-routines" && method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req));
      if (!body) { sendJson(res, 400, { success: false, error: "Corps JSON invalide", code: "PARSE_ERROR" }); return; }
      const result = handleActivateRoutines(body);
      sendJson(res, result.success ? 200 : 400, result);
      return;
    }
    if (path === "/api/onboarding/suggested-scenes" && method === "GET") {
      if (!requireAuth(req, res)) return;
      const result = await handleGetSuggestedScenes();
      sendJson(res, 200, result);
      return;
    }
    if (path === "/api/onboarding/apply-scenes" && method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req));
      if (!body) { sendJson(res, 400, { success: false, error: "Corps JSON invalide", code: "PARSE_ERROR" }); return; }
      const result = handleApplyScenes(body);
      sendJson(res, result.success ? 200 : 400, result);
      return;
    }

    // --- Story 18.4 : Templates post-onboarding routes ---
    if (path === "/api/templates/housing-types" && method === "GET") {
      if (!requireAuth(req, res)) return;
      sendJson(res, 200, handleGetHousingTypes());
      return;
    }
    if (path === "/api/templates/suggested-routines" && method === "GET") {
      if (!requireAuth(req, res)) return;
      const result = await handleGetSuggestedRoutines();
      sendJson(res, 200, result);
      return;
    }
    if (path === "/api/templates/suggested-scenes" && method === "GET") {
      if (!requireAuth(req, res)) return;
      const result = await handleGetSuggestedScenes();
      sendJson(res, 200, result);
      return;
    }
    if (path === "/api/templates/apply-housing" && method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req));
      if (!body) { sendJson(res, 400, { success: false, error: "Corps JSON invalide", code: "PARSE_ERROR" }); return; }
      const result = await handleApplyTemplate(body);
      sendJson(res, result.success ? 200 : 400, result);
      return;
    }
    if (path === "/api/templates/apply-routines" && method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req));
      if (!body) { sendJson(res, 400, { success: false, error: "Corps JSON invalide", code: "PARSE_ERROR" }); return; }
      const result = handleActivateRoutines(body);
      sendJson(res, result.success ? 200 : 400, result);
      return;
    }
    if (path === "/api/templates/apply-scenes" && method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req));
      if (!body) { sendJson(res, 400, { success: false, error: "Corps JSON invalide", code: "PARSE_ERROR" }); return; }
      const result = handleApplyScenes(body);
      sendJson(res, result.success ? 200 : 400, result);
      return;
    }

    // --- Story 18.5/18.6: Device Health routes ---
    if (path === "/api/domotique/health" && method === "GET") {
      if (!requireAuth(req, res)) return;
      await handleHealthOverview((status, data) => sendJson(res, status, data));
      return;
    }
    const healthDetailMatch = path.match(/^\/api\/domotique\/health\/([^/]+)\/diagnose$/);
    if (healthDetailMatch && method === "POST") {
      if (!requireAuth(req, res)) return;
      await handleDiagnose(decodeURIComponent(healthDetailMatch[1]), (status, data) => sendJson(res, status, data));
      return;
    }
    const healthDeviceMatch = path.match(/^\/api\/domotique\/health\/([^/]+)$/);
    if (healthDeviceMatch && method === "GET") {
      if (!requireAuth(req, res)) return;
      await handleDeviceDetail(decodeURIComponent(healthDeviceMatch[1]), (status, data) => sendJson(res, status, data));
      return;
    }
    if (path === "/api/domotique/notifications" && method === "GET") {
      if (!requireAuth(req, res)) return;
      handleGetNotifications((status, data) => sendJson(res, status, data));
      return;
    }
    const notifReadMatch = path.match(/^\/api\/domotique\/notifications\/(\d+)\/read$/);
    if (notifReadMatch && method === "PUT") {
      if (!requireAuth(req, res)) return;
      handleMarkNotificationRead(parseInt(notifReadMatch[1], 10), (status, data) => sendJson(res, status, data));
      return;
    }
    // Story 18.6 alias endpoints
    if (path === "/api/device-health/summary" && method === "GET") {
      if (!requireAuth(req, res)) return;
      await handleHealthSummary((status, data) => sendJson(res, status, data));
      return;
    }
    const dhDeviceDetailMatch = path.match(/^\/api\/device-health\/devices\/([^/]+)$/);
    if (dhDeviceDetailMatch && method === "GET") {
      if (!requireAuth(req, res)) return;
      await handleDeviceDetail(decodeURIComponent(dhDeviceDetailMatch[1]), (status, data) => sendJson(res, status, data));
      return;
    }
    const dhRestartMatch = path.match(/^\/api\/device-health\/devices\/([^/]+)\/restart$/);
    if (dhRestartMatch && method === "POST") {
      if (!requireAuth(req, res)) return;
      await handleDeviceRestart(decodeURIComponent(dhRestartMatch[1]), (status, data) => sendJson(res, status, data));
      return;
    }
    const dhAckMatch = path.match(/^\/api\/device-health\/devices\/([^/]+)\/acknowledge$/);
    if (dhAckMatch && method === "POST") {
      if (!requireAuth(req, res)) return;
      handleAcknowledgeAlert(decodeURIComponent(dhAckMatch[1]), (status, data) => sendJson(res, status, data));
      return;
    }

    // --- Story 18.5/18.7: Planning routes ---
    if ((path === "/api/domotique/planning" || path === "/api/planning/weekly") && method === "GET") {
      if (!requireAuth(req, res)) return;
      handleGetPlanning(url.searchParams, (status, data) => sendJson(res, status, data));
      return;
    }
    if ((path === "/api/domotique/planning/conflicts" || path === "/api/planning/conflicts") && method === "GET") {
      if (!requireAuth(req, res)) return;
      handleGetConflicts((status, data) => sendJson(res, status, data));
      return;
    }
    if (path === "/api/planning/suggestions" && method === "GET") {
      if (!requireAuth(req, res)) return;
      handleGetSuggestions(url.searchParams, (status, data) => sendJson(res, status, data));
      return;
    }
    if (path === "/api/planning/dismiss-suggestion" && method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req));
      if (!body) { sendJson(res, 400, { success: false, error: "Corps JSON invalide", code: "PARSE_ERROR" }); return; }
      handleDismissSuggestion(body, (status, data) => sendJson(res, status, data));
      return;
    }

    // --- Story 18.7: Coaching routes ---
    if (path === "/api/coaching/start" && method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req));
      if (!body) { sendJson(res, 400, { success: false, error: "Corps JSON invalide", code: "PARSE_ERROR" }); return; }
      handleStartCoaching(body, (status, data) => sendJson(res, status, data));
      return;
    }
    if (path === "/api/coaching/next-step" && method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req));
      if (!body) { sendJson(res, 400, { success: false, error: "Corps JSON invalide", code: "PARSE_ERROR" }); return; }
      handleNextStep(body, (status, data) => sendJson(res, status, data));
      return;
    }
    if (path === "/api/coaching/end" && method === "POST") {
      if (!requireAuth(req, res)) return;
      const body = parseJson(await readBody(req));
      if (!body) { sendJson(res, 400, { success: false, error: "Corps JSON invalide", code: "PARSE_ERROR" }); return; }
      handleEndCoaching(body, (status, data) => sendJson(res, status, data));
      return;
    }
    if (path === "/api/coaching/proactive-suggestions" && method === "GET") {
      if (!requireAuth(req, res)) return;
      handleGetProactiveSuggestions(url.searchParams, (status, data) => sendJson(res, status, data));
      return;
    }

    // --- Souvenirs route (AC5 — Task 3.3) ---
    if (path === "/api/souvenirs/recent" && method === "GET") {
      if (!requireAuth(req, res)) return;
      await handleSouvenirsRecent(res);
      return;
    }

    // --- Parametres routes (AC5 — Task 3.4) ---
    if (path === "/api/parametres" && method === "GET") {
      handleGetParametres(req, res);
      return;
    }
    if (path === "/api/parametres" && method === "POST") {
      await handleUpdateParametres(req, res);
      return;
    }

    // --- Static files ---
    if (method === "GET") {
      // Story 18.3: Serve manifest.json with correct MIME type
      if (path === "/manifest.json") {
        const manifestPath = join(PUBLIC_DIR, "manifest.json");
        try {
          const content = await readFile(manifestPath);
          res.writeHead(200, {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Content-Length": content.length,
            "Cache-Control": "public, max-age=3600",
          });
          res.end(content);
        } catch {
          sendError(res, 404, "Not found");
        }
        return;
      }
      // Story 18.3: Serve /widget page
      if (path === "/widget") {
        await serveStatic(res, "widget.html");
        return;
      }
      const filePath = path === "/" ? "index.html" : path.replace(/^\//, "");
      await serveStatic(res, filePath);
      return;
    }

    sendError(res, 404, "Route introuvable");
  } catch (err) {
    log.error("Dashboard-prod request error", { path, method, error: String(err) });
    sendError(res, 500, "Erreur interne");
  }
}

// =====================================================================
// Server Bootstrap
// =====================================================================

// =====================================================================
// Exports for testing
// =====================================================================

export {
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  destroySession,
  getSessionToken,
  getDashPassword,
  setDashPassword,
  ensureDashPasswordColumn,
  requireAuth,
  handleRequest,
  sessions,
  rateLimitStore,
  PORT,
  SESSION_TTL_MS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  // Wizard (Story 12.2)
  handleWizardStatus,
  handleWizardStep1,
  handleWizardStep2Get,
  handleWizardStep2Post,
  handleWizardStep3Get,
  handleWizardStep3Post,
  handleWizardStep4Post,
  handleWizardStep5Post,
  ensureWizardColumns,
  ensureFoyerSettingsTable,
  getWizardCompleted,
  MIN_PASSWORD_LENGTH,
  WIZARD_STEPS_COUNT,
  // Story 12.3 — Vue par pièces
  handleDomotiqueRoomsEnriched,
  handleDomotiqueRoomDetail,
  handleDomotiqueCommand,
  brightnessToPercent,
  colorTempToHuman,
  getRoomIcon,
};

/** Story 18.2 — WebSocket server instance (exported for external access) */
let _wsServer: DashboardWebSocketServer | null = null;

/** Get the WebSocket server instance (may be null if not started). */
export function getWsServer(): DashboardWebSocketServer | null {
  return _wsServer;
}

export function startProductionDashboard(): void {
  ensureSchema();
  ensureDashPasswordColumn();
  ensureWizardColumns();
  ensureFoyerSettingsTable();
  ensureActivitySchema();
  ensureScenesSchema();
  ensurePushSchema();
  ensureDeviceHealthSchema(); // Story 18.5/18.6

  // Story 18.3: Initialize VAPID keys asynchronously (non-blocking)
  initVapidKeys().catch((err) => {
    log.warn("VAPID key initialization failed (web-push may not be installed)", { error: String(err) });
  });

  // Story 18.3 — Task 6: Hook domotique alerts to push notifications
  onAlertCreated((alert: DomotiqueAlert) => {
    // Only send push for ATTENTION (WARNING) and URGENCE (URGENT) alerts
    if (alert.level !== "ATTENTION" && alert.level !== "URGENCE") return;

    const category = alert.level === "URGENCE" ? "urgent" : "warning";
    let title: string;
    let actions: Array<{ action: string; title: string }>;
    let tag: string;

    if (alert.message.includes("batterie") || alert.message.includes("Batterie")) {
      title = "Batterie faible";
      tag = `battery-${alert.device || "unknown"}`;
      actions = [
        { action: "view", title: "Voir" },
        { action: "shopping", title: "Ajouter a la liste de courses" },
      ];
    } else if (alert.message.includes("hors ligne") || alert.message.includes("unavailable")) {
      title = "Appareil deconnecte";
      tag = `offline-${alert.device || "unknown"}`;
      actions = [
        { action: "diagnose", title: "Diagnostiquer" },
        { action: "ignore", title: "Ignorer" },
      ];
    } else if (alert.level === "URGENCE") {
      title = "Alerte securite";
      tag = `security-${alert.room || "unknown"}`;
      actions = [
        { action: "view", title: "Voir" },
        { action: "lock", title: "Verrouiller" },
      ];
    } else {
      title = "Alerte Diva";
      tag = `alert-${alert.id}`;
      actions = [
        { action: "view", title: "Voir" },
        { action: "ignore", title: "Ignorer" },
      ];
    }

    const payload: PushPayload = {
      title,
      body: alert.message,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      tag,
      data: { actionUrl: "/" },
      actions,
    };

    // Fire-and-forget
    broadcastNotification(payload, category).catch(() => {});
  });

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      log.error("Unhandled dashboard-prod error", { error: String(err) });
      if (!res.headersSent) {
        sendError(res, 500, "Erreur interne");
      }
    });
  });

  // Story 18.2 — Task 2.1: Initialize WebSocket server on the same HTTP server
  _wsServer = new DashboardWebSocketServer(server, validateSession);

  // Story 18.2 — Task 2.2: Connect HA state change callbacks to WebSocket broadcast
  onStateChange((event) => {
    if (_wsServer) {
      _wsServer.broadcastStateChange(event);
    }
  });

  // Story 18.2 — Task 4.4: Connect activity recorder callbacks to WebSocket broadcast
  onActivityRecorded((activity) => {
    if (_wsServer) {
      _wsServer.broadcastActivity(activity);
    }
  });

  // Story 18.5/18.6 — Start health monitoring with WebSocket broadcast
  startHealthMonitor((change) => {
    if (_wsServer) {
      _wsServer.broadcast(change);
    }
  });

  // Story 18.7 — Connect coaching WebSocket
  setWsCallback((msg) => {
    if (_wsServer) {
      _wsServer.broadcast(msg);
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    log.info(`Production dashboard listening on http://0.0.0.0:${PORT}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log.error(`Dashboard production port ${PORT} already in use — dashboard disabled, Diva continues`, { port: PORT, code: err.code });
    } else {
      log.error("Dashboard-prod server error", { error: String(err) });
    }
    // AC10: Dashboard is not a critical dependency — Diva continues normally
  });

  // Story 18.2 — Task 2.3: Graceful shutdown of WebSocket server on SIGTERM
  process.on("SIGTERM", async () => {
    log.info("SIGTERM received — shutting down WebSocket server");
    stopHealthMonitor(); // Story 18.5/18.6
    if (_wsServer) {
      await _wsServer.close();
      _wsServer = null;
    }
    server.close(() => {
      log.info("HTTP server closed");
      process.exit(0);
    });
  });
}
