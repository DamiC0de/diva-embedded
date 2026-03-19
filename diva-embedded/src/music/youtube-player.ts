/**
 * YouTube Music Player — search and play via yt-dlp + mpv
 * No authentication needed for public content.
 * With cookies (from dashboard), supports personal playlists.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const COOKIES_PATH = "/opt/diva-embedded/data/music/ytmusic-cookies.txt";

let currentProcess: ChildProcess | null = null;
let currentTrack: { title: string; artist: string; url: string } | null = null;
let queue: { title: string; artist: string; url: string }[] = [];

interface YTSearchResult {
  id: string;
  title: string;
  url: string;
  channel: string;
  duration: string;
}

/**
 * Search YouTube Music for a query, return top results.
 */
export async function searchYouTube(query: string, maxResults: number = 5): Promise<YTSearchResult[]> {
  try {
    const cookieArg = existsSync(COOKIES_PATH) ? `--cookies "${COOKIES_PATH}"` : "";
    // Use ytsearch to search YouTube Music
    const cmd = `yt-dlp ${cookieArg} "ytsearch${maxResults}:${query.replace(/"/g, '\\"')} music" --flat-playlist --dump-json --no-warnings 2>/dev/null`;
    const raw = execSync(cmd, { timeout: 15000, maxBuffer: 1024 * 1024 }).toString();

    const results: YTSearchResult[] = [];
    for (const line of raw.split("\n").filter(Boolean)) {
      try {
        const entry = JSON.parse(line);
        results.push({
          id: entry.id,
          title: entry.title || "Unknown",
          url: `https://www.youtube.com/watch?v=${entry.id}`,
          channel: entry.channel || entry.uploader || "Unknown",
          duration: entry.duration_string || "",
        });
      } catch {}
    }
    return results;
  } catch (err) {
    console.error("[YT-MUSIC] Search error:", err);
    return [];
  }
}

/**
 * Play a YouTube URL or search query via mpv.
 * mpv + yt-dlp handle the audio extraction automatically.
 */
export function playYouTube(urlOrQuery: string, title?: string, artist?: string): string {
  stop(); // Stop any current playback

  const isUrl = urlOrQuery.startsWith("http");
  const mpvInput = isUrl ? urlOrQuery : `ytdl://ytsearch:${urlOrQuery} music`;

  const cookieArgs = existsSync(COOKIES_PATH)
    ? ["--ytdl-raw-options=cookies=" + COOKIES_PATH]
    : [];

  try {
    currentProcess = spawn("mpv", [
      "--no-video",
      "--really-quiet",
      "--audio-device=alsa",
      "--volume=80",
      ...cookieArgs,
      mpvInput,
    ], {
      stdio: "ignore",
      detached: true,
    });

    currentProcess.unref();

    currentProcess.on("exit", () => {
      console.log("[YT-MUSIC] Playback ended");
      currentProcess = null;
      currentTrack = null;
      // Play next in queue
      if (queue.length > 0) {
        const next = queue.shift()!;
        playYouTube(next.url, next.title, next.artist);
      }
    });

    currentTrack = {
      title: title || urlOrQuery,
      artist: artist || "",
      url: isUrl ? urlOrQuery : "",
    };

    console.log(`[YT-MUSIC] Playing: ${currentTrack.title} (PID: ${currentProcess.pid})`);
    return title || urlOrQuery;
  } catch (err) {
    console.error("[YT-MUSIC] Play error:", err);
    return "";
  }
}

/**
 * Search and play the best match for a query.
 */
export async function searchAndPlay(query: string): Promise<string> {
  const results = await searchYouTube(query, 1);
  if (results.length === 0) {
    return "";
  }

  const best = results[0];
  playYouTube(best.url, best.title, best.channel);
  return `${best.title} de ${best.channel}`;
}

/**
 * Add tracks to queue after searching.
 */
export async function addToQueue(query: string): Promise<string> {
  const results = await searchYouTube(query, 1);
  if (results.length === 0) return "";

  const track = results[0];
  queue.push({ title: track.title, artist: track.channel, url: track.url });

  if (!currentProcess) {
    // Nothing playing, start immediately
    const next = queue.shift()!;
    playYouTube(next.url, next.title, next.artist);
    return `${next.title} de ${next.artist}`;
  }

  return `${track.title} ajouté à la file d'attente`;
}

export function stop(): void {
  if (currentProcess) {
    try {
      process.kill(-currentProcess.pid!, "SIGTERM");
    } catch {
      try { currentProcess.kill("SIGTERM"); } catch {}
    }
    currentProcess = null;
  }
  // Kill any lingering mpv playing YouTube
  try { execSync("pkill -f 'mpv.*youtube\\|mpv.*ytdl' || true", { timeout: 2000 }); } catch {}
  currentTrack = null;
}

export function pause(): void {
  // mpv doesn't support external pause easily without IPC socket
  // For now, we'll stop playback
  stop();
}

export function isPlaying(): boolean {
  return currentProcess !== null && currentTrack !== null;
}

export function getCurrentTrack(): { title: string; artist: string } | null {
  return currentTrack;
}

export function clearQueue(): void {
  queue = [];
}

export function hasCookies(): boolean {
  return existsSync(COOKIES_PATH);
}
