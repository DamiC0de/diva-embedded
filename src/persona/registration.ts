/**
 * Voice Registration Flow — guided vocal enrollment
 * "Diva, enregistre ma voix" → 3 sentences → WeSpeaker embedding → profile
 */

import {
    recordAudio,
    playAudioBytes,
} from "../audio/audio-client.js";
import { synthesize } from "../tts/piper.js";
import { createPersona, type PersonaType } from "./engine.js";

const MEM0_URL = "http://localhost:9002";

const REGISTRATION_PROMPTS = [
    "Dis-moi ton prenom, suivi d'une phrase de ton choix.",
    "Parfait. Maintenant, dis une deuxieme phrase, par exemple ce que tu as fait aujourd'hui.",
    "Tres bien. Une derniere phrase, dis ce que tu veux.",
];

async function speak(text: string): Promise<void> {
    const wav = await synthesize(text);
    await playAudioBytes(wav.toString("base64"));
}

async function registerEmbedding(name: string, audioB64: string): Promise<boolean> {
    try {
        const res = await fetch(`${MEM0_URL}/speaker/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, audio: audioB64 }),
            signal: AbortSignal.timeout(5000),
        });
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Run the voice registration flow.
 * Returns the registered speaker name or null if failed.
 */
export async function runVoiceRegistration(): Promise<string | null> {
    await speak("D'accord, je vais enregistrer ta voix. Je vais te demander de dire trois phrases.");

    const audioSamples: string[] = [];

    for (let i = 0; i < REGISTRATION_PROMPTS.length; i++) {
        await speak(REGISTRATION_PROMPTS[i]);

        const recorded = await recordAudio({
            maxDurationS: 8,
            silenceTimeoutS: 1.5,
        });

        if (!recorded.has_speech || !recorded.wav_base64) {
            await speak("Je n'ai rien entendu. On recommencera une prochaine fois.");
            return null;
        }

        audioSamples.push(recorded.wav_base64);
    }

    // Ask for name
    await speak("Merci. Comment veux-tu que je t'appelle ?");
    const nameRecording = await recordAudio({
        maxDurationS: 5,
        silenceTimeoutS: 1.2,
    });

    // We'll use a simple default name extraction via STT
    // The actual name extraction will happen via the transcription in the caller
    // For now, register with the combined audio

    // Combine all samples for better embedding quality
    // Register with the first sample (longest usually)
    const bestSample = audioSamples.reduce((a, b) => a.length > b.length ? a : b);

    // Use a temporary name until the caller provides the real one
    // The registration flow returns the name recording for STT processing
    return bestSample; // Return the best audio for embedding
}

/**
 * Complete registration with speaker name and audio.
 */
export async function completeRegistration(
    speakerName: string,
    audioB64: string,
    type: PersonaType = "adult",
    greetingName?: string
): Promise<boolean> {
    // Register WeSpeaker embedding
    const ok = await registerEmbedding(speakerName, audioB64);
    if (!ok) {
        console.error(`[REGISTER] Failed to register embedding for ${speakerName}`);
        return false;
    }

    // Create persona profile
    createPersona(speakerName, speakerName, type, greetingName ?? speakerName);

    console.log(`[REGISTER] Successfully registered: ${speakerName} (${type})`);
    return true;
}
