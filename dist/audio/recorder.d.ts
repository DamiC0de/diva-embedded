import { ChildProcess } from "node:child_process";
import { Readable } from "node:stream";
/**
 * Record raw PCM audio from ALSA.
 * Returns a readable stream of 16kHz 16-bit mono PCM.
 */
export declare function recordStream(): {
    stream: Readable;
    process: ChildProcess;
};
/**
 * Record a fixed duration of audio and return as buffer.
 * @param durationMs - Duration in milliseconds
 * @returns Raw PCM buffer
 */
export declare function recordBuffer(durationMs: number): Promise<Buffer>;
//# sourceMappingURL=recorder.d.ts.map