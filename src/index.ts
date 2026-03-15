import "dotenv/config";
import { AecService } from "./audio/aec.js";
import { WakeWordService } from "./wake/wakeword.js";
import { StateMachine, State } from "./state/machine.js";
import { transcribeGroq, collectUntilSilence } from "./stt/groq-cloud.js";
import { transcribeLocal } from "./stt/whisper-local.js";
import { ClaudeClient } from "./llm/claude.js";
import { playViaAec } from "./tts/piper.js";
import { detectKeyword } from "./wake/keywords.js";
import { handleBraveSearch } from "./tools/brave-search.js";
import { handleWebScrape } from "./tools/web-scrape.js";
import { handleMemoryRead, handleMemoryWrite, getMemorySummary, getMemoryManager } from "./tools/memory-tool.js";

const aec = new AecService();
const wakeWord = new WakeWordService();
const stateMachine = new StateMachine();
const claude = new ClaudeClient();
const memory = getMemoryManager();

let abortSpeaking = false;

/** Initialize all services and register tool handlers. */
async function init(): Promise<void> {
  console.log("[Diva] Starting voice assistant...");

  // Register LLM tool handlers
  claude.registerTool("brave_search", handleBraveSearch);
  claude.registerTool("web_scrape", handleWebScrape);
  claude.registerTool("memory_read", handleMemoryRead);
  claude.registerTool("memory_write", handleMemoryWrite);

  // Load memory summary
  const memorySummary = await getMemorySummary();
  if (memorySummary) {
    claude.setMemorySummary(memorySummary);
  }

  // Start AEC (optional — if it fails, wake word uses direct mic)
  try {
    await aec.start();
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (err) {
    console.warn("[Diva] AEC failed to start, continuing without echo cancellation:", (err as Error).message);
  }

  // If AEC crashed, remove FIFOs so Python uses direct mic
  if (!aec.running) {
    const { unlink } = await import("node:fs/promises");
    for (const f of ["/tmp/ec.input", "/tmp/ec.output"]) {
      await unlink(f).catch(() => {});
    }
    console.log("[Diva] FIFOs removed — wake word will use direct microphone");
  }

  // Start Wake Word detection
  await wakeWord.start();

  // Wire up wake word detection
  wakeWord.on("detection", () => {
    handleWakeWord();
  });

  console.log("[Diva] All services started. Waiting for wake word...");
}

/** Handle wake word detection. */
function handleWakeWord(): void {
  if (stateMachine.is(State.IDLE)) {
    stateMachine.transition(State.LISTENING, "wake word detected");
    startListening().catch((err) => {
      console.error("[Diva] Error in listening pipeline:", err);
      stateMachine.reset("error in pipeline");
    });
  } else if (stateMachine.is(State.SPEAKING)) {
    // Barge-in: interrupt speaking and re-listen
    abortSpeaking = true;
    stateMachine.transition(State.LISTENING, "barge-in: wake word during speech");
    startListening().catch((err) => {
      console.error("[Diva] Error in listening pipeline:", err);
      stateMachine.reset("error in pipeline");
    });
  }
}

/** Listen for user speech, transcribe, get LLM response, speak. */
async function startListening(): Promise<void> {
  try {
    // Get clean audio stream from AEC
    const audioStream = aec.getCleanAudioStream();

    // Collect audio until silence
    console.log("[Diva] Listening...");
    const audioBuffer = await collectUntilSilence(audioStream, 2500, 30000);

    if (audioBuffer.length < 3200) {
      // Too short (< 100ms), ignore
      console.log("[Diva] Audio too short, ignoring");
      stateMachine.transition(State.IDLE, "audio too short");
      return;
    }

    // Transition to processing
    stateMachine.transition(State.PROCESSING, "audio collected");

    // Transcribe (Groq primary, whisper.cpp fallback)
    let transcription: string;
    try {
      transcription = await transcribeGroq(audioBuffer);
    } catch (err) {
      console.warn("[Diva] Groq STT failed, falling back to local:", err);
      transcription = await transcribeLocal(audioBuffer);
    }

    console.log("[Diva] Transcription:", transcription);

    if (!transcription.trim()) {
      stateMachine.transition(State.IDLE, "empty transcription");
      return;
    }

    // Check for stop keywords
    const keyword = detectKeyword(transcription);
    if (keyword === "stop") {
      stateMachine.transition(State.IDLE, "stop keyword detected");
      return;
    }

    // Save to conversation history
    await memory.addMessage("user", transcription);

    // Get LLM response
    const response = await claude.chat(transcription);
    console.log("[Diva] Response:", response);

    // Save assistant response
    await memory.addMessage("assistant", response);

    // Speak the response
    stateMachine.transition(State.SPEAKING, "LLM response ready");
    abortSpeaking = false;

    // Split response into sentences for incremental TTS
    const sentences = splitSentences(response);
    for (const sentence of sentences) {
      if (abortSpeaking) {
        console.log("[Diva] Speech interrupted");
        break;
      }
      await playViaAec(sentence);
    }

    if (!abortSpeaking && stateMachine.is(State.SPEAKING)) {
      stateMachine.transition(State.IDLE, "speech complete");
    }
  } catch (err) {
    console.error("[Diva] Pipeline error:", err);
    stateMachine.reset("pipeline error");
  }
}

/** Split text into sentences for incremental TTS. */
function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+/g);
  if (!parts) return [text];
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Handle graceful shutdown. */
function setupShutdown(): void {
  const shutdown = async (signal: string) => {
    console.log(`\n[Diva] Received ${signal}, shutting down...`);
    await wakeWord.stop();
    await aec.stop();
    console.log("[Diva] Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// --- Main ---
setupShutdown();
init().catch((err) => {
  console.error("[Diva] Fatal error during init:", err);
  process.exit(1);
});
