/**
 * Offline Queue — Story 10.7
 * Stores actions that need network and replays them when connection returns.
 */

import { log } from "../monitoring/logger.js";

interface QueuedAction {
  id: string;
  type: "send_message" | "search" | "calendar_sync";
  payload: Record<string, unknown>;
  queuedAt: number;
  speakerId: string;
}

const queue: QueuedAction[] = [];
let idCounter = 0;

export function enqueueAction(
  type: QueuedAction["type"],
  payload: Record<string, unknown>,
  speakerId: string,
): string {
  const id = `offline_${++idCounter}`;
  queue.push({ id, type, payload, queuedAt: Date.now(), speakerId });
  log.info("Action queued for offline replay", { id, type, speakerId });
  return id;
}

export function getPendingActions(): QueuedAction[] {
  return [...queue];
}

export function dequeueAction(id: string): void {
  const idx = queue.findIndex(a => a.id === id);
  if (idx >= 0) queue.splice(idx, 1);
}

export function clearQueue(): void {
  queue.length = 0;
}

export function getQueueSize(): number {
  return queue.length;
}
