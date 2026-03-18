/**
 * Voice Registration Flow — simple guided enrollment
 *
 * Like Alexa/Google: user repeats fixed phrases. No open questions.
 * 5 phrases designed to cover full prosody (vowels, consonants,
 * intonation, rhythm, nasal sounds specific to French).
 */
import { type PersonaType } from "./engine.js";
export declare function runVoiceRegistration(): Promise<{
    name: string;
    success: boolean;
} | null>;
export declare function completeRegistration(speakerName: string, audioB64: string, type?: PersonaType, greetingName?: string): Promise<boolean>;
//# sourceMappingURL=registration.d.ts.map