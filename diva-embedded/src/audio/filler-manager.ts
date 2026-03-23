/**
 * Filler Manager — Story 1.4: Fillers contextuels pendant le traitement
 *
 * Selectionne et planifie des fillers audio adaptes au profil du speaker,
 * avec declenchement differe, anti-repetition intra-session, et logs structures.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lazy imports to avoid circular dependencies — resolved at first call
let _log: typeof import('../monitoring/logger.js').log | null = null;
let _getCurrentPersona: typeof import('../persona/engine.js').getCurrentPersona | null = null;
let _getPersona: typeof import('../persona/engine.js').getPersona | null = null;
let _playAudioFile: typeof import('./audio-client.js').playAudioFile | null = null;
let _isAudioBusy: typeof import('./audio-lock.js').isAudioBusy | null = null;

async function ensureImports(): Promise<void> {
  if (!_log) {
    try {
      const logger = await import('../monitoring/logger.js');
      _log = logger.log;
    } catch {
      // Fallback: no-op logger for tests
      _log = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      } as any;
    }
  }
  if (!_getCurrentPersona) {
    try {
      const engine = await import('../persona/engine.js');
      _getCurrentPersona = engine.getCurrentPersona;
      _getPersona = engine.getPersona;
    } catch {
      _getCurrentPersona = (() => ({ type: 'adult' })) as any;
      _getPersona = (() => ({ type: 'adult' })) as any;
    }
  }
  if (!_playAudioFile) {
    try {
      const audio = await import('./audio-client.js');
      _playAudioFile = audio.playAudioFile;
    } catch {
      _playAudioFile = (async () => {}) as any;
    }
  }
  if (!_isAudioBusy) {
    try {
      const lock = await import('./audio-lock.js');
      _isAudioBusy = lock.isAudioBusy;
    } catch {
      _isAudioBusy = (() => false) as any;
    }
  }
}

// =====================================================================
// Configuration (Task 1.1)
// =====================================================================

export interface FillerConfig {
  FILLER_DELAY_MS: number;
  FILLER_LONG_DELAY_MS: number;
  FILLER_HISTORY_SIZE: number;
}

export const FILLER_DELAY_MS = 800;
export const FILLER_LONG_DELAY_MS = 3500;
export const FILLER_HISTORY_SIZE = 5;

// =====================================================================
// Types (Task 1.2)
// =====================================================================

export type FillerProfile = 'casual' | 'child' | 'elderly' | 'patient' | 'neutral';

export type PersonaType = 'adult' | 'child' | 'elderly' | 'alzheimer' | 'guest';

const PERSONA_TO_FILLER_PROFILE: Record<PersonaType, FillerProfile> = {
  adult: 'casual',
  child: 'child',
  elderly: 'elderly',
  alzheimer: 'patient',
  guest: 'neutral',
};

export interface FillerChoice {
  primary: string | null;
  secondary: string | null;
}

export interface FillerHandle {
  cancel(): void;
}

// =====================================================================
// Internal state
// =====================================================================

const CACHE_DIR = path.join(__dirname, '../../assets/cached-responses');

const fillerCache: Map<string, string[]> = new Map();

// Anti-repetition history per speaker (Task 2.1)
const fillerHistory: Map<string, string[]> = new Map();

// Metrics (Task 5.4)
let fillersPlayedTotal = 0;
let fillersCancelledTotal = 0;

// =====================================================================
// Filler loading (Task 1.4)
// =====================================================================

export function loadFillers(): void {
  fillerCache.clear();

  if (!fs.existsSync(CACHE_DIR)) {
    try { _log?.warn('[FILLERS] Cache dir not found', { dir: CACHE_DIR }); } catch {}
    return;
  }

  const categories = fs.readdirSync(CACHE_DIR)
    .filter(d => d.endsWith('-fillers') || d === 'fillers')
    .filter(d => {
      try { return fs.statSync(path.join(CACHE_DIR, d)).isDirectory(); } catch { return false; }
    });

  for (const cat of categories) {
    const dir = path.join(CACHE_DIR, cat);

    // Load flat files (backward compatible)
    const flatFiles = fs.readdirSync(dir)
      .filter(f => f.endsWith('.wav'))
      .map(f => path.join(dir, f));
    if (flatFiles.length > 0) {
      fillerCache.set(cat, flatFiles);
    }

    // Load profile subdirectories (Task 1.4)
    const profiles: FillerProfile[] = ['casual', 'child', 'elderly', 'patient', 'neutral'];
    for (const profile of profiles) {
      const profileDir = path.join(dir, profile);
      if (fs.existsSync(profileDir) && fs.statSync(profileDir).isDirectory()) {
        const profileFiles = fs.readdirSync(profileDir)
          .filter(f => f.endsWith('.wav'))
          .map(f => path.join(profileDir, f));
        if (profileFiles.length > 0) {
          fillerCache.set(`${cat}:${profile}`, profileFiles);
        }
      }
    }
  }

  try { _log?.info('[FILLERS] Loaded categories', { count: fillerCache.size }); } catch {}
}

// =====================================================================
// Random filler selection with anti-repetition (Task 2.2)
// =====================================================================

export function getRandomFiller(category: string): string | null {
  const files = fillerCache.get(category);
  if (!files || files.length === 0) return null;
  return files[Math.floor(Math.random() * files.length)];
}

function getRandomFillerWithHistory(category: string, speakerId: string): string | null {
  const files = fillerCache.get(category);
  if (!files || files.length === 0) return null;

  const history = fillerHistory.get(speakerId) || [];

  // Filter out recently played fillers from this category
  const available = files.filter(f => !history.includes(f));

  // If all fillers have been played, reset history for this category (Task 2.3)
  if (available.length === 0) {
    const otherHistory = history.filter(h => !files.includes(h));
    fillerHistory.set(speakerId, otherHistory);
    return files[Math.floor(Math.random() * files.length)];
  }

  const chosen = available[Math.floor(Math.random() * available.length)];

  // Record in history
  const updatedHistory = [...history, chosen];
  // Keep only the last FILLER_HISTORY_SIZE entries
  if (updatedHistory.length > FILLER_HISTORY_SIZE) {
    fillerHistory.set(speakerId, updatedHistory.slice(-FILLER_HISTORY_SIZE));
  } else {
    fillerHistory.set(speakerId, updatedHistory);
  }

  return chosen;
}

// =====================================================================
// Night mode detection
// =====================================================================

export function isNightMode(): boolean {
  const hour = new Date().getHours();
  return hour >= 22 || hour < 6;
}

// =====================================================================
// Profile resolution
// =====================================================================

function resolveFillerProfile(speakerId?: string): FillerProfile {
  try {
    if (speakerId && _getPersona) {
      const persona = _getPersona(speakerId);
      if (persona && persona.type) {
        return PERSONA_TO_FILLER_PROFILE[persona.type as PersonaType] || 'casual';
      }
    }
    if (_getCurrentPersona) {
      const current = _getCurrentPersona();
      if (current && current.type) {
        return PERSONA_TO_FILLER_PROFILE[current.type as PersonaType] || 'casual';
      }
    }
  } catch {
    // Degradation gracieuse: fallback sur profil adult (AC11)
  }
  return 'casual';
}

// =====================================================================
// Filler selection by category + profile
// =====================================================================

function getProfiledFiller(category: string, profile: FillerProfile, speakerId: string): string | null {
  // Try profile-specific first, then fallback to flat category
  const profileKey = `${category}:${profile}`;
  let filler = getRandomFillerWithHistory(profileKey, speakerId);
  if (!filler) {
    filler = getRandomFillerWithHistory(category, speakerId);
  }
  return filler;
}

// =====================================================================
// Category detection (from intent + text)
// =====================================================================

function detectCategory(intent: string, text: string): string {
  const lower = text.toLowerCase();

  // Recipe / Cooking
  if (/\b(recette|cuisiner|préparer|ingrédients|gâteau|plat|soupe|poulet|pâtes|tarte|gratin)\b/i.test(lower)) {
    return 'recipe-fillers';
  }

  // Translation
  if (/\b(tradui|comment on dit|en anglais|en espagnol|traduction|translate)\b/i.test(lower)) {
    return 'translation-fillers';
  }

  // Baby / Jean
  if (/\b(bébé|jean|biberon|couche|dort|sieste|pleure|poids|taille)\b/i.test(lower)) {
    return 'baby-fillers';
  }

  // Complex calculation
  if (/\b(calcul|combien fait|pourcentage|racine|puissance)\b/i.test(lower)) {
    return 'calc-fillers';
  }

  // Music / Media
  if (/\b(musique|chanson|podcast|film|série|joue|mets|playlist)\b/i.test(lower)) {
    return 'media-fillers';
  }

  // Home automation
  if (/\b(allume|éteins|lumière|chauffage|volet|salon|cuisine|chambre)\b/i.test(lower)) {
    return 'home-fillers';
  }

  // Route by intent
  switch (intent) {
    case 'search':
      return 'search-fillers';
    case 'news':
      return 'news-fillers';
    case 'weather':
      return 'weather-fillers';
    case 'complex':
    case 'conversational':
      if (/\b(qui est|c'est quoi|qu'est-ce)\b/i.test(lower)) {
        return 'knowledge-fillers';
      }
      if (/\b(comment|conseil|aide|idée|recommand|suggèr)\b/i.test(lower)) {
        return 'advice-fillers';
      }
      return 'thinking-fillers';
    default:
      return 'micro-fillers';
  }
}

// =====================================================================
// chooseFiller — deprecated (Task 1.6)
// =====================================================================

/**
 * @deprecated Use `chooseContextualFiller` instead, which supports speaker profiles,
 * anti-repetition, and structured logging.
 */
export function chooseFiller(intent: string, text: string): FillerChoice {
  // Night mode = micro fillers only
  if (isNightMode()) {
    return { primary: getRandomFiller('micro-fillers'), secondary: null };
  }

  const category = detectCategory(intent, text);
  const needsSecondary = ['search-fillers', 'news-fillers', 'weather-fillers', 'recipe-fillers',
    'baby-fillers', 'knowledge-fillers', 'advice-fillers', 'thinking-fillers'].includes(category);

  return {
    primary: getRandomFiller(category),
    secondary: needsSecondary ? getRandomFiller('wait-fillers') : null,
  };
}

// =====================================================================
// chooseContextualFiller — new (Task 1.5)
// =====================================================================

export function chooseContextualFiller(intent: string, text: string, speakerId?: string): FillerChoice {
  const effectiveSpeakerId = speakerId || '__default__';
  const profile = resolveFillerProfile(speakerId);

  // Night mode = micro fillers only (AC6)
  if (isNightMode()) {
    return {
      primary: getProfiledFiller('micro-fillers', profile, effectiveSpeakerId),
      secondary: null,
    };
  }

  const category = detectCategory(intent, text);

  // Check if category exists in cache — fallback to micro-fillers (AC11)
  const hasCategory = fillerCache.has(category) || fillerCache.has(`${category}:${profile}`);
  if (!hasCategory) {
    return {
      primary: getProfiledFiller('micro-fillers', profile, effectiveSpeakerId),
      secondary: null,
    };
  }

  const needsSecondary = ['search-fillers', 'news-fillers', 'weather-fillers', 'recipe-fillers',
    'baby-fillers', 'knowledge-fillers', 'advice-fillers', 'thinking-fillers'].includes(category);

  return {
    primary: getProfiledFiller(category, profile, effectiveSpeakerId),
    secondary: needsSecondary ? getProfiledFiller('wait-fillers', profile, effectiveSpeakerId) : null,
  };
}

// =====================================================================
// scheduleFillers — deferred filler playback (Task 3)
// =====================================================================

export function scheduleFillers(
  fillerChoice: FillerChoice,
  correlationId: string,
  speakerId?: string,
  personaType?: string,
): FillerHandle {
  let primaryTimer: ReturnType<typeof setTimeout> | null = null;
  let secondaryTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  let primaryPlayed = false;
  const startTime = Date.now();

  // Task 3.1: Schedule primary filler
  if (fillerChoice.primary) {
    primaryTimer = setTimeout(async () => {
      if (cancelled) return;
      await ensureImports();

      // Check audio lock
      if (_isAudioBusy && _isAudioBusy()) {
        // Wait for audio to be free (poll every 200ms, max 2s)
        let waited = 0;
        while (_isAudioBusy() && waited < 2000) {
          await new Promise(r => setTimeout(r, 200));
          waited += 200;
        }
        if (cancelled) return;
      }

      try {
        if (_playAudioFile) {
          await _playAudioFile(fillerChoice.primary!);
        }
        primaryPlayed = true;
        fillersPlayedTotal++;

        // Task 5.2: Log filler played
        _log?.info('Filler played', {
          speakerId: speakerId || 'unknown',
          fillerCategory: path.basename(path.dirname(fillerChoice.primary!)),
          fillerFile: path.basename(fillerChoice.primary!),
          delayMs: FILLER_DELAY_MS,
          personaType: personaType || 'adult',
          correlationId,
          type: 'primary',
        });
      } catch (err) {
        _log?.warn('Filler playback failed', {
          fillerFile: fillerChoice.primary!,
          error: err instanceof Error ? err.message : String(err),
          correlationId,
        });
      }
    }, FILLER_DELAY_MS);
  }

  // Task 3.1: Schedule secondary filler (AC5)
  if (fillerChoice.secondary) {
    secondaryTimer = setTimeout(async () => {
      if (cancelled) return;
      await ensureImports();

      // Wait for primary to finish if still playing
      if (_isAudioBusy && _isAudioBusy()) {
        let waited = 0;
        while (_isAudioBusy() && waited < 3000) {
          await new Promise(r => setTimeout(r, 200));
          waited += 200;
        }
        if (cancelled) return;
      }

      try {
        if (_playAudioFile) {
          await _playAudioFile(fillerChoice.secondary!);
        }
        fillersPlayedTotal++;

        _log?.info('Filler played', {
          speakerId: speakerId || 'unknown',
          fillerCategory: 'wait-fillers',
          fillerFile: path.basename(fillerChoice.secondary!),
          delayMs: FILLER_LONG_DELAY_MS,
          personaType: personaType || 'adult',
          correlationId,
          type: 'secondary',
        });
      } catch (err) {
        _log?.warn('Filler secondary playback failed', {
          fillerFile: fillerChoice.secondary!,
          error: err instanceof Error ? err.message : String(err),
          correlationId,
        });
      }
    }, FILLER_LONG_DELAY_MS);
  }

  // Task 3.2: cancel() method
  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      if (primaryTimer) clearTimeout(primaryTimer);
      if (secondaryTimer) clearTimeout(secondaryTimer);
      fillersCancelledTotal++;

      // Task 5.3: Log cancellation
      try {
        const actualDelayMs = Date.now() - startTime;
        _log?.debug('Filler cancelled', {
          speakerId: speakerId || 'unknown',
          reason: 'response_arrived_before_filler',
          actualDelayMs,
          correlationId,
          primaryPlayed,
        });
      } catch {
        // Silent — never crash on log
      }
    },
  };
}

// =====================================================================
// Anti-repetition cleanup (Task 2.4)
// =====================================================================

export function clearFillerHistory(speakerId: string): void {
  fillerHistory.delete(speakerId);
}

// =====================================================================
// Metrics exposure (Task 5.4)
// =====================================================================

export function getFillerMetrics(): { fillersPlayedTotal: number; fillersCancelledTotal: number; fillersCancelledRatio: number } {
  const total = fillersPlayedTotal + fillersCancelledTotal;
  return {
    fillersPlayedTotal,
    fillersCancelledTotal,
    fillersCancelledRatio: total > 0 ? fillersCancelledTotal / total : 0,
  };
}

// =====================================================================
// Test helpers (exported for tests only)
// =====================================================================

export function _getFillerCache(): Map<string, string[]> {
  return fillerCache;
}

export function _getFillerHistory(): Map<string, string[]> {
  return fillerHistory;
}

export function _resetMetrics(): void {
  fillersPlayedTotal = 0;
  fillersCancelledTotal = 0;
}

/** Override lazy imports for testing */
export function _setTestDeps(deps: {
  log?: any;
  getCurrentPersona?: any;
  getPersona?: any;
  playAudioFile?: any;
  isAudioBusy?: any;
}): void {
  if (deps.log) _log = deps.log;
  if (deps.getCurrentPersona) _getCurrentPersona = deps.getCurrentPersona;
  if (deps.getPersona) _getPersona = deps.getPersona;
  if (deps.playAudioFile) _playAudioFile = deps.playAudioFile;
  if (deps.isAudioBusy) _isAudioBusy = deps.isAudioBusy;
}

// Load on import
loadFillers();
