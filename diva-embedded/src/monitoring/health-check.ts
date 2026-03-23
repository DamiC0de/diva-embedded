/**
 * Health Check & Watchdog Alert Endpoints — Story 9.1
 *
 * Exposes:
 * - GET  /v1/health-check    — Health check for the watchdog to verify diva-server
 * - POST /v1/watchdog-alert   — Receives failure notifications from the watchdog
 *
 * Runs an HTTP server on port 3000 (localhost only).
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { log } from "./logger.js";
import { handleDeployRoute, startUpdateChecker } from "./update-checker.js";
import { getTransferMetrics24h } from "./metrics-collector.js";

// Story 10.4: Optional monitoring handler injected at startup
let monitoringHandler: ((req: IncomingMessage, res: ServerResponse) => Promise<boolean>) | null = null;

/** Register the monitoring endpoints handler (called from index.ts) */
export function setMonitoringHandler(handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>): void {
  monitoringHandler = handler;
}

const PORT = 3000;
const startTime = Date.now();

/** In-memory degradation state — accessible by other modules (Story 9.2) */
export interface DegradedService {
    service: string;
    status: string;
    restartAttempts: number;
    lastError: string;
    timestamp: string;
}

const degradedServices: Map<string, DegradedService> = new Map();

/** Get all services currently in degraded/failed state */
export function getDegradedServices(): DegradedService[] {
    return Array.from(degradedServices.values());
}

/** Check if a specific service is degraded */
export function isServiceDegraded(serviceName: string): boolean {
    return degradedServices.has(serviceName);
}

/** Event listeners for watchdog alerts */
type AlertListener = (alert: DegradedService) => void;
const alertListeners: AlertListener[] = [];
const recoveryListeners: AlertListener[] = [];

/** Register a listener for watchdog.service-failed events */
export function onServiceFailed(listener: AlertListener): void {
    alertListeners.push(listener);
}

/** Register a listener for watchdog.service-recovered events (Story 9.2) */
export function onServiceRecovered(listener: AlertListener): void {
    recoveryListeners.push(listener);
}

function emitServiceFailed(alert: DegradedService): void {
    for (const listener of alertListeners) {
        try {
            listener(alert);
        } catch (err) {
            log.error("Error in watchdog alert listener", { error: String(err) });
        }
    }
}

/** Emit watchdog.service-recovered event (Story 9.2) */
function emitServiceRecovered(alert: DegradedService): void {
    for (const listener of recoveryListeners) {
        try {
            listener(alert);
        } catch (err) {
            log.error("Error in watchdog recovery listener", { error: String(err) });
        }
    }
}

/** Read the full request body as a string */
function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        req.on("error", reject);
    });
}

/** Send a JSON response */
function respond(res: ServerResponse, statusCode: number, body: unknown): void {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

/** Handle GET /v1/health-check */
function handleHealthCheck(_req: IncomingMessage, res: ServerResponse): void {
    // Basic health: if we can respond, we're alive
    // Check for critical conditions
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / (1024 * 1024);
    const heapTotalMB = memUsage.heapTotal / (1024 * 1024);
    const heapPct = (heapUsedMB / heapTotalMB) * 100;

    // If heap usage > 95%, consider unhealthy
    if (heapPct > 95) {
        respond(res, 503, {
            success: false,
            error: "Memory critical",
            code: "MEMORY_CRITICAL",
            data: {
                status: "unhealthy",
                service: "diva-server",
                uptime: Math.floor((Date.now() - startTime) / 1000),
                heapUsedMB: Math.round(heapUsedMB),
                heapPct: Math.round(heapPct),
            },
        });
        return;
    }

    // Story 3.12 (AC9): Include session transfer metrics
    const sessionTransfers = getTransferMetrics24h();

    respond(res, 200, {
        success: true,
        data: {
            status: "ok",
            service: "diva-server",
            uptime: Math.floor((Date.now() - startTime) / 1000),
            sessionTransfers,
        },
    });
}

/** Handle POST /v1/watchdog-alert */
async function handleWatchdogAlert(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const body = await readBody(req);
        let payload: { service?: string; status?: string; restartAttempts?: number; lastError?: string };

        try {
            payload = JSON.parse(body);
        } catch {
            respond(res, 400, {
                success: false,
                error: "Invalid JSON",
                code: "INVALID_JSON",
            });
            return;
        }

        // Validate required fields
        if (!payload.service || typeof payload.service !== "string") {
            respond(res, 400, {
                success: false,
                error: "Missing or invalid 'service' field",
                code: "INVALID_PAYLOAD",
            });
            return;
        }

        if (!payload.status || typeof payload.status !== "string") {
            respond(res, 400, {
                success: false,
                error: "Missing or invalid 'status' field",
                code: "INVALID_PAYLOAD",
            });
            return;
        }

        const alert: DegradedService = {
            service: payload.service,
            status: payload.status,
            restartAttempts: payload.restartAttempts ?? 0,
            lastError: payload.lastError ?? "",
            timestamp: new Date().toISOString(),
        };

        // Story 9.2: Handle recovered status
        if (payload.status === "recovered") {
            degradedServices.delete(payload.service);
            log.info(`Watchdog alert: service ${payload.service} recovered`, {
                service: payload.service,
            });
            emitServiceRecovered(alert);
        } else {
            // Store in degradation map
            degradedServices.set(payload.service, alert);

            // Log the alert
            log.error(`Watchdog alert: service ${payload.service} is ${payload.status}`, {
                service: payload.service,
                status: payload.status,
                restartAttempts: payload.restartAttempts,
                lastError: payload.lastError,
            });

            // Emit internal event
            emitServiceFailed(alert);
        }

        respond(res, 200, {
            success: true,
            data: { received: true, service: payload.service },
        });
    } catch (err) {
        log.error("Error handling watchdog alert", { error: String(err) });
        respond(res, 500, {
            success: false,
            error: "Internal server error",
            code: "INTERNAL_ERROR",
        });
    }
}

// Text input handler for remote testing
let _textInputHandler: ((text: string, speaker: string) => Promise<string>) | null = null;

/** Register handler for /v1/text-input (called from index.ts) */
export function setTextInputHandler(handler: (text: string, speaker: string) => Promise<string>): void {
  _textInputHandler = handler;
}

async function handleTextInput(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!_textInputHandler) {
    respond(res, 503, { success: false, error: "Text input not ready" });
    return;
  }
  const body = JSON.parse(await readBody(req));
  const text = body?.text;
  const speaker = body?.speaker ?? "unknown";
  if (!text) {
    respond(res, 400, { success: false, error: "Missing 'text' field" });
    return;
  }
  try {
    const response = await _textInputHandler(text, speaker);
    respond(res, 200, { success: true, data: { response } });
  } catch (err) {
    respond(res, 500, { success: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Start the health check HTTP server on port 3000 */
export function startHealthServer(): void {
    const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
        const path = url.pathname;

        try {
            if (path === "/v1/health-check" && req.method === "GET") {
                handleHealthCheck(req, res);
            } else if (path === "/v1/watchdog-alert" && req.method === "POST") {
                await handleWatchdogAlert(req, res);
            } else if (monitoringHandler && await monitoringHandler(req, res)) {
                // Handled by Story 10.4 monitoring endpoints (/v1/monitoring/*)
            } else if (await handleDeployRoute(req, res, path)) {
                // Handled by update-checker deploy routes (POST /v1/deploy, GET /v1/deploy/status)
            } else if (path === "/v1/text-input" && req.method === "POST") {
                await handleTextInput(req, res);
            } else {
                respond(res, 404, { success: false, error: "Not found", code: "NOT_FOUND" });
            }
        } catch (err) {
            log.error("Health server error", { error: String(err) });
            respond(res, 500, { success: false, error: "Internal error", code: "INTERNAL_ERROR" });
        }
    });

    server.listen(PORT, "127.0.0.1", () => {
        log.info("Health check server started", { port: PORT });
        // Story 10.1: Start periodic update checker
        startUpdateChecker();
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
            log.warn("Health server port already in use, skipping", { port: PORT });
        } else {
            log.error("Health server failed to start", { error: String(err) });
        }
    });
}
