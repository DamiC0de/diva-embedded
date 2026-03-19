import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./system-prompt.js";
import { toolDefinitions, type ToolName } from "./tools.js";

const MODEL = "claude-haiku-4-5-20251001";

interface ToolHandler {
  (input: Record<string, string>): Promise<string>;
}

/**
 * Claude Streaming Client — Single-pass streaming with tool_use support.
 * Eliminates the double-call pattern (non-streaming check + streaming response).
 * Now streams from the first token, handling tools inline when needed.
 */
export class ClaudeStreamingClient {
  private client: Anthropic;
  private toolHandlers: Map<ToolName, ToolHandler> = new Map();
  private conversationHistory: Anthropic.MessageParam[] = [];
  private memorySummary: string | undefined;
  private sessionContext: string | undefined;

  constructor() {
    this.client = new Anthropic();
  }

  registerTool(name: ToolName, handler: ToolHandler): void {
    this.toolHandlers.set(name, handler);
  }

  setMemorySummary(summary: string): void {
    this.memorySummary = summary;
  }

  setSessionContext(context: string): void {
    this.sessionContext = context;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Stream a response, calling onSentence for each completed sentence.
   * Handles tool_use inline: if Claude requests a tool, we execute it
   * and resume streaming — all in a single logical call.
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
    let systemPrompt = buildSystemPrompt(this.memorySummary);
    if (this.sessionContext) {
      systemPrompt += "\n\n" + this.sessionContext;
    }

    // Tool use loop — streams every pass, handles tools if needed
    let maxToolRounds = 3;
    while (maxToolRounds-- > 0) {
      const stream = this.client.messages.stream({
        model: MODEL,
        max_tokens: 1024,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages,
        tools: toolDefinitions,
      });

      // Track tool_use blocks as they stream in
      const toolUseBlocks: { id: string; name: string; inputJson: string }[] = [];
      let currentToolBlock: { id: string; name: string; inputJson: string } | null = null;

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            currentToolBlock = {
              id: event.content_block.id,
              name: event.content_block.name,
              inputJson: "",
            };
          }
        }

        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            const text = event.delta.text;
            fullResponse += text;
            sentenceBuffer += text;

            // Sentence boundary detection — flush completed sentences for TTS
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

          if (event.delta.type === "input_json_delta" && currentToolBlock) {
            currentToolBlock.inputJson += event.delta.partial_json;
          }
        }

        if (event.type === "content_block_stop" && currentToolBlock) {
          toolUseBlocks.push(currentToolBlock);
          currentToolBlock = null;
        }
      }

      // Get final message to check stop reason
      const finalMessage = await stream.finalMessage();

      if (finalMessage.stop_reason === "tool_use" && toolUseBlocks.length > 0) {
        // Execute tools and continue the loop
        messages.push({ role: "assistant", content: finalMessage.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const toolBlock of toolUseBlocks) {
          const handler = this.toolHandlers.get(toolBlock.name as ToolName);
          let result: string;
          if (handler) {
            try {
              const parsed = JSON.parse(toolBlock.inputJson || "{}");
              const input: Record<string, string> = {};
              for (const [k, v] of Object.entries(parsed)) {
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
        continue; // Next streaming round with tool results
      }

      // No tool use — flush remaining sentence buffer
      if (sentenceBuffer.trim().length > 3) {
        onSentence(sentenceBuffer.trim(), sentenceCount === 0);
      }

      break; // Done
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
