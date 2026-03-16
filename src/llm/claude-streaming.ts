import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./system-prompt.js";
import { toolDefinitions, type ToolName } from "./tools.js";

const MODEL = "claude-haiku-4-5-20251001";

interface ToolHandler {
  (input: Record<string, string>): Promise<string>;
}

/**
 * Claude Streaming Client — sends sentences as they complete
 * for TTS pipeline to start playing immediately
 */
export class ClaudeStreamingClient {
  private client: Anthropic;
  private toolHandlers: Map<ToolName, ToolHandler> = new Map();
  private conversationHistory: Anthropic.MessageParam[] = [];
  private memorySummary: string | undefined;

  constructor() {
    this.client = new Anthropic();
  }

  registerTool(name: ToolName, handler: ToolHandler): void {
    this.toolHandlers.set(name, handler);
  }

  setMemorySummary(summary: string): void {
    this.memorySummary = summary;
  }

  /**
   * Stream a response, calling onSentence for each completed sentence.
   * Returns the full response text.
   */
  async chatStreaming(
    userMessage: string,
    onSentence: (sentence: string, isFirst: boolean) => void
  ): Promise<string> {
    this.conversationHistory.push({ role: "user", content: userMessage });
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }

    const messages: Anthropic.MessageParam[] = [...this.conversationHistory];
    let fullResponse = "";
    let sentenceBuffer = "";
    let sentenceCount = 0;

    // Tool use loop (non-streaming for tool calls, streaming for final response)
    while (true) {
      // First, check if tools are needed (non-streaming)
      const checkResponse = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: [{ type: "text", text: buildSystemPrompt(this.memorySummary), cache_control: { type: "ephemeral" } }],
        messages,
        tools: toolDefinitions,
      });

      // Handle tool use
      const toolUseBlocks: Anthropic.ToolUseBlock[] = [];
      for (const block of checkResponse.content) {
        if (block.type === "tool_use") {
          toolUseBlocks.push(block);
        }
      }

      if (checkResponse.stop_reason === "tool_use" && toolUseBlocks.length > 0) {
        messages.push({ role: "assistant", content: checkResponse.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const toolBlock of toolUseBlocks) {
          const handler = this.toolHandlers.get(toolBlock.name as ToolName);
          let result: string;
          if (handler) {
            try {
              const input: Record<string, string> = {};
              for (const [k, v] of Object.entries(toolBlock.input as Record<string, unknown>)) {
                input[k] = String(v);
              }
              result = await handler(input);
            } catch (err) {
              result = `Erreur: ${err instanceof Error ? err.message : String(err)}`;
            }
          } else {
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
        system: [{ type: "text", text: buildSystemPrompt(this.memorySummary), cache_control: { type: "ephemeral" } }],
        messages,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          const text = event.delta.text;
          fullResponse += text;
          sentenceBuffer += text;

          // Check for sentence boundaries
          const sentenceEnders = /([.!?]+)\s*/g;
          let match: RegExpExecArray | null;
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
  async chat(userMessage: string): Promise<string> {
    let result = "";
    await this.chatStreaming(userMessage, (sentence) => {
      result += sentence + " ";
    });
    return result.trim();
  }
}
