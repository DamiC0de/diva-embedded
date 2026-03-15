import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./system-prompt.js";

const MODEL = "claude-haiku-4-5-20251001";

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
     * Stream response, yielding text chunks.
     * First does a non-streaming call with tools. If tools are used,
     * executes them then streams the final response.
     */
    async *chatStream(userMessage) {
        this.conversationHistory.push({ role: "user", content: userMessage });
        if (this.conversationHistory.length > 20) {
            this.conversationHistory = this.conversationHistory.slice(-20);
        }

        const messages = [...this.conversationHistory];
        const system = buildSystemPrompt(this.memorySummary);

        // Build tool definitions from registered handlers
        const toolDefs = [];
        for (const name of this.toolHandlers.keys()) {
            if (name === "brave_search") {
                toolDefs.push({
                    name: "brave_search",
                    description: "Search the web for current information. Use for weather, news, events, prices, facts you're unsure about.",
                    input_schema: {
                        type: "object",
                        properties: { query: { type: "string", description: "Search query" } },
                        required: ["query"]
                    }
                });
            } else if (name === "memory_write") {
                toolDefs.push({
                    name: "memory_write",
                    description: "Save personal information about the user for later recall.",
                    input_schema: {
                        type: "object",
                        properties: {
                            content: { type: "string", description: "Information to remember" },
                            category: { type: "string", description: "Category: preference, fact, person, location, routine" }
                        },
                        required: ["content"]
                    }
                });
            } else if (name === "memory_read") {
                toolDefs.push({
                    name: "memory_read",
                    description: "Search saved memories about the user.",
                    input_schema: {
                        type: "object",
                        properties: { query: { type: "string", description: "Search term" } },
                        required: ["query"]
                    }
                });
            }
        }

        // First call: non-streaming with tools
        const firstResponse = await this.client.messages.create({
            model: MODEL,
            max_tokens: 300,
            system,
            messages,
            tools: toolDefs.length > 0 ? toolDefs : undefined,
        });

        // Check for tool use
        if (firstResponse.stop_reason === "tool_use") {
            const toolBlocks = firstResponse.content.filter(b => b.type === "tool_use");
            const textBlocks = firstResponse.content.filter(b => b.type === "text");

            // Yield any initial text
            for (const tb of textBlocks) {
                if (tb.text) yield tb.text;
            }

            // Execute tools
            messages.push({ role: "assistant", content: firstResponse.content });
            const toolResults = [];
            for (const tool of toolBlocks) {
                const handler = this.toolHandlers.get(tool.name);
                let result = "Tool not found";
                if (handler) {
                    try {
                        const input = {};
                        for (const [k, v] of Object.entries(tool.input)) {
                            input[k] = String(v);
                        }
                        result = await handler(input);
                        console.log(`[Claude] Tool ${tool.name} executed`);
                    } catch (err) {
                        result = "Error: " + String(err);
                    }
                }
                toolResults.push({ type: "tool_result", tool_use_id: tool.id, content: result });
            }
            messages.push({ role: "user", content: toolResults });

            // Stream the final response (after tool results)
            const stream = this.client.messages.stream({
                model: MODEL,
                max_tokens: 300,
                system,
                messages,
            });
            let fullText = "";
            for await (const event of stream) {
                if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                    fullText += event.delta.text;
                    yield event.delta.text;
                }
            }
            // Combine initial text + tool response
            const initialText = textBlocks.map(t => t.text).join("");
            this.conversationHistory.push({ role: "assistant", content: initialText + fullText });
        } else {
            // No tool use — stream directly
            const textContent = firstResponse.content.filter(b => b.type === "text").map(b => b.text).join("");
            if (textContent) {
                yield textContent;
                this.conversationHistory.push({ role: "assistant", content: textContent });
            }
        }
    }

    async chat(userMessage) {
        let full = "";
        for await (const chunk of this.chatStream(userMessage)) {
            full += chunk;
        }
        return full;
    }
}
