/**
 * Cache Manager — Story 10.5
 * RAM cache with TTL for weather, calendar, search results.
 */

import { log } from "../monitoring/logger.js";

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttlMs: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, cachedAt: Date.now(), ttlMs });
}

export function cacheGet<T>(key: string): { data: T; ageMs: number } | null {
  const entry = cache.get(key);
  if (!entry) return null;

  const age = Date.now() - entry.cachedAt;
  if (age > entry.ttlMs) {
    cache.delete(key);
    return null;
  }

  return { data: entry.data as T, ageMs: age };
}

export function cacheGetStale<T>(key: string): { data: T; ageMs: number; isStale: boolean } | null {
  const entry = cache.get(key);
  if (!entry) return null;

  const age = Date.now() - entry.cachedAt;
  return {
    data: entry.data as T,
    ageMs: age,
    isStale: age > entry.ttlMs,
  };
}

export function cacheDelete(key: string): void {
  cache.delete(key);
}

export function cacheClear(): void {
  cache.clear();
}

// Pre-defined TTLs
export const TTL = {
  WEATHER: 60 * 60 * 1000,      // 1 hour
  CALENDAR: 30 * 60 * 1000,     // 30 minutes
  SEARCH: 5 * 60 * 1000,        // 5 minutes
  MUSIC_STATE: 0,                // No expiry (always current)
} as const;
