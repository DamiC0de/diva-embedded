/**
 * Google Calendar Integration — read family events, detect changes
 * Auth via OAuth2 (dashboard setup) or Service Account
 * Features: #2 #6 #8 #47 #74
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const TOKENS_PATH = "/opt/diva-embedded/data/calendar/google-tokens.json";
const CONFIG_PATH = "/opt/diva-embedded/data/calendar/google-config.json";
const CACHE_PATH = "/opt/diva-embedded/data/calendar/events-cache.json";
const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_AUTH = "https://oauth2.googleapis.com";

interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface GoogleConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  calendar_ids: string[]; // ["primary", "family@group.calendar.google.com"]
}

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;       // ISO datetime
  end: string;
  location?: string;
  description?: string;
  attendees?: string[];
  calendarName?: string;
  updated: string;     // for change detection
}

// =====================================================================
// Config & Tokens
// =====================================================================

function loadConfig(): GoogleConfig | null {
  try {
    if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {}
  return null;
}

export function saveConfig(config: GoogleConfig): void {
  const dir = "/opt/diva-embedded/data/calendar";
  if (!existsSync(dir)) {
    require("node:fs").mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function loadTokens(): GoogleTokens | null {
  try {
    if (existsSync(TOKENS_PATH)) return JSON.parse(readFileSync(TOKENS_PATH, "utf-8"));
  } catch {}
  return null;
}

function saveTokens(tokens: GoogleTokens): void {
  writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

function loadEventCache(): CalendarEvent[] {
  try {
    if (existsSync(CACHE_PATH)) return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  } catch {}
  return [];
}

function saveEventCache(events: CalendarEvent[]): void {
  writeFileSync(CACHE_PATH, JSON.stringify(events, null, 2));
}

// =====================================================================
// OAuth
// =====================================================================

const SCOPES = "https://www.googleapis.com/auth/calendar.readonly";

export function getAuthorizeUrl(): string | null {
  const config = loadConfig();
  if (!config) return null;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.client_id,
    redirect_uri: config.redirect_uri,
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<boolean> {
  const config = loadConfig();
  if (!config) return false;
  try {
    const res = await fetch(`${GOOGLE_AUTH}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.client_id,
        client_secret: config.client_secret,
        redirect_uri: config.redirect_uri,
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) return false;
    const data = await res.json() as any;
    saveTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    });
    return true;
  } catch { return false; }
}

async function getAccessToken(): Promise<string | null> {
  const tokens = loadTokens();
  const config = loadConfig();
  if (!tokens || !config) return null;
  if (Date.now() < tokens.expires_at - 60000) return tokens.access_token;
  // Refresh
  try {
    const res = await fetch(`${GOOGLE_AUTH}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.client_id,
        client_secret: config.client_secret,
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const newTokens: GoogleTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };
    saveTokens(newTokens);
    return newTokens.access_token;
  } catch { return null; }
}

// =====================================================================
// Calendar API
// =====================================================================

export function isConfigured(): boolean { return loadConfig() !== null; }
export function isAuthenticated(): boolean { return loadTokens() !== null; }

export async function getUpcomingEvents(days: number = 7): Promise<CalendarEvent[]> {
  const token = await getAccessToken();
  if (!token) return [];
  const config = loadConfig();
  if (!config) return [];

  const now = new Date();
  const future = new Date(now.getTime() + days * 86400000);
  const allEvents: CalendarEvent[] = [];

  for (const calId of (config.calendar_ids.length > 0 ? config.calendar_ids : ["primary"])) {
    try {
      const params = new URLSearchParams({
        timeMin: now.toISOString(),
        timeMax: future.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "20",
      });
      const res = await fetch(
        `${GOOGLE_API}/calendars/${encodeURIComponent(calId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) continue;
      const data = await res.json() as any;
      for (const item of (data.items || [])) {
        allEvents.push({
          id: item.id,
          summary: item.summary || "Sans titre",
          start: item.start?.dateTime || item.start?.date || "",
          end: item.end?.dateTime || item.end?.date || "",
          location: item.location,
          description: item.description,
          attendees: item.attendees?.map((a: any) => a.displayName || a.email) || [],
          calendarName: data.summary || calId,
          updated: item.updated || "",
        });
      }
    } catch (err) {
      console.error(`[CALENDAR] Error fetching ${calId}:`, err);
    }
  }

  // Sort by start time
  allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  saveEventCache(allEvents);
  return allEvents;
}

export async function getTodayEvents(): Promise<CalendarEvent[]> {
  const events = await getUpcomingEvents(1);
  const today = new Date().toISOString().slice(0, 10);
  return events.filter(e => e.start.startsWith(today));
}

export async function getWeekEvents(): Promise<CalendarEvent[]> {
  return getUpcomingEvents(7);
}

/**
 * Detect changes since last check — for proactive notifications (#8)
 */
export async function detectChanges(): Promise<{ added: CalendarEvent[]; modified: CalendarEvent[]; removed: CalendarEvent[] }> {
  const oldCache = loadEventCache();
  const newEvents = await getUpcomingEvents(3); // Check next 3 days
  const oldMap = new Map(oldCache.map(e => [e.id, e]));
  const newMap = new Map(newEvents.map(e => [e.id, e]));

  const added: CalendarEvent[] = [];
  const modified: CalendarEvent[] = [];
  const removed: CalendarEvent[] = [];

  for (const [id, event] of newMap) {
    const old = oldMap.get(id);
    if (!old) {
      added.push(event);
    } else if (old.updated !== event.updated || old.start !== event.start) {
      modified.push(event);
    }
  }
  for (const [id, event] of oldMap) {
    if (!newMap.has(id)) removed.push(event);
  }

  return { added, modified, removed };
}

/**
 * Format events for TTS — concise vocal summary
 */
export function formatEventsForVoice(events: CalendarEvent[]): string {
  if (events.length === 0) return "Rien de prevu.";
  return events.map(e => {
    const time = new Date(e.start).toLocaleTimeString("fr-FR", {
      hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
    });
    const isAllDay = !e.start.includes("T");
    return isAllDay ? e.summary : `${e.summary} a ${time}`;
  }).join(". ") + ".";
}

/**
 * Claude tool handler
 */
export async function handleCalendarTool(input: Record<string, string>): Promise<string> {
  const action = (input.action || "today").toLowerCase();
  const query = input.query || "";

  if (!isAuthenticated()) {
    return "Le calendrier n'est pas encore connecte. Connecte-le depuis le dashboard Diva dans la section Comptes.";
  }

  switch (action) {
    case "today": {
      const events = await getTodayEvents();
      if (events.length === 0) return "Rien de prevu aujourd'hui.";
      return formatEventsForVoice(events);
    }
    case "week": {
      const events = await getWeekEvents();
      if (events.length === 0) return "Rien de prevu cette semaine.";
      // Group by day
      const grouped = new Map<string, CalendarEvent[]>();
      for (const e of events) {
        const day = new Date(e.start).toLocaleDateString("fr-FR", { weekday: "long", timeZone: "Europe/Paris" });
        if (!grouped.has(day)) grouped.set(day, []);
        grouped.get(day)!.push(e);
      }
      return [...grouped.entries()].map(([day, evts]) =>
        `${day} : ${formatEventsForVoice(evts)}`
      ).join(" ");
    }
    case "check":
    case "search": {
      const events = await getUpcomingEvents(14);
      if (!query) return formatEventsForVoice(events.slice(0, 5));
      const matches = events.filter(e =>
        e.summary.toLowerCase().includes(query.toLowerCase()) ||
        (e.description || "").toLowerCase().includes(query.toLowerCase()) ||
        e.attendees?.some(a => a.toLowerCase().includes(query.toLowerCase()))
      );
      if (matches.length === 0) return `Rien de prevu concernant "${query}".`;
      return formatEventsForVoice(matches);
    }
    default:
      return formatEventsForVoice(await getTodayEvents());
  }
}
