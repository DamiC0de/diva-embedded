/**
 * Distress Detection — emergency intent handler
 * Detects distress phrases, confirms with user, alerts caregiver
 */

import { playAudioBytes, recordAudio } from "../audio/audio-client.js";
import { synthesize } from "../tts/piper.js";
import { transcribeLocal } from "../stt/local-npu.js";
import { sendDistressAlert } from "./notifications.js";
import { getCurrentPersona } from "../persona/engine.js";

const DISTRESS_PATTERNS = [
  /j.ai\s+mal/i,
  /je\s+suis\s+tomb[eé]/i,
  /appel.*aide/i,
  /au\s+secours/i,
  /help|aidez[- ]moi/i,
  /je\s+me\s+sens\s+mal/i,
  /j.ai\s+peur/i,
  /je\s+ne\s+peux\s+pas\s+(me\s+lever|bouger|respirer)/i,
  /urgence/i,
  /mal\s+au\s+(coeur|ventre|poitrine|bras)/i,
];

export function isDistressPhrase(text: string): boolean {
  return DISTRESS_PATTERNS.some((p) => p.test(text));
}

async function speak(text: string): Promise<void> {
  const wav = await synthesize(text, 1.3); // Slower for clarity
  await playAudioBytes(wav.toString("base64"));
}

export async function handleDistress(transcription: string): Promise<string> {
  const persona = getCurrentPersona();
  const name = persona.greetingName || "vous";

  // Reassure
  await speak(`${name}, je suis la. Tout va bien se passer.`);

  // Confirm if they want to call
  await speak("Voulez-vous que je previenne quelqu'un ?");

  // Listen for response
  try {
    const recorded = await recordAudio({ maxDurationS: 5, silenceTimeoutS: 2 });
    if (recorded.has_speech && recorded.wav_base64) {
      const wav = Buffer.from(recorded.wav_base64, "base64");
      const response = await transcribeLocal(wav);
      const lower = response.toLowerCase();

      if (/oui|s.il.*pla[iî]t|appel|pr[eé]vien|confirm/i.test(lower)) {
        // Send alert
        await sendDistressAlert(persona.name, transcription);
        return `C'est fait, j'ai prevenu votre contact. Restez calme ${name}, quelqu'un va venir.`;
      } else if (/non|pas\s+besoin|[çc]a\s+va/i.test(lower)) {
        return `D'accord ${name}. Je reste la si vous avez besoin.`;
      }
    }
  } catch {}

  // Default: send alert anyway for safety
  await sendDistressAlert(persona.name, transcription);
  return `Par precaution, j'ai prevenu votre contact. Tout va bien se passer ${name}.`;
}
