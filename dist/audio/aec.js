import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { EventEmitter } from "node:events";
const EC_BINARY = process.env.EC_BINARY ?? "/opt/ec/ec";
const EC_INPUT_FIFO = process.env.EC_INPUT_FIFO ?? "/tmp/ec.input";
const EC_OUTPUT_FIFO = process.env.EC_OUTPUT_FIFO ?? "/tmp/ec.output";
const AUDIO_INPUT_DEVICE = process.env.AUDIO_INPUT_DEVICE ?? "plughw:1";
const AUDIO_OUTPUT_DEVICE = process.env.AUDIO_OUTPUT_DEVICE ?? "plughw:1";
/**
 * AEC (Acoustic Echo Cancellation) service.
 * Wraps the SpeexDSP-based ec binary, managing FIFOs for speaker
 * reference input and clean microphone output.
 */
export class AecService extends EventEmitter {
    process = null;
    _running = false;
    get running() {
        return this._running;
    }
    async createFifos() {
        for (const fifo of [EC_INPUT_FIFO, EC_OUTPUT_FIFO]) {
            if (existsSync(fifo)) {
                await unlink(fifo);
            }
        }
        for (const fifo of [EC_INPUT_FIFO, EC_OUTPUT_FIFO]) {
            const proc = spawn("mkfifo", [fifo]);
            await new Promise((resolve, reject) => {
                proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`mkfifo ${fifo} failed`)));
            });
        }
    }
    /** Start the AEC process with configured ALSA devices. */
    async start() {
        if (this._running) {
            console.warn("[AEC] Already running");
            return;
        }
        await this.createFifos();
        this.process = spawn(EC_BINARY, [
            "-i", AUDIO_INPUT_DEVICE,
            "-o", AUDIO_OUTPUT_DEVICE,
            "-c", "2",
            "-s",
        ]);
        this.process.stderr?.on("data", (data) => {
            const msg = data.toString().trim();
            if (msg)
                console.error("[AEC]", msg);
        });
        this.process.on("error", (err) => {
            console.error("[AEC] Process error:", err.message);
            this._running = false;
            this.emit("error", err);
        });
        this.process.on("close", (code) => {
            console.log("[AEC] Process exited with code", code);
            this._running = false;
            this.emit("stopped", code);
        });
        this._running = true;
        this.emit("started");
        console.log("[AEC] Started with devices:", AUDIO_INPUT_DEVICE, AUDIO_OUTPUT_DEVICE);
    }
    /** Stop the AEC process and clean up FIFOs. */
    async stop() {
        if (!this._running || !this.process)
            return;
        this.process.kill("SIGTERM");
        this._running = false;
        await new Promise((resolve) => {
            if (!this.process) {
                resolve();
                return;
            }
            const timeout = setTimeout(() => { this.process?.kill("SIGKILL"); resolve(); }, 3000);
            this.process.on("close", () => { clearTimeout(timeout); resolve(); });
        });
        for (const fifo of [EC_INPUT_FIFO, EC_OUTPUT_FIFO]) {
            if (existsSync(fifo))
                await unlink(fifo).catch(() => { });
        }
        this.process = null;
        console.log("[AEC] Stopped");
    }
    /** Write audio to the speaker FIFO (ec input). */
    async writeSpeaker(data) {
        const fd = await open(EC_INPUT_FIFO, "w");
        try {
            await fd.write(data);
        }
        finally {
            await fd.close();
        }
    }
    /** Get a readable stream of echo-cancelled microphone audio. */
    getCleanAudioStream() {
        return createReadStream(EC_OUTPUT_FIFO, { highWaterMark: 4096 });
    }
    /** Get a writable stream to the speaker FIFO. */
    getSpeakerStream() {
        return createWriteStream(EC_INPUT_FIFO, { highWaterMark: 4096 });
    }
}
//# sourceMappingURL=aec.js.map