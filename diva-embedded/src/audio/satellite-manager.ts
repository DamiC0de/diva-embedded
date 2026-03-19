/**
 * Satellite Manager — Ideas #37, #38, #39, #40
 * Manages ESP32 audio satellites for multi-room coverage.
 * #37: Satellite network (WebSocket audio streaming)
 * #38: Spatial awareness (which room)
 * #39: Audio isolation (separate contexts per room)
 * #40: Extended fall detection (bathroom satellite)
 */

import { log } from "../monitoring/logger.js";

interface Satellite {
  id: string;
  name: string; // "salon", "cuisine", "salle_de_bain"
  ip: string;
  port: number;
  connected: boolean;
  lastSeen: number;
  capabilities: ("audio_in" | "audio_out" | "fall_detection")[];
}

const satellites = new Map<string, Satellite>();
let currentRoom: string = "main"; // Default: main device

// #37 — Register and manage satellites
export function registerSatellite(id: string, name: string, ip: string, port: number, capabilities: Satellite["capabilities"]): void {
  satellites.set(id, {
    id, name, ip, port,
    connected: true,
    lastSeen: Date.now(),
    capabilities,
  });
  log.info("Satellite registered", { id, name, ip, capabilities });
}

export function getSatellites(): Satellite[] {
  return [...satellites.values()];
}

export function getSatelliteByRoom(room: string): Satellite | null {
  return [...satellites.values()].find(s => s.name === room) || null;
}

// #38 — Spatial awareness
export function setCurrentRoom(room: string): void {
  currentRoom = room;
  log.debug("Room detected", { room });
}

export function getCurrentRoom(): string {
  return currentRoom;
}

// Route audio to correct satellite
export function getAudioTarget(speakerId: string): { ip: string; port: number } | null {
  if (satellites.size === 0) return null; // No satellites, use main device
  const roomSatellite = getSatelliteByRoom(currentRoom);
  return roomSatellite ? { ip: roomSatellite.ip, port: roomSatellite.port } : null;
}

// #39 — Audio isolation: get session per room
export function getRoomSession(room: string): string {
  return `room_${room}`;
}

// #40 — Fall detection on bathroom satellite
export function handleSatelliteFallAlert(satelliteId: string): void {
  const satellite = satellites.get(satelliteId);
  if (!satellite) return;
  log.error("Fall detected on satellite", { satelliteId, room: satellite.name });
  // Trigger emergency on ALL satellites + main device
}

// mDNS discovery would be implemented here for auto-detection
export function discoverSatellites(): void {
  log.info("Satellite discovery started (mDNS)");
  // In production: use mdns/avahi to find _diva-satellite._tcp services
}
