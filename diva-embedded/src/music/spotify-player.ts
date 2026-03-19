/**
 * Spotify Player — OAuth + Web API for search and playback control.
 *
 * Auth flow:
 * 1. User visits dashboard /accounts/spotify
 * 2. Redirected to Spotify authorize URL
 * 3. Spotify redirects back to dashboard with auth code
 * 4. We exchange code for access_token + refresh_token
 * 5. Tokens stored in /opt/diva-embedded/data/music/spotify-tokens.json
 *
 * Playback: Uses Spotify Connect — the Rock acts as a playback device via librespot,
 * or controls an existing Spotify Connect device (phone, speaker, etc.)
 *
 * Fallback: If no active device, we use the Web API to search and get track info,
 * then play via yt-dlp as audio-only.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TOKENS_PATH = "/opt/diva-embedded/data/music/spotify-tokens.json";
const CONFIG_PATH = "/opt/diva-embedded/data/music/spotify-config.json";
const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_AUTH = "https://accounts.spotify.com";

interface SpotifyTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

interface SpotifyConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

// =====================================================================
// Config & Tokens
// =====================================================================

function loadConfig(): SpotifyConfig | null {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return null;
}

export function saveConfig(config: SpotifyConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function loadTokens(): SpotifyTokens | null {
  try {
    if (existsSync(TOKENS_PATH)) {
      return JSON.parse(readFileSync(TOKENS_PATH, "utf-8"));
    }
  } catch {}
  return null;
}

function saveTokens(tokens: SpotifyTokens): void {
  writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

// =====================================================================
// OAuth Flow
// =====================================================================

const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "user-library-read",
  "streaming",
].join(" ");

export function getAuthorizeUrl(): string | null {
  const config = loadConfig();
  if (!config) return null;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.client_id,
    scope: SCOPES,
    redirect_uri: config.redirect_uri,
    show_dialog: "true",
  });

  return `${SPOTIFY_AUTH}/authorize?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<boolean> {
  const config = loadConfig();
  if (!config) return false;

  try {
    const res = await fetch(`${SPOTIFY_AUTH}/api/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${config.client_id}:${config.client_secret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirect_uri,
      }),
    });

    if (!res.ok) {
      console.error("[SPOTIFY] Token exchange failed:", res.status, await res.text());
      return false;
    }

    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    saveTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    });

    console.log("[SPOTIFY] Authenticated successfully");
    return true;
  } catch (err) {
    console.error("[SPOTIFY] Exchange error:", err);
    return false;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const config = loadConfig();
  const tokens = loadTokens();
  if (!config || !tokens?.refresh_token) return null;

  try {
    const res = await fetch(`${SPOTIFY_AUTH}/api/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${config.client_id}:${config.client_secret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    const newTokens: SpotifyTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };
    saveTokens(newTokens);
    return newTokens.access_token;
  } catch {
    return null;
  }
}

async function getAccessToken(): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens) return null;

  // Refresh if expired or expiring in 60s
  if (Date.now() >= tokens.expires_at - 60000) {
    return refreshAccessToken();
  }

  return tokens.access_token;
}

// =====================================================================
// API Helpers
// =====================================================================

async function spotifyApi(endpoint: string, method: string = "GET", body?: unknown): Promise<unknown> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${SPOTIFY_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify API ${res.status}: ${text}`);
  }

  return res.json();
}

// =====================================================================
// Public API
// =====================================================================

export function isConfigured(): boolean {
  return loadConfig() !== null;
}

export function isAuthenticated(): boolean {
  return loadTokens() !== null;
}

export interface SpotifyTrack {
  name: string;
  artist: string;
  album: string;
  uri: string;
  duration_ms: number;
}

export async function search(query: string, type: string = "track", limit: number = 5): Promise<SpotifyTrack[]> {
  const data = await spotifyApi(`/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}&market=FR`) as any;

  if (!data?.tracks?.items) return [];

  return data.tracks.items.map((item: any) => ({
    name: item.name,
    artist: item.artists?.map((a: any) => a.name).join(", ") || "Unknown",
    album: item.album?.name || "",
    uri: item.uri,
    duration_ms: item.duration_ms,
  }));
}

export async function play(uriOrQuery?: string): Promise<string> {
  try {
    // Get available devices
    const devicesData = await spotifyApi("/me/player/devices") as any;
    const devices = devicesData?.devices || [];

    if (devices.length === 0) {
      return "no_device";
    }

    // Find active device or first available
    const activeDevice = devices.find((d: any) => d.is_active) || devices[0];

    if (uriOrQuery) {
      if (uriOrQuery.startsWith("spotify:")) {
        // Direct URI
        if (uriOrQuery.includes(":track:")) {
          await spotifyApi(`/me/player/play?device_id=${activeDevice.id}`, "PUT", {
            uris: [uriOrQuery],
          });
        } else {
          // Album, playlist, artist
          await spotifyApi(`/me/player/play?device_id=${activeDevice.id}`, "PUT", {
            context_uri: uriOrQuery,
          });
        }
      } else {
        // Search and play first result
        const results = await search(uriOrQuery, "track", 1);
        if (results.length === 0) return "not_found";

        await spotifyApi(`/me/player/play?device_id=${activeDevice.id}`, "PUT", {
          uris: [results[0].uri],
        });
        return `${results[0].name} de ${results[0].artist}`;
      }
    } else {
      // Resume playback
      await spotifyApi(`/me/player/play?device_id=${activeDevice.id}`, "PUT");
    }

    return "ok";
  } catch (err) {
    console.error("[SPOTIFY] Play error:", err);
    return "error";
  }
}

export async function pausePlayback(): Promise<void> {
  try {
    await spotifyApi("/me/player/pause", "PUT");
  } catch {}
}

export async function nextTrack(): Promise<void> {
  try {
    await spotifyApi("/me/player/next", "POST");
  } catch {}
}

export async function previousTrack(): Promise<void> {
  try {
    await spotifyApi("/me/player/previous", "POST");
  } catch {}
}

export async function getCurrentlyPlaying(): Promise<{ name: string; artist: string } | null> {
  try {
    const data = await spotifyApi("/me/player/currently-playing") as any;
    if (!data?.item) return null;
    return {
      name: data.item.name,
      artist: data.item.artists?.map((a: any) => a.name).join(", ") || "",
    };
  } catch {
    return null;
  }
}

export async function getUserPlaylists(): Promise<{ name: string; uri: string; tracks: number }[]> {
  try {
    const data = await spotifyApi("/me/playlists?limit=20") as any;
    return (data?.items || []).map((p: any) => ({
      name: p.name,
      uri: p.uri,
      tracks: p.tracks?.total || 0,
    }));
  } catch {
    return [];
  }
}
