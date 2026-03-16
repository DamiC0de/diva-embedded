import "dotenv/config";
import * as net from "node:net";
import { execSync, spawn } from "node:child_process";
import { transcribeLocal } from "./stt/local-npu.js";
import { ClaudeClient } from "./llm/claude.js";
import { synthesizeToFile } from "./tts/piper.js";
import { classifyIntent, handleLocalIntent } from "./routing/intent-router.js";
import { handleWebSearch } from "./tools/searxng-search.js";
import { handleMemoryRead, handleMemoryWrite, getMemorySummary, getMemoryManager, } from "./tools/memory-tool.js";
const PORT = 9001;
const HOST = "127.0.0.1";
const RESPONSE_WAV = "/tmp/diva_response.wav";
const claude = new ClaudeClient();
const memory = getMemoryManager();
async function init() {
    // Register tools
    claude.registerTool("brave_search", handleWebSearch);
    claude.registerTool("memory_read", handleMemoryRead);
    claude.registerTool("memory_write", handleMemoryWrite);
    // Load memory
    const memorySummary = await getMemorySummary();
    if (memorySummary) {
        claude.setMemorySummary(memorySummary);
    }
}
function handleConnection(socket) {
    console.log("[Diva] Python client connected");
    let buffer = "";
    socket.on("data", (data) => {
        buffer += data.toString();
        // Process complete JSON lines
        let newlineIdx;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);
            if (!line)
                continue;
            let msg;
            try {
                msg = JSON.parse(line);
            }
            catch {
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
async function handleAudio(socket, b64Audio) {
    // 1. Decode base64 WAV
    const wavBuffer = Buffer.from(b64Audio, "base64");
    console.log(`[Diva] Received audio: ${wavBuffer.length} bytes`);
    // 2. Transcribe via Groq Whisper
    console.log("[Diva] Transcribing...");
    const transcription = await transcribeLocal(wavBuffer);
    console.log(`[Diva] Transcription: "${transcription}"`);
    if (!transcription.trim()) {
        sendJson(socket, { type: "error", message: "empty transcription" });
        return;
    }
    // 3. Save to conversation history
    await memory.addMessage("user", transcription);
    // 4. Route intent: local or Claude
    const intent = await classifyIntent(transcription);
    console.log(`[Diva] Intent: ${intent.intent} (${intent.category}) [${intent.latency_ms}ms]`);
    let response;
    if (intent.intent === "local_simple") {
        const local = await handleLocalIntent(intent.category, transcription);
        if (local.handled && local.response) {
            response = local.response;
            console.log(`[Diva] Local response: "${response}"`);
        }
        else {
            console.log("[Diva] Local handler declined, falling back to Claude...");
            response = await claude.chat(transcription);
        }
    }
    else {
        console.log("[Diva] Asking Claude...");
        response = await claude.chat(transcription);
    }
    console.log(`[Diva] Response: "${response}"`);
    await memory.addMessage("assistant", response);
    // 5. Synthesize via Piper TTS
    console.log("[Diva] Synthesizing speech...");
    await synthesizeToFile(response, RESPONSE_WAV);
    // 6. Send play command back to Python
    sendJson(socket, { type: "play", path: RESPONSE_WAV });
    console.log("[Diva] Sent play command");
}
function sendJson(socket, data) {
    const msg = JSON.stringify(data) + "\n";
    socket.write(msg);
}
// --- Main ---
async function main() {
    console.log("[Diva] Starting PROTO mode...");
    await init();
    const server = net.createServer(handleConnection);
    // Kill any OLD processes from a previous run
    // Python hasn't been launched yet so this is safe
    try {
        execSync("pkill -9 -f wakeword_server || true", { timeout: 3000 });
    }
    catch { }
    try {
        execSync("pkill -9 arecord || true", { timeout: 3000 });
    }
    catch { }
    try {
        execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`, { timeout: 3000 });
    }
    catch { }
    console.log("[Diva] Cleaned up old processes");
    // Wait for port to fully release
    await new Promise((resolve) => setTimeout(resolve, 2000));
    server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            console.error(`[Diva] Port ${PORT} still in use after cleanup. Retrying in 2s...`);
            setTimeout(() => {
                server.close();
                server.listen(PORT, HOST);
            }, 2000);
        }
        else {
            console.error("[Diva] Server error:", err);
        }
    });
    // Wait for port to be free
    await new Promise((resolve) => setTimeout(resolve, 1000));
    server.listen(PORT, HOST, () => {
        console.log(`[Diva] TCP server listening on ${HOST}:${PORT}`);
        console.log("[Diva] Starting Python wakeword process...");
        // Launch Python wakeword as child process
        const pythonProc = spawn("python3", ["python/wakeword_server.py"], {
            stdio: ["ignore", "inherit", "inherit"],
            cwd: process.cwd(),
        });
        pythonProc.on("error", (err) => console.error("[Diva] Python error:", err.message));
        pythonProc.on("close", (code) => {
            console.log(`[Diva] Python exited with code ${code}`);
            if (code !== 0)
                process.exit(1);
        });
        // Graceful shutdown with Python cleanup
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
//# sourceMappingURL=index.js.map