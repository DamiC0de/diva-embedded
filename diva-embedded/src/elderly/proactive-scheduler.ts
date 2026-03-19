/**
 * Proactive Scheduler — handles all time-based proactive features:
 * - Companionship check-ins (anti-isolation)
 * - Time/day announcements (Alzheimer)
 * - Morning briefing auto-trigger
 * - Daily wellness summary for caregiver
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { playAudioFile, playAudioBytes, recordAudio } from "../audio/audio-client.js";
import { synthesize } from "../tts/piper.js";
import { transcribeLocal } from "../stt/local-npu.js";
import { isDNDActive } from "../tools/dnd-manager.js";
import { isAudioBusy } from "../audio/audio-lock.js";
import { listPersonas, type PersonaProfile } from "../persona/engine.js";
import { searchMemory } from "../tools/memory-tool.js";
import { sendDailySummary } from "./notifications.js";
import { getComplianceRate, getMedicationLog } from "./medication-manager.js";

const ASSETS_DIR = "/opt/diva-embedded/assets";
const PROACTIVE_CONFIG_PATH = "/opt/diva-embedded/data/proactive-config.json";
const WELLNESS_LOG_PATH = "/opt/diva-embedded/data/wellness-log.json";

interface ProactiveConfig {
  companionshipTimes: string[];      // ["10:00", "16:00"]
  timeAnnouncementInterval: number;  // minutes, 0 = disabled
  dailySummaryTime: string;          // "21:00"
  enabled: boolean;
}

interface WellnessEntry {
  date: string;
  interactionCount: number;
  repeatedQuestions: number;
  mood: "positive" | "neutral" | "negative" | "unknown";
  notes: string[];
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastTimeAnnouncement = 0;
let lastCompanionshipCheck = "";
let lastDailySummary = "";

// Interaction tracking for wellness
let dailyInteractionCount = 0;
let dailyRepeatedQuestions = 0;
const dailyNotes: string[] = [];

export function trackInteraction(): void {
  dailyInteractionCount++;
}

export function trackRepeatedQuestion(): void {
  dailyRepeatedQuestions++;
}

export function addWellnessNote(note: string): void {
  dailyNotes.push(note);
}

function loadConfig(): ProactiveConfig {
  try {
    if (existsSync(PROACTIVE_CONFIG_PATH)) {
      return JSON.parse(readFileSync(PROACTIVE_CONFIG_PATH, "utf-8"));
    }
  } catch {}

  const defaults: ProactiveConfig = {
    companionshipTimes: ["10:00", "16:00"],
    timeAnnouncementInterval: 120, // every 2 hours
    dailySummaryTime: "21:00",
    enabled: true,
  };
  writeFileSync(PROACTIVE_CONFIG_PATH, JSON.stringify(defaults, null, 2));
  return defaults;
}

async function speakProactive(text: string): Promise<void> {
  if (isDNDActive() || isAudioBusy()) {
    console.log("[PROACTIVE] Skipped (audio busy or DND)");
    return;
  }
  try {
    await playAudioFile(`${ASSETS_DIR}/listen.wav`);
    const wav = await synthesize(text, 1.2); // Slightly slower for proactive
    await playAudioBytes(wav.toString("base64"));
  } catch (err) {
    console.error("[PROACTIVE] TTS error:", err);
  }
}

function getCurrentTimeHHMM(): string {
  return new Date().toLocaleTimeString("fr-FR", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris", hour12: false,
  });
}

// --- Time Announcement ---

async function announceTime(): Promise<void> {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("fr-FR", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris"
  });
  const dayStr = now.toLocaleDateString("fr-FR", {
    weekday: "long", timeZone: "Europe/Paris"
  });

  const h = parseInt(now.toLocaleString("fr-FR", { hour: "numeric", timeZone: "Europe/Paris" }));
  let context = "";
  if (h >= 7 && h < 9) context = " C'est l'heure du petit-dejeuner.";
  else if (h >= 12 && h < 13) context = " C'est bientot l'heure du dejeuner.";
  else if (h >= 18 && h < 19) context = " C'est bientot l'heure du diner.";

  await speakProactive(`Il est ${timeStr}. Nous sommes ${dayStr}.${context}`);
}

// --- Companionship Check-in ---

async function companionshipCheckin(): Promise<void> {
  const personas = listPersonas();
  // Check all personas with initiative level medium or higher
  const eligiblePersonas = personas.filter((p) => {
    const level = p.communicationPrefs?.initiativeLevel || "low";
    return ["medium", "high", "chatty"].includes(level);
  });

  if (eligiblePersonas.length === 0) return;

  const persona = eligiblePersonas[0];
  const name = persona.greetingName || "vous";
  const useTu = persona.communicationPrefs?.tutoiement ?? false;

  // Try to get a contextual greeting from Mem0
  let contextualGreeting = "";
  try {
    const recentMemories = await searchMemory("conversation recente");
    if (recentMemories.length > 0) {
      const lastMemory = recentMemories[0].memory;
      if (useTu) {
        contextualGreeting = `${name}, la derniere fois tu me parlais de ${lastMemory.slice(0, 80)}. Comment ca va depuis ?`;
      } else {
        contextualGreeting = `${name}, la derniere fois vous me parliez de ${lastMemory.slice(0, 80)}. Comment allez-vous depuis ?`;
      }
    }
  } catch {}

  // Fallback to personalized but generic greetings
  if (!contextualGreeting) {
    const h = parseInt(new Date().toLocaleString("fr-FR", { hour: "numeric", timeZone: "Europe/Paris" }));
    const tuGreetings = [
      `${name}, comment tu vas ?`,
      `Hey ${name} ! Ca va bien ?`,
      h < 12 ? `${name}, tu as bien dormi ?` : `${name}, tu passes un bon apres-midi ?`,
      `${name}, ca fait un moment qu'on a pas discute ! Quoi de neuf ?`,
    ];
    const vousGreetings = [
      `${name}, comment allez-vous ?`,
      `Bonjour ${name} ! Est-ce que tout va bien ?`,
      h < 12 ? `${name}, avez-vous bien dormi ?` : `${name}, vous passez un bon apres-midi ?`,
      `${name}, je voulais prendre de vos nouvelles.`,
    ];
    const greetings = useTu ? tuGreetings : vousGreetings;
    contextualGreeting = greetings[Math.floor(Math.random() * greetings.length)];
  }

  await speakProactive(contextualGreeting);

  // Listen for response (optional — just checking if they're responsive)
  try {
    const recorded = await recordAudio({ maxDurationS: 10, silenceTimeoutS: 2 });
    if (recorded.has_speech && recorded.wav_base64) {
      const wav = Buffer.from(recorded.wav_base64, "base64");
      const response = await transcribeLocal(wav);
      console.log(`[COMPANION] Response: "${response}"`);
      addWellnessNote(`Check-in response: "${response}"`);

      // Simple mood detection
      const lower = response.toLowerCase();
      if (/bien|super|ca va|forme|content/i.test(lower)) {
        await speakProactive("Tant mieux ! N'hésitez pas si vous avez besoin de quelque chose.");
      } else if (/mal|pas bien|fatigue|triste|seul/i.test(lower)) {
        await speakProactive("Je suis désolée d'entendre ça. Je suis là pour vous. Voulez-vous qu'on discute un peu ?");
        addWellnessNote("Mood: negative");
      } else {
        await speakProactive("D'accord ! Je suis là si vous avez besoin.");
      }
    } else {
      addWellnessNote("Check-in: no response");
    }
  } catch {}
}

// --- Daily Summary ---

async function generateDailySummary(): Promise<void> {
  const personas = listPersonas();
  const elderlyPersonas = personas.filter((p) => p.proactiveCheckins);

  for (const persona of elderlyPersonas) {
    const compliance = getComplianceRate(1);
    const medLog = getMedicationLog(1);

    const summary = [
      `Resume du ${new Date().toLocaleDateString("fr-FR")} pour ${persona.name}:`,
      `- ${dailyInteractionCount} interactions aujourd'hui`,
      `- ${dailyRepeatedQuestions} questions repetees`,
      medLog.length > 0 ? `- Medicaments: ${compliance}% de compliance` : "",
      dailyNotes.length > 0 ? `- Notes: ${dailyNotes.join("; ")}` : "",
    ].filter(Boolean).join("\n");

    await sendDailySummary(persona.name, summary);
    console.log(`[SUMMARY] Daily summary sent for ${persona.name}`);
  }

  // Reset daily counters
  dailyInteractionCount = 0;
  dailyRepeatedQuestions = 0;
  dailyNotes.length = 0;
}

// --- Scheduler ---

async function tick(): Promise<void> {
  if (isDNDActive() || isAudioBusy()) return;

  const config = loadConfig();
  if (!config.enabled) return;

  const now = getCurrentTimeHHMM();
  const nowMs = Date.now();

  // Time announcement
  if (config.timeAnnouncementInterval > 0) {
    const intervalMs = config.timeAnnouncementInterval * 60 * 1000;
    if (nowMs - lastTimeAnnouncement >= intervalMs) {
      const h = parseInt(new Date().toLocaleString("fr-FR", { hour: "numeric", timeZone: "Europe/Paris" }));
      if (h >= 7 && h <= 21) { // Only during waking hours
        await announceTime();
        lastTimeAnnouncement = nowMs;
      }
    }
  }

  // Companionship check-in
  if (config.companionshipTimes.includes(now) && lastCompanionshipCheck !== now) {
    lastCompanionshipCheck = now;
    await companionshipCheckin();
  }

  // Daily summary
  if (config.dailySummaryTime === now && lastDailySummary !== new Date().toISOString().slice(0, 10)) {
    lastDailySummary = new Date().toISOString().slice(0, 10);
    await generateDailySummary();
  }
}

export function startProactiveScheduler(): void {
  const config = loadConfig();
  console.log(`[PROACTIVE] Scheduler started (companionship: ${config.companionshipTimes.join(",")}, time interval: ${config.timeAnnouncementInterval}min)`);

  schedulerInterval = setInterval(() => {
    tick().catch((err) => console.error("[PROACTIVE] Tick error:", err));
  }, 60000); // Check every minute
  schedulerInterval.unref();
}

export function stopProactiveScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
