/**
 * Correlation ID — Story 1.2
 * Generates and propagates a unique ID per interaction across all services.
 */

import { randomUUID } from "node:crypto";

let currentCorrelationId: string = "";

export function newCorrelationId(): string {
  currentCorrelationId = randomUUID();
  return currentCorrelationId;
}

export function getCorrelationId(): string {
  return currentCorrelationId || randomUUID();
}

export function setCorrelationId(id: string): void {
  currentCorrelationId = id;
}
