/**
 * Repetition Tracker — detects repeated questions for cognitive monitoring
 * Uses simple similarity comparison with recent questions
 * Tracks count in dashboard for caregiver
 */
interface RepetitionEntry {
    date: string;
    question: string;
    count: number;
    timestamps: string[];
}
/**
 * Check if a question has been asked recently.
 * Returns { isRepetition, count } where count = how many times this session
 */
export declare function checkRepetition(text: string): {
    isRepetition: boolean;
    count: number;
};
export declare function getRepetitionStats(days?: number): {
    totalRepetitions: number;
    uniqueQuestions: number;
    entries: RepetitionEntry[];
};
export {};
//# sourceMappingURL=repetition-tracker.d.ts.map