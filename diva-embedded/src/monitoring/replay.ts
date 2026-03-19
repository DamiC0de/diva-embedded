/**
 * Mode Replay — Story 11.2
 * Stores interaction pipeline details for remote debugging.
 * Each interaction logs: STT result, intent, Claude response, TTS.
 */

import { log } from "./logger.js";
import { getCorrelationId } from "./correlation.js";

interface PipelineStep {
  step: string;
  timestamp: number;
  data: Record<string, unknown>;
  durationMs?: number;
}

interface InteractionReplay {
  correlationId: string;
  speakerId: string;
  startedAt: number;
  steps: PipelineStep[];
}

const replayBuffer: InteractionReplay[] = [];
const MAX_REPLAY_BUFFER = 200;
let currentReplay: InteractionReplay | null = null;

export function startReplay(speakerId: string): void {
  currentReplay = {
    correlationId: getCorrelationId(),
    speakerId,
    startedAt: Date.now(),
    steps: [],
  };
}

export function recordStep(step: string, data: Record<string, unknown>): void {
  if (!currentReplay) return;
  currentReplay.steps.push({
    step,
    timestamp: Date.now(),
    data,
    durationMs: currentReplay.steps.length > 0
      ? Date.now() - currentReplay.steps[currentReplay.steps.length - 1].timestamp
      : Date.now() - currentReplay.startedAt,
  });
}

export function finishReplay(): void {
  if (!currentReplay) return;
  replayBuffer.push(currentReplay);
  if (replayBuffer.length > MAX_REPLAY_BUFFER) {
    replayBuffer.splice(0, replayBuffer.length - MAX_REPLAY_BUFFER);
  }
  currentReplay = null;
}

export function getReplayByCorrelationId(correlationId: string): InteractionReplay | null {
  return replayBuffer.find(r => r.correlationId === correlationId) || null;
}

export function getRecentReplays(count = 20): InteractionReplay[] {
  return replayBuffer.slice(-count);
}

export function searchReplays(speakerId?: string, fromDate?: number): InteractionReplay[] {
  return replayBuffer.filter(r => {
    if (speakerId && r.speakerId !== speakerId) return false;
    if (fromDate && r.startedAt < fromDate) return false;
    return true;
  });
}
