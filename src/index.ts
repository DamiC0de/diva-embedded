import "dotenv/config";
import * as net from "node:net";
import { execSync } from "node:child_process";
import { transcribeGroq } from "./stt/groq-cloud.js";
import { ClaudeClient } from "./llm/claude.js";
import { synthesizeToFile } from "./tts/piper.js";
import { handleBraveSearch } from "./tools/brave-search.js";
import {
  handleMemoryRead,
  handleMemoryWrite,
  getMemorySummary,
  getMemoryManager,
} from "./tools/memory-tool.js";

const PORT = 9001;
const HOST = "127.0.0.1";
const RESPONSE_WAV = "/tmp/diva_response.wav";

const claude = new ClaudeClient();
const memory = getMemoryManager();

async function init(): Promise<void> {
  // Register tools
  claude.registerTool("brave_search", handleBraveSearch);
  claude.registerTool("memory_read", handleMemoryRead);
  claude.registerTool("memory_write", handleMemoryWrite);

  // Load memory
  const memorySummary = await getMemorySummary();
  if (memorySummary) {
    claude.setMemorySummary(memorySummary);
  }
}

function handleConnection(socket: net.Socket): void {
  console.log("[Diva] Python client connected");
  let buffer = "";

  socket.on("data", (data) => {
    buffer += data.toString();

    // Process complete JSON lines
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);

      if (!line) continue;

      let msg: { type: string; data?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        console.error("[Diva] Invalid JSON from Python:", line.slice(0, 100));
        continue;
      }

      if (msg.type === "audio" && msg.data) {
        handleAudio(socket, msg.data).catch((err) => {
          console.error("[Diva] Pipeline error:", err);
          sendJson(socket, { type: "error", message: String(err) });
        });
      }
    }
  });

  socket.on("close", () => console.log("[Diva] Python client disconnected"));
  socket.on("error", (err) => console.error("[Diva] Socket error:", err.message));
}

async function handleAudio(socket: net.Socket, b64Audio: string): Promise<void> {
  // 1. Decode base64 WAV
  const wavBuffer = Buffer.from(b64Audio, "base64");
  console.log(`[Diva] Received audio: ${wavBuffer.length} bytes`);

  // 2. Transcribe via Groq Whisper
  console.log("[Diva] Transcribing...");
  const transcription = await transcribeGroq(wavBuffer);
  console.log(`[Diva] Transcription: "${transcription}"`);

  if (!transcription.trim()) {
    sendJson(socket, { type: "error", message: "empty transcription" });
    return;
  }

  // 3. Save to conversation history
  await memory.addMessage("user", transcription);

  // 4. Get LLM response
  console.log("[Diva] Asking Claude...");
  const response = await claude.chat(transcription);
  console.log(`[Diva] Response: "${response}"`);

  await memory.addMessage("assistant", response);

  // 5. Synthesize via Piper TTS
  console.log("[Diva] Synthesizing speech...");
  await synthesizeToFile(response, RESPONSE_WAV);

  // 6. Send play command back to Python
  sendJson(socket, { type: "play", path: RESPONSE_WAV });
  console.log("[Diva] Sent play command");
}

function sendJson(socket: net.Socket, data: Record<string, unknown>): void {
  const msg = JSON.stringify(data) + "\n";
  socket.write(msg);
}

// --- Main ---
async function main(): Promise<void> {
  console.log("[Diva] Starting PROTO mode...");
  await init();

  const server = net.createServer(handleConnection);

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.log(`[Diva] Port ${PORT} in use, killing existing process...`);
      try {
        execSync(`fuser -k ${PORT}/tcp`, { timeout: 3000 });
      } catch {}
      setTimeout(() => {
        server.close();
        server.listen(PORT, HOST);
      }, 1000);
    } else {
      console.error("[Diva] Server error:", err);
    }
  });

  // Enable port reuse
  server.listen(PORT, HOST, () => {
    console.log(`[Diva] TCP server listening on ${HOST}:${PORT}`);
    console.log("[Diva] Waiting for Python client...");
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[Diva] Shutting down...");
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[Diva] Fatal error:", err);
  process.exit(1);
});
