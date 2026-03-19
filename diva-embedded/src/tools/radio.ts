/**
 * Radio / Music Streaming — predefined French radio streams
 * Uses mpv for playback with ALSA volume control
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";

const RADIO_STREAMS: Record<string, { name: string; url: string }> = {
  "france inter": { name: "France Inter", url: "https://icecast.radiofrance.fr/franceinter-hifi.aac" },
  "france info": { name: "France Info", url: "https://icecast.radiofrance.fr/franceinfo-hifi.aac" },
  "france culture": { name: "France Culture", url: "https://icecast.radiofrance.fr/franceculture-hifi.aac" },
  "france musique": { name: "France Musique", url: "https://icecast.radiofrance.fr/francemusique-hifi.aac" },
  "fip": { name: "FIP", url: "https://icecast.radiofrance.fr/fip-hifi.aac" },
  "rtl": { name: "RTL", url: "https://streaming.radio.rtl.fr/rtl-1-44-128" },
  "rmc": { name: "RMC", url: "https://audio.bfmtv.com/bfmbusiness_128.mp3" },
  "nostalgie": { name: "Nostalgie", url: "https://scdn.nrjaudio.fm/adwz2/fr/30601/mp3_128.mp3" },
  "cherie fm": { name: "Chérie FM", url: "https://scdn.nrjaudio.fm/adwz2/fr/30201/mp3_128.mp3" },
  "nrj": { name: "NRJ", url: "https://scdn.nrjaudio.fm/adwz2/fr/30001/mp3_128.mp3" },
  "jazz": { name: "Radio Jazz", url: "https://jazz-wr01.ice.infomaniak.ch/jazz-wr01-128.mp3" },
  "classique": { name: "Radio Classique", url: "https://radioclassique.ice.infomaniak.ch/radioclassique-high.mp3" },
};

let currentProcess: ChildProcess | null = null;
let currentStation: string | null = null;

function findStation(text: string): { key: string; name: string; url: string } | null {
  const lower = text.toLowerCase();

  // Direct match
  for (const [key, info] of Object.entries(RADIO_STREAMS)) {
    if (lower.includes(key)) {
      return { key, ...info };
    }
  }

  // Fuzzy match
  if (/inter\b/i.test(lower)) return { key: "france inter", ...RADIO_STREAMS["france inter"] };
  if (/info/i.test(lower)) return { key: "france info", ...RADIO_STREAMS["france info"] };
  if (/culture/i.test(lower)) return { key: "france culture", ...RADIO_STREAMS["france culture"] };
  if (/classique/i.test(lower)) return { key: "classique", ...RADIO_STREAMS["classique"] };
  if (/jazz/i.test(lower)) return { key: "jazz", ...RADIO_STREAMS["jazz"] };
  if (/nostalg/i.test(lower)) return { key: "nostalgie", ...RADIO_STREAMS["nostalgie"] };

  return null;
}

export function playRadio(text: string): string {
  const station = findStation(text);
  if (!station) {
    // Default: play a random station
    const keys = Object.keys(RADIO_STREAMS);
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    const info = RADIO_STREAMS[randomKey];
    startStream(info.url);
    currentStation = info.name;
    return `Je lance ${info.name}.`;
  }

  startStream(station.url);
  currentStation = station.name;
  return `Je lance ${station.name}.`;
}

function startStream(url: string): void {
  stopRadio(); // Stop any current playback

  try {
    currentProcess = spawn("mpv", [
      "--no-video",
      "--really-quiet",
      "--audio-device=alsa",
      url,
    ], {
      stdio: "ignore",
      detached: true,
    });
    currentProcess.unref();
    console.log(`[RADIO] Started: ${url} (PID: ${currentProcess.pid})`);
  } catch (err) {
    console.error("[RADIO] Failed to start mpv:", err);
    // Fallback: try with ffplay
    try {
      currentProcess = spawn("ffplay", [
        "-nodisp",
        "-autoexit",
        "-loglevel", "quiet",
        url,
      ], {
        stdio: "ignore",
        detached: true,
      });
      currentProcess.unref();
      console.log(`[RADIO] Started with ffplay: ${url}`);
    } catch {
      console.error("[RADIO] No player available (mpv/ffplay)");
    }
  }
}

export function stopRadio(): string {
  if (currentProcess) {
    try {
      process.kill(-currentProcess.pid!, "SIGTERM");
    } catch {
      try { currentProcess.kill("SIGTERM"); } catch {}
    }
    currentProcess = null;
  }

  // Kill any lingering mpv/ffplay
  try { execSync("pkill -f 'mpv.*icecast\\|mpv.*streaming\\|mpv.*ice.infomaniak\\|mpv.*scdn.nrj\\|ffplay.*icecast' || true", { timeout: 2000 }); } catch {}

  const wasPlaying = currentStation;
  currentStation = null;

  if (wasPlaying) return `J'ai arrete ${wasPlaying}.`;
  return "Aucune radio en cours.";
}

export function setVolume(text: string): string {
  const lower = text.toLowerCase();

  let volumePercent: number | null = null;

  // Extract explicit percentage
  const numMatch = text.match(/(\d+)\s*(%|pourcent)/);
  if (numMatch) {
    volumePercent = parseInt(numMatch[1]);
  } else if (/plus\s+fort|monte|augmente|hausse/i.test(lower)) {
    volumePercent = null; // +10%
    try {
      execSync("amixer set Master 10%+ 2>/dev/null || amixer set PCM 10%+ 2>/dev/null", { timeout: 2000 });
      return "Volume augmente.";
    } catch { return "Impossible de changer le volume."; }
  } else if (/moins\s+fort|baisse|diminue|redui/i.test(lower)) {
    try {
      execSync("amixer set Master 10%- 2>/dev/null || amixer set PCM 10%- 2>/dev/null", { timeout: 2000 });
      return "Volume baisse.";
    } catch { return "Impossible de changer le volume."; }
  } else if (/muet|mute|sourdine/i.test(lower)) {
    try {
      execSync("amixer set Master mute 2>/dev/null || amixer set PCM mute 2>/dev/null", { timeout: 2000 });
      return "Son coupe.";
    } catch { return "Impossible de couper le son."; }
  }

  if (volumePercent !== null) {
    try {
      execSync(`amixer set Master ${volumePercent}% 2>/dev/null || amixer set PCM ${volumePercent}% 2>/dev/null`, { timeout: 2000 });
      return `Volume a ${volumePercent} pourcent.`;
    } catch { return "Impossible de changer le volume."; }
  }

  return "Dis-moi plus fort, moins fort, ou un pourcentage.";
}

export function isPlaying(): boolean {
  return currentStation !== null;
}

export function getCurrentStation(): string | null {
  return currentStation;
}

export function listStations(): string {
  const names = Object.values(RADIO_STREAMS).map((s) => s.name);
  return `Radios disponibles : ${names.join(", ")}.`;
}
