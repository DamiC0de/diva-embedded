/**
 * Cognitive Stimulation Exercises — gentle activities for Alzheimer personas
 * Reminiscence, memory quiz, songs to complete
 * Always encouraging. No scoring, no judgment.
 */
interface Exercise {
    id: number;
    type: "reminiscence" | "quiz" | "song" | "proverb";
    prompt: string;
    hint?: string;
    encouragement: string;
}
export declare function getRandomExercise(type?: string): Exercise | null;
/**
 * Generate a cognitive exercise interaction response.
 * The caller should speak the prompt, listen, then speak the encouragement.
 */
export declare function buildExerciseResponse(exercise: Exercise): {
    prompt: string;
    encouragement: string;
    hint?: string;
};
export {};
//# sourceMappingURL=cognitive-exercises.d.ts.map