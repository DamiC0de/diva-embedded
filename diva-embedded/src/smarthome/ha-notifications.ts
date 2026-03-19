/**
 * Home Assistant Event Notifications
 * Receives webhooks from HA → announces via TTS
 * Filters by importance and DND status
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { playAudioFile, playAudioBytes } from "../audio/audio-client.js";
import { synthesize } from "../tts/piper.js";
import { isDNDActive } from "../tools/dnd-manager.js";
import { handlePresenceEvent } from "./ha-presence.js";

const HA_WEBHOOK_PORT = 3003;
const ASSETS_DIR = "/opt/diva-embedded/assets";

interface HAEvent {
  type: string;       // "doorbell", "motion", "temperature", "custom"
  message: string;    // What to announce
  priority: "low" | "medium" | "high";
  entity_id?: string;
}

// Rate limiting to prevent spam
const lastAnnouncements = new Map<string, number>();
const MIN_INTERVAL_MS = 30000; // 30s between same announcements

async function announce(message: string): Promise<void> {
  try {
    await playAudioFile(`${ASSETS_DIR}/oui.wav`);
    const wav = await synthesize(message);
    await playAudioBytes(wav.toString("base64"));
  } catch (err) {
    console.error("[HA-NOTIFY] TTS error:", err);
  }
}

function shouldAnnounce(event: HAEvent): boolean {
  // DND blocks everything except high priority
  if (isDNDActive() && event.priority !== "high") return false;

  // Time-based filtering: only during waking hours for low priority
  const h = parseInt(new Date().toLocaleString("fr-FR", { hour: "numeric", timeZone: "Europe/Paris" }));
  if (event.priority === "low" && (h < 7 || h > 22)) return false;

  // Rate limit
  const key = `${event.type}:${event.entity_id ?? ""}`;
  const last = lastAnnouncements.get(key);
  if (last && Date.now() - last < MIN_INTERVAL_MS) return false;

  lastAnnouncements.set(key, Date.now());
  return true;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => data += c);
    req.on("end", () => resolve(data));
  });
}

export function startHAWebhookServer(): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "POST" && req.url === "/webhook/ha") {
      try {
        const body = JSON.parse(await readBody(req));
        const event: HAEvent = {
          type: body.type ?? "custom",
          message: body.message ?? "",
          priority: body.priority ?? "medium",
          entity_id: body.entity_id,
        };

        if (event.message && shouldAnnounce(event)) {
          console.log(`[HA-NOTIFY] Announcing: "${event.message}" (${event.priority})`);
          announce(event.message).catch(() => {});
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid request" }));
      }
    } else if (req.method === "POST" && req.url === "/webhook/presence") {
      try {
        const body = JSON.parse(await readBody(req));
        console.log("[HA-NOTIFY] Presence event:", body.type);
        handlePresenceEvent(body).catch(() => {});
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid request" }));
      }
    } else if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(HA_WEBHOOK_PORT, "0.0.0.0", () => {
    console.log(`[HA-NOTIFY] Webhook server on port ${HA_WEBHOOK_PORT}`);
  });
}
