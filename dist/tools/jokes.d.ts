/**
 * Jokes / Riddles / Fun Facts — local database with rotation
 * Zero latency, no Claude needed
 */
interface Joke {
    id: number;
    type: string;
    category: string;
    text: string;
}
interface Riddle {
    id: number;
    category: string;
    question: string;
    answer: string;
}
interface Fact {
    id: number;
    category: string;
    text: string;
}
export declare function getRandomJoke(category?: string): Joke | null;
export declare function getRandomRiddle(category?: string): Riddle | null;
export declare function getRandomFact(category?: string): Fact | null;
export {};
//# sourceMappingURL=jokes.d.ts.map