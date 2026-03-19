/**
 * Reminder Manager — Natural language reminders with contextual triggers
 * Supports: timed reminders, date-based reminders, and context notes
 * Features #25 (charge mentale), #38 (dates qui comptent), #91 (soins animaux)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { playAudioFile, playAudioBytes } from "../audio/audio-client.js";
import { synthesize } from "../tts/piper.js";
import { isDNDActive } from "./dnd-manager.js";
import { isAudioBusy } from "../audio/audio-lock.js";

const REMINDERS_PATH = "/opt/diva-embedded/data/reminders.json";
const ASSETS_DIR = "/opt/diva-embedded/assets";

interface Reminder {
  id: string;
  text: string;
  createdBy: string;
  createdAt: string;
  triggerType: "time" | "date" | "recurring" | "note";
  triggerValue: string;   // ISO datetime, or cron-like for recurring, or "" for notes
  recurring?: string;     // "daily", "weekly", "monthly"
  fired: boolean;
  category?: string;      // "task", "date", "pet", "health", "family"
}

let checkInterval: ReturnType<typeof setInterval> | null = null;

function loadReminders(): Reminder[] {
  try {
    if (existsSync(REMINDERS_PATH)) {
      return JSON.parse(readFileSync(REMINDERS_PATH, "utf-8"));
    }
  } catch {}
  return [];
}

function saveReminders(reminders: Reminder[]): void {
  writeFileSync(REMINDERS_PATH, JSON.stringify(reminders, null, 2));
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// =====================================================================
// Parse natural language time expressions
// =====================================================================

function parseTimeExpression(text: string): { triggerType: "time" | "date" | "recurring" | "note"; triggerValue: string; recurring?: string } {
  const lower = text.toLowerCase();
  const now = new Date();

  // "dans X minutes/heures"
  const inMatch = lower.match(/dans\s+(\d+)\s*(minute|min|heure|h|seconde|sec)/);
  if (inMatch) {
    const amount = parseInt(inMatch[1]);
    const unit = inMatch[2];
    const ms = unit.startsWith("h") ? amount * 3600000 :
               unit.startsWith("min") ? amount * 60000 : amount * 1000;
    return { triggerType: "time", triggerValue: new Date(now.getTime() + ms).toISOString() };
  }

  // "à Xh" or "à X heures"
  const atMatch = lower.match(/[àa]\s*(\d{1,2})\s*[h:]\s*(\d{0,2})/);
  if (atMatch) {
    const h = parseInt(atMatch[1]);
    const m = parseInt(atMatch[2] || "0");
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return { triggerType: "time", triggerValue: target.toISOString() };
  }

  // "demain"
  if (/demain/.test(lower)) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const timeMatch = lower.match(/(\d{1,2})\s*[h:]\s*(\d{0,2})/);
    if (timeMatch) {
      tomorrow.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2] || "0"), 0, 0);
    } else {
      tomorrow.setHours(9, 0, 0, 0); // Default 9h
    }
    return { triggerType: "time", triggerValue: tomorrow.toISOString() };
  }

  // "lundi", "mardi", etc.
  const days = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  for (let i = 0; i < days.length; i++) {
    if (lower.includes(days[i])) {
      const target = new Date(now);
      const diff = (i - now.getDay() + 7) % 7 || 7;
      target.setDate(target.getDate() + diff);
      target.setHours(9, 0, 0, 0);
      return { triggerType: "date", triggerValue: target.toISOString() };
    }
  }

  // "tous les jours", "chaque jour", "chaque matin"
  if (/tous les jours|chaque jour|chaque matin/i.test(lower)) {
    return { triggerType: "recurring", triggerValue: "09:00", recurring: "daily" };
  }

  // "toutes les semaines", "chaque semaine"
  if (/toutes les semaines|chaque semaine/i.test(lower)) {
    return { triggerType: "recurring", triggerValue: "09:00", recurring: "weekly" };
  }

  // Default: note (no specific time — will be surfaced contextually)
  return { triggerType: "note", triggerValue: "" };
}

// =====================================================================
// Public API — Claude tool handlers
// =====================================================================

export async function handleReminderTool(input: Record<string, string>): Promise<string> {
  const action = (input.action || "create").toLowerCase();
  const text = input.text || "";
  const speaker = input.speaker || "default";
  const category = input.category || "task";
  const when = input.when || "";

  switch (action) {
    case "create":
    case "add":
      return createReminder(text, speaker, category, when);
    case "list":
      return listReminders(speaker);
    case "delete":
    case "remove":
      return deleteReminder(text);
    default:
      return createReminder(text, speaker, category, when);
  }
}

function createReminder(text: string, speaker: string, category: string, when: string): string {
  if (!text) return "Pas de contenu pour le rappel.";

  const parsed = when ? parseTimeExpression(when) : parseTimeExpression(text);
  const reminders = loadReminders();

  const reminder: Reminder = {
    id: generateId(),
    text,
    createdBy: speaker,
    createdAt: new Date().toISOString(),
    triggerType: parsed.triggerType,
    triggerValue: parsed.triggerValue,
    recurring: parsed.recurring,
    fired: false,
    category,
  };

  reminders.push(reminder);
  saveReminders(reminders);

  if (parsed.triggerType === "note") {
    return `Noté : "${text}". Je te le rappellerai au bon moment.`;
  } else if (parsed.triggerType === "recurring") {
    return `Rappel récurrent créé : "${text}" (${parsed.recurring}).`;
  } else {
    const when = new Date(parsed.triggerValue);
    const timeStr = when.toLocaleString("fr-FR", { 
      weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" 
    });
    return `Rappel créé pour ${timeStr} : "${text}".`;
  }
}

function listReminders(speaker: string): string {
  const reminders = loadReminders().filter(r => !r.fired || r.recurring);
  if (reminders.length === 0) return "Aucun rappel en cours.";

  const lines = reminders.slice(0, 10).map(r => {
    if (r.triggerType === "note") return `- ${r.text} (note)`;
    if (r.recurring) return `- ${r.text} (${r.recurring})`;
    const when = new Date(r.triggerValue);
    return `- ${r.text} (${when.toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })})`;
  });

  return `${reminders.length} rappel(s) :\n${lines.join("\n")}`;
}

function deleteReminder(text: string): string {
  const reminders = loadReminders();
  const lower = text.toLowerCase();
  const idx = reminders.findIndex(r => r.text.toLowerCase().includes(lower));
  if (idx === -1) return "Rappel non trouvé.";
  const removed = reminders.splice(idx, 1)[0];
  saveReminders(reminders);
  return `Rappel supprimé : "${removed.text}".`;
}

// =====================================================================
// Get pending notes for contextual surfacing
// =====================================================================

export function getPendingNotes(speaker?: string): string[] {
  const reminders = loadReminders();
  return reminders
    .filter(r => r.triggerType === "note" && !r.fired)
    .filter(r => !speaker || r.createdBy === speaker || r.createdBy === "default")
    .map(r => r.text);
}

// =====================================================================
// Background checker — fires timed reminders
// =====================================================================

async function checkReminders(): Promise<void> {
  if (isDNDActive() || isAudioBusy()) return;

  const reminders = loadReminders();
  const now = Date.now();
  let changed = false;

  for (const r of reminders) {
    if (r.fired && !r.recurring) continue;
    if (r.triggerType === "note") continue;

    if (r.triggerType === "time" || r.triggerType === "date") {
      const triggerTime = new Date(r.triggerValue).getTime();
      if (triggerTime <= now && triggerTime > now - 120000) { // Within last 2 min
        if (!r.fired) {
          console.log(`[REMINDER] Firing: "${r.text}"`);
          try {
            await playAudioFile(`${ASSETS_DIR}/bibop.wav`);
            const wav = await synthesize(`Rappel : ${r.text}`);
            await playAudioBytes(wav.toString("base64"));
          } catch (err) {
            console.error("[REMINDER] TTS error:", err);
          }
          r.fired = true;
          changed = true;
        }
      }
    }

    if (r.triggerType === "recurring" && r.recurring) {
      // Check if it's time for recurring reminder
      const [rh, rm] = r.triggerValue.split(":").map(Number);
      const nowDate = new Date();
      const h = parseInt(nowDate.toLocaleString("fr-FR", { hour: "numeric", timeZone: "Europe/Paris", hour12: false }));
      const m = nowDate.getMinutes();

      if (h === rh && m === rm) {
        const todayKey = nowDate.toISOString().slice(0, 10);
        const lastFiredKey = r.fired ? new Date(r.createdAt).toISOString().slice(0, 10) : "";
        if (lastFiredKey !== todayKey) {
          console.log(`[REMINDER] Recurring: "${r.text}"`);
          try {
            await playAudioFile(`${ASSETS_DIR}/bibop.wav`);
            const wav = await synthesize(`Rappel : ${r.text}`);
            await playAudioBytes(wav.toString("base64"));
          } catch (err) {
            console.error("[REMINDER] TTS error:", err);
          }
          r.createdAt = new Date().toISOString(); // Track last fired
          changed = true;
        }
      }
    }
  }

  if (changed) {
    // Clean old fired non-recurring reminders (>24h old)
    const cleaned = reminders.filter(r => {
      if (r.recurring) return true;
      if (r.triggerType === "note") return true;
      if (!r.fired) return true;
      return Date.now() - new Date(r.triggerValue).getTime() < 86400000;
    });
    saveReminders(cleaned);
  }
}

export function startReminderChecker(): void {
  checkInterval = setInterval(() => {
    checkReminders().catch(err => console.error("[REMINDER] Check error:", err));
  }, 30000); // Check every 30s
  checkInterval.unref();
  console.log("[REMINDER] Checker started");
}
