/**
 * Atomic File Write — Story 1.8
 * Write via temp file + rename to prevent corruption on power loss.
 */

import { writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export function atomicWriteFileSync(filePath: string, data: string): void {
  const dir = dirname(filePath);
  const tmpFile = join(dir, `.tmp_${randomBytes(6).toString("hex")}`);
  writeFileSync(tmpFile, data, { flag: "w" });
  renameSync(tmpFile, filePath);
}

export function atomicWriteJsonSync(filePath: string, obj: unknown): void {
  atomicWriteFileSync(filePath, JSON.stringify(obj, null, 2));
}
