/**
 * Voice Registration Flow — simple guided enrollment
 * 
 * Like Alexa/Google: user repeats fixed phrases. No open questions.
 * 5 phrases designed to cover full prosody (vowels, consonants,
 * intonation, rhythm, nasal sounds specific to French).
 */

import {
    recordAudio,
    playAudioBytes,
} from "../audio/audio-client.js";
import { synthesize } from "../tts/piper.js";
import { transcribeLocal } from "../stt/local-npu.js";
import { createPersona, type PersonaType } from "./engine.js";

const MEM0_URL = "http://localhost:9002";

// Fixed phrases — user just repeats them. Covers full French prosody.
const ENROLLMENT_PHRASES = [
    "Repete apres moi : Diva, quelle heure est-il ?",
    "Repete : Le soleil brille aujourd'hui, il fait vraiment tres beau dehors.",
    "Repete : Est-ce que tu peux me raconter une blague s'il te plait ?",
    "Repete : Ma grand-mere fait un excellent gateau au chocolat le dimanche.",
    "Et la derniere : Je voudrais ecouter de la musique classique ce soir.",
];

async function speak(text: string): Promise<void> {
    const wav = await synthesize(text);
    await playAudioBytes(wav.toString("base64"));
}

async function registerSpeakerEmbeddings(name: string, audioSamples: string[]): Promise<boolean> {
    try {
        const res = await fetch(`${MEM0_URL}/speaker/register-multi`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, samples: audioSamples }),
            signal: AbortSignal.timeout(30000),
        });
        if (res.ok) return true;
        // Fallback: longest sample
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

export async function runVoiceRegistration(): Promise<{ name: string; success: boolean } | null> {
    // Step 1: Ask name
    await speak("D'accord. Comment tu t'appelles ?");

    const nameRec = await recordAudio({ maxDurationS: 8, silenceTimeoutS: 1.5 });
    if (!nameRec.has_speech || !nameRec.wav_base64) {
        await speak("Je n'ai rien entendu. Reessaie plus tard.");
        return null;
    }

    const nameWav = Buffer.from(nameRec.wav_base64, "base64");
    const nameText = await transcribeLocal(nameWav);
    const detectedName = extractName(nameText) || nameText.trim().split(/\s+/)[0] || "utilisateur";
    const cleanName = detectedName.toLowerCase().replace(/[^a-zàâéèêëïîôùûüÿç]/g, "");

    await speak(`OK ${detectedName}. Je vais te demander de repeter cinq phrases. C'est rapide.`);

    // Step 2: Collect 5 fixed phrases
    const audioSamples: string[] = [];
    // Include the name recording as first sample (has natural speech)
    audioSamples.push(nameRec.wav_base64);

    for (let i = 0; i < ENROLLMENT_PHRASES.length; i++) {
        await speak(ENROLLMENT_PHRASES[i]);

        const recorded = await recordAudio({
            maxDurationS: 10,
            silenceTimeoutS: 1.5,
        });

        if (!recorded.has_speech || !recorded.wav_base64) {
            // Retry once silently
            await speak("Je n'ai pas entendu, repete.");
            const retry = await recordAudio({ maxDurationS: 10, silenceTimeoutS: 1.5 });
            if (!retry.has_speech || !retry.wav_base64) {
                await speak("On va continuer avec ce qu'on a.");
                continue;
            }
            audioSamples.push(retry.wav_base64);
        } else {
            audioSamples.push(recorded.wav_base64);
        }
    }

    if (audioSamples.length < 3) {
        await speak("Pas assez d'enregistrements. Reessaie plus tard.");
        return null;
    }

    // Step 3: Register
    await speak("Merci ! Enregistrement en cours.");

    const success = await registerSpeakerEmbeddings(cleanName, audioSamples);

    if (success) {
        createPersona(cleanName, detectedName, "adult", detectedName);
        await speak(`Termine ! Je te reconnaitrai maintenant, ${detectedName}.`);
        return { name: cleanName, success: true };
    } else {
        await speak("Il y a eu un souci. Reessaie plus tard.");
        return { name: cleanName, success: false };
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
    return words[0]?.replace(/[^a-zA-ZàâéèêëïîôùûüÿçÀÂÉÈÊËÏÎÔÙÛÜŸÇ]/g, "") || "";
}

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
    } catch { return false; }
}
