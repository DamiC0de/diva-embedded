/**
 * Visitor Classifier — Story 7.3, 7.4, 7.5
 * Classifies visitors: familiar (recurring), child friend, guest, invite mode.
 */

import { log } from "../monitoring/logger.js";

interface VisitorRecord {
  speakerId: string;
  name?: string;
  visitCount: number;
  lastVisit: number;
  type: "unknown" | "familiar" | "child_friend" | "guest";
  isChildVoice?: boolean;
}

const visitors = new Map<string, VisitorRecord>();
let inviteMode = false;
let inviteModeExpiry = 0;

const FAMILIAR_THRESHOLD = 3; // Visits before proposing to register

export function recordVisit(speakerId: string, isChildVoice = false): VisitorRecord {
  const existing = visitors.get(speakerId);
  
  if (existing) {
    existing.visitCount++;
    existing.lastVisit = Date.now();
    if (isChildVoice) existing.isChildVoice = true;
    
    if (existing.visitCount >= FAMILIAR_THRESHOLD && existing.type === "unknown") {
      existing.type = isChildVoice ? "child_friend" : "familiar";
      log.info("Visitor promoted to familiar", { speakerId, visits: existing.visitCount });
    }
    
    return existing;
  }

  const record: VisitorRecord = {
    speakerId,
    visitCount: 1,
    lastVisit: Date.now(),
    type: isChildVoice ? "child_friend" : "unknown",
    isChildVoice,
  };
  visitors.set(speakerId, record);
  return record;
}

export function getVisitorType(speakerId: string): VisitorRecord["type"] {
  if (inviteMode && Date.now() < inviteModeExpiry) return "guest";
  return visitors.get(speakerId)?.type || "unknown";
}

export function setVisitorName(speakerId: string, name: string): void {
  const record = visitors.get(speakerId);
  if (record) {
    record.name = name;
    record.type = "familiar";
    log.info("Visitor named", { speakerId, name });
  }
}

export function getVisitorName(speakerId: string): string | undefined {
  return visitors.get(speakerId)?.name;
}

export function shouldProposeRegistration(speakerId: string): boolean {
  const record = visitors.get(speakerId);
  if (!record) return false;
  return record.visitCount === FAMILIAR_THRESHOLD && !record.name;
}

// =====================================================================
// Invite mode — Story 7.5
// =====================================================================

export function activateInviteMode(durationMs = 8 * 60 * 60 * 1000): void {
  inviteMode = true;
  inviteModeExpiry = Date.now() + durationMs;
  log.info("Invite mode activated", { expiresIn: durationMs / 60000 });
}

export function deactivateInviteMode(): void {
  inviteMode = false;
  inviteModeExpiry = 0;
  log.info("Invite mode deactivated");
}

export function isInviteMode(): boolean {
  if (inviteMode && Date.now() >= inviteModeExpiry) {
    deactivateInviteMode();
  }
  return inviteMode;
}
