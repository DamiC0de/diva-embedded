/**
 * Voice Registration Flow — guided vocal enrollment
 * "Diva, enregistre ma voix" → 3 sentences → WeSpeaker embedding → profile
 */
import { type PersonaType } from "./engine.js";
/**
 * Run the voice registration flow.
 * Returns the registered speaker name or null if failed.
 */
export declare function runVoiceRegistration(): Promise<string | null>;
/**
 * Complete registration with speaker name and audio.
 */
export declare function completeRegistration(speakerName: string, audioB64: string, type?: PersonaType, greetingName?: string): Promise<boolean>;
//# sourceMappingURL=registration.d.ts.map