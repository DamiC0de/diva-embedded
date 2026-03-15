import { EventEmitter } from "node:events";
/**
 * Bridge to the Python OpenWakeWord server.
 * Starts the Python process and connects via TCP to receive detections.
 */
export declare class WakeWordService extends EventEmitter {
    private process;
    private socket;
    private _running;
    get running(): boolean;
    /** Start the wake word detection server and connect to it. */
    start(): Promise<void>;
    /** Connect to the Python TCP server. */
    private connect;
    /** Set up listeners on the TCP socket. */
    private setupSocketListeners;
    /** Stop the wake word service. */
    stop(): Promise<void>;
}
//# sourceMappingURL=wakeword.d.ts.map