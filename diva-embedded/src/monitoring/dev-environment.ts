/**
 * Dev Environment & Documentation — Ideas #97, #98
 * #97: Living documentation from code
 * #98: Local dev environment with mocks
 * #100: Bus factor / open-source readiness
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// #97 — Extract feature references from code
export function extractFeatureReferences(srcDir: string): Map<string, string[]> {
  const featureMap = new Map<string, string[]>();
  
  function scanDir(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
          scanDir(fullPath);
        } else if (entry.name.endsWith(".ts")) {
          try {
            const content = readFileSync(fullPath, "utf-8");
            const matches = content.matchAll(/#(\d+)/g);
            for (const match of matches) {
              const featureId = `#${match[1]}`;
              const files = featureMap.get(featureId) || [];
              if (!files.includes(fullPath)) files.push(fullPath);
              featureMap.set(featureId, files);
            }
          } catch {}
        }
      }
    } catch {}
  }

  scanDir(srcDir);
  return featureMap;
}

// Generate architecture documentation from code structure
export function generateArchitectureDoc(srcDir: string): string {
  const lines: string[] = ["# Diva Architecture — Auto-generated\n"];
  
  function listModules(dir: string, depth = 0): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const indent = "  ".repeat(depth);
        if (entry.isDirectory()) {
          lines.push(`${indent}- **${entry.name}/**`);
          listModules(join(dir, entry.name), depth + 1);
        } else if (entry.name.endsWith(".ts")) {
          // Extract first comment line as description
          try {
            const content = readFileSync(join(dir, entry.name), "utf-8");
            const desc = content.match(/\* (.+?)(?:\n| —)/)?.[1] || "";
            lines.push(`${indent}- ${entry.name} — ${desc}`);
          } catch {
            lines.push(`${indent}- ${entry.name}`);
          }
        }
      }
    } catch {}
  }

  listModules(srcDir);
  return lines.join("\n");
}

// #98 — Check if running in dev mode
export function isDevMode(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.DIVA_DEV === "true";
}

// Mock configuration for local development
export function getDevMockConfig(): Record<string, string> {
  return {
    STT_URL: "http://localhost:8881", // or mock
    TTS_URL: "http://localhost:8880", // or mock
    INTENT_URL: "http://localhost:8882", // or mock
    MEMORY_URL: "http://localhost:9002", // or mock
    AUDIO_URL: "http://localhost:9010", // or mock
  };
}

// #96 — Multi-request detection (simplified)
const activeRequests = new Map<string, number>();

export function isRequestInProgress(speakerId: string): boolean {
  const ts = activeRequests.get(speakerId);
  if (!ts) return false;
  return Date.now() - ts < 15000; // 15s timeout
}

export function markRequestStart(speakerId: string): void {
  activeRequests.set(speakerId, Date.now());
}

export function markRequestEnd(speakerId: string): void {
  activeRequests.delete(speakerId);
}
