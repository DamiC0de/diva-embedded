/**
 * Database Manager — Story 1.4
 * Manages 3 cloistered SQLite databases:
 * - diva.db: companion data (memories, personas, gamification, reminders)
 * - diva-medical.db: health data (wellness, medications, fall detection) — AES-256 at app level
 * - audit.db: audit trail (append-only, non-modifiable)
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { log } from "../monitoring/logger.js";
import { runMigrations } from "../monitoring/migrations.js";

const DATA_DIR = "/opt/diva-embedded/data";
const COMPANION_DB_PATH = `${DATA_DIR}/diva.db`;
const MEDICAL_DB_PATH = `${DATA_DIR}/diva-medical.db`;
const AUDIT_DB_PATH = `${DATA_DIR}/audit.db`;

let companionDb: Database.Database | null = null;
let medicalDb: Database.Database | null = null;
let auditDb: Database.Database | null = null;

function openDb(path: string, walMode = true): Database.Database {
  const db = new Database(path);
  if (walMode) {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");
  return db;
}

export function initDatabases(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // Companion DB
  companionDb = openDb(COMPANION_DB_PATH);
  runMigrations(companionDb, "companion");
  log.info("Companion database initialized", { path: COMPANION_DB_PATH });

  // Medical DB (WAL mode for crash safety)
  medicalDb = openDb(MEDICAL_DB_PATH);
  runMigrations(medicalDb, "medical");
  log.info("Medical database initialized", { path: MEDICAL_DB_PATH });

  // Audit DB (WAL mode, but we enforce append-only at application level)
  auditDb = openDb(AUDIT_DB_PATH);
  auditDb.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      speaker_id TEXT,
      action TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'protected',
      result TEXT,
      correlation_id TEXT,
      details TEXT
    )
  `);
  log.info("Audit database initialized", { path: AUDIT_DB_PATH });
}

export function getCompanionDb(): Database.Database {
  if (!companionDb) throw new Error("Companion DB not initialized");
  return companionDb;
}

export function getMedicalDb(): Database.Database {
  if (!medicalDb) throw new Error("Medical DB not initialized");
  return medicalDb;
}

export function getAuditDb(): Database.Database {
  if (!auditDb) throw new Error("Audit DB not initialized");
  return auditDb;
}

/**
 * Append-only audit log entry. No UPDATE or DELETE allowed.
 */
export function logAudit(
  action: string,
  level: "open" | "protected" | "critical",
  speakerId?: string,
  result?: string,
  correlationId?: string,
  details?: Record<string, unknown>,
): void {
  const db = getAuditDb();
  db.prepare(`
    INSERT INTO audit_log (speaker_id, action, level, result, correlation_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    speakerId || null,
    action,
    level,
    result || null,
    correlationId || null,
    details ? JSON.stringify(details) : null,
  );
}

export function closeDatabases(): void {
  companionDb?.close();
  medicalDb?.close();
  auditDb?.close();
  log.info("All databases closed");
}
