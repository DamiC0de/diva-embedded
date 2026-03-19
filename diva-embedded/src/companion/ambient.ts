/**
 * Ambient Presence — Background sounds for anti-silence
 * Feature #34: Présence silencieuse
 */

import { spawn, type ChildProcess, execSync } from "node:child_process";

let ambientProcess: ChildProcess | null = null;
let currentAmbient: string | null = null;

const AMBIENT_SOUNDS: Record<string, string> = {
  nature: "https://stream.zeno.fm/0r0xa792kwzuv",           // Nature sounds stream
  rain: "https://rainymood.com/audio1112/0.m4a",
  fireplace: "https://stream.zeno.fm/f3wvbbqmdg8uv",        // Fireplace
  cafe: "https://stream.zeno.fm/kbz9wd2zy3quv",             // Cafe ambiance
  jazz_doux: "https://jazz-wr01.ice.infomaniak.ch/jazz-wr01-128.mp3",
  classique_doux: "https://radioclassique.ice.infomaniak.ch/radioclassique-high.mp3",
};

export function startAmbient(type: string = "nature", volume: number = 10): string {
  stopAmbient();

  const url = AMBIENT_SOUNDS[type] || AMBIENT_SOUNDS.nature;

  try {
    ambientProcess = spawn("mpv", [
      "--no-video",
      "--really-quiet",
      "--audio-device=alsa",
      `--volume=${volume}`,
      "--loop",
      url,
    ], {
      stdio: "ignore",
      detached: true,
    });
    ambientProcess.unref();
    currentAmbient = type;

    console.log(`[AMBIENT] Started: ${type} at volume ${volume}%`);
    return `Ambiance ${type} activee.`;
  } catch (err) {
    console.error("[AMBIENT] Error:", err);
    return "Impossible de lancer l'ambiance sonore.";
  }
}

export function stopAmbient(): string {
  if (ambientProcess) {
    try { process.kill(-ambientProcess.pid!, "SIGTERM"); } catch {}
    try { ambientProcess.kill("SIGTERM"); } catch {}
    ambientProcess = null;
  }
  try { execSync("pkill -f 'mpv.*volume=1[0-5]' || true", { timeout: 2000 }); } catch {}

  const was = currentAmbient;
  currentAmbient = null;
  return was ? `Ambiance ${was} arretee.` : "Pas d'ambiance en cours.";
}

export function isAmbientPlaying(): boolean {
  return currentAmbient !== null;
}

export function getAmbientTypes(): string[] {
  return Object.keys(AMBIENT_SOUNDS);
}

export async function handleAmbientTool(input: Record<string, string>): Promise<string> {
  const action = (input.action || "start").toLowerCase();
  const type = input.type || "nature";
  const volume = parseInt(input.volume || "10");

  switch (action) {
    case "start":
    case "play":
      return startAmbient(type, Math.min(volume, 25)); // Cap at 25% for ambient
    case "stop":
      return stopAmbient();
    case "list":
      return `Ambiances disponibles : ${getAmbientTypes().join(", ")}.`;
    default:
      return startAmbient(type, Math.min(volume, 25));
  }
}
