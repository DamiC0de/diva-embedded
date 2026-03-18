/**
 * Do Not Disturb (DND) / Night Mode Manager
 * Disables wake word detection for a configurable duration
 */
export declare function enableDND(durationMs?: number): void;
export declare function disableDND(): void;
export declare function isDNDActive(): boolean;
export declare function getDNDStatus(): {
    active: boolean;
    untilTs: number;
    remainingMin: number;
};
//# sourceMappingURL=dnd-manager.d.ts.map