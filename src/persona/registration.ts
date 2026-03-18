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

import {
    recordAudio,
    playAudioBytes,
} from "../audio/audio-client.js";
import { synthesize } from "../tts/piper.js";
import { transcribeLocal } from "../stt/local-npu.js";
import { createPersona, type PersonaType } from "./engine.js";

const MEM0_URL = "http://localhost:9002";

const REGISTRATION_PROMPTS = [
    "Dis-moi ton prenom, puis raconte ce que tu as fait aujourd'hui. Parle normalement, au moins trois phrases.",
    "Maintenant, pose-moi une question, n'importe laquelle. Par exemple, est-ce qu'il va pleuvoir demain ?",
    "Parfait. Cette fois, raconte-moi quelque chose qui te fait plaisir, avec enthousiasme !",
    "Tres bien. Maintenant lis cette phrase a voix haute : le petit chat est monte sur le toit et a regarde les etoiles toute la nuit.",
    "Dernier enregistrement. Dis-moi ce que tu veux, parle librement pendant quelques secondes.",
];

async function speak(text: string): Promise<void> {
    const wav = await synthesize(text);
    await playAudioBytes(wav.toString("base64"));
}

async function registerSpeakerEmbeddings(name: string, audioSamples: string[]): Promise<boolean> {
    // Register each sample as a separate embedding, let Python compute the mean
    try {
        const res = await fetch(`${MEM0_URL}/speaker/register-multi`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, samples: audioSamples }),
            signal: AbortSignal.timeout(30000),
        });
        if (res.ok) {
            const data = await res.json() as { status?: string };
            console.log(`[REGISTER] Multi-sample registration: ${data.status}`);
            return true;
        }
        // Fallback: register with longest sample only
        console.warn("[REGISTER] Multi-sample failed, using single best sample");
        const best = audioSamples.reduce((a, b) => a.length > b.length ? a : b);
        const res2 = await fetch(`${MEM0_URL}/speaker/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, audio: best }),
            signal: AbortSignal.timeout(10000),
        });
        return res2.ok;
    } catch (err) {
        console.error("[REGISTER] Error:", err);
        return false;
    }
}

/**
 * Run the full voice registration flow.
 * Returns { name, success } or null if aborted.
 */
export async function runVoiceRegistration(): Promise<{ name: string; success: boolean } | null> {
    await speak("D'accord, je vais enregistrer ta voix. Ca prend environ une minute. Je vais te demander de dire cinq phrases differentes pour bien reconnaitre ta voix.");

    const audioSamples: string[] = [];
    let detectedName = "";

    for (let i = 0; i < REGISTRATION_PROMPTS.length; i++) {
        await speak(REGISTRATION_PROMPTS[i]);

        const recorded = await recordAudio({
            maxDurationS: 15,     // Allow longer recordings for natural speech
            silenceTimeoutS: 2.0, // More patience — user needs time to think
        });

        if (!recorded.has_speech || !recorded.wav_base64) {
            await speak("Je n'ai rien entendu. On reessaie.");
            // Retry once
            const retry = await recordAudio({
                maxDurationS: 15,
                silenceTimeoutS: 2.0,
            });
            if (!retry.has_speech || !retry.wav_base64) {
                await speak("Toujours rien. On arrete l'enregistrement pour le moment.");
                return null;
            }
            audioSamples.push(retry.wav_base64);

            // Extract name from first sample
            if (i === 0) {
                const wav = Buffer.from(retry.wav_base64, "base64");
                const text = await transcribeLocal(wav);
                detectedName = extractName(text);
            }
            continue;
        }

        audioSamples.push(recorded.wav_base64);

        // Extract name from first sample
        if (i === 0) {
            const wav = Buffer.from(recorded.wav_base64, "base64");
            const text = await transcribeLocal(wav);
            detectedName = extractName(text);
            if (detectedName) {
                await speak(`OK ${detectedName}, c'est note. On continue.`);
            } else {
                await speak("C'est note. On continue.");
            }
        } else if (i < REGISTRATION_PROMPTS.length - 1) {
            const confirmations = ["Parfait.", "Tres bien.", "Super.", "C'est note."];
            await speak(confirmations[i % confirmations.length]);
        }
    }

    if (audioSamples.length < 3) {
        await speak("Pas assez d'echantillons pour un bon enregistrement. Reessaie plus tard.");
        return null;
    }

    // If no name detected, ask explicitly
    if (!detectedName) {
        await speak("Comment veux-tu que je t'appelle ?");
        const nameRec = await recordAudio({ maxDurationS: 5, silenceTimeoutS: 1.5 });
        if (nameRec.has_speech && nameRec.wav_base64) {
            const wav = Buffer.from(nameRec.wav_base64, "base64");
            const text = await transcribeLocal(wav);
            detectedName = extractName(text) || text.trim().split(/\s+/)[0] || "utilisateur";
        } else {
            detectedName = "utilisateur";
        }
    }

    const name = detectedName.toLowerCase().replace(/[^a-zàâéèêëïîôùûüÿç]/g, "");
    
    await speak(`Enregistrement en cours pour ${detectedName}, ca prend quelques secondes.`);

    // Register with all samples
    const success = await registerSpeakerEmbeddings(name, audioSamples);

    if (success) {
        // Create persona profile
        createPersona(name, detectedName, "adult", detectedName);
        await speak(`C'est fait ! Je t'ai enregistre sous le nom ${detectedName}. Je te reconnaitrai a partir de maintenant.`);
        return { name, success: true };
    } else {
        await speak("Desole, il y a eu un probleme. Reessaie plus tard.");
        return { name, success: false };
    }
}

function extractName(text: string): string {
    if (!text) return "";
    
    // Common patterns: "Je m'appelle X", "Moi c'est X", "C'est X", just "X"
    const patterns = [
        /(?:je\s+m'appelle|moi\s+c'est|c'est|je\s+suis)\s+([A-ZÀ-Ü][a-zà-ü]+)/i,
        /^([A-ZÀ-Ü][a-zà-ü]+)[\s,]/,  // First word if capitalized
    ];
    
    for (const pat of patterns) {
        const m = text.match(pat);
        if (m && m[1] && m[1].length >= 2 && m[1].length <= 20) {
            return m[1];
        }
    }
    
    // Fallback: first word that looks like a name
    const words = text.trim().split(/[\s,!.?]+/);
    for (const w of words) {
        if (w.length >= 2 && w.length <= 15 && /^[A-ZÀ-Ü]/.test(w)) {
            return w;
        }
    }
    
    return words[0]?.replace(/[^a-zA-ZàâéèêëïîôùûüÿçÀÂÉÈÊËÏÎÔÙÛÜŸÇ]/g, "") || "";
}

/**
 * Complete registration with speaker name and audio (used by dashboard/API).
 */
export async function completeRegistration(
    speakerName: string,
    audioB64: string,
    type: PersonaType = "adult",
    greetingName?: string
): Promise<boolean> {
    try {
        const res = await fetch(`${MEM0_URL}/speaker/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: speakerName, audio: audioB64 }),
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return false;
        createPersona(speakerName, speakerName, type, greetingName ?? speakerName);
        return true;
    } catch {
        return false;
    }
}
