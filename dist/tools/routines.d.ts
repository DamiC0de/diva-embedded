/**
 * Vocal Routines — named sequences of actions
 * "Diva, routine dodo" → sequence of actions
 * Config stored in JSON. Editable in dashboard.
 */
interface RoutineAction {
    type: "speak" | "radio_play" | "radio_stop" | "volume" | "timer" | "dnd" | "wait";
    params: Record<string, string | number>;
}
interface Routine {
    name: string;
    triggerPhrases: string[];
    actions: RoutineAction[];
    description: string;
}
export declare function findRoutine(text: string): Routine | null;
export declare function executeRoutine(routine: Routine): Promise<string[]>;
export declare function listRoutines(): string;
export declare function getRoutinesForDashboard(): Routine[];
export {};
//# sourceMappingURL=routines.d.ts.map