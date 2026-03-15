import { Readable, Writable } from "node:stream";
import { EventEmitter } from "node:events";
/**
 * AEC (Acoustic Echo Cancellation) service.
 * Wraps the SpeexDSP-based ec binary, managing FIFOs for speaker
 * reference input and clean microphone output.
 */
export declare class AecService extends EventEmitter {
    private process;
    private _running;
    get running(): boolean;
    private createFifos;
    /** Start the AEC process with configured ALSA devices. */
    start(): Promise<void>;
    /** Stop the AEC process and clean up FIFOs. */
    stop(): Promise<void>;
    /** Write audio to the speaker FIFO (ec input). */
    writeSpeaker(data: Buffer): Promise<void>;
    /** Get a readable stream of echo-cancelled microphone audio. */
    getCleanAudioStream(): Readable;
    /** Get a writable stream to the speaker FIFO. */
    getSpeakerStream(): Writable;
}
//# sourceMappingURL=aec.d.ts.map