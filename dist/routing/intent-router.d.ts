/**
 * Intent Router v2 — calls local keyword classifier on port 8882
 * Routes simple queries locally, complex ones to Claude
 */
interface IntentResult {
    intent: "local_simple" | "home_control" | "complex";
    category: string;
    confidence: number;
    latency_ms: number;
}
interface LocalResponse {
    handled: boolean;
    response?: string;
}
export declare function classifyIntent(text: string): Promise<IntentResult>;
export declare function handleLocalIntent(category: string, text: string): Promise<LocalResponse>;
export {};
//# sourceMappingURL=intent-router.d.ts.map