/**
 * Local Music Player — Story 10.6
 * Plays music from local storage when streaming services are unavailable.
 */

import { readdirSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { playAudioFile } from "../audio/audio-client.js";
import { log } from "../monitoring/logger.js";

const LOCAL_MUSIC_DIR = "/opt/diva-embedded/assets/local-music";

interface LocalTrack {
  path: string;
  filename: string;
  artist: string;
  title: string;
}

let localLibrary: LocalTrack[] = [];

export function loadLocalLibrary(): void {
  if (!existsSync(LOCAL_MUSIC_DIR)) {
    log.debug("No local music directory found", { dir: LOCAL_MUSIC_DIR });
    return;
  }

  const files = readdirSync(LOCAL_MUSIC_DIR)
    .filter(f => /\.(mp3|wav|ogg|flac)$/i.test(f));

  localLibrary = files.map(f => {
    const name = basename(f, extname(f));
    // Expected format: "Artist - Title.mp3"
    const parts = name.split(" - ");
    return {
      path: join(LOCAL_MUSIC_DIR, f),
      filename: f,
      artist: parts.length > 1 ? parts[0].trim() : "Inconnu",
      title: parts.length > 1 ? parts[1].trim() : name,
    };
  });

  log.info("Local music library loaded", { tracks: localLibrary.length });
}

export function hasLocalMusic(): boolean {
  return localLibrary.length > 0;
}

export function searchLocal(query: string): LocalTrack | null {
  const lower = query.toLowerCase();
  return localLibrary.find(t =>
    t.artist.toLowerCase().includes(lower) ||
    t.title.toLowerCase().includes(lower) ||
    t.filename.toLowerCase().includes(lower)
  ) || null;
}

export function getRandomLocal(): LocalTrack | null {
  if (localLibrary.length === 0) return null;
  return localLibrary[Math.floor(Math.random() * localLibrary.length)];
}

export function listLocalArtists(): string[] {
  const artists = new Set(localLibrary.map(t => t.artist));
  return [...artists].filter(a => a !== "Inconnu");
}

export async function playLocalTrack(track: LocalTrack): Promise<string> {
  try {
    await playAudioFile(track.path);
    log.info("Playing local track", { artist: track.artist, title: track.title });
    return `${track.title} de ${track.artist}`;
  } catch (err) {
    log.error("Local playback failed", { path: track.path });
    return "";
  }
}

// Load on import
loadLocalLibrary();
