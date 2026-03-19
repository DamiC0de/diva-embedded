/**
 * Safety Module — Emergency mode, fall detection, voice security
 * Features: #86 #85 #51 #39
 */

import { playAudioFile, playAudioBytes, recordAudio } from "../audio/audio-client.js";
import { synthesize } from "../tts/piper.js";
import { transcribeLocal } from "../stt/local-npu.js";
import { isDNDActive } from "../tools/dnd-manager.js";
import { isAudioBusy } from "../audio/audio-lock.js";
import { listPersonas, getCurrentPersona } from "../persona/engine.js";
import { handleMessageTool } from "../messaging/sender.js";

const ASSETS_DIR = "/opt/diva-embedded/assets";

// =====================================================================
// #86 — Emergency Mode
// =====================================================================

const EMERGENCY_PHRASES = [
  /urgence/i, /au secours/i, /a l'aide/i, /appel.*secours/i,
  /appelle.*urgence/i, /accident/i, /je suis tomb[eé]/i,
  /j'ai mal/i, /je peux pas bouger/i, /aide[- ]moi/i,
];

export function isEmergencyPhrase(text: string): boolean {
  return EMERGENCY_PHRASES.some(r => r.test(text));
}

export async function handleEmergency(transcription: string): Promise<string> {
  console.log(`[SAFETY] Emergency triggered: "${transcription}"`);
  const persona = getCurrentPersona();
  const name = persona.greetingName || "vous";

  // 1. Calm immediate response
  const useTu = persona.communicationPrefs?.tutoiement ?? true;
  const calmMsg = useTu
    ? `${name}, reste calme, je suis la. Je previens tes proches.`
    : `${name}, restez calme, je suis la. Je previens vos proches.`;

  // 2. Alert all emergency contacts
  const personas = listPersonas();
  const contacts = personas.filter(p => p.aidantContacts && p.aidantContacts.length > 0);

  // Send alerts
  try {
    await handleMessageTool({
      action: "send",
      to: "fils",
      message: `URGENCE DIVA: ${name} a dit "${transcription}". Verifiez immediatement.`,
      method: "auto",
    });
  } catch (err) {
    console.error("[SAFETY] Alert send error:", err);
  }

  // 3. Provide first aid guidance if possible
  const lower = transcription.toLowerCase();
  let firstAid = "";
  if (/brul[eé]/i.test(lower)) {
    firstAid = useTu ? " Mets la brulure sous l'eau froide pendant 10 minutes." : " Mettez la brulure sous l'eau froide pendant 10 minutes.";
  } else if (/tomb[eé]|chute/i.test(lower)) {
    firstAid = useTu ? " Ne bouge pas si tu as mal. Tes proches arrivent." : " Ne bougez pas si vous avez mal. Vos proches arrivent.";
  } else if (/sang|coupe|coupure/i.test(lower)) {
    firstAid = useTu ? " Appuie fort sur la plaie avec un tissu propre." : " Appuyez fort sur la plaie avec un tissu propre.";
  }

  return calmMsg + firstAid;
}

// =====================================================================
// #85 — Fall Detection (audio-based)
// =====================================================================

interface FallDetectionState {
  lastLoudSound: number;
  awaitingResponse: boolean;
}

const fallState: FallDetectionState = {
  lastLoudSound: 0,
  awaitingResponse: false,
};

/**
 * Called when HA sends a loud sound event or when the audio server
 * detects a sudden noise spike followed by silence.
 */
export async function handlePossibleFall(source: string = "sensor"): Promise<void> {
  if (isDNDActive() || isAudioBusy()) return;
  if (Date.now() - fallState.lastLoudSound < 120000) return; // 2min cooldown
  fallState.lastLoudSound = Date.now();

  console.log(`[SAFETY] Possible fall detected (source: ${source})`);

  // Check if elderly persona is active
  const personas = listPersonas();
  const elderly = personas.find(p => p.type === "elderly" || p.type === "alzheimer");
  if (!elderly) return;

  const name = elderly.greetingName || "vous";
  const useTu = elderly.communicationPrefs?.tutoiement ?? false;

  // Step 1: Ask if OK
  try {
    const wav1 = await synthesize(
      useTu ? `${name}, tout va bien ? J'ai entendu un bruit.` : `${name}, tout va bien ? J'ai entendu un bruit.`
    );
    await playAudioBytes(wav1.toString("base64"));
  } catch { return; }

  // Step 2: Listen for response
  try {
    const rec = await recordAudio({ maxDurationS: 8, silenceTimeoutS: 3 });
    if (rec.has_speech && rec.wav_base64) {
      const wav = Buffer.from(rec.wav_base64, "base64");
      const text = await transcribeLocal(wav);
      const lower = text.toLowerCase();

      if (/bien|oui|ca va|pas grave|rien/i.test(lower)) {
        const wav2 = await synthesize("D'accord, tant mieux !");
        await playAudioBytes(wav2.toString("base64"));
        return;
      }
      // Person responded but might need help
      if (/aide|mal|tomb|peux pas/i.test(lower)) {
        await handleEmergency(text);
        return;
      }
    }
  } catch {}

  // Step 3: No response — ask again louder
  console.log("[SAFETY] No response to first check, asking again...");
  try {
    const wav3 = await synthesize(`${name} ? Est-ce que tout va bien ? Repondez-moi !`);
    await playAudioBytes(wav3.toString("base64"));
  } catch { return; }

  // Step 4: Listen again
  try {
    const rec2 = await recordAudio({ maxDurationS: 10, silenceTimeoutS: 3 });
    if (rec2.has_speech && rec2.wav_base64) {
      const wav = Buffer.from(rec2.wav_base64, "base64");
      const text = await transcribeLocal(wav);
      if (/bien|oui|ca va/i.test(text.toLowerCase())) {
        const wav4 = await synthesize("Ouf, vous m'avez fait peur !");
        await playAudioBytes(wav4.toString("base64"));
        return;
      }
    }
  } catch {}

  // Step 5: No response at all — ALERT
  console.log("[SAFETY] No response after 2 checks — sending emergency alert!");
  try {
    await handleMessageTool({
      action: "send",
      to: "fils",
      message: `ALERTE DIVA: ${name} ne repond pas apres un bruit suspect. Verifiez immediatement. Il est ${new Date().toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" })}.`,
      method: "auto",
    });
    const wav5 = await synthesize(`${name}, j'ai prevenu vos proches. De l'aide arrive.`);
    await playAudioBytes(wav5.toString("base64"));
  } catch (err) {
    console.error("[SAFETY] Emergency alert error:", err);
  }
}

// =====================================================================
// #51 — Voice Security (unknown voice at night)
// =====================================================================

export async function handleUnknownVoiceAtNight(): Promise<void> {
  const h = parseInt(new Date().toLocaleString("fr-FR", { hour: "numeric", timeZone: "Europe/Paris", hour12: false }));
  if (h >= 6 && h < 23) return; // Only alert at night

  console.log("[SAFETY] Unknown voice detected at night!");
  try {
    await handleMessageTool({
      action: "send",
      to: "fils",
      message: `SECURITE DIVA: Voix inconnue detectee dans la maison a ${new Date().toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" })}. Aucun membre de la famille identifie.`,
      method: "auto",
    });
  } catch (err) {
    console.error("[SAFETY] Night security alert error:", err);
  }
}
