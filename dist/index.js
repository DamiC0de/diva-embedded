import "dotenv/config";
import * as net from "node:net";
import { execSync, spawn } from "node:child_process";
import { transcribeGroq } from "./stt/groq-cloud.js";
import { ClaudeClient } from "./llm/claude.js";
import { synthesizeToFile } from "./tts/piper.js";
import { handleBraveSearch } from "./tools/brave-search.js";
import { handleMemoryRead, handleMemoryWrite, getMemorySummary, getMemoryManager, } from "./tools/memory-tool.js";
import { fillerManager } from "./llm/filler-manager.js";
const PORT = 9001;
const HOST = "127.0.0.1";
const RESPONSE_WAV = "/tmp/diva_response.wav";
const claude = new ClaudeClient();
const memory = getMemoryManager();
async function init() {
    // Register tools
    claude.registerTool("brave_search", handleBraveSearch);
    claude.registerTool("memory_read", handleMemoryRead);
    claude.registerTool("memory_write", handleMemoryWrite);
    
    // PRIORITÉ 4 : Inject memory manager for contextual retrieval
    // claude.setMemoryManager(memory);
    
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
            if (msg.type === "keyword_check" && msg.data) {
                handleKeywordCheck(socket, msg.data).catch((err) => {
                    console.error("[Diva] Keyword check error:", err);
                });
            }
            else if (msg.type === "audio" && msg.data) {
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

const INTERRUPT_KEYWORDS = ['stop', 'arrête', 'tais-toi', 'ta gueule', 'attend', 'attends', 'diva', 'hey jarvis'];
async function handleKeywordCheck(socket, b64Audio) {
    try {
        const wavBuffer = Buffer.from(b64Audio, "base64");
        const transcription = await transcribeGroq(wavBuffer);
        const lower = (transcription || "").toLowerCase().trim();
        const detected = INTERRUPT_KEYWORDS.find(kw => lower.includes(kw));
        if (detected) {
            console.log("[Diva] Keyword detected: " + detected + " in: " + lower);
            sendJson(socket, { type: "keyword_detected", keyword: detected });
        } else {
            sendJson(socket, { type: "keyword_not_detected", transcript: lower });
        }
    } catch (err) {
        sendJson(socket, { type: "keyword_not_detected", error: String(err) });
    }
}

async function handleAudio(socket, b64Audio) {
    const wavBuffer = Buffer.from(b64Audio, "base64");
    console.log("[Diva] Received audio: " + wavBuffer.length + " bytes");
    console.log("[Diva] Transcribing...");
    const transcription = await transcribeGroq(wavBuffer);
    console.log("[Diva] Transcription: " + JSON.stringify(transcription));
    if (!transcription.trim() || transcription.trim() === '...' || transcription.trim().length < 3) {
        console.log('[Diva] Skipping empty/noise transcription');
        sendJson(socket, { type: "error", message: "empty transcription" });
        return;
    }
    // Check if user wants to end conversation
    const SHUTDOWN_PHRASES = ["ta gueule", "tais-toi", "ferme-la", "ferme la", "ferme"];
    const lowerTrans = transcription.toLowerCase();
    if (SHUTDOWN_PHRASES.some(p => lowerTrans.includes(p))) {
        console.log("[Diva] Shutdown phrase detected in transcription: " + transcription);
        sendJson(socket, { type: "shutdown" });
        return;
    }

    // PRIORITÉ 2 : Send contextual filler immediately after transcription
    const userId = "default"; // Single user system for now
    // const fillerAudio = fillerManager.pickFiller(userId, transcription);
    if (false && fillerAudio) {
        console.log("[Diva] Sending contextual filler");
        sendJson(socket, { type: "play_filler", audio: fillerAudio });
    }

    await memory.addMessage("user", transcription);
    console.log("[Diva] Asking Claude (streaming)...");
    const sentences = [];
    let buf = "";
    let fullResponse = "";
    let firstSent = false;
    const stream = claude.chatStream(transcription);
    for await (const chunk of stream) {
        buf += chunk;
        fullResponse += chunk;
        const match = buf.match(/[.!?]\s|[.!?]$/);
        if (match) {
            const idx = match.index + match[0].length;
            const sentence = buf.slice(0, idx).trim().replace(/[*#`_~]/g, "");
            buf = buf.slice(idx);
            if (sentence.length > 0) {
                if (!firstSent) {
                    console.log("[Diva] First sentence: " + JSON.stringify(sentence));
                    sendJson(socket, { type: "speak", text: sentence });
                    firstSent = true;
                } else {
                    sentences.push(sentence);
                }
            }
        }
    }
    if (buf.trim().length > 0) {
        const clean = buf.trim().replace(/[*#`_~]/g, "");
        if (clean.length > 0) {
            if (!firstSent) {
                console.log("[Diva] Single sentence: " + JSON.stringify(clean));
                sendJson(socket, { type: "speak", text: clean });
                firstSent = true;
            } else {
                sentences.push(clean);
            }
        }
    }
    for (const s of sentences) {
        sendJson(socket, { type: "speak_queue", text: s });
    }
    sendJson(socket, { type: "play_done" });
    const cleanFull = fullResponse.replace(/[*#`_~]/g, "").replace(/\n+/g, ". ").trim();
    console.log("[Diva] Full response: " + JSON.stringify(cleanFull));
    await memory.addMessage("assistant", cleanFull);

    // PRIORITÉ 3 : Automatic memory extraction (every N interactions)
    await scheduleMemoryExtraction(userId);
}

// PRIORITÉ 3 : Memory extraction counter and scheduler
const interactionCount = new Map(); // userId -> count
const EXTRACT_EVERY_N = 5; // Extract memories every 5 interactions

async function scheduleMemoryExtraction(userId) {
    try {
        const count = (interactionCount.get(userId) || 0) + 1;
        interactionCount.set(userId, count);
        
        if (count >= EXTRACT_EVERY_N) {
            interactionCount.set(userId, 0);
            console.log("[Diva] Triggering memory extraction after " + count + " interactions");
            
            // Get recent messages for extraction
            const recentMessages = memory.getRecentMessages();
            if (recentMessages.length >= 4) { // Need at least 2 exchanges
                await extractMemoriesFromMessages(userId, recentMessages);
                // Refresh memory summary after extraction
                const newSummary = await getMemorySummary();
                if (newSummary) {
                    claude.setMemorySummary(newSummary);
                    console.log("[Diva] Memory summary refreshed");
                }
            }
        }
    } catch (err) {
        console.warn("[Diva] Memory extraction scheduling failed:", err);
    }
}

// PRIORITÉ 3 : Simple memory extraction without embeddings
async function extractMemoriesFromMessages(userId, messages) {
    try {
        // Convert messages to conversation text
        const conversationText = messages
            .map(m => `${m.role === 'user' ? 'User' : 'Diva'}: ${m.content}`)
            .join('\n');

        console.log("[Diva] Extracting memories from conversation with " + messages.length + " messages");

        // Use Claude to extract facts (simplified prompt for Haiku)
        const extractPrompt = `Analyse cette conversation et extrais 3-5 faits importants à retenir sur l'utilisateur. 

Format: une ligne par fait avec [catégorie] contenu
Catégories: preference, fact, person, event, health, routine

Conversation:
${conversationText}

Faits à retenir:`;

        const extractionResult = await claude.chat(extractPrompt);
        const facts = extractionResult
            .split('\n')
            .filter(line => line.trim() && line.includes('[') && line.includes(']'))
            .slice(0, 5); // Max 5 facts

        if (facts.length > 0) {
            console.log("[Diva] Extracted " + facts.length + " facts:");
            for (const fact of facts) {
                console.log("  - " + fact);
                // Parse category and content
                const match = fact.match(/^\[(.+?)\]\s*(.+)$/);
                if (match) {
                    const [, category, content] = match;
                    await memory.append(userId, content.trim(), category.trim());
                }
            }
            console.log("[Diva] Facts saved to memory");
        } else {
            console.log("[Diva] No facts extracted from conversation");
        }
    } catch (err) {
        console.error("[Diva] Memory extraction failed:", err);
    }
}

function sendJson(socket, data) {
    const msg = JSON.stringify(data) + "\n";
    socket.write(msg);
}
// --- Main ---
async function main() {
    console.log("[Diva] Starting PROTO mode...");
    await init();
    const server = net.createServer({ allowHalfOpen: true }, handleConnection);
    server.on("listening", () => { try { server.address(); } catch(e) {} });
    // Kill any OLD processes from a previous run
    // Python hasn't been launched yet so this is safe
    try {
        // execSync("pkill -9 -f wakeword_server || true", { timeout: 3000 });
    }
    catch { }
    try {
        // execSync("pkill -9 arecord || true", { timeout: 3000 });
    }
    catch { }
    try {
        // execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`, { timeout: 3000 });
    }
    catch { }
    console.log("[Diva] Cleaned up old processes");
    
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
            if (code !== 0 && code !== null)
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