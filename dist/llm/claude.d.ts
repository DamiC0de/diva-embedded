import { type ToolName } from "./tools.js";
interface ToolHandler {
    (input: Record<string, string>): Promise<string>;
}
/**
 * Claude Haiku LLM client with tool use support.
 * PROTO mode: no streaming, simple request/response.
 */
export declare class ClaudeClient {
    private client;
    private toolHandlers;
    private conversationHistory;
    private memorySummary;
    constructor();
    registerTool(name: ToolName, handler: ToolHandler): void;
    setMemorySummary(summary: string): void;
    /**
     * Send a message and get a full response.
     * Handles tool use loops automatically.
     */
    chat(userMessage: string): Promise<string>;
}
export {};
//# sourceMappingURL=claude.d.ts.map