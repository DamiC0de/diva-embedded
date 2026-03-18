/**
 * Timer Manager v2 — countdown timers + reminders with persistence
 * - Custom reminder messages: "rappelle-moi dans 30 min de sortir le gâteau"
 * - JSON persistence to survive restarts
 * - Plays bibop.wav + TTS announcement when a timer expires
 */
interface ActiveTimer {
    id: number;
    label: string;
    message: string;
    durationMs: number;
    startedAt: number;
    handle: ReturnType<typeof setTimeout>;
}
export declare function restoreTimers(): Promise<void>;
export declare function startTimer(durationMs: number, label: string, message?: string): ActiveTimer;
export declare function listTimers(): {
    id: number;
    label: string;
    message: string;
    remainingS: number;
}[];
export declare function cancelAllTimers(): number;
export declare function cancelTimer(id: number): boolean;
export {};
//# sourceMappingURL=timer-manager.d.ts.map