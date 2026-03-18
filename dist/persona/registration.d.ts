/**
 * Voice Registration Flow — simple guided enrollment
 * User repeats fixed phrases covering full French prosody.
 */
import { type PersonaType } from "./engine.js";
export declare function runVoiceRegistration(): Promise<{
    name: string;
    success: boolean;
} | null>;
export declare function completeRegistration(speakerName: string, audioB64: string, type?: PersonaType, greetingName?: string): Promise<boolean>;
//# sourceMappingURL=registration.d.ts.map