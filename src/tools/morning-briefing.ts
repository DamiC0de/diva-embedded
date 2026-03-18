/**
 * Morning Briefing — personalized daily greeting
 * "Diva, bonjour" → weather + reminders + news adapted per persona
 */

import { getCurrentPersona } from "../persona/engine.js";
import { listTimers } from "./timer-manager.js";
import { readList } from "./shopping-list.js";

interface BriefingSection {
  content: string;
}

async function getWeather(city: string = "Bouclans"): Promise<string> {
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=%C+%t+%h&lang=fr`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return "";
    return (await res.text()).trim();
  } catch {
    return "";
  }
}

export async function generateBriefing(): Promise<string> {
  const persona = getCurrentPersona();
  const now = new Date();
  const hour = now.toLocaleString("fr-FR", { hour: "numeric", timeZone: "Europe/Paris" });
  const h = parseInt(hour);

  // Time-appropriate greeting
  let greeting: string;
  if (h >= 5 && h < 12) greeting = "Bonjour";
  else if (h >= 12 && h < 18) greeting = "Bon apres-midi";
  else greeting = "Bonsoir";

  if (persona.greetingName) {
    greeting += ` ${persona.greetingName}`;
  }

  const parts: string[] = [`${greeting} !`];

  // Date
  const dateStr = now.toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
    timeZone: "Europe/Paris"
  });
  parts.push(`Nous sommes ${dateStr}.`);

  // Weather
  const weather = await getWeather();
  if (weather) {
    parts.push(`Meteo : ${weather}.`);
  }

  // Active timers/reminders
  const timers = listTimers();
  if (timers.length > 0) {
    const timerDesc = timers.map((t) => {
      const min = Math.floor(t.remainingS / 60);
      return t.message || `${t.label} dans ${min} minutes`;
    });
    parts.push(`Rappels : ${timerDesc.join(", ")}.`);
  }

  // Shopping list summary (skip for children)
  if (persona.type !== "child") {
    const shopItems = readList();
    if (!shopItems.includes("vide")) {
      parts.push(shopItems);
    }
  }

  // Persona-specific adaptations
  if (persona.type === "alzheimer") {
    // Keep it simple and reassuring
    return `${greeting} ! Nous sommes ${dateStr}. ${weather ? `Il fait ${weather}.` : ""} Tout va bien.`;
  }

  if (persona.type === "child") {
    return `${greeting} ! On est ${dateStr}. ${weather ? `Dehors il fait ${weather}.` : ""} Bonne journee !`;
  }

  return parts.join(" ");
}
