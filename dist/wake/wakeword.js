import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
const WAKEWORD_SCRIPT = process.env.WAKEWORD_SCRIPT ?? "python/wakeword_server.py";
const WAKEWORD_HOST = "127.0.0.1";
const WAKEWORD_PORT = 9001;
/**
 * Bridge to the Python OpenWakeWord server.
 * Starts the Python process and connects via TCP to receive detections.
 */
export class WakeWordService extends EventEmitter {
    process = null;
    socket = null;
    _running = false;
    get running() {
        return this._running;
    }
    /** Start the wake word detection server and connect to it. */
    async start() {
        if (this._running)
            return;
        // Start Python process
        this.process = spawn("python3", [WAKEWORD_SCRIPT], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        // Monitor Python stdout for status messages
        if (this.process.stdout) {
            const rl = createInterface({ input: this.process.stdout });
            rl.on("line", (line) => {
                try {
                    const msg = JSON.parse(line);
                    const display = msg.type === "detection" ? JSON.stringify(msg) : msg.message;
                    console.log("[WakeWord] Python:", display);
                }
                catch {
                    console.log("[WakeWord] Python:", line);
                }
            });
        }
        if (this.process.stderr) {
            this.process.stderr.on("data", (data) => {
                console.error("[WakeWord] Python error:", data.toString().trim());
            });
        }
        this.process.on("error", (err) => {
            console.error("[WakeWord] Process error:", err.message);
            this._running = false;
            this.emit("error", err);
        });
        this.process.on("close", (code) => {
            console.log("[WakeWord] Process exited with code", code);
            this._running = false;
            this.emit("stopped");
        });
        // Wait a moment for the server to start, then connect
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await this.connect();
        this._running = true;
        this.emit("started");
        console.log("[WakeWord] Service started");
    }
    /** Connect to the Python TCP server. */
    async connect() {
        return new Promise((resolve, reject) => {
            const retryConnect = (attempts) => {
                this.socket = createConnection({ host: WAKEWORD_HOST, port: WAKEWORD_PORT });
                this.socket.on("connect", () => {
                    console.log("[WakeWord] Connected to Python server");
                    this.setupSocketListeners();
                    resolve();
                });
                this.socket.on("error", (err) => {
                    if (attempts > 0) {
                        setTimeout(() => retryConnect(attempts - 1), 500);
                    }
                    else {
                        reject(new Error(`Failed to connect to wake word server: ${err.message}`));
                    }
                });
            };
            retryConnect(10);
        });
    }
    /** Set up listeners on the TCP socket. */
    setupSocketListeners() {
        if (!this.socket)
            return;
        const rl = createInterface({ input: this.socket });
        rl.on("line", (line) => {
            try {
                const msg = JSON.parse(line);
                if (msg.type === "detection") {
                    const detection = msg;
                    console.log(`[WakeWord] Detected "${detection.keyword}" (score: ${detection.score.toFixed(2)})`);
                    this.emit("detection", detection);
                }
            }
            catch {
                console.warn("[WakeWord] Invalid message:", line);
            }
        });
        this.socket.on("close", () => {
            console.log("[WakeWord] Socket closed");
        });
        this.socket.on("error", (err) => {
            console.error("[WakeWord] Socket error:", err.message);
        });
    }
    /** Stop the wake word service. */
    async stop() {
        this._running = false;
        this.socket?.destroy();
        this.socket = null;
        if (this.process) {
            this.process.kill("SIGTERM");
            await new Promise((resolve) => {
                const timeout = setTimeout(() => { this.process?.kill("SIGKILL"); resolve(); }, 3000);
                this.process?.on("close", () => { clearTimeout(timeout); resolve(); });
            });
            this.process = null;
        }
        console.log("[WakeWord] Stopped");
    }
}
//# sourceMappingURL=wakeword.js.map