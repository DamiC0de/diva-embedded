import "dotenv/config";
import * as net from "node:net";
import { execSync, spawn } from "node:child_process";
import { transcribeLocal } from "./stt/local-npu.js";
import { ClaudeStreamingClient } from "./llm/claude-streaming.js";
import { synthesize } from "./tts/piper.js";
import { classifyIntent, handleLocalIntent } from "./routing/intent-router.js";
import { handleWebSearch } from "./tools/searxng-search.js";
import {
  handleMemoryRead,
  handleMemoryWrite,
  getMemorySummary,
  getMemoryManager,
} from "./tools/memory-tool.js";

const PORT = 9001;
const HOST = "127.0.0.1";

const claude = new ClaudeStreamingClient();
const memory = getMemoryManager();

async function init(): Promise<void> {
  claude.registerTool("brave_search", handleWebSearch);
  claude.registerTool("memory_read", handleMemoryRead);
  claude.registerTool("memory_write", handleMemoryWrite);

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
  const wavBuffer = Buffer.from(b64Audio, "base64");
  console.log(`[Diva] Received audio: ${wavBuffer.length} bytes`);

  console.log("[Diva] Transcribing...");
  const transcription = await transcribeLocal(wavBuffer);
  console.log(`[Diva] Transcription: "${transcription}"`);

  if (!transcription.trim()) {
    sendJson(socket, { type: "error", message: "empty transcription" });
    return;
  }

  await memory.addMessage("user", transcription);

  // Route intent
  const intent = await classifyIntent(transcription);
  console.log(`[Diva] Intent: ${intent.intent} (${intent.category}) [${intent.latency_ms}ms]`);

  if (intent.intent === "local_simple") {
    const local = await handleLocalIntent(intent.category, transcription);
    if (local.handled && local.response) {
      console.log(`[Diva] Local response: "${local.response}"`);
      await memory.addMessage("assistant", local.response);
      // Single sentence — send directly as speak
      sendJson(socket, { type: "speak", text: local.response });
      sendJson(socket, { type: "play_done" });
      return;
    }
    console.log("[Diva] Local handler declined, falling back to Claude...");
  }

  // Streaming Claude response — TTS each sentence as it arrives
  console.log("[Diva] Asking Claude (streaming)...");
  let isFirstSent = false;

  const fullResponse = await claude.chatStreaming(
    transcription,
    (sentence: string, isFirst: boolean) => {
      if (isFirst) {
        console.log(`[Diva] First sentence: "${sentence}"`);
        sendJson(socket, { type: "speak", text: sentence });
        isFirstSent = true;
      } else {
        console.log(`[Diva] Queue sentence: "${sentence}"`);
        sendJson(socket, { type: "speak_queue", text: sentence });
      }
    }
  );

  console.log(`[Diva] Full response: "${fullResponse}"`);
  await memory.addMessage("assistant", fullResponse);

  // Signal end of response
  sendJson(socket, { type: "play_done" });
}

function sendJson(socket: net.Socket, data: Record<string, unknown>): void {
  const msg = JSON.stringify(data) + "\n";
  socket.write(msg);
}

// --- Main ---
async function main(): Promise<void> {
  console.log("[Diva] Starting STREAMING mode...");
  await init();

  const server = net.createServer(handleConnection);

  try { execSync("pkill -9 -f wakeword_server || true", { timeout: 3000 }); } catch {}
  try { execSync("pkill -9 arecord || true", { timeout: 3000 }); } catch {}
  try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`, { timeout: 3000 }); } catch {}
  console.log("[Diva] Cleaned up old processes");

  await new Promise((resolve) => setTimeout(resolve, 2000));

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[Diva] Port ${PORT} still in use. Retrying in 2s...`);
      setTimeout(() => {
        server.close();
        server.listen(PORT, HOST);
      }, 2000);
    } else {
      console.error("[Diva] Server error:", err);
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  server.listen(PORT, HOST, () => {
    console.log(`[Diva] TCP server listening on ${HOST}:${PORT}`);
    console.log("[Diva] Starting Python wakeword process...");

    const pythonProc = spawn("/opt/npu-env/bin/python", ["python/wakeword_server.py"], {
      stdio: ["ignore", "inherit", "inherit"],
      cwd: process.cwd(),
    });

    pythonProc.on("error", (err) => console.error("[Diva] Python error:", err.message));
    pythonProc.on("close", (code) => {
      console.log(`[Diva] Python exited with code ${code}`);
      if (code !== 0) process.exit(1);
    });

    const shutdown = () => {
      console.log("\n[Diva] Shutting down...");
      pythonProc.kill("SIGTERM");
      server.close();
      setTimeout(() => process.exit(0), 2000);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

main().catch((err) => {
  console.error("[Diva] Fatal error:", err);
  process.exit(1);
});
