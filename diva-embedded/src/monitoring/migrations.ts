/**
 * Database Migration System — Story 1.3
 * Versioned sequential migrations executed automatically at startup.
 */

import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./logger.js";

const MIGRATIONS_DIR = "/opt/diva-embedded/data/migrations";

function ensureMigrationTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function getAppliedMigrations(db: Database.Database): Set<string> {
  const rows = db.prepare("SELECT filename FROM _migrations").all() as { filename: string }[];
  return new Set(rows.map(r => r.filename));
}

export function runMigrations(db: Database.Database, dbName: string): void {
  ensureMigrationTable(db);
  const applied = getAppliedMigrations(db);

  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith(".sql") && f.includes(dbName))
      .sort();
  } catch {
    log.debug("No migrations directory found", { dir: MIGRATIONS_DIR });
    return;
  }

  if (files.length === 0) {
    log.debug("No migrations found", { dbName });
    return;
  }

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    log.info("Running migration", { file, dbName });

    const savepoint = `sp_${file.replace(/[^a-zA-Z0-9]/g, "_")}`;
    try {
      db.exec(`SAVEPOINT ${savepoint}`);
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (filename) VALUES (?)").run(file);
      db.exec(`RELEASE ${savepoint}`);
      log.info("Migration applied", { file, dbName });
    } catch (err) {
      db.exec(`ROLLBACK TO ${savepoint}`);
      log.error("Migration failed — rolled back", {
        file,
        dbName,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
