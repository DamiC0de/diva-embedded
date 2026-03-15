import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./system-prompt.js";
import { toolDefinitions } from "./tools.js";
const MODEL = "claude-haiku-4-5-20251001";
/**
 * Claude Haiku LLM client with tool use support.
 * PROTO mode: no streaming, simple request/response.
 */
export class ClaudeClient {
    client;
    toolHandlers = new Map();
    conversationHistory = [];
    memorySummary;
    constructor() {
        this.client = new Anthropic();
    }
    registerTool(name, handler) {
        this.toolHandlers.set(name, handler);
    }
    setMemorySummary(summary) {
        this.memorySummary = summary;
    }
    /**
     * Send a message and get a full response.
     * Handles tool use loops automatically.
     */
    async chat(userMessage) {
        this.conversationHistory.push({ role: "user", content: userMessage });
        // Keep last 20 messages
        if (this.conversationHistory.length > 20) {
            this.conversationHistory = this.conversationHistory.slice(-20);
        }
        const messages = [...this.conversationHistory];
        let fullResponse = "";
        // Tool use loop
        while (true) {
            const response = await this.client.messages.create({
                model: MODEL,
                max_tokens: 1024,
                system: buildSystemPrompt(this.memorySummary),
                messages,
                tools: toolDefinitions,
            });
            // Collect text and tool use blocks
            const textParts = [];
            const toolUseBlocks = [];
            for (const block of response.content) {
                if (block.type === "text") {
                    textParts.push(block.text);
                }
                else if (block.type === "tool_use") {
                    toolUseBlocks.push(block);
                }
            }
            fullResponse += textParts.join("");
            // If no tool use, we're done
            if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
                break;
            }
            // Execute tools
            messages.push({ role: "assistant", content: response.content });
            const toolResults = [];
            for (const toolBlock of toolUseBlocks) {
                const handler = this.toolHandlers.get(toolBlock.name);
                let result;
                if (handler) {
                    try {
                        const input = {};
                        for (const [k, v] of Object.entries(toolBlock.input)) {
                            input[k] = String(v);
                        }
                        result = await handler(input);
                    }
                    catch (err) {
                        result = `Erreur: ${err instanceof Error ? err.message : String(err)}`;
                    }
                }
                else {
                    result = `Outil "${toolBlock.name}" non disponible`;
                }
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolBlock.id,
                    content: result,
                });
            }
            messages.push({ role: "user", content: toolResults });
            // Loop continues to get final response
        }
        this.conversationHistory.push({ role: "assistant", content: fullResponse });
        // Keep last 20 messages
        if (this.conversationHistory.length > 20) {
            this.conversationHistory = this.conversationHistory.slice(-20);
        }
        return fullResponse;
    }
}
//# sourceMappingURL=claude.js.map