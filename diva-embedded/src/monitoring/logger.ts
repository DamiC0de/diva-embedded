/**
 * Structured JSON Logger — Story 1.2
 * Replaces console.log with structured JSON logs including correlation ID.
 */

import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import { getCorrelationId } from "./correlation.js";

const LOG_FILE = "/var/log/diva-server.log";
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

type LogLevel = "error" | "warn" | "info" | "debug";

interface LogEntry {
  ts: string;
  level: LogLevel;
  service: string;
  correlationId: string;
  speakerId?: string;
  msg: string;
  data?: Record<string, unknown>;
}

let currentSpeakerId = "";
let debugEnabled = process.env.LOG_DEBUG === "true";

export function setLogSpeaker(speakerId: string): void {
  currentSpeakerId = speakerId;
}

function writeLog(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    service: "diva-server",
    correlationId: getCorrelationId(),
    msg,
  };

  if (currentSpeakerId) entry.speakerId = currentSpeakerId;
  if (data && Object.keys(data).length > 0) entry.data = data;

  const line = JSON.stringify(entry);

  // Console output for journalctl
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else if (level !== "debug") {
    process.stdout.write(line + "\n");
  }

  // File output
  try {
    appendFileSync(LOG_FILE, line + "\n");
    rotateIfNeeded();
  } catch {}
}

function rotateIfNeeded(): void {
  try {
    if (existsSync(LOG_FILE)) {
      const size = statSync(LOG_FILE).size;
      if (size > MAX_LOG_SIZE) {
        renameSync(LOG_FILE, LOG_FILE + ".1");
      }
    }
  } catch {}
}

export const log = {
  error(msg: string, data?: Record<string, unknown>): void {
    writeLog("error", msg, data);
  },
  warn(msg: string, data?: Record<string, unknown>): void {
    writeLog("warn", msg, data);
  },
  info(msg: string, data?: Record<string, unknown>): void {
    writeLog("info", msg, data);
  },
  debug(msg: string, data?: Record<string, unknown>): void {
    if (debugEnabled) writeLog("debug", msg, data);
  },
};
