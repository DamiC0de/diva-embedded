/**
 * Life Journal — Passive life logging, capsules, transmission, wellness scoring
 * Features: #65 #97 #52 #72 #53
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { getAllMemories } from "../tools/memory-tool.js";

const JOURNAL_DIR = "/opt/diva-embedded/data/journal";
const CAPSULES_DIR = "/opt/diva-embedded/data/capsules";

// =====================================================================
// #52 — Passive Life Journal (daily summary from interactions)
// =====================================================================

interface DayEntry {
  date: string;
  interactions: number;
  repeatedQuestions: number;
  topics: string[];
  mood: string;
  firstInteraction: string;  // time
  lastInteraction: string;   // time
  notes: string[];
}

function getJournalPath(speakerId: string): string {
  return `${JOURNAL_DIR}/${speakerId}-journal.json`;
}

function loadJournal(speakerId: string): DayEntry[] {
  const path = getJournalPath(speakerId);
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8"));
  } catch {}
  return [];
}

function saveJournal(speakerId: string, entries: DayEntry[]): void {
  if (!existsSync(JOURNAL_DIR)) mkdirSync(JOURNAL_DIR, { recursive: true });
  writeFileSync(getJournalPath(speakerId), JSON.stringify(entries.slice(-365), null, 2));
}

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function logDailyInteraction(speakerId: string, transcription: string, mood?: string): void {
  const journal = loadJournal(speakerId);
  const today = getTodayKey();
  const now = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

  let entry = journal.find(e => e.date === today);
  if (!entry) {
    entry = {
      date: today,
      interactions: 0,
      repeatedQuestions: 0,
      topics: [],
      mood: "neutral",
      firstInteraction: now,
      lastInteraction: now,
      notes: [],
    };
    journal.push(entry);
  }

  entry.interactions++;
  entry.lastInteraction = now;
  if (mood) entry.mood = mood;

  // Extract simple topic keywords
  const keywords = transcription.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 4)
    .slice(0, 3);
  entry.topics.push(...keywords);
  // Keep unique, last 20
  entry.topics = [...new Set(entry.topics)].slice(-20);

  saveJournal(speakerId, journal);
}

export function logRepeatedQuestion(speakerId: string): void {
  const journal = loadJournal(speakerId);
  const today = getTodayKey();
  const entry = journal.find(e => e.date === today);
  if (entry) {
    entry.repeatedQuestions++;
    saveJournal(speakerId, journal);
  }
}

// =====================================================================
// #72 — Passive Sleep Journal
// =====================================================================

export function logSleepEvent(speakerId: string, event: "goodnight" | "goodmorning"): void {
  const journal = loadJournal(speakerId);
  const today = getTodayKey();
  const now = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

  let entry = journal.find(e => e.date === today);
  if (!entry) {
    entry = {
      date: today, interactions: 0, repeatedQuestions: 0,
      topics: [], mood: "neutral", firstInteraction: now, lastInteraction: now, notes: [],
    };
    journal.push(entry);
  }

  if (event === "goodnight") {
    entry.notes.push(`Coucher: ${now}`);
  } else {
    entry.notes.push(`Lever: ${now}`);
  }

  saveJournal(speakerId, journal);
}

// =====================================================================
// #53 — Wellness Score
// =====================================================================

export function getWellnessScore(speakerId: string, days: number = 7): {
  score: number;
  trend: "up" | "down" | "stable";
  details: string;
} {
  const journal = loadJournal(speakerId);
  const recent = journal.slice(-days);
  if (recent.length === 0) return { score: 50, trend: "stable", details: "Pas assez de donnees." };

  const avgInteractions = recent.reduce((s, e) => s + e.interactions, 0) / recent.length;
  const avgRepeats = recent.reduce((s, e) => s + e.repeatedQuestions, 0) / recent.length;
  const daysWithInteraction = recent.filter(e => e.interactions > 0).length;

  // Simple scoring: 0-100
  let score = 50;
  score += Math.min(daysWithInteraction / days * 20, 20);  // Active days
  score += Math.min(avgInteractions * 3, 20);               // Engagement
  score -= Math.min(avgRepeats * 5, 20);                    // Repetitions penalize

  // Trend
  const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
  const secondHalf = recent.slice(Math.floor(recent.length / 2));
  const avgFirst = firstHalf.reduce((s, e) => s + e.interactions, 0) / (firstHalf.length || 1);
  const avgSecond = secondHalf.reduce((s, e) => s + e.interactions, 0) / (secondHalf.length || 1);
  const trend = avgSecond > avgFirst * 1.2 ? "up" : avgSecond < avgFirst * 0.8 ? "down" : "stable";

  const details = `${Math.round(score)}/100 — ${daysWithInteraction}/${days} jours actifs, ${Math.round(avgInteractions)} interactions/jour en moyenne, ${Math.round(avgRepeats)} repetitions/jour.`;

  return { score: Math.round(Math.max(0, Math.min(100, score))), trend, details };
}

// =====================================================================
// #65 — Time Capsules
// =====================================================================

interface TimeCapsule {
  id: string;
  createdBy: string;
  createdAt: string;
  deliverAt: string;     // ISO date
  message: string;
  delivered: boolean;
}

function loadCapsules(): TimeCapsule[] {
  const path = `${CAPSULES_DIR}/capsules.json`;
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8"));
  } catch {}
  return [];
}

function saveCapsules(capsules: TimeCapsule[]): void {
  if (!existsSync(CAPSULES_DIR)) mkdirSync(CAPSULES_DIR, { recursive: true });
  writeFileSync(`${CAPSULES_DIR}/capsules.json`, JSON.stringify(capsules, null, 2));
}

export function createCapsule(speaker: string, message: string, deliverIn: string): string {
  const capsules = loadCapsules();

  // Parse delivery time
  let deliverDate = new Date();
  const match = deliverIn.match(/(\d+)\s*(jour|semaine|mois|an)/i);
  if (match) {
    const amount = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit.startsWith("jour")) deliverDate.setDate(deliverDate.getDate() + amount);
    else if (unit.startsWith("semaine")) deliverDate.setDate(deliverDate.getDate() + amount * 7);
    else if (unit.startsWith("mois")) deliverDate.setMonth(deliverDate.getMonth() + amount);
    else if (unit.startsWith("an")) deliverDate.setFullYear(deliverDate.getFullYear() + amount);
  } else {
    deliverDate.setFullYear(deliverDate.getFullYear() + 1); // Default: 1 year
  }

  capsules.push({
    id: Date.now().toString(36),
    createdBy: speaker,
    createdAt: new Date().toISOString(),
    deliverAt: deliverDate.toISOString(),
    message,
    delivered: false,
  });
  saveCapsules(capsules);

  const dateStr = deliverDate.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return `Capsule temporelle creee ! Je te la lirai le ${dateStr}.`;
}

export function checkCapsulesToDeliver(): TimeCapsule[] {
  const capsules = loadCapsules();
  const now = Date.now();
  const toDeliver = capsules.filter(c => !c.delivered && new Date(c.deliverAt).getTime() <= now);

  if (toDeliver.length > 0) {
    for (const c of toDeliver) c.delivered = true;
    saveCapsules(capsules);
  }

  return toDeliver;
}

// =====================================================================
// #97 — Family Transmission (store stories)
// =====================================================================

interface FamilyStory {
  id: string;
  teller: string;      // who told the story
  date: string;
  content: string;
  tags: string[];
}

function loadStories(): FamilyStory[] {
  const path = `${CAPSULES_DIR}/family-stories.json`;
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8"));
  } catch {}
  return [];
}

function saveStories(stories: FamilyStory[]): void {
  writeFileSync(`${CAPSULES_DIR}/family-stories.json`, JSON.stringify(stories, null, 2));
}

export function addFamilyStory(teller: string, content: string, tags: string[] = []): string {
  const stories = loadStories();
  stories.push({
    id: Date.now().toString(36),
    teller,
    date: new Date().toISOString(),
    content,
    tags,
  });
  saveStories(stories);
  return `Histoire enregistree. La famille pourra la reecouter plus tard.`;
}

export function searchFamilyStories(query: string): FamilyStory[] {
  const stories = loadStories();
  const lower = query.toLowerCase();
  return stories.filter(s =>
    s.content.toLowerCase().includes(lower) ||
    s.teller.toLowerCase().includes(lower) ||
    s.tags.some(t => t.toLowerCase().includes(lower))
  );
}

// =====================================================================
// Claude tool handler
// =====================================================================

export async function handleJournalTool(input: Record<string, string>): Promise<string> {
  const action = (input.action || "wellness").toLowerCase();
  const speaker = input.speaker || "default";

  switch (action) {
    case "wellness": {
      const { score, trend, details } = getWellnessScore(speaker);
      const trendFr = trend === "up" ? "en hausse" : trend === "down" ? "en baisse" : "stable";
      return `Score de bien-etre : ${details} Tendance : ${trendFr}.`;
    }
    case "capsule": {
      const message = input.message || input.text || "";
      const when = input.when || "1 an";
      if (!message) return "Quel message veux-tu mettre dans la capsule ?";
      return createCapsule(speaker, message, when);
    }
    case "story":
    case "histoire": {
      const content = input.content || input.text || "";
      if (!content) return "Raconte-moi l'histoire et je la garderai pour la famille.";
      return addFamilyStory(speaker, content);
    }
    case "search_stories": {
      const query = input.query || "";
      const stories = searchFamilyStories(query);
      if (stories.length === 0) return "Aucune histoire trouvee.";
      return stories.slice(0, 3).map(s =>
        `${s.teller} a raconte : "${s.content.slice(0, 100)}..."`
      ).join(" ");
    }
    default:
      return getWellnessScore(speaker).details;
  }
}
