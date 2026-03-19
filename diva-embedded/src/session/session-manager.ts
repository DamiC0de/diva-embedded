/**
 * Session Manager — Story 2.1, 2.2, 2.4
 * Maintains conversation context per persona with sliding window,
 * system state tracking, and conversation resumption.
 */

import { log } from "../monitoring/logger.js";

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_EXCHANGES = 10;

export interface Exchange {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface SystemState {
  musicPlaying?: { title: string; artist: string } | null;
  activeTimers?: { label: string; remainingS: number }[];
  lastSearch?: string;
  lastReminderCreated?: string;
  lastAction?: string;
}

export interface ConversationSession {
  speakerId: string;
  exchanges: Exchange[];
  state: SystemState;
  lastIntent?: string;
  lastEntity?: string;
  lastCategory?: string;
  lastAction?: string;
  lastActivityAt: number;
  createdAt: number;
}

const sessions = new Map<string, ConversationSession>();

function isExpired(session: ConversationSession): boolean {
  return Date.now() - session.lastActivityAt > SESSION_TTL_MS;
}

export function getSession(speakerId: string): ConversationSession {
  const existing = sessions.get(speakerId);
  if (existing && !isExpired(existing)) {
    return existing;
  }

  // Expired or new — create fresh session
  if (existing && isExpired(existing)) {
    log.debug("Session expired", { speakerId, ageMinutes: Math.floor((Date.now() - existing.lastActivityAt) / 60000) });
  }

  const session: ConversationSession = {
    speakerId,
    exchanges: [],
    state: {},
    lastActivityAt: Date.now(),
    createdAt: Date.now(),
  };
  sessions.set(speakerId, session);
  return session;
}

export function addUserExchange(speakerId: string, content: string): void {
  const session = getSession(speakerId);
  session.exchanges.push({ role: "user", content, timestamp: Date.now() });
  if (session.exchanges.length > MAX_EXCHANGES * 2) {
    session.exchanges = session.exchanges.slice(-MAX_EXCHANGES * 2);
  }
  session.lastActivityAt = Date.now();
}

export function addAssistantExchange(speakerId: string, content: string): void {
  const session = getSession(speakerId);
  session.exchanges.push({ role: "assistant", content, timestamp: Date.now() });
  if (session.exchanges.length > MAX_EXCHANGES * 2) {
    session.exchanges = session.exchanges.slice(-MAX_EXCHANGES * 2);
  }
  session.lastActivityAt = Date.now();
}

export function updateLastIntent(speakerId: string, intent: string, category: string, entity?: string): void {
  const session = getSession(speakerId);
  session.lastIntent = intent;
  session.lastCategory = category;
  if (entity) session.lastEntity = entity;
  session.lastActivityAt = Date.now();
}

export function updateSystemState(speakerId: string, update: Partial<SystemState>): void {
  const session = getSession(speakerId);
  session.state = { ...session.state, ...update };
}

export function getLastIntent(speakerId: string): { intent?: string; category?: string; entity?: string } {
  const session = getSession(speakerId);
  if (isExpired(session)) return {};
  return {
    intent: session.lastIntent,
    category: session.lastCategory,
    entity: session.lastEntity,
  };
}

/**
 * Build context string for Claude prompt injection.
 * Includes sliding window + system state.
 */
export function buildSessionContext(speakerId: string): string {
  const session = getSession(speakerId);
  const parts: string[] = [];

  // Sliding window
  if (session.exchanges.length > 0) {
    parts.push("Conversation recente :");
    for (const ex of session.exchanges.slice(-MAX_EXCHANGES * 2)) {
      const role = ex.role === "user" ? "Utilisateur" : "Diva";
      parts.push(`${role}: ${ex.content}`);
    }
  }

  // System state
  const stateLines: string[] = [];
  if (session.state.musicPlaying) {
    stateLines.push(`Musique en cours : ${session.state.musicPlaying.title} — ${session.state.musicPlaying.artist}`);
  }
  if (session.state.activeTimers?.length) {
    const timerStr = session.state.activeTimers
      .map(t => `${t.label}: ${Math.floor(t.remainingS / 60)} min restantes`)
      .join(", ");
    stateLines.push(`Minuteurs actifs : ${timerStr}`);
  }
  if (session.state.lastSearch) {
    stateLines.push(`Derniere recherche : ${session.state.lastSearch}`);
  }
  if (session.state.lastReminderCreated) {
    stateLines.push(`Dernier rappel cree : ${session.state.lastReminderCreated}`);
  }

  if (stateLines.length > 0) {
    parts.push("\nEtat actuel du systeme :");
    parts.push(...stateLines);
  }

  return parts.join("\n");
}

/**
 * Check if user is resuming a previous conversation (Story 2.4)
 */
export function canResumeConversation(speakerId: string): boolean {
  const session = sessions.get(speakerId);
  if (!session) return false;
  return !isExpired(session) && session.exchanges.length > 0;
}

export function getLastTopic(speakerId: string): string | null {
  const session = sessions.get(speakerId);
  if (!session || isExpired(session)) return null;
  const lastUserExchanges = session.exchanges.filter(e => e.role === "user");
  if (lastUserExchanges.length === 0) return null;
  return lastUserExchanges[lastUserExchanges.length - 1].content;
}

export function clearSession(speakerId: string): void {
  sessions.delete(speakerId);
}
