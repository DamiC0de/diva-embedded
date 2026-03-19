/**
 * Fleet Reporter — Story 11.5
 * Pushes device metrics to the fleet server.
 * MVP: Simple HTTP push. Post-MVP: MQTT.
 */

import { log } from "./logger.js";
import { getDailyMetrics, getMonthlyEstimatedCost } from "./metrics-collector.js";
import { readFileSync, existsSync } from "node:fs";

const FLEET_URL = process.env.FLEET_URL || "";
const DEVICE_ID = process.env.DEVICE_ID || "dev-local";
const REPORT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface DeviceReport {
  deviceId: string;
  timestamp: string;
  version: string;
  uptime: number;
  temperatureC: number | null;
  ramUsedPct: number;
  diskUsedPct: number;
  metrics: ReturnType<typeof getDailyMetrics>;
  monthlyCostEur: number;
}

function getTemperature(): number | null {
  try {
    const temp = readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf-8");
    return parseInt(temp) / 1000;
  } catch { return null; }
}

function getVersion(): string {
  try {
    if (existsSync("/opt/diva-embedded/package.json")) {
      const pkg = JSON.parse(readFileSync("/opt/diva-embedded/package.json", "utf-8"));
      return pkg.version || "unknown";
    }
  } catch {}
  return "unknown";
}

async function sendReport(): Promise<void> {
  if (!FLEET_URL) return; // Fleet not configured

  const report: DeviceReport = {
    deviceId: DEVICE_ID,
    timestamp: new Date().toISOString(),
    version: getVersion(),
    uptime: process.uptime(),
    temperatureC: getTemperature(),
    ramUsedPct: 0,
    diskUsedPct: 0,
    metrics: getDailyMetrics(),
    monthlyCostEur: getMonthlyEstimatedCost(),
  };

  try {
    await fetch(`${FLEET_URL}/api/devices/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(5000),
    });
    log.debug("Fleet report sent");
  } catch {
    log.debug("Fleet report failed (fleet server unreachable)");
  }
}

let reporterInterval: ReturnType<typeof setInterval> | null = null;

export function startFleetReporter(): void {
  if (!FLEET_URL) {
    log.info("Fleet reporter disabled (no FLEET_URL configured)");
    return;
  }

  reporterInterval = setInterval(() => {
    sendReport().catch(() => {});
  }, REPORT_INTERVAL_MS);
  reporterInterval.unref();

  log.info("Fleet reporter started", { interval: REPORT_INTERVAL_MS / 1000, url: FLEET_URL });
}

export function stopFleetReporter(): void {
  if (reporterInterval) clearInterval(reporterInterval);
}
