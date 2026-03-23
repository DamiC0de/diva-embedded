/**
 * Mode Detector — Story 11.4 / FR78
 * Detects one of 4 behavioral modes from text analysis and optional audio metadata.
 * Modes: executant, conseiller, compagnon, silencieux
 *
 * Detection is 100% automatic — no user configuration required.
 * Target latency: < 50ms.
 */

import { log } from "../monitoring/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BehavioralMode = "executant" | "conseiller" | "compagnon" | "silencieux";

export interface AudioMetadata {
  /** Average volume in dB */
  volumeDb: number;
  /** Speech rate in words per second */
  speechRateWps: number;
  /** Whisper detected by VAD/STT */
  isWhisper: boolean;
  /** Pitch trend over the utterance */
  pitchTrend: "rising" | "falling" | "flat";
}

export interface ModeDetectionResult {
  mode: BehavioralMode;
  confidence: number;
  source: "text" | "prosody" | "fusion";
}

// ---------------------------------------------------------------------------
// Text patterns per mode
// ---------------------------------------------------------------------------

/** Imperative command patterns — executant mode */
const IMPERATIVE_PATTERNS = [
  /^(allume|eteins|éteins|ouvre|ferme|active|désactive|desactive|lance|mets|fais|joue|coupe|arrête|arrete|baisse|monte|verrouille|déverrouille|deverrouille|stop|envoie|supprime|annule|rappelle|minuteur|timer|ajoute|retire|programme|demarre|démarre)\b/i,
  /^(dis|donne|lis|cherche|trouve|calcule|convertis)\b/i,
  /^(mode (nuit|normal|silence|absent)|bonne nuit)\b/i,
  // Match imperative verbs anywhere for longer phrases
  /\b(allume|eteins|éteins|ouvre|ferme|lance|mets|fais|joue|coupe|arrête|arrete|envoie|supprime|annule|rappelle|ajoute|retire|démarre|demarre)\s/i,
];

/** Interrogative patterns — conseiller mode */
const INTERROGATIVE_PATTERNS = [
  /^(est[ -]ce que|qu[ ']est[ -]ce que|pourquoi|comment|quand|combien|quel(?:le)?s?|ou est|où est)\b/i,
  /\b(tu penses que|tu crois que|tu conseillerais?|on devrait|je devrais|ca vaut|ça vaut|c'est mieux|lequel|laquelle)\b/i,
  /\?$/,
  /\b(a ton avis|d'après toi|selon toi)\b/i,
];

/** Emotional expression patterns — compagnon mode */
const EMOTIONAL_PATTERNS = [
  // Note: \b doesn't work with accented characters in JS, so we use (?:\s|$) or no boundary
  /(je suis|j'ai|j'me sens|je me sens)\s+(fatigu|triste|content|heureu|stress|anxieu|seul|ennuy|malade|crev|d[eé]prim|nostalgique|perdu|bien|mal)/i,
  /(j'ai envie|j'en ai marre|[çc]a me|j'ai besoin|je n'arrive pas|j'arrive pas|[çc]a m'[eé]nerve|[çc]a me fait)/i,
  /(c'est dur|c'est difficile|c'est pas facile|la journ[eé]e a [eé]t[eé]|quelle journ[eé]e|quel enfer)/i,
  /(je me sens seul|personne ne|tout le monde)/i,
];

/** Minimalist patterns — silencieux mode (ultra-short, no verb) */
const MINIMALIST_MAX_WORDS = 2;

// ---------------------------------------------------------------------------
// Detection functions
// ---------------------------------------------------------------------------

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function scoreTextMode(text: string): { mode: BehavioralMode; confidence: number } {
  const trimmed = text.trim();
  if (!trimmed) return { mode: "conseiller", confidence: 0.3 };

  const wordCount = countWords(trimmed);

  // Check minimalist first (1-2 words, often just a noun)
  if (wordCount <= MINIMALIST_MAX_WORDS) {
    // Check if it matches an imperative verb (then it's executant, not silencieux)
    const hasVerb = IMPERATIVE_PATTERNS.some(p => p.test(trimmed));
    if (!hasVerb) {
      return { mode: "silencieux", confidence: 0.7 };
    }
  }

  // Score each mode
  let executantScore = 0;
  let conseillerScore = 0;
  let compagnonScore = 0;

  // Imperative patterns
  for (const pattern of IMPERATIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      executantScore += 0.4;
    }
  }
  // Short imperatives get a boost
  if (executantScore > 0 && wordCount <= 5) {
    executantScore += 0.2;
  }
  // Cap at 1.0
  executantScore = Math.min(executantScore, 1.0);

  // Interrogative patterns
  for (const pattern of INTERROGATIVE_PATTERNS) {
    if (pattern.test(trimmed)) {
      conseillerScore += 0.35;
    }
  }
  conseillerScore = Math.min(conseillerScore, 1.0);

  // Emotional patterns — stronger weight since emotional expressions are distinctive
  for (const pattern of EMOTIONAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      compagnonScore += 0.65;
    }
  }
  compagnonScore = Math.min(compagnonScore, 1.0);

  // Pick highest score
  const scores: Array<{ mode: BehavioralMode; score: number }> = [
    { mode: "executant", score: executantScore },
    { mode: "conseiller", score: conseillerScore },
    { mode: "compagnon", score: compagnonScore },
  ];

  scores.sort((a, b) => b.score - a.score);

  if (scores[0].score === 0) {
    // No patterns matched — default to conseiller
    return { mode: "conseiller", confidence: 0.4 };
  }

  // Normalize confidence to [0, 1]
  const confidence = Math.min(scores[0].score, 1.0);
  return { mode: scores[0].mode, confidence };
}

function scoreProsodyMode(audio: AudioMetadata): { mode: BehavioralMode; confidence: number } {
  // Whisper → silencieux
  if (audio.isWhisper) {
    return { mode: "silencieux", confidence: 0.85 };
  }

  // Low volume → silencieux
  if (audio.volumeDb < -35) {
    return { mode: "silencieux", confidence: 0.7 };
  }

  // Fast speech + falling pitch → executant
  if (audio.speechRateWps > 3.5 && audio.pitchTrend === "falling") {
    return { mode: "executant", confidence: 0.7 };
  }

  // Rising pitch → conseiller (question intonation)
  if (audio.pitchTrend === "rising") {
    return { mode: "conseiller", confidence: 0.65 };
  }

  // Slow speech + flat pitch → compagnon (pensive, emotional)
  if (audio.speechRateWps < 2.0 && audio.pitchTrend === "flat") {
    return { mode: "compagnon", confidence: 0.5 };
  }

  // Default: no strong prosodic signal
  return { mode: "conseiller", confidence: 0.3 };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Confidence threshold — below this, fallback to conseiller */
const MIN_CONFIDENCE = 0.6;

/** Weight for text vs prosody fusion (Task 1.4) */
const TEXT_WEIGHT = 0.6;
const PROSODY_WEIGHT = 0.4;

/**
 * Detect the behavioral mode from transcription text and optional audio metadata.
 * Returns the mode, confidence, and detection source.
 *
 * If audioMetadata is not provided, detection is 100% text-based (Task 1.5).
 * Fusion uses 60% text / 40% prosody weighting (Task 1.4).
 * Latency target: < 50ms (pure CPU, no I/O).
 */
export function detectMode(
  transcription: string,
  audioMetadata?: AudioMetadata,
): ModeDetectionResult {
  const textResult = scoreTextMode(transcription);

  // Task 1.5: No audio metadata → 100% text
  if (!audioMetadata) {
    const mode = textResult.confidence >= MIN_CONFIDENCE ? textResult.mode : "conseiller";
    const confidence = textResult.confidence >= MIN_CONFIDENCE ? textResult.confidence : 0.5;
    return { mode, confidence, source: "text" };
  }

  // Task 1.4: Fusion text + prosody
  const prosodyResult = scoreProsodyMode(audioMetadata);

  // If both agree, boost confidence
  if (textResult.mode === prosodyResult.mode) {
    const fusedConfidence = Math.min(
      textResult.confidence * TEXT_WEIGHT + prosodyResult.confidence * PROSODY_WEIGHT + 0.15,
      1.0,
    );
    return { mode: textResult.mode, confidence: fusedConfidence, source: "fusion" };
  }

  // Different results — pick the one with higher weighted score
  const textWeighted = textResult.confidence * TEXT_WEIGHT;
  const prosodyWeighted = prosodyResult.confidence * PROSODY_WEIGHT;

  // Special case: if prosody is whisper/silencieux with high confidence, it wins
  // (whisper is a strong physical signal that overrides text analysis)
  if (prosodyResult.mode === "silencieux" && prosodyResult.confidence >= 0.8) {
    return { mode: "silencieux", confidence: prosodyResult.confidence * 0.9, source: "fusion" };
  }

  if (textWeighted >= prosodyWeighted) {
    const fusedConfidence = Math.max(textResult.confidence, textWeighted + prosodyWeighted * 0.5);
    return { mode: textResult.mode, confidence: Math.min(fusedConfidence, 1.0), source: "fusion" };
  } else {
    const fusedConfidence = Math.max(prosodyResult.confidence * 0.8, prosodyWeighted + textWeighted * 0.5);
    return { mode: prosodyResult.mode, confidence: Math.min(fusedConfidence, 1.0), source: "fusion" };
  }
}
