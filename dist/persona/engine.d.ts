/**
 * Persona Engine — adapts ALL behavior based on detected speaker
 *
 * After speaker ID (WeSpeaker), loads persona profile that configures:
 * - allowed_intents: which intents are allowed (child filtering)
 * - prompt_prefix: Claude instructions (tone, vocabulary, length)
 * - tts_config: Piper speed (length_scale) and pauses
 * - content_filter: none | mild | strict
 * - greeting_name: how Diva addresses this person
 */
export type PersonaType = "adult" | "child" | "elderly" | "alzheimer" | "guest";
export type ContentFilter = "none" | "mild" | "strict";
export interface TTSConfig {
    lengthScale: number;
    pauseBetweenSentences: number;
}
export interface PersonaProfile {
    id: string;
    name: string;
    type: PersonaType;
    greetingName: string;
    allowedIntents: string[] | "all";
    blockedIntents: string[];
    promptPrefix: string;
    ttsConfig: TTSConfig;
    contentFilter: ContentFilter;
    morningBriefing: boolean;
    medicationReminders: boolean;
    proactiveCheckins: boolean;
    aidantContacts: string[];
}
export declare function loadPersonas(): void;
export declare function savePersona(profile: PersonaProfile): void;
export declare function getPersona(speakerId: string): PersonaProfile;
export declare function createPersona(speakerId: string, displayName: string, type: PersonaType, greetingName?: string): PersonaProfile;
export declare function listPersonas(): PersonaProfile[];
export declare function deletePersona(id: string): boolean;
export declare function setCurrentPersona(speakerId: string): PersonaProfile;
export declare function getCurrentPersona(): PersonaProfile;
export declare function isIntentAllowed(category: string): boolean;
export declare function getPersonaPromptPrefix(): string;
export declare function getPersonaTTSConfig(): TTSConfig;
//# sourceMappingURL=engine.d.ts.map