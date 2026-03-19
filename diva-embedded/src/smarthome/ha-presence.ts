/**
 * Home Assistant Presence & Sensor Triggers
 * Receives webhooks from HA automations for:
 * - Motion/presence sensors (Tapo, door contacts)
 * - Person arrival/departure
 * - Sensor anomalies (door open late, oven on too long)
 * Features: #1 #33 #13 #75 #83 #84 #87
 */

import { playAudioFile, playAudioBytes } from "../audio/audio-client.js";
import { synthesize } from "../tts/piper.js";
import { isDNDActive } from "../tools/dnd-manager.js";
import { isAudioBusy, setAudioBusy } from "../audio/audio-lock.js";
import { getPersona, setCurrentPersona, listPersonas, type PersonaProfile } from "../persona/engine.js";
import { getTodayEvents, formatEventsForVoice, isAuthenticated as isCalendarAuth } from "../calendar/google-calendar.js";
import { getPendingNotes } from "../tools/reminder-manager.js";

const ASSETS_DIR = "/opt/diva-embedded/assets";

interface PresenceEvent {
  type: "arrival" | "departure" | "motion" | "door" | "anomaly" | "scene";
  person?: string;       // speaker ID or name, if identifiable
  zone?: string;         // "kitchen", "entrance", "bedroom"
  entity_id?: string;
  data?: Record<string, unknown>;
}

// Rate limiting
const lastEvents = new Map<string, number>();
const COOLDOWN_MS = 60000; // 1 min between same events

function shouldProcess(event: PresenceEvent): boolean {
  if (isDNDActive()) return false;
  const key = `${event.type}:${event.person || ""}:${event.zone || ""}`;
  const last = lastEvents.get(key);
  if (last && Date.now() - last < COOLDOWN_MS) return false;
  lastEvents.set(key, Date.now());
  return true;
}

async function speak(text: string): Promise<void> {
  try {
    const wav = await synthesize(text);
    await playAudioBytes(wav.toString("base64"));
  } catch (err) {
    console.error("[HA-PRESENCE] TTS error:", err);
  }
}

// =====================================================================
// Arrival — #33 Joie au retour + #1 Briefing matinal
// =====================================================================

async function handleArrival(event: PresenceEvent): Promise<void> {
  const personName = event.person || "";
  const persona = personName ? getPersona(personName) : null;
  const h = parseInt(new Date().toLocaleString("fr-FR", { hour: "numeric", timeZone: "Europe/Paris" }));

  if (persona && personName) {
    setCurrentPersona(personName);
    const name = persona.greetingName || personName;
    const useTu = persona.communicationPrefs?.tutoiement ?? true;

    // Greeting adapted by persona type and time
    let greeting = "";
    if (h >= 6 && h < 10) {
      greeting = useTu ? `Bonjour ${name} !` : `Bonjour ${name}, comment allez-vous ?`;
    } else if (h >= 16 && h < 18 && persona.type === "child") {
      greeting = `Salut ${name} ! Ca s'est bien passe a l'ecole ?`;
    } else if (h >= 17 && h < 20) {
      greeting = useTu ? `Ah ${name}, te voila !` : `${name}, bon retour !`;
    } else {
      greeting = useTu ? `Hey ${name} !` : `Bonjour ${name} !`;
    }

    // Morning briefing (#1) — add events + reminders if morning arrival
    if (h >= 6 && h < 10) {
      const parts = [greeting];

      // Calendar events
      if (isCalendarAuth()) {
        try {
          const events = await getTodayEvents();
          if (events.length > 0) {
            parts.push("Aujourd'hui : " + formatEventsForVoice(events.slice(0, 3)));
          }
        } catch {}
      }

      // Pending reminders
      const notes = getPendingNotes(personName);
      if (notes.length > 0) {
        parts.push("Rappel : " + notes[0] + ".");
      }

      await speak(parts.join(" "));
    } else {
      await speak(greeting);
    }
  } else {
    // Unknown person — simple sound
    await playAudioFile(`${ASSETS_DIR}/oui.wav`);
  }

  console.log(`[HA-PRESENCE] Arrival: ${personName || "unknown"} at ${event.zone || "?"}`);
}

// =====================================================================
// Anomaly — #87 Alerte anomalie domestique
// =====================================================================

async function handleAnomaly(event: PresenceEvent): Promise<void> {
  const entityId = event.entity_id || "";
  const data = event.data || {};
  const message = String(data.message || `Attention, anomalie detectee sur ${entityId}.`);

  console.log(`[HA-PRESENCE] Anomaly: ${entityId} — ${message}`);
  await playAudioFile(`${ASSETS_DIR}/bibop.wav`);
  await speak(message);
}

// =====================================================================
// Scene — #83 Scènes émotionnelles
// =====================================================================

async function handleScene(event: PresenceEvent): Promise<void> {
  const sceneName = String(event.data?.scene || "");
  const confirmations: Record<string, string> = {
    "soiree_tranquille": "Ambiance soiree tranquille activee.",
    "film": "Mode film active. Bon visionnage !",
    "fete": "C'est la fete !",
    "nuit": "Bonne nuit, je passe en mode calme.",
    "matin": "Bonjour ! Belle journee en perspective.",
    "concentration": "Mode concentration. Je ne te derangerai pas.",
  };
  const msg = confirmations[sceneName] || `Scene ${sceneName} activee.`;
  await speak(msg);
  console.log(`[HA-PRESENCE] Scene: ${sceneName}`);
}

// =====================================================================
// Main handler — called from HA webhook
// =====================================================================

export async function handlePresenceEvent(event: PresenceEvent): Promise<void> {
  if (!shouldProcess(event)) return;

  // Don't interrupt active conversation
  if (isAudioBusy()) {
    console.log(`[HA-PRESENCE] Skipped (audio busy): ${event.type}`);
    return;
  }

  switch (event.type) {
    case "arrival":
      await handleArrival(event);
      break;
    case "departure":
      console.log(`[HA-PRESENCE] Departure: ${event.person || "unknown"}`);
      break;
    case "anomaly":
      await handleAnomaly(event);
      break;
    case "scene":
      await handleScene(event);
      break;
    case "motion":
      // Motion in specific zones could trigger contextual actions
      console.log(`[HA-PRESENCE] Motion: ${event.zone}`);
      break;
    case "door":
      // Door events logged for pattern detection
      console.log(`[HA-PRESENCE] Door: ${event.entity_id} — ${JSON.stringify(event.data)}`);
      break;
  }
}
