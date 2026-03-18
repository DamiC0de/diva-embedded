/**
 * Voice Registration Flow — guided vocal enrollment with multiple samples
 *
 * "Diva, enregistre ma voix" → 5 diverse phrases → WeSpeaker mean embedding
 *
 * Uses varied prompts to capture full prosody range:
 * - Declarative, interrogative, exclamative, whispery, fast speech
 * - Each sample > 2s for good embedding quality
 * - Mean of all embeddings = robust speaker profile
 */
import { type PersonaType } from "./engine.js";
/**
 * Run the full voice registration flow.
 * Returns { name, success } or null if aborted.
 */
export declare function runVoiceRegistration(): Promise<{
    name: string;
    success: boolean;
} | null>;
/**
 * Complete registration with speaker name and audio (used by dashboard/API).
 */
export declare function completeRegistration(speakerName: string, audioB64: string, type?: PersonaType, greetingName?: string): Promise<boolean>;
//# sourceMappingURL=registration.d.ts.map