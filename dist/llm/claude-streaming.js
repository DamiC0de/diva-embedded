import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./system-prompt.js";
import { toolDefinitions } from "./tools.js";
const MODEL = "claude-haiku-4-5-20251001";
/**
 * Claude Streaming Client — sends sentences as they complete
 * for TTS pipeline to start playing immediately
 */
export class ClaudeStreamingClient {
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
     * Stream a response, calling onSentence for each completed sentence.
     * Returns the full response text.
     */
    async chatStreaming(userMessage, onSentence) {
        this.conversationHistory.push({ role: "user", content: userMessage });
        if (this.conversationHistory.length > 20) {
            this.conversationHistory = this.conversationHistory.slice(-20);
        }
        const messages = [...this.conversationHistory];
        let fullResponse = "";
        let sentenceBuffer = "";
        let sentenceCount = 0;
        // Tool use loop (non-streaming for tool calls, streaming for final response)
        while (true) {
            // First, check if tools are needed (non-streaming)
            const checkResponse = await this.client.messages.create({
                model: MODEL,
                max_tokens: 1024,
                system: buildSystemPrompt(this.memorySummary),
                messages,
                tools: toolDefinitions,
            });
            // Handle tool use
            const toolUseBlocks = [];
            for (const block of checkResponse.content) {
                if (block.type === "tool_use") {
                    toolUseBlocks.push(block);
                }
            }
            if (checkResponse.stop_reason === "tool_use" && toolUseBlocks.length > 0) {
                messages.push({ role: "assistant", content: checkResponse.content });
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
                    toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: result });
                }
                messages.push({ role: "user", content: toolResults });
                continue; // Loop back for final response
            }
            // No tool use — now stream the final response
            const stream = this.client.messages.stream({
                model: MODEL,
                max_tokens: 1024,
                system: buildSystemPrompt(this.memorySummary),
                messages,
            });
            for await (const event of stream) {
                if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                    const text = event.delta.text;
                    fullResponse += text;
                    sentenceBuffer += text;
                    // Check for sentence boundaries
                    const sentenceEnders = /([.!?]+)\s*/g;
                    let match;
                    let lastEnd = 0;
                    while ((match = sentenceEnders.exec(sentenceBuffer)) !== null) {
                        const sentence = sentenceBuffer.slice(lastEnd, match.index + match[1].length).trim();
                        lastEnd = match.index + match[0].length;
                        if (sentence.length > 3) {
                            onSentence(sentence, sentenceCount === 0);
                            sentenceCount++;
                        }
                    }
                    if (lastEnd > 0) {
                        sentenceBuffer = sentenceBuffer.slice(lastEnd);
                    }
                }
            }
            // Flush remaining buffer
            if (sentenceBuffer.trim().length > 3) {
                onSentence(sentenceBuffer.trim(), sentenceCount === 0);
            }
            break;
        }
        this.conversationHistory.push({ role: "assistant", content: fullResponse });
        if (this.conversationHistory.length > 20) {
            this.conversationHistory = this.conversationHistory.slice(-20);
        }
        return fullResponse;
    }
    /** Non-streaming fallback */
    async chat(userMessage) {
        let result = "";
        await this.chatStreaming(userMessage, (sentence) => {
            result += sentence + " ";
        });
        return result.trim();
    }
}
//# sourceMappingURL=claude-streaming.js.map