/**
 * Timer Manager v2 — countdown timers + reminders with persistence
 * - Custom reminder messages: "rappelle-moi dans 30 min de sortir le gâteau"
 * - JSON persistence to survive restarts
 * - Plays bibop.wav + TTS announcement when a timer expires
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { playAudioFile, playAudioBytes } from "../audio/audio-client.js";
import { synthesize } from "../tts/piper.js";

const ASSETS_DIR = "/opt/diva-embedded/assets";
const PERSIST_PATH = "/opt/diva-embedded/data/timers.json";

interface ActiveTimer {
  id: number;
  label: string;
  message: string; // custom reminder message
  durationMs: number;
  startedAt: number; // epoch ms
  handle: ReturnType<typeof setTimeout>;
}

interface PersistedTimer {
  id: number;
  label: string;
  message: string;
  durationMs: number;
  startedAt: number;
}

let nextId = 1;
const activeTimers = new Map<number, ActiveTimer>();

// --- Persistence ---

async function persistTimers(): Promise<void> {
  const data: PersistedTimer[] = [...activeTimers.values()].map((t) => ({
    id: t.id,
    label: t.label,
    message: t.message,
    durationMs: t.durationMs,
    startedAt: t.startedAt,
  }));
  try {
    await writeFile(PERSIST_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("[TIMER] Persist error:", err);
  }
}

export async function restoreTimers(): Promise<void> {
  try {
    if (!existsSync(PERSIST_PATH)) return;
    const raw = await readFile(PERSIST_PATH, "utf-8");
    const timers: PersistedTimer[] = JSON.parse(raw);
    const now = Date.now();

    for (const t of timers) {
      const elapsed = now - t.startedAt;
      const remaining = t.durationMs - elapsed;

      if (remaining <= 0) {
        // Timer already expired while we were down — fire immediately
        console.log(`[TIMER] Restored expired: "${t.label}" — firing now`);
        fireTimer(t.label, t.message);
      } else {
        // Re-schedule
        if (t.id >= nextId) nextId = t.id + 1;
        const handle = setTimeout(() => {
          onTimerExpired(timer);
        }, remaining);
        handle.unref();

        const timer: ActiveTimer = {
          id: t.id,
          label: t.label,
          message: t.message,
          durationMs: t.durationMs,
          startedAt: t.startedAt,
          handle,
        };
        activeTimers.set(t.id, timer);
        console.log(`[TIMER] Restored #${t.id}: "${t.label}" (${Math.round(remaining / 1000)}s left)`);
      }
    }
  } catch (err) {
    console.error("[TIMER] Restore error:", err);
  }
}

// --- Timer logic ---

async function fireTimer(label: string, message: string): Promise<void> {
  try {
    await playAudioFile(`${ASSETS_DIR}/bibop.wav`);
    let ttsText: string;
    if (message) {
      ttsText = message;
    } else if (label) {
      ttsText = `Le minuteur ${label} est terminé !`;
    } else {
      ttsText = "Le minuteur est terminé !";
    }
    const wavBuffer = await synthesize(ttsText);
    await playAudioBytes(wavBuffer.toString("base64"));
  } catch (err) {
    console.error("[TIMER] Notification error:", err);
  }
}

async function onTimerExpired(timer: ActiveTimer): Promise<void> {
  activeTimers.delete(timer.id);
  console.log(`[TIMER] Expiré: "${timer.label}"${timer.message ? ` — "${timer.message}"` : ""}`);
  await fireTimer(timer.label, timer.message);
  await persistTimers();
}

export function startTimer(durationMs: number, label: string, message: string = ""): ActiveTimer {
  const id = nextId++;
  const handle = setTimeout(() => {
    onTimerExpired(timer);
  }, durationMs);
  handle.unref();

  const timer: ActiveTimer = {
    id,
    label,
    message,
    durationMs,
    startedAt: Date.now(),
    handle,
  };
  activeTimers.set(id, timer);
  console.log(`[TIMER] Démarré #${id}: ${label} (${Math.round(durationMs / 1000)}s)${message ? ` msg="${message}"` : ""}`);
  persistTimers();
  return timer;
}

export function listTimers(): { id: number; label: string; message: string; remainingS: number }[] {
  const now = Date.now();
  return [...activeTimers.values()].map((t) => ({
    id: t.id,
    label: t.label,
    message: t.message,
    remainingS: Math.max(0, Math.round((t.durationMs - (now - t.startedAt)) / 1000)),
  }));
}

export function cancelAllTimers(): number {
  const count = activeTimers.size;
  for (const timer of activeTimers.values()) {
    clearTimeout(timer.handle);
  }
  activeTimers.clear();
  console.log(`[TIMER] ${count} minuteur(s) annulé(s)`);
  persistTimers();
  return count;
}

export function cancelTimer(id: number): boolean {
  const timer = activeTimers.get(id);
  if (!timer) return false;
  clearTimeout(timer.handle);
  activeTimers.delete(id);
  console.log(`[TIMER] Annulé #${id}: "${timer.label}"`);
  persistTimers();
  return true;
}
