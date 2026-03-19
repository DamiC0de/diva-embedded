/**
 * Noise Suppressor — Story 3.1
 * Uses sox noisered for noise reduction before STT.
 * MVP approach: sox-based. Post-MVP: native RNNoise.
 */

import { execSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { log } from "../monitoring/logger.js";

const NOISE_PROFILE = "/tmp/diva-noise-profile.prof";
let profileReady = false;

/**
 * Generate noise profile from a short silence sample.
 * Should be called once during startup with ambient noise.
 */
export function generateNoiseProfile(silenceWavBuffer: Buffer): boolean {
  try {
    const tmpIn = "/tmp/diva-noise-sample.wav";
    writeFileSync(tmpIn, silenceWavBuffer);
    execSync(`sox ${tmpIn} -n noiseprof ${NOISE_PROFILE}`, { timeout: 5000 });
    profileReady = true;
    log.info("Noise profile generated");
    return true;
  } catch (err) {
    log.warn("Failed to generate noise profile", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Apply noise reduction to an audio buffer.
 * Returns the cleaned buffer, or the original if processing fails.
 */
export function suppressNoise(wavBuffer: Buffer): Buffer {
  if (!profileReady || !existsSync(NOISE_PROFILE)) {
    return wavBuffer; // Graceful degradation — pass through
  }

  const tmpIn = "/tmp/diva-nr-in.wav";
  const tmpOut = "/tmp/diva-nr-out.wav";

  try {
    writeFileSync(tmpIn, wavBuffer);
    execSync(`sox ${tmpIn} ${tmpOut} noisered ${NOISE_PROFILE} 0.21`, { timeout: 5000 });
    const cleaned = readFileSync(tmpOut);
    return cleaned;
  } catch (err) {
    log.debug("Noise suppression failed — using original audio", {
      error: err instanceof Error ? err.message : String(err),
    });
    return wavBuffer; // Graceful degradation
  } finally {
    try { unlinkSync(tmpIn); } catch {}
    try { unlinkSync(tmpOut); } catch {}
  }
}

export function isNoiseProfileReady(): boolean {
  return profileReady;
}
