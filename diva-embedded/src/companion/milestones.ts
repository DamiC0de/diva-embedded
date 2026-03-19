/**
 * Milestones — Relationship anniversaries, weekly stories, yearly recap
 * Features: #63 #48 #66
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { listPersonas } from "../persona/engine.js";
import { getAllMemories } from "../tools/memory-tool.js";

const MILESTONES_PATH = "/opt/diva-embedded/data/milestones.json";

interface MilestoneData {
  personaCreationDates: Record<string, string>;  // speakerId → creation date
  lastWeeklyStory: string;                       // ISO date
  lastYearlyRecap: string;                       // ISO date
}

function loadData(): MilestoneData {
  try {
    if (existsSync(MILESTONES_PATH)) return JSON.parse(readFileSync(MILESTONES_PATH, "utf-8"));
  } catch {}
  return { personaCreationDates: {}, lastWeeklyStory: "", lastYearlyRecap: "" };
}

function saveData(data: MilestoneData): void {
  writeFileSync(MILESTONES_PATH, JSON.stringify(data, null, 2));
}

/**
 * Record when a persona was first created (for anniversary tracking)
 */
export function recordPersonaCreation(speakerId: string): void {
  const data = loadData();
  if (!data.personaCreationDates[speakerId]) {
    data.personaCreationDates[speakerId] = new Date().toISOString();
    saveData(data);
  }
}

/**
 * #63 — Check if today is an anniversary for any persona
 */
export function checkAnniversaries(): { speakerId: string; years: number }[] {
  const data = loadData();
  const today = new Date();
  const anniversaries: { speakerId: string; years: number }[] = [];

  for (const [id, dateStr] of Object.entries(data.personaCreationDates)) {
    const created = new Date(dateStr);
    if (created.getMonth() === today.getMonth() && created.getDate() === today.getDate()) {
      const years = today.getFullYear() - created.getFullYear();
      if (years > 0) {
        anniversaries.push({ speakerId: id, years });
      }
    }
  }

  return anniversaries;
}

/**
 * #48 — Generate weekly family story from memories
 */
export async function generateWeeklyStory(): Promise<string> {
  const personas = listPersonas();
  if (personas.length === 0) return "";

  const highlights: string[] = [];

  for (const persona of personas) {
    try {
      const memories = await getAllMemories();
      // Get recent memories (simplified — Mem0 doesn't have date filtering easily)
      const recent = memories.slice(-5);
      if (recent.length > 0) {
        const summary = recent.map(m => m.memory).join(", ");
        highlights.push(`${persona.name} : ${summary.slice(0, 100)}`);
      }
    } catch {}
  }

  if (highlights.length === 0) return "Pas assez de souvenirs cette semaine pour un resume.";

  const data = loadData();
  data.lastWeeklyStory = new Date().toISOString();
  saveData(data);

  return `Resume de la semaine de la famille : ${highlights.join(". ")}.`;
}

/**
 * #66 — Generate yearly recap
 */
export function generateYearlyRecapPrompt(): string {
  return `Genere un bilan de l'annee de la famille en utilisant memory_read pour retrouver les moments marquants. Fais-le de maniere chaleureuse et personnelle, avec une touche d'humour. Mentionne les progres, les decouvertes, les moments droles. Maximum 10 phrases.`;
}

/**
 * Should we generate a weekly story today? (Sunday evening)
 */
export function shouldGenerateWeeklyStory(): boolean {
  const now = new Date();
  if (now.getDay() !== 0) return false; // Sunday only
  const h = parseInt(now.toLocaleString("fr-FR", { hour: "numeric", timeZone: "Europe/Paris" }));
  if (h !== 19) return false; // 7pm only

  const data = loadData();
  const today = now.toISOString().slice(0, 10);
  return data.lastWeeklyStory.slice(0, 10) !== today;
}
