/**
 * Voice Registration Flow — simple guided enrollment
 * User repeats fixed phrases covering full French prosody.
 */
import { recordAudio, playAudioBytes, playAudioFile, } from "../audio/audio-client.js";
import { synthesize } from "../tts/piper.js";
import { transcribeLocal } from "../stt/local-npu.js";
import { createPersona } from "./engine.js";
const MEM0_URL = "http://localhost:9002";
const ASSETS_DIR = "/opt/diva-embedded/assets";
const ENROLLMENT_PHRASES = [
    "Répète après moi : Diva, quelle heure est-il ?",
    "Répète : Le soleil brille aujourd'hui, il fait vraiment très beau dehors.",
    "Répète : Est-ce que tu peux me raconter une blague s'il te plaît ?",
    "Répète : Ma grand-mère fait un excellent gâteau au chocolat le dimanche.",
    "Et la dernière : Je voudrais écouter de la musique classique ce soir.",
];
async function speak(text) {
    const wav = await synthesize(text);
    await playAudioBytes(wav.toString("base64"));
}
/** Play the "your turn" beep then record */
async function listenWithBeep(maxDurationS = 10, silenceTimeoutS = 1.5) {
    await playAudioFile(`${ASSETS_DIR}/listen.wav`);
    return recordAudio({ maxDurationS, silenceTimeoutS });
}
async function registerSpeakerEmbeddings(name, audioSamples) {
    try {
        const res = await fetch(`${MEM0_URL}/speaker/register-multi`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, samples: audioSamples }),
            signal: AbortSignal.timeout(30000),
        });
        if (res.ok)
            return true;
        const best = audioSamples.reduce((a, b) => a.length > b.length ? a : b);
        const res2 = await fetch(`${MEM0_URL}/speaker/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, audio: best }),
            signal: AbortSignal.timeout(10000),
        });
        return res2.ok;
    }
    catch (err) {
        console.error("[REGISTER] Error:", err);
        return false;
    }
}
export async function runVoiceRegistration() {
    // Step 1: Ask name
    await speak("D'accord. Comment tu t'appelles ?");
    const nameRec = await listenWithBeep(8, 1.5);
    if (!nameRec.has_speech || !nameRec.wav_base64) {
        await speak("Je n'ai rien entendu. Réessaie plus tard.");
        return null;
    }
    const nameWav = Buffer.from(nameRec.wav_base64, "base64");
    const nameText = await transcribeLocal(nameWav);
    const detectedName = extractName(nameText) || nameText.trim().split(/\s+/)[0] || "utilisateur";
    const cleanName = detectedName.toLowerCase().replace(/[^a-zàâéèêëïîôùûüÿç]/g, "");
    await speak(`OK ${detectedName}. Je vais te demander de répéter cinq phrases. C'est rapide.`);
    // Step 2: Collect 5 fixed phrases
    const audioSamples = [];
    audioSamples.push(nameRec.wav_base64);
    for (let i = 0; i < ENROLLMENT_PHRASES.length; i++) {
        await speak(ENROLLMENT_PHRASES[i]);
        const recorded = await listenWithBeep(10, 1.5);
        if (!recorded.has_speech || !recorded.wav_base64) {
            await speak("Je n'ai pas entendu, répète.");
            const retry = await listenWithBeep(10, 1.5);
            if (!retry.has_speech || !retry.wav_base64) {
                await speak("On continue avec ce qu'on a.");
                continue;
            }
            audioSamples.push(retry.wav_base64);
        }
        else {
            audioSamples.push(recorded.wav_base64);
        }
    }
    if (audioSamples.length < 3) {
        await speak("Pas assez d'enregistrements. Réessaie plus tard.");
        return null;
    }
    // Step 3: Register
    await speak("Merci ! Enregistrement en cours.");
    const success = await registerSpeakerEmbeddings(cleanName, audioSamples);
    if (success) {
        createPersona(cleanName, detectedName, "adult", detectedName);
        await speak(`Terminé ! Je te reconnaîtrai maintenant, ${detectedName}.`);
        return { name: cleanName, success: true };
    }
    else {
        await speak("Il y a eu un souci. Réessaie plus tard.");
        return { name: cleanName, success: false };
    }
}
function extractName(text) {
    if (!text)
        return "";
    const patterns = [
        /(?:je\s+m'appelle|moi\s+c'est|c'est|je\s+suis)\s+([A-ZÀ-Ü][a-zà-ü]+)/i,
        /^([A-ZÀ-Ü][a-zà-ü]+)[\s,!.]/,
    ];
    for (const pat of patterns) {
        const m = text.match(pat);
        if (m?.[1] && m[1].length >= 2 && m[1].length <= 20)
            return m[1];
    }
    const words = text.trim().split(/[\s,!.?]+/);
    return words[0]?.replace(/[^a-zA-ZàâéèêëïîôùûüÿçÀÂÉÈÊËÏÎÔÙÛÜŸÇ]/g, "") || "";
}
export async function completeRegistration(speakerName, audioB64, type = "adult", greetingName) {
    try {
        const res = await fetch(`${MEM0_URL}/speaker/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: speakerName, audio: audioB64 }),
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok)
            return false;
        createPersona(speakerName, speakerName, type, greetingName ?? speakerName);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=registration.js.map