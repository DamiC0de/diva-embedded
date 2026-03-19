/**
 * Interactive Onboarding — triggered when an unknown voice is detected.
 *
 * Flow:
 * 1. "Oh, bonjour ! Je ne connais pas encore ta voix. Je suis Diva, le compagnon de la maison. Comment tu t'appelles ?"
 * 2. Collect name + first voice sample
 * 3. Collect 4 more voice samples (enrollment phrases)
 * 4. Ask communication preferences (tutoiement, style) — SKIP for children
 * 5. Register speaker embedding + create persona
 */

import {
    recordAudio,
    playAudioBytes,
    playAudioFile,
} from "../audio/audio-client.js";
import { synthesize } from "../tts/piper.js";
import { transcribeLocal } from "../stt/local-npu.js";
import {
    createPersona,
    type PersonaType,
    type CommunicationStyle,
    type CommunicationPrefs,
} from "./engine.js";

import { buildWarmStartGreeting } from "./warm-start.js";
import { initDiscovery } from "./discovery-guide.js";
import { log } from "../monitoring/logger.js";
import { recordConsent } from "../security/privacy-guard.js";

const MEM0_URL = "http://localhost:9002";
const ASSETS_DIR = "/opt/diva-embedded/assets";

const ENROLLMENT_PHRASES = [
    "Dis-moi, qu'est-ce que tu aimes faire ? De la musique, du sport ?",
    "Et tu habites ici ou tu es de passage ?",
    "C'est quoi ta musique preferee ?",
    "Derniere question : c'est quoi ton plat prefere ?",
];

// Child detection keywords in the name/response
const CHILD_INDICATORS = [
    /\b(\d+)\s*ans?\b/,       // "j'ai 8 ans"
    /\benfant\b/i,
    /\bpetit(e)?\b/i,
];

async function speak(text: string): Promise<void> {
    const wav = await synthesize(text);
    await playAudioBytes(wav.toString("base64"));
}

async function listenWithBeep(
    maxDurationS: number = 10,
    silenceTimeoutS: number = 1.5
): Promise<{ has_speech: boolean; wav_base64?: string; duration_ms?: number }> {
    await playAudioFile(`${ASSETS_DIR}/listen.wav`);
    return recordAudio({ maxDurationS, silenceTimeoutS });
}

async function registerSpeakerEmbeddings(
    name: string,
    audioSamples: string[]
): Promise<boolean> {
    try {
        const res = await fetch(`${MEM0_URL}/speaker/register-multi`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, samples: audioSamples }),
            signal: AbortSignal.timeout(30000),
        });
        if (res.ok) return true;

        // Fallback: single best sample
        const best = audioSamples.reduce((a, b) =>
            a.length > b.length ? a : b
        );
        const res2 = await fetch(`${MEM0_URL}/speaker/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, audio: best }),
            signal: AbortSignal.timeout(10000),
        });
        return res2.ok;
    } catch (err) {
        console.error("[ONBOARDING] Register error:", err);
        return false;
    }
}

function extractName(text: string): string {
    if (!text) return "";
    const patterns = [
        /(?:je\s+m'appelle|moi\s+c'est|c'est|je\s+suis)\s+([A-ZÀ-Ü][a-zà-ü]+)/i,
        /^([A-ZÀ-Ü][a-zà-ü]+)[\s,!.]/,
    ];
    for (const pat of patterns) {
        const m = text.match(pat);
        if (m?.[1] && m[1].length >= 2 && m[1].length <= 20) return m[1];
    }
    const words = text.trim().split(/[\s,!.?]+/);
    return (
        words[0]?.replace(/[^a-zA-ZàâéèêëïîôùûüÿçÀÂÉÈÊËÏÎÔÙÛÜŸÇ]/g, "") || ""
    );
}

function detectChildFromAge(text: string): boolean {
    const ageMatch = text.match(/\b(\d+)\s*ans?\b/);
    if (ageMatch) {
        const age = parseInt(ageMatch[1]);
        return age > 0 && age < 13;
    }
    return false;
}

/**
 * Ask a yes/no question, return true for yes.
 */
async function askYesNo(question: string): Promise<boolean | null> {
    await speak(question);
    const rec = await listenWithBeep(6, 1.2);
    if (!rec.has_speech || !rec.wav_base64) return null;

    const wav = Buffer.from(rec.wav_base64, "base64");
    const text = await transcribeLocal(wav);
    const lower = text.toLowerCase();

    if (/\b(oui|ouais|ok|d'accord|bien sur|yes|yep|absolument|carrément|volontiers)\b/.test(lower)) return true;
    if (/\b(non|nan|pas|nope|jamais)\b/.test(lower)) return false;
    return null; // ambiguous
}

/**
 * Ask a multiple choice question, return the detected choice.
 */
async function askChoice(
    question: string,
    options: { keywords: RegExp; value: string }[]
): Promise<string | null> {
    await speak(question);
    const rec = await listenWithBeep(8, 1.5);
    if (!rec.has_speech || !rec.wav_base64) return null;

    const wav = Buffer.from(rec.wav_base64, "base64");
    const text = await transcribeLocal(wav);
    const lower = text.toLowerCase();

    for (const option of options) {
        if (option.keywords.test(lower)) return option.value;
    }
    return null;
}

// =====================================================================
// Main Onboarding Flow
// =====================================================================

export interface OnboardingResult {
    name: string;
    cleanName: string;
    success: boolean;
    type: PersonaType;
}

export async function runOnboarding(): Promise<OnboardingResult | null> {
    console.log("[ONBOARDING] Starting interactive onboarding for unknown voice");

    // --- Step 1: Introduce and ask name ---
    await speak("Tiens, je ne te connais pas encore ! Comment tu t'appelles ?");

    const nameRec = await listenWithBeep(8, 1.5);
    if (!nameRec.has_speech || !nameRec.wav_base64) {
        await speak("Pas de souci, on fera connaissance une prochaine fois !");
        return null;
    }

    const nameWav = Buffer.from(nameRec.wav_base64, "base64");
    const nameText = await transcribeLocal(nameWav);
    const detectedName =
        extractName(nameText) || nameText.trim().split(/\s+/)[0] || "ami";
    const cleanName = detectedName
        .toLowerCase()
        .replace(/[^a-zàâéèêëïîôùûüÿç]/g, "");

    console.log(`[ONBOARDING] Detected name: "${detectedName}" (clean: "${cleanName}")`);

    // --- Step 2: Detect if child ---
    let isChild = detectChildFromAge(nameText);
    let personaType: PersonaType = "adult";

    if (!isChild) {
        // Ask age to determine if child
        const ageAnswer = await askChoice(
            `Enchantee ${detectedName} ! Dis-moi, tu es un adulte ou un enfant ?`,
            [
                { keywords: /\b(enfant|petit|gamin|gosse|junior)\b/, value: "child" },
                { keywords: /\b(adulte|grand|majeur)\b/, value: "adult" },
                { keywords: /\b(ado|adolescent|teenager)\b/, value: "adult" }, // teens get adult treatment
            ]
        );

        if (ageAnswer === "child") {
            isChild = true;
            personaType = "child";
        }
    } else {
        personaType = "child";
    }

    // --- Step 3: Collect voice samples ---
    if (isChild) {
        await speak(`Super ${detectedName} ! Je vais apprendre a reconnaitre ta voix. Repete ce que je te dis, c'est un jeu !`);
    } else {
        await speak(`${detectedName}, je vais apprendre ta voix. Repete ces quelques phrases, c'est rapide.`);
    }

    const audioSamples: string[] = [];
    audioSamples.push(nameRec.wav_base64); // Use name recording as first sample

    for (let i = 0; i < ENROLLMENT_PHRASES.length; i++) {
        await speak(ENROLLMENT_PHRASES[i]);
        const recorded = await listenWithBeep(10, 1.5);

        if (!recorded.has_speech || !recorded.wav_base64) {
            await speak("Je n'ai pas entendu, repete.");
            const retry = await listenWithBeep(10, 1.5);
            if (retry.has_speech && retry.wav_base64) {
                audioSamples.push(retry.wav_base64);
            }
            continue;
        }
        audioSamples.push(recorded.wav_base64);
    }

    if (audioSamples.length < 3) {
        await speak("Pas assez d'echantillons. On reessaiera une prochaine fois !");
        return null;
    }

    // --- Step 4: Ask communication preferences (adults only) ---
    let commPrefs: Partial<CommunicationPrefs> = {};

    if (!isChild) {
        // Tutoiement preference
        const tuPref = await askYesNo(
            `${detectedName}, tu preferes qu'on se tutoie, ou que je te vouvoie ?`
        );
        if (tuPref === true) {
            commPrefs.tutoiement = true;
        } else if (tuPref === false) {
            commPrefs.tutoiement = false;
        }
        // null = keep default (tutoiement for adults)

        // Personality style
        const stylePref = await askChoice(
            "Et pour mon style, tu preferes que je sois plutot enjouee et dynamique, ou plutot posee et calme ?",
            [
                { keywords: /\b(enjou|dynamique|fun|drole|rigol|joyeu|energi)\b/, value: "enjouée" },
                { keywords: /\b(pos[eé]|calme|tranquil|zen|serein|cool)\b/, value: "posée" },
                { keywords: /\b(normal|neutre|simple|classique|standard)\b/, value: "neutre" },
                { keywords: /\b(chaleureu|douc|gentil|bienveillan)\b/, value: "chaleureuse" },
                { keywords: /\b(espi[eè]gle|malici|taquin|coquin)\b/, value: "espiègle" },
            ]
        );
        if (stylePref) {
            commPrefs.style = stylePref as CommunicationStyle;
        }

        // Humor preference
        const humorPref = await askYesNo(
            "Est-ce que tu aimes quand je glisse des petites touches d'humour ?"
        );
        if (humorPref !== null) {
            commPrefs.humor = humorPref;
        }
    }

    // --- Step 5: Register voice + create persona ---
    await speak("Merci ! Enregistrement en cours.");
    console.log(`[ONBOARDING] Registering ${cleanName} with ${audioSamples.length} samples, prefs:`, commPrefs);

    const success = await registerSpeakerEmbeddings(cleanName, audioSamples);

    if (success) {
        createPersona(cleanName, detectedName, personaType, detectedName, commPrefs);

        if (isChild) {
            await speak(`C'est bon ${detectedName} ! Maintenant je te reconnaitrai. A bientot !`);
        } else {
            await speak(`Parfait ${detectedName}, c'est enregistre ! Je te reconnaitrai desormais.`);
        }

        return { name: detectedName, cleanName, success: true, type: personaType };
    } else {
        await speak("Il y a eu un souci technique. On reessaiera plus tard.");
        return { name: detectedName, cleanName, success: false, type: personaType };
    }
}

/**
 * Quick check: should we trigger onboarding for this speaker?
 * Returns true if speaker is unknown and we haven't tried recently.
 */
let lastOnboardingAttempt = 0;
const ONBOARDING_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between attempts

export function shouldTriggerOnboarding(speakerId: string): boolean {
    if (speakerId !== "unknown") return false;
    const now = Date.now();
    if (now - lastOnboardingAttempt < ONBOARDING_COOLDOWN_MS) return false;
    return true;
}

export function markOnboardingAttempt(): void {
    lastOnboardingAttempt = Date.now();
}
