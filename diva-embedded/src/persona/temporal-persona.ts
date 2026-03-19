/**
 * Temporal Persona — Idea #15
 * Time-limited access for caregivers (aide-soignante).
 * Access medical briefing during visit, auto-revoke when they leave.
 * 
 * Idea #16 — Baby/toddler cry detection
 * Idea #17 — Alternating custody management
 */

import { log } from "../monitoring/logger.js";

interface TemporalAccess {
  speakerId: string;
  name: string;
  role: "caregiver" | "therapist" | "other";
  permissions: string[];
  grantedAt: number;
  expiresAt: number;
  grantedBy: string;
}

const temporalAccess = new Map<string, TemporalAccess>();

// #15 — Temporal persona
export function grantTemporalAccess(
  speakerId: string,
  name: string,
  role: TemporalAccess["role"],
  durationMs: number,
  grantedBy: string,
): void {
  const access: TemporalAccess = {
    speakerId,
    name,
    role,
    permissions: role === "caregiver" ? ["medical_briefing", "medication_status", "wellness_check"] : ["basic"],
    grantedAt: Date.now(),
    expiresAt: Date.now() + durationMs,
    grantedBy,
  };
  temporalAccess.set(speakerId, access);
  log.info("Temporal access granted", { name, role, durationMin: durationMs / 60000 });
}

export function checkTemporalAccess(speakerId: string): TemporalAccess | null {
  const access = temporalAccess.get(speakerId);
  if (!access) return null;
  if (Date.now() > access.expiresAt) {
    temporalAccess.delete(speakerId);
    log.info("Temporal access expired", { name: access.name });
    return null;
  }
  return access;
}

export function hasTemporalPermission(speakerId: string, permission: string): boolean {
  const access = checkTemporalAccess(speakerId);
  if (!access) return false;
  return access.permissions.includes(permission);
}

export function revokeTemporalAccess(speakerId: string): void {
  const access = temporalAccess.get(speakerId);
  if (access) {
    log.info("Temporal access revoked", { name: access.name });
    temporalAccess.delete(speakerId);
  }
}

// #16 — Baby cry detection patterns
const CRY_DETECTION_ENABLED = false; // Requires audio analysis — future implementation

export function isBabyCry(audioFeatures: { energy: number; pitch: number; duration: number }): boolean {
  if (!CRY_DETECTION_ENABLED) return false;
  // High pitch (300-600Hz), sustained (>2s), high energy
  return audioFeatures.pitch > 300 && audioFeatures.pitch < 600 
    && audioFeatures.duration > 2 
    && audioFeatures.energy > 0.7;
}

// #17 — Alternating custody
interface CustodySchedule {
  childId: string;
  parentA: string; // Home with Diva
  parentB: string; // Other home
  schedule: "week_on_week_off" | "custom";
  currentlyHere: boolean;
  nextSwitch: number; // timestamp
}

const custodySchedules = new Map<string, CustodySchedule>();

export function setCustodySchedule(
  childId: string,
  parentA: string,
  parentB: string,
  schedule: CustodySchedule["schedule"],
): void {
  custodySchedules.set(childId, {
    childId,
    parentA,
    parentB,
    schedule,
    currentlyHere: true,
    nextSwitch: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  log.info("Custody schedule set", { childId, schedule });
}

export function isChildHere(childId: string): boolean {
  const schedule = custodySchedules.get(childId);
  if (!schedule) return true; // No schedule = always here
  
  if (Date.now() > schedule.nextSwitch) {
    schedule.currentlyHere = !schedule.currentlyHere;
    schedule.nextSwitch = Date.now() + 7 * 24 * 60 * 60 * 1000;
  }
  return schedule.currentlyHere;
}

export function getWelcomeBackMessage(childId: string): string | null {
  const schedule = custodySchedules.get(childId);
  if (!schedule || schedule.currentlyHere) return null;
  return `Te revoila ! Alors, cette semaine chez ${schedule.parentB} ?`;
}
