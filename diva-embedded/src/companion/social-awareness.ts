/**
 * Social & Cultural Awareness — Ideas #46, #47, #49, #59, #63, #65, #66-70, #74, #78, #83, #87, #95
 * Comprehensive module covering all remaining social, learning, and infrastructure ideas.
 */

import { log } from "../monitoring/logger.js";

// =====================================================================
// #46 — Implicit dissatisfaction detection
// =====================================================================

const DISSATISFACTION_SIGNALS = [
  { pattern: /laisse tomber|oublie|tant pis/i, signal: "gave_up" },
  { pattern: /c.est nul|t.es nulle|ca marche pas/i, signal: "frustration" },
  { pattern: /non|pas ca|l.autre/i, signal: "correction" },
];

export function detectDissatisfaction(text: string): string | null {
  for (const { pattern, signal } of DISSATISFACTION_SIGNALS) {
    if (pattern.test(text)) return signal;
  }
  return null;
}

// =====================================================================
// #47 — Contextual ambiguity mapping (room/time preferences)
// =====================================================================

interface AmbiguityMap {
  entity: string; // "la lumiere"
  context: string; // "chambre_marie_soir"
  resolution: string; // "lampe de chevet"
}

const ambiguityMaps = new Map<string, AmbiguityMap[]>();

export function recordAmbiguityResolution(speakerId: string, entity: string, context: string, resolution: string): void {
  const maps = ambiguityMaps.get(speakerId) || [];
  const existing = maps.find(m => m.entity === entity && m.context === context);
  if (existing) {
    existing.resolution = resolution;
  } else {
    maps.push({ entity, context, resolution });
  }
  ambiguityMaps.set(speakerId, maps);
}

export function resolveAmbiguity(speakerId: string, entity: string, context: string): string | null {
  const maps = ambiguityMaps.get(speakerId) || [];
  const match = maps.find(m => m.entity === entity && m.context === context);
  return match?.resolution || null;
}

// =====================================================================
// #49 — Evolving taste profile per domain
// =====================================================================

interface TasteProfile {
  music: { liked: string[]; disliked: string[] };
  food: { liked: string[]; disliked: string[]; allergies: string[] };
  media: { liked: string[]; disliked: string[] };
  activities: { liked: string[]; disliked: string[] };
}

const tasteProfiles = new Map<string, TasteProfile>();

export function getTasteProfile(speakerId: string): TasteProfile {
  return tasteProfiles.get(speakerId) || {
    music: { liked: [], disliked: [] },
    food: { liked: [], disliked: [], allergies: [] },
    media: { liked: [], disliked: [] },
    activities: { liked: [], disliked: [] },
  };
}

export function recordTaste(speakerId: string, domain: keyof TasteProfile, item: string, liked: boolean): void {
  const profile = getTasteProfile(speakerId);
  const list = liked ? profile[domain].liked : profile[domain].disliked;
  if (!list.includes(item)) list.push(item);
  tasteProfiles.set(speakerId, profile);
  log.debug("Taste recorded", { speakerId, domain, item, liked });
}

// =====================================================================
// #59 — Temporal emotional intelligence (day-of-week awareness)
// =====================================================================

export function getTemporalMood(): { dayType: string; suggestion: string | null } {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();

  if (day === 5 && hour >= 18) return { dayType: "friday_evening", suggestion: "C'est vendredi soir, detends-toi !" };
  if (day === 6) return { dayType: "saturday", suggestion: null };
  if (day === 0 && hour <= 10) return { dayType: "sunday_morning", suggestion: null }; // Calm mode
  if (day === 1 && hour >= 6 && hour <= 9) return { dayType: "monday_morning", suggestion: null }; // Ultra-brief
  return { dayType: "normal", suggestion: null };
}

export function shouldReduceBriefing(): boolean {
  const { dayType } = getTemporalMood();
  return dayType === "friday_evening" || dayType === "sunday_morning";
}

// =====================================================================
// #63 — Feature flags
// =====================================================================

const featureFlags = new Map<string, boolean>();

export function setFeatureFlag(flag: string, enabled: boolean): void {
  featureFlags.set(flag, enabled);
  log.info("Feature flag updated", { flag, enabled });
}

export function isFeatureEnabled(flag: string, defaultValue = true): boolean {
  return featureFlags.get(flag) ?? defaultValue;
}

export function getAllFeatureFlags(): Record<string, boolean> {
  return Object.fromEntries(featureFlags);
}

// =====================================================================
// #65 — Changelog vocal
// =====================================================================

let pendingChangelog: string | null = null;

export function setChangelog(message: string): void {
  pendingChangelog = message;
}

export function consumeChangelog(): string | null {
  const msg = pendingChangelog;
  pendingChangelog = null;
  return msg;
}

// =====================================================================
// #66 — Family recomposition (dynamic family links)
// =====================================================================

interface FamilyLink {
  from: string; // speakerId
  to: string; // name
  relation: string; // "papa", "maman", "belle-mere", "demi-frere"
  notes?: string;
}

const familyLinks = new Map<string, FamilyLink[]>();

export function addFamilyLink(from: string, to: string, relation: string): void {
  const links = familyLinks.get(from) || [];
  links.push({ from, to, relation });
  familyLinks.set(from, links);
}

export function getFamilyLinks(speakerId: string): FamilyLink[] {
  return familyLinks.get(speakerId) || [];
}

// =====================================================================
// #67 — Multi-confessional calendar
// =====================================================================

interface CulturalEvent {
  name: string;
  type: "religious" | "cultural" | "national";
  noMealReminder?: boolean; // Ramadan fasting
  quiet?: boolean; // Shabbat
}

const culturalCalendar = new Map<string, CulturalEvent[]>(); // date string -> events

export function addCulturalEvent(date: string, event: CulturalEvent): void {
  const events = culturalCalendar.get(date) || [];
  events.push(event);
  culturalCalendar.set(date, events);
}

export function getCulturalEventsToday(): CulturalEvent[] {
  const today = new Date().toISOString().slice(0, 10);
  return culturalCalendar.get(today) || [];
}

export function shouldSuppressMealReminder(): boolean {
  return getCulturalEventsToday().some(e => e.noMealReminder);
}

// =====================================================================
// #68 — Sensitive topics navigation (in system prompt)
// #69 — Diverse visitor adaptation (in system prompt)
// These are handled via system-prompt.ts enhancements
// =====================================================================

// =====================================================================
// #70 — Grief mode
// =====================================================================

interface GriefDate {
  speakerId: string;
  date: string; // MM-DD format
  person: string;
  relation: string;
}

const griefDates: GriefDate[] = [];

export function addGriefDate(speakerId: string, monthDay: string, person: string, relation: string): void {
  griefDates.push({ speakerId, date: monthDay, person, relation });
  log.info("Grief date recorded", { speakerId, person, date: monthDay });
}

export function isGriefDay(speakerId: string): GriefDate | null {
  const today = new Date().toISOString().slice(5, 10); // MM-DD
  return griefDates.find(g => g.speakerId === speakerId && g.date === today) || null;
}

export function getGriefBehavior(): { noGames: boolean; gentle: boolean; suggestMusic: boolean } {
  return { noGames: true, gentle: true, suggestMusic: true };
}

// =====================================================================
// #74 — Double request detection
// =====================================================================

const lastRequests = new Map<string, { text: string; timestamp: number }>();

export function isDuplicateRequest(speakerId: string, text: string): boolean {
  const last = lastRequests.get(speakerId);
  if (last && last.text === text && Date.now() - last.timestamp < 10000) {
    log.debug("Duplicate request detected", { speakerId, text: text.slice(0, 30) });
    return true;
  }
  lastRequests.set(speakerId, { text, timestamp: Date.now() });
  return false;
}

// =====================================================================
// #78 — Auto volume adaptation
// =====================================================================

export function getRecommendedVolume(ambientNoiseLevel: number): number {
  // Scale 0-100
  if (ambientNoiseLevel > 70) return 90; // Loud environment
  if (ambientNoiseLevel > 40) return 70; // Normal
  if (ambientNoiseLevel > 20) return 50; // Quiet
  return 30; // Very quiet (night)
}

// =====================================================================
// #83 — NPU arbitration
// =====================================================================

type NPUTask = "stt" | "intent" | "embeddings" | "tts";

const NPU_PRIORITIES: Record<NPUTask, number> = {
  stt: 1,      // Highest
  intent: 2,
  tts: 3,
  embeddings: 4, // Lowest
};

let currentNPUTask: NPUTask | null = null;

export function canRunNPUTask(task: NPUTask): boolean {
  if (!currentNPUTask) return true;
  return NPU_PRIORITIES[task] <= NPU_PRIORITIES[currentNPUTask];
}

export function acquireNPU(task: NPUTask): boolean {
  if (canRunNPUTask(task)) {
    currentNPUTask = task;
    return true;
  }
  return false;
}

export function releaseNPU(): void {
  currentNPUTask = null;
}

// =====================================================================
// #87 — SD card resilience (tmpfs for frequent writes)
// =====================================================================

export function getTmpfsPath(filename: string): string {
  return `/dev/shm/diva-${filename}`;
}

export function shouldUseTmpfs(writeFrequency: "high" | "medium" | "low"): boolean {
  return writeFrequency === "high"; // Logs, metrics → tmpfs
}

// =====================================================================
// #95 — Interrupt priority
// =====================================================================

type InterruptPriority = "emergency" | "anomaly" | "presence" | "proactive";

const INTERRUPT_WEIGHTS: Record<InterruptPriority, number> = {
  emergency: 100,
  anomaly: 80,
  presence: 40,
  proactive: 10,
};

export function shouldInterrupt(currentActivity: string, interruptType: InterruptPriority): boolean {
  const weight = INTERRUPT_WEIGHTS[interruptType];
  // Always interrupt for emergency
  if (weight >= 80) return true;
  // Don't interrupt conversations for low-priority
  if (currentActivity === "conversation" && weight < 50) return false;
  return true;
}
