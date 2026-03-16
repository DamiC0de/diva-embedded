import { type ToolName } from "./tools.js";
interface ToolHandler {
    (input: Record<string, string>): Promise<string>;
}
/**
 * Claude Streaming Client — sends sentences as they complete
 * for TTS pipeline to start playing immediately
 */
export declare class ClaudeStreamingClient {
    private client;
    private toolHandlers;
    private conversationHistory;
    private memorySummary;
    constructor();
    registerTool(name: ToolName, handler: ToolHandler): void;
    setMemorySummary(summary: string): void;
    /**
     * Stream a response, calling onSentence for each completed sentence.
     * Returns the full response text.
     */
    chatStreaming(userMessage: string, onSentence: (sentence: string, isFirst: boolean) => void): Promise<string>;
    /** Non-streaming fallback */
    chat(userMessage: string): Promise<string>;
}
export {};
//# sourceMappingURL=claude-streaming.d.ts.map